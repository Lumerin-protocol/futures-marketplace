//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { StructuredLinkedList } from "solidity-linked-list/contracts/StructuredLinkedList.sol";
import { ICollateralVault } from "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol";
import { ILinearMarket } from "collateral-margin/contracts/contracts/interfaces/ILinearMarket.sol";
import { MathLib as M } from "./libs/MathLib.sol";
import { FuturesBase } from "./FuturesBase.sol";
import { FuturesAdmin } from "./FuturesAdmin.sol";

/// @title Futures — cash-settled hashrate futures CLOB (v3: aggregate positions + qty-bearing orders)
/// @dev The permissionless surface: trading, liquidation and views. Storage and internal
///      helpers live in {FuturesBase}; the owner-only surface lives in {FuturesAdmin}.
contract Futures is FuturesAdmin {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using StructuredLinkedList for StructuredLinkedList.List;

    /// @notice Implementation version, bumped on every deployed change.
    /// @dev Lives here rather than in {FuturesBase} so that a diff to this file
    ///      and the version it ships under stay in the same place — CI reads it
    ///      straight out of `Futures.sol` to require a bump.
    string public constant VERSION = "4.3.0";

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(ICollateralVault _vault) FuturesBase(_vault) { }

    function initialize(
        AggregatorV3Interface _priceOracle,
        uint8 _liquidationMarginPercent,
        uint256, // was _minimumPriceIncrement — now constant = 1e4
        uint8, // was expirationIntervalDays — now EXPIRATION_INTERVAL_DAYS constant
        uint8 _futureExpirationDatesCount,
        uint256 _firstFutureExpirationDate
    ) public initializer {
        if (_futureExpirationDatesCount < 1) {
            revert ValueOutOfRange(1, int256(uint256(type(uint8).max)));
        }

        __Ownable_init(_msgSender());
        __UUPSUpgradeable_init();
        setOracle(_priceOracle);
        liquidationMarginPercent = _liquidationMarginPercent;
        futureExpirationDatesCount = _futureExpirationDatesCount;
        firstFutureExpirationDate = _firstFutureExpirationDate;
        emit LiquidationMarginPercentUpdated(_liquidationMarginPercent);
        emit FutureExpirationDatesCountUpdated(_futureExpirationDatesCount);
    }

    // ── Order placement ───────────────────────────────────────────────────────

    /// @notice Place a limit order with explicit time-in-force (GTC / IOC / FOK).
    ///         `quantity` > 0 = buy/long, < 0 = sell/short.
    /// @dev Reduce-only legs (opposite side, size ≤ position at `expirationAt`) skip the IM check.
    function createOrder(uint256 _price, uint256 _expirationAt, int256 _quantity, TimeInForce _tif) external {
        address sender = _msgSender();
        bool skipMargin = _createOrder(sender, _price, _expirationAt, _quantity, _tif);
        if (!skipMargin) _ensureNoCollateralDeficit(sender);
    }

    /// @notice Batched placement with per-leg time-in-force — IM check once at the end.
    function createOrders(OrderIntent[] calldata _intents) external {
        address sender = _msgSender();
        uint256 len = _intents.length;
        for (uint256 i = 0; i < len; i++) {
            OrderIntent calldata intent = _intents[i];
            _createOrder(sender, intent.price, intent.expirationAt, intent.quantity, intent.timeInForce);
        }
        _ensureNoCollateralDeficit(sender);
    }

    /// @notice Cancel, reduce-in-place, then place orders — IM check once at the end.
    /// @dev Cancels/reduces run first so freed margin is available to the creates.
    ///      Reduces keep FIFO queue position; creates always join the back.
    function updateOrders(
        bytes32[] calldata _cancelIds,
        ReduceIntent[] calldata _reduces,
        OrderIntent[] calldata _intents
    ) external {
        address sender = _msgSender();
        uint256 cancelLen = _cancelIds.length;
        for (uint256 i = 0; i < cancelLen; i++) {
            _cancelOrder(sender, _cancelIds[i]);
        }
        uint256 reduceLen = _reduces.length;
        for (uint256 r = 0; r < reduceLen; r++) {
            _reduceOrderSize(sender, _reduces[r].orderId, _reduces[r].newQuantity);
        }
        uint256 createLen = _intents.length;
        for (uint256 j = 0; j < createLen; j++) {
            OrderIntent calldata intent = _intents[j];
            _createOrder(sender, intent.price, intent.expirationAt, intent.quantity, intent.timeInForce);
        }
        _ensureNoCollateralDeficit(sender);
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

    /// @notice Optionally close expired resting orders in one maintenance transaction.
    /// @dev Missing, already-closed and not-yet-expired ids are skipped so concurrent
    ///      callers cannot revert unrelated cleanup work. No protocol path calls this
    ///      automatically; expired orders are inert and do not consume future delivery caps.
    function removeOutdatedOrders(bytes32[] calldata _orderIds) external returns (uint256 removed) {
        uint256 len = _orderIds.length;
        for (uint256 i = 0; i < len; i++) {
            bytes32 orderId = _orderIds[i];
            Order memory order = orders[orderId];
            if (order.participant == address(0) || order.quantity == 0 || order.expirationAt >= block.timestamp) {
                continue;
            }
            _dropRestingOrder(orderId, order);
            removed++;
        }
    }

    /// @dev Per-leg body of `createOrder` / `createOrders` without the IM-check epilogue.
    ///      Returns true when the leg is reduce-only (single-order callers may skip IM);
    ///      batch callers always check once at the end.
    function _createOrder(
        address _participant,
        uint256 _price,
        uint256 _expirationAt,
        int256 _quantity,
        TimeInForce _tif
    ) internal returns (bool isReduceOnly) {
        _validateTIF(_tif);
        _validatePrice(_price);
        _validateExpirationAt(_expirationAt);
        _validateQty(_quantity);

        // Snapshot before matching — reduce-only vs position minus already-resting reduces.
        int256 positionBefore = participantExpirationAtNetDelta[_participant][_expirationAt];
        uint256 reducingBefore = _restingReduceAbs(_participant, _expirationAt, positionBefore);

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
                _indexRestingOrder(_participant, _expirationAt, _price, orderId);
                _increaseOrderAggregate(_participant, _expirationAt, _price, remainingQty);
            }
        } else {
            // IOC (or FOK after a full fill): never rest; close the taker order id at 0.
            if (partiallyOrFullyFilled || _tif == TimeInForce.IOC) {
                emit OrderUpdated(orderId, _participant, 0);
            }
        }

        // Opposite side and combined reducing size (resting + this intent) ≤ position.
        isReduceOnly = positionBefore != 0 && (positionBefore > 0 ? _quantity < 0 : _quantity > 0)
            && M.abs(_quantity) + reducingBefore <= M.abs(positionBefore);
    }

    /// @dev Shared cancel body for `cancelOrder` / `updateOrders`.
    function _cancelOrder(address _participant, bytes32 _orderId) internal {
        Order memory order = orders[_orderId];
        if (order.participant != _participant) revert OrderNotBelongToSender();
        if (order.quantity == 0) revert OrderNotExists();
        _dropRestingOrder(_orderId, order);
    }

    /// @dev Unindex a resting order and announce it cancelled. Callers own the authorization
    ///      decision; this only performs the removal.
    function _dropRestingOrder(bytes32 _orderId, Order memory _order) private {
        _removeRestingOrder(_orderId, _order.expirationAt, _order.price, _order.participant, _order.quantity > 0);
        emit OrderCancelled(_orderId, _order.participant);
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

    /// @notice True when the participant has resting orders or an active position and is below portfolio MM.
    /// @dev The state check is what separates this from `_underwater`: an account holding
    ///      nothing has an MM of zero, so it is never "liquidatable" even at a zero balance.
    function isLiquidatable(address _participant) public view returns (bool) {
        bool hasState = _hasActiveOrders(_participant) || participantActiveExpirationAts[_participant].length() > 0;
        return hasState && _underwater(_participant);
    }

    function _hasActiveOrders(address _participant) private view returns (bool) {
        (, uint256 count) = _activeOrderExpirations(_participant);
        return count != 0;
    }

    /// @notice Cancel one resting order of an underwater participant, charging the liquidation fee.
    function liquidateOrder(address _user, bytes32 _orderId) external {
        if (!_underwater(_user)) revert NotLiquidatable();
        Order memory order = orders[_orderId];
        if (order.participant != _user) revert OrderNotBelongToUser();
        if (order.quantity == 0) revert OrderNotExists();
        _doLiquidateOrder(_user, _orderId, order);
    }

    /// @notice Cancel keeper-chosen resting orders. Keeps prior cancels; skips
    ///         raced/stale ids; stops when the user is healthy.
    function liquidateOrders(address _user, bytes32[] calldata _orderIds) external {
        uint256 cancelled = 0;
        uint256 len = _orderIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (!_underwater(_user)) break;
            bytes32 orderId = _orderIds[i];
            Order memory order = orders[orderId];
            // Skip raced/stale ids; stop only once healthy.
            if (order.participant != _user || order.quantity == 0) continue;
            _doLiquidateOrder(_user, orderId, order);
            cancelled++;
        }
        if (cancelled == 0) revert NotLiquidatable();
    }

    function _underwater(address _participant) internal view returns (bool) {
        return vault.balanceOf(_participant) < portfolioMargin.computePortfolioMM(_participant);
    }

    function _doLiquidateOrder(address _user, bytes32 _orderId, Order memory _order) internal {
        uint256 orderNotional = _order.price * M.abs(_order.quantity);
        bool isBuy = _order.quantity > 0;
        _removeRestingOrder(_orderId, _order.expirationAt, _order.price, _order.participant, isBuy);

        uint256 liqFee = _chargeLiquidationFee(_user, orderNotional);

        emit OrderCancelled(_orderId, _user);
        emit OrderLiquidated(_orderId, _user, _msgSender(), liqFee);
        _notifyLiquidation(_msgSender(), liqFee);
    }

    // ── Position liquidation ──────────────────────────────────────────────────

    /// @notice Force-close up to `closeQty` contracts of an underwater user's net at `expirationAt`.
    /// @dev Orders-first, portfolio-wide: any resting order delta at any venue gates this call,
    ///      not just this book's. Keeper sizes `closeQty` off-chain; partial closes revert `OverLiquidation`
    ///      if leftover balance sits above IM when a real IM>MM buffer exists. Full closes skip
    ///      that guard (bad-debt / deep-underwater path).
    function liquidatePosition(address _user, uint256 _expirationAt, uint256 _closeQty) external {
        if (portfolioMargin.hasRestingOrderDelta(_user)) revert OrdersStillOpen();
        if (!_underwater(_user)) revert NotLiquidatable();
        if (_closeQty == 0) revert InvalidQty();

        int256 netQty = participantExpirationAtNetDelta[_user][_expirationAt];
        if (netQty == 0) revert NotLiquidatable();

        if (!_closePosition(_user, _expirationAt, netQty, _closeQty)) revert NotLiquidatable();
        _revertIfOverLiquidated(_user);
    }

    /// @notice Batch liquidate across expiries. Keeper chooses legs; keeps prior closes.
    /// @dev Skips empty legs; stops when healthy. End-of-tx `OverLiquidation` if oversize.
    function liquidatePositions(address _user, uint256[] calldata _expirationAts, uint256[] calldata _closeQtys)
        external
    {
        if (_expirationAts.length != _closeQtys.length) revert ArrayLengthMismatch();
        if (portfolioMargin.hasRestingOrderDelta(_user)) revert OrdersStillOpen();

        uint256 closed = 0;
        for (uint256 i = 0; i < _expirationAts.length; i++) {
            if (!_underwater(_user)) break;
            uint256 expirationAt = _expirationAts[i];
            uint256 closeQty = _closeQtys[i];
            int256 netQty = participantExpirationAtNetDelta[_user][expirationAt];
            // Skip empty/stale legs; stop only once healthy.
            if (netQty == 0 || closeQty == 0) continue;
            if (!_closePosition(_user, expirationAt, netQty, closeQty)) continue;
            closed++;
        }

        if (closed == 0) revert NotLiquidatable();
        _revertIfOverLiquidated(_user);
    }

    /// @dev Close up to `_closeQty` at `_expirationAt`. Returns false when no positive close.
    function _closePosition(address _user, uint256 _expirationAt, int256 _netQty, uint256 _closeQty)
        internal
        returns (bool)
    {
        uint256 absNet = M.abs(_netQty);
        uint256 closeAbs = M.min(_closeQty, absNet);
        if (closeAbs == 0) return false;

        if (closeAbs == absNet) {
            _doLiquidateFullPosition(_user, _expirationAt, _netQty);
            return true;
        }

        (int256 pnl, int256 signedClose) = _doPartialLiquidatePosition(_user, _expirationAt, _netQty, closeAbs);

        uint256 mark = _getMarketPrice(_getPrice());
        uint256 closedNotional = mark * closeAbs;
        uint256 liqFee = _chargeLiquidationFee(_user, closedNotional);

        emit PositionLiquidated(_user, _msgSender(), _expirationAt, signedClose, pnl, liqFee);
        _notifyLiquidation(_msgSender(), liqFee);
        return true;
    }

    /// @dev With remaining portfolio risk and a real IM>MM buffer, balance must be ≤ IM.
    function _revertIfOverLiquidated(address _user) internal view {
        uint256 im = portfolioMargin.computePortfolioIM(_user);
        uint256 mm = portfolioMargin.computePortfolioMM(_user);
        if (im > mm && vault.balanceOf(_user) > im) revert OverLiquidation();
    }

    // ── Settlement ────────────────────────────────────────────────────────────

    /// @notice Permissionlessly pin the settlement price for a matured expiry.
    function recordSettlementPrice(uint256 expirationAt) external returns (uint256 price) {
        if (block.timestamp < expirationAt) revert SettlementDateNotReached();
        return _ensureSettlementPrice(expirationAt);
    }

    /// @notice Cash-settle a matured aggregate position at the pinned settlement price.
    function settlePosition(address _user, uint256 _expirationAt) public {
        if (block.timestamp < _expirationAt) revert PositionExpirationNotStartedYet();
        int256 netQty = participantExpirationAtNetDelta[_user][_expirationAt];
        if (netQty == 0) revert PositionNotExists();

        uint256 price = _ensureSettlementPrice(_expirationAt);
        int256 netEntry = participantExpirationAtNetEntryValue[_user][_expirationAt];
        int256 pnl = int256(price) * netQty - netEntry;

        _transferPnl(_insuranceFundAccount(), _user, pnl);

        participantExpirationAtNetDelta[_user][_expirationAt] = 0;
        participantExpirationAtNetEntryValue[_user][_expirationAt] = 0;
        participantActiveExpirationAts[_user].remove(_expirationAt);

        emit PositionSettled(_user, _expirationAt, netQty, pnl, price, _msgSender());
    }

    /// @notice Cash-settle a batch of (user, expiry) pairs. Reverts if any leg is unsettleable.
    function settlePositions(address[] calldata _users, uint256[] calldata _expirationAts) external {
        if (_users.length != _expirationAts.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < _users.length; i++) {
            settlePosition(_users[i], _expirationAts[i]);
        }
    }

    /// @dev Pins the settlement price for `expirationAt` on first call; idempotent thereafter.
    function _ensureSettlementPrice(uint256 expirationAt) internal returns (uint256) {
        uint256 price = settlementPrice[expirationAt];
        if (price == 0) {
            price = _getMarketPrice(_getPrice());
            if (price == 0) revert InvalidPrice();
            settlementPrice[expirationAt] = price;
            emit SettlementPriceRecorded(expirationAt, price, _msgSender());
        }
        return price;
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getMarketPrice() public view returns (uint256) {
        return _getMarketPrice(_getPrice());
    }

    function getOrder(bytes32 _orderId) external view returns (Order memory) {
        return orders[_orderId];
    }

    /// @notice Resting orders for the currently tradable delivery window.
    function getUserOrders(address _user) external view returns (bytes32[] memory orderIds) {
        (uint256[] memory expirationAts, uint256 activeCount) = _activeOrderExpirations(_user);
        uint256 total;
        for (uint256 i = 0; i < activeCount; i++) {
            total += participantExpirationAtOrderIdsIndex[_user][expirationAts[i]].length();
        }

        orderIds = new bytes32[](total);
        uint256 cursor;
        for (uint256 i = 0; i < activeCount; i++) {
            EnumerableSet.Bytes32Set storage ids = participantExpirationAtOrderIdsIndex[_user][expirationAts[i]];
            uint256 len = ids.length();
            for (uint256 j = 0; j < len; j++) {
                orderIds[cursor++] = ids.at(j);
            }
        }
    }

    /// @notice Every physically resting order for one participant and delivery date.
    /// @dev Explicit historical reads include expired orders; normal callers should use
    ///      `getUserOrders`, whose cost and response are bounded to active deliveries.
    function getUserOrdersAtExpiration(address _user, uint256 _expirationAt)
        external
        view
        returns (bytes32[] memory orderIds)
    {
        return participantExpirationAtOrderIdsIndex[_user][_expirationAt].values();
    }

    function getOrderAggregate(address _user) external view returns (OrderAggregate memory aggregate_) {
        (uint256[] memory expirationAts, uint256 activeCount) = _activeOrderExpirations(_user);
        for (uint256 i = 0; i < activeCount; i++) {
            OrderAggregate storage aggregate = participantExpirationAtOrderAggregate[_user][expirationAts[i]];
            aggregate_.buyQty += aggregate.buyQty;
            aggregate_.sellQty += aggregate.sellQty;
            aggregate_.buyValue += aggregate.buyValue;
            aggregate_.sellValue += aggregate.sellValue;
        }
    }

    /// @notice Raw per-expiration cache, including orders awaiting cleanup after expiration.
    function getOrderAggregateAtExpiration(address _user, uint256 _expirationAt)
        external
        view
        returns (OrderAggregate memory)
    {
        return participantExpirationAtOrderAggregate[_user][_expirationAt];
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

    /// @notice Net linear delta across active positions, signed and scaled by
    ///         10^collateralDecimals: one unit per contract.
    /// @dev Deliberately does not share `_positionAggregate`: delta needs no mark, so this
    ///      view never reads the oracle and keeps answering while the feed is stale. That
    ///      matters for matured-but-unpriced expiries, where the price is stale by
    ///      construction yet the exposure still has to be reported.
    function getNetPositionDelta(address _participant) external view returns (int256) {
        EnumerableSet.UintSet storage dates = participantActiveExpirationAts[_participant];
        uint256 len = dates.length();
        int256 netDelta = 0;
        for (uint256 i = 0; i < len; i++) {
            uint256 date = dates.at(i);
            if (settlementPrice[date] != 0) continue;
            netDelta += participantExpirationAtNetDelta[_participant][date];
        }
        return netDelta * int256(10 ** collateralDecimals);
    }

    /// @dev Collect mark-independent position inputs. Future expiries cannot have a pinned
    ///      settlement price, so their settlement slots are not touched. All unpinned
    ///      positions share one live mark and can be collapsed before pricing.
    function _positionRiskInputs(address _participant)
        private
        view
        returns (int256 liveDelta, int256 liveEntryValue, int256 pinnedPnl)
    {
        EnumerableSet.UintSet storage dates = participantActiveExpirationAts[_participant];
        uint256 len = dates.length();
        for (uint256 i = 0; i < len;) {
            uint256 date = dates.at(i);
            int256 dateDelta = participantExpirationAtNetDelta[_participant][date];
            int256 entryValue = participantExpirationAtNetEntryValue[_participant][date];
            uint256 pinnedPrice = date <= block.timestamp ? settlementPrice[date] : 0;
            if (pinnedPrice != 0) {
                pinnedPnl += int256(pinnedPrice) * dateDelta - entryValue;
            } else {
                liveDelta += dateDelta;
                liveEntryValue += entryValue;
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @notice ILinearMarket: all per-user margin inputs in a single call (saves the
    ///         portfolio margin engine external-call gas). One loop computes both the
    ///         live-position delta and the mark-to-market PnL; a second aggregates the
    ///         resting book into per-side delta and instant fill loss.
    /// @dev Resting orders no longer carry their own margin figure sized off
    ///      `liquidationMarginPercent`. The engine's `imSpotShock` sizes them, applied to
    ///      order delta netted into portfolio net delta — the parameterization change
    ///      accepted when both venues migrated together. The per-expiry reduce credits are
    ///      gone with it: netting at the engine is exact and cross-product, and covers the
    ///      case a venue-local credit cannot, where the offsetting position sits elsewhere.
    function getRiskView(address _participant) external view returns (ILinearMarket.RiskView memory view_) {
        (int256 liveDelta, int256 liveEntryValue, int256 pinnedPnl) = _positionRiskInputs(_participant);
        (
            OrderAggregate memory orders_,
            uint256 liveBuyQty,
            uint256 liveSellQty,
            uint256 pinnedBuyMark,
            uint256 pinnedSellMark
        ) = _restingRiskInputs(_participant);

        uint256 livePrice;
        if (liveDelta != 0 || liveBuyQty != 0 || liveSellQty != 0) {
            livePrice = getMarketPrice();
        }
        uint256 scale = 10 ** collateralDecimals;
        view_.netPositionDelta = liveDelta * int256(scale);
        view_.unrealizedPnl = pinnedPnl + int256(livePrice) * liveDelta - liveEntryValue;
        view_.buyOrderDelta = orders_.buyQty * scale;
        view_.sellOrderDelta = orders_.sellQty * scale;

        uint256 buyMark = pinnedBuyMark + livePrice * liveBuyQty;
        uint256 sellMark = pinnedSellMark + livePrice * liveSellQty;
        if (orders_.buyValue > buyMark) view_.buyOrderFillLoss = orders_.buyValue - buyMark;
        if (sellMark > orders_.sellValue) view_.sellOrderFillLoss = sellMark - orders_.sellValue;
    }

    /// @notice Total resting order notional per side at the orders' own limit prices
    ///         (token decimals).
    /// @dev One pass over the fixed currently tradable delivery window. Historical
    ///      aggregates are never traversed and therefore cannot increase margin-call gas.
    ///
    ///      The fill-loss clamp is applied per side across all expiries rather than per
    ///      expiry — the less conservative of the two, and consistent with this venue
    ///      already collapsing every expiry into a single `netPositionDelta` and ignoring
    ///      calendar-spread risk.
    function _restingRiskInputs(address _participant)
        private
        view
        returns (
            OrderAggregate memory orders_,
            uint256 liveBuyQty,
            uint256 liveSellQty,
            uint256 pinnedBuyMark,
            uint256 pinnedSellMark
        )
    {
        (uint256[] memory expirationAts, uint256 activeCount) = _activeOrderExpirations(_participant);
        for (uint256 i = 0; i < activeCount;) {
            uint256 expirationAt = expirationAts[i];
            OrderAggregate storage aggregate = participantExpirationAtOrderAggregate[_participant][expirationAt];
            uint256 buyQty = aggregate.buyQty;
            uint256 sellQty = aggregate.sellQty;
            orders_.buyQty += buyQty;
            orders_.sellQty += sellQty;
            orders_.buyValue += aggregate.buyValue;
            orders_.sellValue += aggregate.sellValue;

            uint256 pinnedPrice = expirationAt <= block.timestamp ? settlementPrice[expirationAt] : 0;
            if (pinnedPrice == 0) {
                liveBuyQty += buyQty;
                liveSellQty += sellQty;
            } else {
                pinnedBuyMark += pinnedPrice * buyQty;
                pinnedSellMark += pinnedPrice * sellQty;
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Mark-to-market PnL across active expiries, in collateral token units.
    ///         Settled-but-unswept expiries are marked at their pinned settlement price.
    function getUnrealizedPnl(address _participant) external view returns (int256) {
        (int256 liveDelta, int256 liveEntryValue, int256 pinnedPnl) = _positionRiskInputs(_participant);
        uint256 livePrice = liveDelta != 0 ? getMarketPrice() : 0;
        return pinnedPnl + int256(livePrice) * liveDelta - liveEntryValue;
    }

    /// @notice The currently tradable expiration timestamps, earliest first.
    function getExpirationDates() external view returns (uint256[] memory) {
        uint256 currentExpirationDateIndex = _getCurrentExpirationAtIndex();
        uint256[] memory expirationDatesArray = new uint256[](futureExpirationDatesCount);
        for (uint256 i = 0; i < futureExpirationDatesCount; i++) {
            expirationDatesArray[i] = _activeExpirationAt(currentExpirationDateIndex, i);
        }
        return expirationDatesArray;
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

    /// @notice Best (highest) bid for `expirationAt`, or 0 if empty.
    function getBestBidPrice(uint256 _expirationAt) public view returns (uint256) {
        StructuredLinkedList.List storage bids = activeBidPrices[_expirationAt];
        if (bids.sizeOf() == 0) return 0;
        (, uint256 bestBid) = bids.getNextNode(0);
        return bestBid;
    }

    /// @notice Best (lowest) ask for `expirationAt`, or 0 if empty.
    function getBestAskPrice(uint256 _expirationAt) public view returns (uint256) {
        StructuredLinkedList.List storage asks = activeAskPrices[_expirationAt];
        if (asks.sizeOf() == 0) return 0;
        (, uint256 bestAsk) = asks.getNextNode(0);
        return bestAsk;
    }

    /// @notice Simulate a limit order: filled qty, VWAP, and remainder (view, no state change).
    /// @dev Skips own resting liquidity (matches on-match STP net-out). Self-trade is judged
    ///      against the caller, so simulating for another account requires setting the
    ///      `eth_call` `from` field to that account.
    function simulateOrder(uint256 _expirationAt, uint256 _price, int256 _quantity)
        external
        view
        returns (int256 filledQuantity, uint256 averageFillPrice, int256 remainingQuantity)
    {
        if (_quantity == 0) return (0, 0, 0);

        bool isBuy = _quantity > 0;
        int256 remaining = _quantity;
        uint256 totalNotional = 0;
        uint256 totalFilledAbs = 0;
        StructuredLinkedList.List storage oppositePrices =
            isBuy ? activeAskPrices[_expirationAt] : activeBidPrices[_expirationAt];
        (, uint256 currentPrice) = oppositePrices.getNextNode(0);

        while (currentPrice != 0 && remaining != 0) {
            if (isBuy && currentPrice > _price) break;
            if (!isBuy && currentPrice < _price) break;

            StructuredLinkedList.List storage orderQueue =
                _expirationAtPriceOrderIds(_expirationAt, currentPrice, !isBuy);
            (, uint256 orderIdUint) = orderQueue.getNextNode(0);

            while (orderIdUint != 0 && remaining != 0) {
                Order storage makerOrder = orders[bytes32(orderIdUint)];
                // STP: own resting size would net out, not fill.
                if (makerOrder.participant != _msgSender() && makerOrder.quantity != 0) {
                    uint256 matchAmt = M.min(M.abs(makerOrder.quantity), M.abs(remaining));
                    if (matchAmt > 0) {
                        totalNotional += currentPrice * matchAmt;
                        totalFilledAbs += matchAmt;
                        remaining -= M.toSigned(isBuy, matchAmt);
                    }
                } else if (makerOrder.participant == _msgSender() && makerOrder.quantity != 0) {
                    uint256 cancelAmt = M.min(M.abs(makerOrder.quantity), M.abs(remaining));
                    remaining -= M.toSigned(isBuy, cancelAmt);
                }
                (, orderIdUint) = orderQueue.getNextNode(orderIdUint);
            }

            (, currentPrice) = oppositePrices.getNextNode(currentPrice);
        }

        remainingQuantity = remaining;
        filledQuantity = _quantity - remainingQuantity;
        if (totalFilledAbs > 0) {
            averageFillPrice = totalNotional / totalFilledAbs;
        }
    }

    /// @notice Sum of resting abs quantity at one (expirationAt, price, side).
    function getQuantityAtPrice(uint256 _expirationAt, uint256 _price, bool _isBid) external view returns (uint256) {
        StructuredLinkedList.List storage queue = _expirationAtPriceOrderIds(_expirationAt, _price, _isBid);

        uint256 total = 0;
        uint256 size = queue.sizeOf();
        if (size == 0) return 0;

        (, uint256 nodeId) = queue.getNextNode(0);
        for (uint256 i = 0; i < size && nodeId != 0; i++) {
            total += M.abs(orders[bytes32(nodeId)].quantity);
            (, nodeId) = queue.getNextNode(nodeId);
        }
        return total;
    }

    function expirationIntervalDays() external pure returns (uint8) {
        return EXPIRATION_INTERVAL_DAYS;
    }
}
