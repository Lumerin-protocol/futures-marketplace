//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { StructuredLinkedList } from "solidity-linked-list/contracts/StructuredLinkedList.sol";
import { ICollateralVault } from "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol";
import { ILinearMarket } from "collateral-margin/contracts/contracts/interfaces/ILinearMarket.sol";
import { ILinearMarketExposure } from "collateral-margin/contracts/contracts/interfaces/ILinearMarketExposure.sol";
import { MathLib as M } from "./libs/MathLib.sol";
import { FuturesBookLib } from "./libs/FuturesBookLib.sol";
import { IMarkRangeOracle } from "./interfaces/IMarkRangeOracle.sol";
import { HashPowerFuturesBase } from "./HashPowerFuturesBase.sol";
import { HashPowerFuturesAdmin } from "./HashPowerFuturesAdmin.sol";
import { HashPowerFuturesAdminModule } from "./HashPowerFuturesAdminModule.sol";

/// @title HashPowerFutures — cash-settled hashrate futures CLOB (v3: aggregate positions + qty-bearing orders)
/// @dev The permissionless surface: trading, liquidation and views. Storage and internal
///      helpers live in {HashPowerFuturesBase}; the owner-only surface lives in {HashPowerFuturesAdmin}.
contract HashPowerFutures is HashPowerFuturesAdmin {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using StructuredLinkedList for StructuredLinkedList.List;

    /// @notice Implementation version, bumped on every deployed change.
    /// @dev Lives here rather than in {HashPowerFuturesBase} so that a diff to this file
    ///      and the version it ships under stay in the same place — CI reads it
    ///      straight out of `HashPowerFutures.sol` to require a bump.
    string public constant VERSION = "6.18.1";

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(ICollateralVault _vault) HashPowerFuturesBase(_vault) HashPowerFuturesAdmin(_vault) { }

    function initialize(
        IMarkRangeOracle _oracle,
        uint8 _liquidationMarginPercent,
        uint8 _futureExpirationDatesCount,
        uint256 _firstFutureExpirationDate
    ) public initializer {
        if (_futureExpirationDatesCount < 1) {
            revert ValueOutOfRange(1, int256(uint256(type(uint8).max)));
        }

        __Ownable_init(_msgSender());
        __UUPSUpgradeable_init();
        _delegateCallAdminModule(abi.encodeCall(HashPowerFuturesAdminModule.setOracle, (_oracle)));
        liquidationMarginPercent = _liquidationMarginPercent;
        futureExpirationDatesCount = _futureExpirationDatesCount;
        firstFutureExpirationDate = _firstFutureExpirationDate;
        emit LiquidationMarginPercentUpdated(_liquidationMarginPercent);
        emit FutureExpirationDatesCountUpdated(_futureExpirationDatesCount);

        // The delivery chain starts on the plain grid and the first window is pinned at once, so
        // `getExpirationDates()` is final from the first block.
        if (_firstFutureExpirationDate > type(uint64).max) {
            revert ValueOutOfRange(0, int256(uint256(type(uint64).max)));
        }
        uint64 first = uint64(_firstFutureExpirationDate);
        expirySchedule = ExpirySchedule({
            pinnedCount: 0,
            anchorSlot: 0,
            anchorTime: first,
            prevAnchorSlot: 0,
            prevAnchorTime: first
        });
        _pinDue();
    }

    // ── Order placement ───────────────────────────────────────────────────────

    /// @notice Place a limit order with explicit time-in-force (GTC / IOC / FOK).
    ///         `quantity` > 0 = buy/long, < 0 = sell/short.
    /// @dev Locally reducing legs are accepted below IM only when authoritative portfolio IM
    ///      does not increase, so cross-venue exposure cannot bypass the margin gate, and the
    ///      MM deficit does not grow (the engine's `reduceLimits` / `meetsTradeMargin`). The
    ///      taker must pay any realized loss in full.
    function createOrder(uint256 _price, uint256 _expirationAt, int256 _quantity, TimeInForce _tif) external {
        _requireTradingOpen();
        _pinDue();
        address sender = _msgSender();
        _validateOrderIntent(_price, _expirationAt, _quantity, _tif);
        uint256 maxAllowedIm;
        uint256 maxAllowedMmDeficit;
        if (_isLocallyReducing(sender, _expirationAt, _quantity)) {
            (maxAllowedIm, maxAllowedMmDeficit) = portfolioMargin.reduceLimits(sender);
        }
        _createOrder(sender, _price, _expirationAt, _quantity, _tif);
        _ensureNoCollateralDeficit(sender, maxAllowedIm, maxAllowedMmDeficit);
    }

    /// @notice Batched placement with per-leg time-in-force — IM check once at the end.
    /// @dev Unlike `createOrder`, batch placement does not use the below-IM,
    ///      portfolio-non-increasing exception. Any non-empty batch must leave
    ///      the account fully above portfolio IM. This avoids an additional
    ///      pre-batch PME traversal.
    ///      Empty input reverts so simulate-before-write callers do not submit
    ///      a no-op transaction.
    function createOrders(OrderIntent[] calldata _intents) external {
        _requireTradingOpen();
        _pinDue();
        uint256 len = _intents.length;
        if (len == 0) revert EmptyBatch();
        address sender = _msgSender();
        _placeIntents(sender, _intents);
        _ensureNoCollateralDeficit(sender, 0, 0);
    }

    /// @dev Validate and place each intent for `_sender`; shared by the two batch entry points.
    function _placeIntents(address _sender, OrderIntent[] calldata _intents) internal {
        uint256 len = _intents.length;
        for (uint256 i = 0; i < len; i++) {
            OrderIntent calldata intent = _intents[i];
            _validateOrderIntent(intent.price, intent.expirationAt, intent.quantity, intent.timeInForce);
            _createOrder(_sender, intent.price, intent.expirationAt, intent.quantity, intent.timeInForce);
        }
    }

    /// @notice Cancel, reduce-in-place, then place orders — IM check once at the end.
    /// @dev Cancels/reduces run first so freed margin is available to the creates.
    ///      Reduces keep FIFO queue position; creates always join the back.
    ///      Cancel/reduce-only batches skip PME because they cannot expand possible
    ///      post-fill exposures. Batches with creates use one strict final IM check;
    ///      the single-order below-IM exception does not apply.
    function updateOrders(
        bytes32[] calldata _cancelIds,
        ReduceIntent[] calldata _reduces,
        OrderIntent[] calldata _intents
    ) external {
        if (_intents.length != 0) {
            _requireTradingOpen();
            _pinDue();
        }
        address sender = _msgSender();
        uint256 cancelLen = _cancelIds.length;
        for (uint256 i = 0; i < cancelLen; i++) {
            _cancelOrder(sender, _cancelIds[i]);
        }
        uint256 reduceLen = _reduces.length;
        for (uint256 r = 0; r < reduceLen; r++) {
            _reduceOrderSize(sender, _reduces[r].orderId, _reduces[r].newQuantity);
        }
        if (_intents.length != 0) {
            _placeIntents(sender, _intents);
            _ensureNoCollateralDeficit(sender, 0, 0);
        }
    }

    /// @notice Shrink a resting order owned by the caller without losing FIFO priority.
    /// @dev Rejects grow / sign flip / zero (use `cancelOrder` to remove entirely).
    function reduceOrderSize(bytes32 _orderId, int256 _newQuantity) external {
        _reduceOrderSize(_msgSender(), _orderId, _newQuantity);
    }

    /// @notice Cancel a resting order owned by the caller.
    function cancelOrder(bytes32 _orderId) external {
        _cancelOrder(_msgSender(), _orderId);
    }

    /// @notice See {HashPowerFuturesAdminModule-removeOutdatedOrders}. Permissionless; runs in the
    ///         module by delegatecall (a maintenance call, so the hop's gas is immaterial).
    function removeOutdatedOrders(bytes32[] calldata _orderIds) external returns (uint256 removed) {
        (_orderIds, removed);
        _delegateToAdminModule();
    }

    /// @dev Validated per-leg body of `createOrder` / `createOrders` without the IM-check epilogue.
    function _createOrder(
        address _participant,
        uint256 _price,
        uint256 _expirationAt,
        int256 _quantity,
        TimeInForce _tif
    ) internal {
        bytes32 orderId = _nextOrderId();
        emit OrderCreated(orderId, _participant, _price, _quantity, _expirationAt);

        int256 remainingQty = _matchWithOppositeOrders(_participant, _price, _expirationAt, _quantity);
        uint256 remainingAbs = M.abs(remainingQty);
        bool partiallyOrFullyFilled = remainingAbs != M.abs(_quantity);

        if (_tif == TimeInForce.FOK && remainingAbs > 0) revert TimeInForceNotFilled();
        if (_tif == TimeInForce.IOC && !partiallyOrFullyFilled) revert TimeInForceNotFilled();

        if (_tif == TimeInForce.GTC) {
            if (partiallyOrFullyFilled) {
                emit OrderUpdated(orderId, _participant, remainingQty);
            }
            if (remainingAbs > 0) {
                EnumerableSet.Bytes32Set storage participantOrders =
                    participantExpirationAtOrderIdsIndex[_participant][_expirationAt];
                if (participantOrders.length() >= MAX_ORDERS_PER_PARTICIPANT_PER_EXPIRATION) {
                    revert MaxOrdersPerParticipantPerExpirationReached();
                }
                orders[orderId] = Order({
                    participant: _participant,
                    price: _price,
                    quantity: remainingQty,
                    expirationAt: _expirationAt
                });
                StructuredLinkedList.List storage orderQueue =
                    _expirationAtPriceOrderIds(_expirationAt, _price, _quantity > 0);
                _addOrderToQueue(orderQueue, orderId, _expirationAt, _price, _quantity > 0);
                _indexRestingOrder(_participant, _expirationAt, orderId);
                _increaseOrderAggregate(_participant, _expirationAt, _price, remainingQty);
            }
        } else {
            // IOC (or FOK after a full fill): never rest; close the taker order id at 0.
            if (partiallyOrFullyFilled || _tif == TimeInForce.IOC) {
                emit OrderUpdated(orderId, _participant, 0);
            }
        }

    }

    /// @dev Shared cancel body for `cancelOrder` / `updateOrders`.
    function _cancelOrder(address _participant, bytes32 _orderId) internal {
        Order storage order = orders[_orderId];
        if (order.participant != _participant) revert OrderNotBelongToSender();
        if (order.quantity == 0) revert OrderNotExists();
        _dropRestingOrder(_orderId, true);
    }

    /// @dev In-place size shrink. Keeps the order id in its price/expiry queue slot.
    function _reduceOrderSize(address _participant, bytes32 _orderId, int256 _newQuantity) internal {
        Order storage order = orders[_orderId];
        if (order.participant == address(0) || order.quantity == 0) revert OrderNotExists();
        if (order.participant != _participant) revert OrderNotBelongToSender();

        int256 oldQty = order.quantity;
        if (_newQuantity == 0 || (_newQuantity > 0) != (oldQty > 0)) revert InvalidReduceQuantity();
        if (M.abs(_newQuantity) >= M.abs(oldQty)) revert InvalidReduceQuantity();

        _decreaseOrderAggregate(
            order.participant, order.expirationAt, order.price, M.abs(oldQty) - M.abs(_newQuantity), oldQty > 0
        );
        order.quantity = _newQuantity;
        emit OrderUpdated(_orderId, order.participant, _newQuantity);
    }

    // ── Order liquidation ─────────────────────────────────────────────────────

    /// @notice Whether the participant has margin-relevant orders in the tradable window.
    /// @dev Part of the ILinearMarket surface read by the portfolio margin engine. The
    ///      liquidatability predicate itself lives on the engine
    ///      ({IPortfolioMarginEngine-isLiquidatable}) — it is a property of the portfolio,
    ///      not of any single venue. Combine it with this view and the position views to
    ///      tell whether this venue holds anything actionable.
    function hasRestingOrderDelta(address _participant) external view returns (bool) {
        (, uint256 count) = _activeOrderExpirations(_participant);
        return count != 0;
    }

    // Liquidation bodies live in the admin module (reached by delegatecall, in this contract's
    // storage) so the venue fits EIP-170; the hop costs about 2.6k gas on a liquidation, a keeper
    // path. Each stub keeps its ABI.

    /// @notice See {HashPowerFuturesAdminModule-liquidateOrder}.
    function liquidateOrder(address _user, bytes32 _orderId) external {
        (_user, _orderId);
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-liquidateOrders}.
    function liquidateOrders(address _user, bytes32[] calldata _orderIds) external {
        (_user, _orderIds);
        _delegateToAdminModule();
    }

    // ── Position liquidation ──────────────────────────────────────────────────

    /// @notice See {HashPowerFuturesAdminModule-liquidatePosition}.
    function liquidatePosition(address _user, uint256 _expirationAt, uint256 _closeQty) external {
        (_user, _expirationAt, _closeQty);
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-liquidatePositions}.
    function liquidatePositions(address _user, uint256[] calldata _expirationAts, uint256[] calldata _closeQtys)
        external
    {
        (_user, _expirationAts, _closeQtys);
        _delegateToAdminModule();
    }

    // ── Backstop unwind ───────────────────────────────────────────────────────

    /// @notice Reduce the protocol backstop's leg at `_expirationAt` by up to `_qty` contracts as a
    ///         taker, inside `mark ± backstopUnwindBandBps`, and pay the caller
    ///         `backstopUnwindFeeBps` of the filled notional at the mark from the fee pot.
    /// @dev Permissionless. Reverts `TradingHalted` while the vault is halted, since a fill would
    ///      open positions users cannot reduce until it clears. Reduce-only by construction. Reverts `TimeInForceNotFilled` when nothing
    ///      inside the band fills, so callers can simulate before sending. The fee is capped at
    ///      the fee pot balance. Matured backstop legs go through `settlePosition` instead.
    function unwindBackstop(uint256 _expirationAt, uint256 _qty) external {
        _requireTradingOpen();
        _pinDue();
        if (!_isActiveExpirationAt(_expirationAt)) revert ExpirationDateNotAvailable();
        if (_qty == 0) revert InvalidQty();
        int256 net = participantExpirationAtNetDelta[BACKSTOP][_expirationAt];
        if (net == 0) revert PositionNotExists();

        bool isBuy = net < 0;
        uint256 closeAbs = M.min(_qty, M.abs(net));
        uint256 mark = _sideMark(_expirationAt, net > 0);
        (uint16 bandBps, uint16 feeBps) = vault.backstopParams();
        uint256 limit = _bandPrice(mark, isBuy, bandBps);
        if (limit == 0) revert InvalidPrice();

        // Same log sequence as an IOC through `_createOrder`, without routing through it: the IR
        // inliner would specialize a whole copy of `_createOrder` for the constant TIF (~550 bytes).
        bytes32 orderId = _nextOrderId();
        int256 qty = M.toSigned(isBuy, closeAbs);
        emit OrderCreated(orderId, BACKSTOP, limit, qty, _expirationAt);
        int256 remaining = _matchWithOppositeOrders(BACKSTOP, limit, _expirationAt, qty);
        if (remaining == qty) revert TimeInForceNotFilled();
        emit OrderUpdated(orderId, BACKSTOP, 0);
        uint256 filledAbs = closeAbs - M.abs(remaining);

        uint256 fee = M.min(mark * filledAbs * feeBps / BPS, _vaultBalance(address(this)));
        if (fee != 0) _internalTransfer(address(this), _msgSender(), fee);

        emit BackstopUnwound(_msgSender(), _expirationAt, M.toSigned(isBuy, filledAbs), fee);
    }

    // ── Settlement ────────────────────────────────────────────────────────────
    //
    // Permissionless, run by the keeper once per matured expiry; the bodies live in the admin
    // module (reached by delegatecall, in this contract's storage) so the venue fits EIP-170.

    /// @notice See {HashPowerFuturesAdminModule-recordSettlementPrice}.
    function recordSettlementPrice(uint256 expirationAt) external returns (uint256 price) {
        (expirationAt, price);
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-settlePosition}.
    function settlePosition(address _user, uint256 _expirationAt) external {
        (_user, _expirationAt);
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-settlePositions}.
    function settlePositions(address[] calldata _users, uint256[] calldata _expirationAts) external {
        (_users, _expirationAts);
        _delegateToAdminModule();
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getMarketPrice() public view returns (uint256) {
        return _marketPrice();
    }

    function getOrder(bytes32 _orderId) external view returns (Order memory) {
        return orders[_orderId];
    }

    /// @notice Every physically resting order for one participant and delivery date.
    /// @dev Explicit historical reads include expired orders. For the currently tradable
    ///      window, callers should multicall over `getExpirationDates()`.
    function getUserOrdersAtExpiration(address _user, uint256 _expirationAt)
        external
        view
        returns (bytes32[] memory orderIds)
    {
        return participantExpirationAtOrderIdsIndex[_user][_expirationAt].values();
    }

    /// @notice Raw per-expiration cache, including orders awaiting cleanup after expiration:
    ///         quantity and the first two price moments per side, the inputs of the fill-loss
    ///         bound.
    function getOrderAggregateAtExpiration(address _user, uint256 _expirationAt)
        external
        view
        returns (RestingOrderAggregate memory)
    {
        return participantExpirationAtRestingOrderAggregate[_user][_expirationAt];
    }

    function getUserPosition(address _user, uint256 _expirationAt) external view returns (Position memory) {
        return Position({
            netQuantity: participantExpirationAtNetDelta[_user][_expirationAt],
            netEntryValue: participantExpirationAtNetEntryValue[_user][_expirationAt]
        });
    }

    function getActiveExpirationDates(address _user) external view returns (uint256[] memory) {
        return participantActiveExpirationAts[_user].values();
    }

    /// @dev The resting book per side: quantity (contracts), instant fill loss and exposure
    ///      (token decimals), each expiry priced at its pinned settlement or its mark range.
    struct RestingRisk {
        uint256 buyQty;
        uint256 sellQty;
        uint256 buyLoss;
        uint256 sellLoss;
        uint256 buyExposure;
        uint256 sellExposure;
    }

    /// @dev Live positions summed: delta (contracts) and exposure (token decimals) at their marks.
    struct PositionRisk {
        int256 liveDelta;
        int256 liveExposure;
        int256 unrealizedPnl;
    }

    /// @notice ILinearMarketExposure: all per-user margin inputs in a single call, with live
    ///         positions and resting orders valued at each expiry's mark.
    /// @dev The engine reads this and shocks the exposure by a percentage, so a mark need not be
    ///      the index it stresses: a date settling after a halving is worth about half of it.
    function getExposureView(address _participant)
        external
        view
        returns (ILinearMarketExposure.ExposureView memory view_)
    {
        (PositionRisk memory positions, RestingRisk memory resting) = _riskInputs(_participant, true);
        view_.netPositionExposure = positions.liveExposure;
        view_.unrealizedPnl = positions.unrealizedPnl;
        view_.buyOrderExposure = resting.buyExposure;
        view_.sellOrderExposure = resting.sellExposure;
        view_.buyOrderFillLoss = resting.buyLoss;
        view_.sellOrderFillLoss = resting.sellLoss;
    }

    /// @notice ILinearMarket: all per-user margin inputs in a single call, with deltas in
    ///         contracts.
    /// @dev Deprecated for margin: the engine reads `getExposureView`, and this only for a venue
    ///      without it, valuing the deltas at its index.
    function getRiskView(address _participant) external view returns (ILinearMarket.RiskView memory view_) {
        (PositionRisk memory positions, RestingRisk memory resting) = _riskInputs(_participant, true);
        uint256 scale = 10 ** collateralDecimals;
        view_.netPositionDelta = positions.liveDelta * int256(scale);
        view_.unrealizedPnl = positions.unrealizedPnl;
        view_.buyOrderDelta = resting.buyQty * scale;
        view_.sellOrderDelta = resting.sellQty * scale;
        view_.buyOrderFillLoss = resting.buyLoss;
        view_.sellOrderFillLoss = resting.sellLoss;
    }

    /// @notice Mark-to-market PnL across active expiries, in collateral token units: live expiries
    ///         at their marks (longs at the low mark, shorts at the high), settled-but-unswept ones
    ///         at their pinned settlement price.
    function getUnrealizedPnl(address _participant) external view returns (int256) {
        (PositionRisk memory positions,) = _riskInputs(_participant, false);
        return positions.unrealizedPnl;
    }

    /// @notice The mark range of `_expirationAt` in collateral token units: longs and bids are valued
    ///         at `low`, shorts and asks at `high` (both the index mark without a mark oracle).
    function getMarkRange(uint256 _expirationAt) external view returns (uint256 low, uint256 high) {
        return _markRange(_expirationAt);
    }

    /// @dev One mark read for every live expiry the account holds or rests orders on, then one
    ///      loop over positions and one over the resting book. Resting orders carry no margin
    ///      figure of their own: the engine's `imSpotShock` sizes them, netted into the portfolio —
    ///      exact and cross-product, covering the case a venue-local reduce credit cannot, where
    ///      the offsetting position sits elsewhere. The fill loss is bounded per expiry (bids at
    ///      the low mark, asks at the high, since a filled bid is a long) and summed, never netted
    ///      across orders: fills go best price first, so a deep order must never offset a
    ///      marketable one's loss. One pass over the tradable window: historical aggregates are
    ///      never traversed.
    function _riskInputs(address _participant, bool _withOrders)
        private
        view
        returns (PositionRisk memory positions, RestingRisk memory resting)
    {
        EnumerableSet.UintSet storage dates = participantActiveExpirationAts[_participant];
        uint256 positionCount = dates.length();
        uint256[] memory orderDates;
        uint256 orderCount;
        if (_withOrders) (orderDates, orderCount) = _activeOrderExpirations(_participant);

        uint256[] memory live = new uint256[](positionCount + orderCount);
        uint256 liveCount;
        for (uint256 i = 0; i < positionCount; i++) {
            uint256 date = dates.at(i);
            if (_pinnedPrice(date) == 0) live[liveCount++] = date;
        }
        for (uint256 i = 0; i < orderCount; i++) {
            if (_pinnedPrice(orderDates[i]) == 0) live[liveCount++] = orderDates[i];
        }
        assembly ("memory-safe") {
            mstore(live, liveCount)
        }
        (uint256[] memory low, uint256[] memory high) = _markRanges(live);

        uint256 k;
        for (uint256 i = 0; i < positionCount; i++) {
            uint256 date = dates.at(i);
            int256 delta = participantExpirationAtNetDelta[_participant][date];
            uint256 price = _pinnedPrice(date);
            if (price == 0) {
                price = delta > 0 ? low[k] : high[k];
                k++;
                positions.liveDelta += delta;
                positions.liveExposure += delta * int256(price);
            }
            positions.unrealizedPnl +=
                int256(price) * delta - participantExpirationAtNetEntryValue[_participant][date];
        }
        for (uint256 i = 0; i < orderCount; i++) {
            uint256 date = orderDates[i];
            RestingOrderAggregate storage aggregate = participantExpirationAtRestingOrderAggregate[_participant][date];
            uint256 bidPrice = _pinnedPrice(date);
            uint256 askPrice = bidPrice;
            if (bidPrice == 0) {
                (bidPrice, askPrice) = (low[k], high[k]);
                k++;
            }
            resting.buyQty += aggregate.buyQty;
            resting.sellQty += aggregate.sellQty;
            resting.buyLoss += M.fillLossBound(aggregate.buyQty, aggregate.buyPQ, aggregate.buyP2Q, bidPrice, true);
            resting.sellLoss +=
                M.fillLossBound(aggregate.sellQty, aggregate.sellPQ, aggregate.sellP2Q, askPrice, false);
            resting.buyExposure += aggregate.buyQty * bidPrice;
            resting.sellExposure += aggregate.sellQty * askPrice;
        }
    }

    /// @dev A matured expiry's pinned settlement price; 0 while it is live or not yet pinned.
    function _pinnedPrice(uint256 _expirationAt) private view returns (uint256) {
        return _expirationAt <= block.timestamp ? settlementPrice[_expirationAt] : 0;
    }

    /// @notice The currently tradable expiration timestamps, earliest first. A slot not pinned
    ///         yet (only while no pin has run since it rolled in) shows the chain's date, which
    ///         the pin may still move clear of the halving; see {pinExpiry}.
    function getExpirationDates() external view returns (uint256[] memory) {
        return _windowExpiries();
    }

    // ── Delivery schedule ─────────────────────────────────────────────────────

    /// @dev Pin any unpinned slot of the tradable window (normally none: one read and a compare).
    ///      The pinning itself runs in the admin module, so the hot paths carry only the check.
    function _pinDue() internal {
        if (_pinIsDue(expirySchedule)) {
            _delegateCallAdminModule(abi.encodeCall(HashPowerFuturesAdminModule.pinWindow, ()));
        }
    }

    /// @notice The schedule in one read: the first slot whose date is still ahead (the tradable
    ///         window starts there), how many slots are pinned (`pinExpiry` pins this slot when it
    ///         is at most one past the window), and the date that matured last (0 before the first).
    function deliverySchedule()
        external
        view
        returns (uint256 currentSlot, uint256 pinnedCount, uint256 previousExpiry)
    {
        ExpirySchedule memory s = expirySchedule;
        currentSlot = _currentSlot(s);
        pinnedCount = s.pinnedCount;
        if (currentSlot != 0) previousExpiry = _expiryOfSlot(currentSlot - 1, s);
    }

    /// @notice Active bid/ask price levels for one expiration (bids high→low, asks low→high).
    function getOrderBookPrices(uint256 _expirationAt, uint256 _maxLevels)
        external
        view
        returns (uint256[] memory bids, uint256[] memory asks)
    {
        bids = _activePricesSlice(activeBidPrices[_expirationAt], _maxLevels);
        asks = _activePricesSlice(activeAskPrices[_expirationAt], _maxLevels);
    }

    /// @notice Simulate a limit order: filled qty, VWAP, and remainder (view, no state change).
    /// @dev Skips own resting liquidity (matches on-match STP net-out). Self-trade is judged
    ///      against the caller, so simulating for another account requires setting the
    ///      `eth_call` `from` field to that account. Served by {FuturesBookLib} (an external
    ///      library linked at deploy) to keep the venue under EIP-170; off-chain callers only.
    function simulateOrder(uint256 _expirationAt, uint256 _price, int256 _quantity)
        external
        view
        returns (int256 filledQuantity, uint256 averageFillPrice, int256 remainingQuantity)
    {
        return FuturesBookLib.simulateOrder(
            activeBidPrices,
            activeAskPrices,
            expirationAtPriceOrdersLongIdQueue,
            expirationAtPriceOrdersShortIdQueue,
            orders,
            _msgSender(),
            _expirationAt,
            _price,
            _quantity
        );
    }

    /// @notice Sum of resting abs quantity at one (expirationAt, price, side). See {simulateOrder}
    ///         for where it runs.
    function getQuantityAtPrice(uint256 _expirationAt, uint256 _price, bool _isBid) external view returns (uint256) {
        return FuturesBookLib.quantityInQueue(_expirationAtPriceOrderIds(_expirationAt, _price, _isBid), orders);
    }

    function expirationIntervalDays() external pure returns (uint8) {
        return EXPIRATION_INTERVAL_DAYS;
    }
}
