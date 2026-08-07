//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { MulticallUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { StructuredLinkedList } from "solidity-linked-list/contracts/StructuredLinkedList.sol";
import { Versionable } from "./interfaces/Versionable.sol";
import { ICollateralVault } from "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol";
import { IPortfolioMarginEngine } from "collateral-margin/contracts/contracts/interfaces/IPortfolioMarginEngine.sol";
import { IPointsHook } from "collateral-margin/contracts/contracts/interfaces/IPointsHook.sol";
import { PriceLadderLib } from "./libs/PriceLadderLib.sol";
import { MathLib as M } from "./libs/MathLib.sol";

/// @title FuturesBase — storage layout and internal helpers for {Futures}
/// @dev Owns the full UUPS storage layout (declaration order is part of the layout — do not reorder).
///      {Futures} declares no state of its own; append new storage here, at the end.
abstract contract FuturesBase is UUPSUpgradeable, OwnableUpgradeable, MulticallUpgradeable, Versionable {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using StructuredLinkedList for StructuredLinkedList.List;

    // ── Storage (declaration order is part of the UUPS layout — do not reorder) ──

    mapping(bytes32 => Order) internal orders;
    /// @dev Dead after v3 reset: former bilateral lot mapping. Slot retained for upgrade safety.
    mapping(bytes32 => LegacyLot) internal positions;
    mapping(uint256 => mapping(uint256 => StructuredLinkedList.List)) private expirationAtPriceOrdersLongIdQueue;
    mapping(uint256 => mapping(uint256 => StructuredLinkedList.List)) private expirationAtPriceOrdersShortIdQueue;
    /// @dev Dead after v3: former bilateral lot index. Slot retained.
    mapping(address => EnumerableSet.Bytes32Set) internal participantPositionIdsIndex;
    mapping(address => EnumerableSet.Bytes32Set) internal participantOrderIdsIndex;
    /// @dev Dead after v3: former per-(user, expiry) lot index. Slot retained.
    mapping(address => mapping(uint256 => EnumerableSet.Bytes32Set)) internal participantExpirationAtPositionIdsIndex;
    mapping(address => mapping(uint256 => mapping(uint256 => EnumerableSet.Bytes32Set))) private
        participantExpirationAtPriceOrderIdsIndex;

    uint256 private __gap0;
    uint256 public firstFutureExpirationDate;
    /// @dev Reserved — formerly `contractSizeHpsDay` / `speedHps`.
    uint256 private __gap1;
    uint256 private __gap2;
    /// @dev Dead — former takerFee (flat). Now bps-based, appended at end of storage.
    uint256 private __gap3;
    uint256 private nonce = 0;

    address private __gap4;
    /// @notice Hashprice oracle (price of 1 PH/s per day in `token` currency).
    AggregatorV3Interface public priceOracle;
    address private __gap5;

    /// @dev Reserved — formerly `deliveryDurationDays`.
    uint8 private __gap6;
    /// @dev Reserved — formerly `expirationIntervalDays` (now `EXPIRATION_INTERVAL_DAYS` constant).
    uint8 private __gap7;
    uint8 public futureExpirationDatesCount;
    /// @notice Vestigial. No contract reads this — margin is sized entirely by the
    ///         portfolio margin engine's spot shocks. The slot and its public getter are
    ///         retained for upgrade safety and for consumers still reading it, but the
    ///         value has no effect on margin, liquidation or order acceptance. Do not
    ///         derive margin figures from it.
    uint8 public liquidationMarginPercent;
    uint8 private __gap8;
    string private __gap9;
    uint256 public collectedFeesBalance;
    uint256 private __gap10;
    /// @dev Reserved — formerly `addressFeeDiscountPercent`.
    mapping(address => uint8) private __gap11;
    /// @dev Dead — former hashpriceScalingDivisor. Oracle scaling now via M.scaleDecimals.
    uint256 private __gap12;

    IPortfolioMarginEngine public portfolioMargin;
    /// @notice Canonical net position quantity per (participant, expirationAt). +long / -short.
    mapping(address => mapping(uint256 => int256)) internal participantExpirationAtNetDelta;
    /// @notice Canonical Σ qty_i * entryPrice_i per (participant, expirationAt), token decimals.
    mapping(address => mapping(uint256 => int256)) internal participantExpirationAtNetEntryValue;

    /// @dev Sorted bid prices per expiration (highest first).
    mapping(uint256 => StructuredLinkedList.List) internal activeBidPrices;
    /// @dev Sorted ask prices per expiration (lowest first).
    mapping(uint256 => StructuredLinkedList.List) internal activeAskPrices;

    /// @dev Dead — former liquidationFee (flat). Now bps-based via liquidationFeeBps.
    uint256 private __gap13;

    /// @dev Dead — former makerFee (flat). Now bps-based, appended at end of storage.
    uint256 private __gap14;

    IPointsHook public hook;

    /// @notice Pinned cash-settlement price per expiration (`0` = unset).
    mapping(uint256 => uint256) public settlementPrice;

    /// @dev Expiration timestamps at which a participant holds a non-zero aggregate position.
    mapping(address => EnumerableSet.UintSet) internal participantActiveExpirationAts;

    /// @notice Liquidation fee in basis points on the liquidated notional.
    ///         e.g., 50 = 0.5% of the closed position or cancelled order value.
    /// @dev Appended at end of storage to preserve the upgradeable layout.
    uint16 public liquidationFeeBps;
    /// @notice Share of the liquidation fee paid to the keeper (msg.sender).
    ///         In basis points: 10_000 = 100% to liquidator, 5_000 = 50/50 split.
    ///         The remainder goes to the insurance fund.
    /// @dev Appended at end of storage to preserve the upgradeable layout.
    uint16 public liquidatorShareBps;

    /// @notice Taker fee in basis points (e.g., 5 = 0.05% of notional).
    /// @dev Appended at end of storage to preserve the upgradeable layout.
    int16 public takerFeeBps;
    /// @notice Maker fee in basis points (e.g., 0 = 0% of notional).
    /// @dev Appended at end of storage to preserve the upgradeable layout.
    int16 public makerFeeBps;

    /// @notice Decimals of the oracle feed (cached for gas).
    /// @dev Appended at end of storage to preserve the upgradeable layout.
    /// @dev `internal` so {FuturesAdmin-setOracle} can refresh it alongside `priceOracle`.
    ///      Visibility does not affect the slot, so the layout is unchanged.
    uint8 internal oracleDecimals;

    /// @dev Dead — former vault. Moved to immutable.
    address private __gap15;

    struct OrderAggregate {
        uint256 buyQty;
        uint256 sellQty;
        uint256 buyValue;
        uint256 sellValue;
    }

    mapping(address => mapping(uint256 => OrderAggregate)) internal participantExpirationAtOrderAggregate;
    mapping(address => EnumerableSet.UintSet) internal participantOrderExpirationAts;

    // immutable
    ICollateralVault public immutable vault;
    uint8 internal immutable collateralDecimals;

    // constants
    /// @notice One contract settles 1 PH/s/day (hashes/s·day). Matches the hashprice oracle quote basis.
    uint256 public constant CONTRACT_SIZE_HPS_DAY = 1e15;
    uint8 public constant MAX_ORDERS_PER_PARTICIPANT = 100;
    uint256 public constant MAX_PRICE_LEVELS_PER_SIDE = 200;
    uint256 internal constant BPS = 10_000; // Basis points denominator
    /// @notice Hard ceiling on |makerFeeBps| and |takerFeeBps|: 100 bps (1%).
    /// @dev Keeps a trading fee at most a fifth of the 5% MM spot shock, so the argument
    ///      that the MM floor already covers the unreserved fee holds by construction
    ///      rather than by operational convention. An `int16` setter would otherwise
    ///      accept 327%.
    int16 internal constant MAX_FEE_BPS = 100;
    uint32 internal constant SECONDS_PER_DAY = 3600 * 24;
    uint256 public constant MAX_ORACLE_STALENESS = 3600; // 1 hour
    uint8 public constant EXPIRATION_INTERVAL_DAYS = 30;
    /// @notice Minimum price increment for orders: $0.01 in USDC (6 decimals).
    uint256 public constant minimumPriceIncrement = 0.01e6;

    // ── Structs ───────────────────────────────────────────────────────────────

    /// @notice Resting order (also the public `getOrder` return type). Signed remaining qty; 0 = empty.
    struct Order {
        address participant;
        uint256 price;
        int256 quantity; // >0 bid/long, <0 ask/short
        uint256 expirationAt;
    }

    /// @notice One placement in a `createOrders` / `updateOrders` batch.
    struct OrderIntent {
        uint256 price;
        uint256 expirationAt;
        int256 quantity;
        TimeInForce timeInForce;
    }

    /// @notice Shrink a resting order in place (FIFO position preserved).
    struct ReduceIntent {
        bytes32 orderId;
        int256 newQuantity; // same sign as resting; 0 < |new| < |old|
    }

    /// @notice Order lifetime / fill policy. GTD is not supported.
    enum TimeInForce {
        GTC, // rest unfilled size on the book
        IOC, // fill what is available now; cancel remainder; revert if nothing fills
        FOK // fill entire size now or revert
    }

    /// @notice Unilateral aggregate position for a (user, expirationAt).
    /// @dev Prefer `netEntryValue` over an averaged entry price: exact on scale-in
    ///      (no integer-division dust) and matches margin math
    ///      `pnl = mark * netQty - netEntryValue`. UI/MM can derive
    ///      `avgEntry = abs(netEntryValue) / abs(netQuantity)` when netQty != 0.
    struct Position {
        int256 netQuantity;
        int256 netEntryValue;
    }

    /// @dev Former bilateral lot — dead after reset; kept so the `positions` mapping slot stays typed.
    /// @dev Dead after v3 — slot retained for upgrade safety.
    struct LegacyLot {
        address _0; address _1; string _2;
        uint256 _3; uint256 _4; uint256 _5; uint256 _6;
        bool _7;
    }

    // ── Events ────────────────────────────────────────────────────────────────

    event OrderCreated(
        bytes32 indexed orderId, address indexed participant, uint256 price, int256 quantity, uint256 expirationAt
    );
    /// @notice Resting size changed (partial fill, IOC remainder close, or reduce-only amend).
    /// @dev Indexers must attribute fills only when paired with `OrderMatched` in the same tx;
    ///      a lone shrink is a reduce-only amend (FIFO kept, not a trade).
    event OrderUpdated(bytes32 indexed orderId, address indexed participant, int256 newQuantity);
    event OrderCancelled(bytes32 indexed orderId, address indexed participant);
    event OrderMatched(
        bytes32 indexed makerOrderId,
        address indexed maker,
        address indexed taker,
        uint256 expirationAt,
        uint256 tradePrice,
        int256 takerQuantity,
        int256 makerFee,
        int256 takerFee,
        int256 makerNetQtyAfter,
        int256 takerNetQtyAfter,
        uint256 makerEntryPriceAfter,
        uint256 takerEntryPriceAfter
    );
    event OrderLiquidated(bytes32 indexed orderId, address indexed user, address indexed liquidator, uint256 fee);
    event PositionLiquidated(
        address indexed user,
        address indexed liquidator,
        uint256 expirationAt,
        int256 closedQuantity,
        int256 pnl,
        uint256 liquidatorFee
    );
    event PositionSettled(
        address indexed user,
        uint256 indexed expirationAt,
        int256 closedQuantity,
        int256 pnl,
        uint256 settlementPrice,
        address settledBy
    );
    event BadDebt(address indexed user, uint256 amount);
    event SettlementPriceRecorded(uint256 indexed expirationAt, uint256 price, address recordedBy);
    event LiquidationMarginPercentUpdated(uint8 newLiquidationMarginPercent);
    event FutureExpirationDatesCountUpdated(uint8 newFutureExpirationDatesCount);
    event MakerFeeBpsUpdated(int16 newMakerFeeBps);
    event TakerFeeBpsUpdated(int16 newTakerFeeBps);
    event LiquidationFeeBpsUpdated(uint16 newLiquidationFeeBps);
    event LiquidatorShareBpsUpdated(uint16 newLiquidatorShareBps);
    event OracleUpdated(address newOracle);
    event PortfolioMarginUpdated(address newPortfolioMargin);
    event HookUpdated(address indexed hook);

    // ── Errors ────────────────────────────────────────────────────────────────

    error InvalidPrice();
    error InvalidQty();
    error ExpirationDateShouldBeInTheFuture();
    error ExpirationDateNotAvailable();
    error OrderNotBelongToSender();
    error InsufficientMarginBalance();
    error PositionNotExists();
    error PositionExpirationNotStartedYet();
    error MaxOrdersPerParticipantReached();
    error ValueOutOfRange(int256 min, int256 max);
    error ZeroAddress();
    error InsuranceFundNotConfigured();
    error UnsupportedTokenDecimals();
    error OracleStale();
    error SettlementDateNotReached();
    error InvalidOracle();
    error NotLiquidatable();
    error OrdersStillOpen();
    /// @notice Partial liquidation left balance above IM while a real IM>MM buffer remains.
    error OverLiquidation();
    error OrderNotBelongToUser();
    error OrderNotExists();
    error OrderNotExpired();
    error ArrayLengthMismatch();
    error MaxPriceLevelsReached();
    /// @notice FOK could not fill entirely, or IOC matched nothing.
    error TimeInForceNotFilled();
    error InvalidTimeInForce();
    error InvalidReduceQuantity();
    /// @notice Fee magnitude above `MAX_FEE_BPS`, or a maker+taker sum below zero (which
    ///         would make every match a net outflow from the insurance fund).
    error InvalidFee();
    /// @notice The margin engine aggregates a different vault than this venue settles into.
    error VaultMismatch();
    /// @dev A dependency did not answer a call the venue depends on: no code at the address,
    ///      or the call reverted. Which dependency is bad is implied by the setter that reverted.
    error InvalidDependency();

    /// @param _vault The shared collateral vault. Its `collateralToken()` provides the underlying ERC20.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(ICollateralVault _vault) {
        if (address(_vault) == address(0)) revert ZeroAddress();
        vault = _vault;
        collateralDecimals = IERC20Metadata(address(_vault.collateralToken())).decimals();
        _disableInitializers();
    }

    // ── Internal helpers: order placement / matching ──────────────────────────

    /// @dev Mints the next order id. `nonce` stays private so this contract is the only
    ///      thing that can advance it.
    function _nextOrderId() internal returns (bytes32) {
        return bytes32(++nonce);
    }

    /// @dev Index a newly resting order under its (participant, expiry, price) bucket.
    ///      Mirrors the removal in {_removeRestingOrder}, and keeps the index private here.
    function _indexRestingOrder(address _participant, uint256 _expirationAt, uint256 _price, bytes32 _orderId)
        internal
    {
        participantExpirationAtPriceOrderIdsIndex[_participant][_expirationAt][_price].add(_orderId);
    }

    function _increaseOrderAggregate(address _participant, uint256 _expirationAt, uint256 _price, int256 _quantity)
        internal
    {
        uint256 absQty = M.abs(_quantity);
        OrderAggregate storage aggregate = participantExpirationAtOrderAggregate[_participant][_expirationAt];
        if (_quantity > 0) {
            aggregate.buyQty += absQty;
            aggregate.buyValue += _price * absQty;
        } else {
            aggregate.sellQty += absQty;
            aggregate.sellValue += _price * absQty;
        }
        participantOrderExpirationAts[_participant].add(_expirationAt);
    }

    function _decreaseOrderAggregate(
        address _participant,
        uint256 _expirationAt,
        uint256 _price,
        uint256 _absQty,
        bool _isBuy
    ) internal {
        OrderAggregate storage aggregate = participantExpirationAtOrderAggregate[_participant][_expirationAt];
        if (_isBuy) {
            aggregate.buyQty -= _absQty;
            aggregate.buyValue -= _price * _absQty;
        } else {
            aggregate.sellQty -= _absQty;
            aggregate.sellValue -= _price * _absQty;
        }
        if (aggregate.buyQty == 0 && aggregate.sellQty == 0) {
            participantOrderExpirationAts[_participant].remove(_expirationAt);
        }
    }

    function _clearOrderAggregateCache(address _participant) internal {
        EnumerableSet.UintSet storage expirationAts = participantOrderExpirationAts[_participant];
        while (expirationAts.length() > 0) {
            uint256 expirationAt = expirationAts.at(expirationAts.length() - 1);
            delete participantExpirationAtOrderAggregate[_participant][expirationAt];
            expirationAts.remove(expirationAt);
        }
    }

    /// @dev Rebuild from the canonical order index, including physically resting expired orders.
    function _rebuildOrderAggregateCache(address _participant) internal {
        _clearOrderAggregateCache(_participant);

        EnumerableSet.Bytes32Set storage ids = participantOrderIdsIndex[_participant];
        uint256 len = ids.length();
        for (uint256 i = 0; i < len; i++) {
            Order storage order = orders[ids.at(i)];
            if (order.quantity != 0) {
                _increaseOrderAggregate(_participant, order.expirationAt, order.price, order.quantity);
            }
        }
    }

    /// @dev Absolute qty of resting orders that reduce `_net` at `_expirationAt`.
    function _restingReduceAbs(address _user, uint256 _expirationAt, int256 _net)
        internal
        view
        returns (uint256 total)
    {
        if (_net == 0) return 0;
        OrderAggregate storage aggregate = participantExpirationAtOrderAggregate[_user][_expirationAt];
        return _net > 0 ? aggregate.sellQty : aggregate.buyQty;
    }

    /// @notice Walk opposite sorted book from best price toward the taker limit; fill at maker price.
    function _matchWithOppositeOrders(
        address _taker,
        uint256 _limitPrice,
        uint256 _expirationAt,
        int256 _quantity
    ) internal returns (int256 remainingQuantity) {
        remainingQuantity = _quantity;
        bool isBuy = _quantity > 0;
        StructuredLinkedList.List storage oppositePrices = isBuy ? activeAskPrices[_expirationAt] : activeBidPrices[_expirationAt];

        if (oppositePrices.sizeOf() == 0) return remainingQuantity;

        (, uint256 currentPrice) = oppositePrices.getNextNode(0);

        while (currentPrice != 0 && remainingQuantity != 0) {
            if (isBuy && currentPrice > _limitPrice) break;
            if (!isBuy && currentPrice < _limitPrice) break;

            (, uint256 nextPrice) = oppositePrices.getNextNode(currentPrice);
            remainingQuantity = _matchOrdersAtPrice(_taker, currentPrice, _expirationAt, remainingQuantity, isBuy);
            currentPrice = nextPrice;
        }
    }

    /// @notice FIFO-match at one maker price level. Self-cross nets out (no fill/fees).
    function _matchOrdersAtPrice(
        address _taker,
        uint256 _price,
        uint256 _expirationAt,
        int256 _remainingQty,
        bool _isBuy
    ) internal returns (int256) {
        StructuredLinkedList.List storage makerOrderQueue = _expirationAtPriceOrderIds(_expirationAt, _price, !_isBuy);

        (, uint256 orderIdUint) = makerOrderQueue.getNextNode(0);
        while (_remainingQty != 0 && orderIdUint != 0) {
            bytes32 makerOrderId = bytes32(orderIdUint);
            Order storage makerOrder = orders[makerOrderId];

            if (makerOrder.participant == _taker) {
                _remainingQty = _netSelfCross(_taker, makerOrderId, makerOrder, _remainingQty, _isBuy, _expirationAt);
                (, orderIdUint) = makerOrderQueue.getNextNode(0);
                continue;
            }

            _remainingQty = _executeMatch(_taker, makerOrderId, makerOrder, _remainingQty, _isBuy, _price, _expirationAt);
            (, orderIdUint) = makerOrderQueue.getNextNode(0);
        }

        _removePriceLevelIfEmpty(makerOrderQueue, _expirationAt, _price, !_isBuy);
        return _remainingQty;
    }

    /// @dev Cancel overlapping size against the taker's own resting order.
    ///      No fill, no fees, no position change.
    function _netSelfCross(
        address _taker,
        bytes32 _makerOrderId,
        Order storage _makerOrder,
        int256 _remainingQty,
        bool _isBuy,
        uint256 _expirationAt
    ) internal returns (int256) {
        uint256 makerAbs = M.abs(_makerOrder.quantity);
        uint256 remainingAbs = M.abs(_remainingQty);
        uint256 cancelAmt = M.min(makerAbs, remainingAbs);
        bool isBuy = _makerOrder.quantity > 0;

        if (cancelAmt == makerAbs) {
            _removeRestingOrder(_makerOrderId, _expirationAt, _makerOrder.price, _makerOrder.participant, isBuy);
            emit OrderCancelled(_makerOrderId, _taker);
        } else {
            uint256 reducedMakerAbs = makerAbs - cancelAmt;
            int256 newMakerQty = M.toSigned(isBuy, reducedMakerAbs);
            _decreaseOrderAggregate(_taker, _expirationAt, _makerOrder.price, cancelAmt, isBuy);
            _makerOrder.quantity = newMakerQty;
            emit OrderUpdated(_makerOrderId, _taker, newMakerQty);
        }
        return M.toSigned(_isBuy, remainingAbs - cancelAmt);
    }

    /// @dev Execute a single match between taker and a maker resting order.
    function _executeMatch(
        address _taker,
        bytes32 _makerOrderId,
        Order storage _makerOrder,
        int256 _remainingQty,
        bool _isBuy,
        uint256 _price,
        uint256 _expirationAt
    ) internal returns (int256) {
        // Cache fields up front: a full fill deletes the storage order below.
        address makerParticipant = _makerOrder.participant;
        uint256 makerPrice = _makerOrder.price;
        bool isBuy = _makerOrder.quantity > 0;
        uint256 makerAbs = M.abs(_makerOrder.quantity);
        uint256 remainingAbs = M.abs(_remainingQty);
        uint256 fill = M.min(makerAbs, remainingAbs);
        int256 takerFillQty = M.toSigned(_isBuy, fill);

        _applyFill(makerParticipant, -takerFillQty, _price, _expirationAt);
        _applyFill(_taker, takerFillQty, _price, _expirationAt);

        uint256 notional = _price * fill;
        // Signed throughout: the former `uint256(uint16(makerFeeBps))` cast turned a −1 bps
        // rebate into 65535 bps (655%).
        int256 makerFeeAmt = int256(notional) * int256(makerFeeBps) / int256(BPS);
        int256 takerFeeAmt = int256(notional) * int256(takerFeeBps) / int256(BPS);
        _chargeMatchFees(makerParticipant, _taker, makerFeeAmt, takerFeeAmt);
        _notifyFill(makerParticipant, _taker, notional, makerFeeAmt, takerFeeAmt, _price);

        uint256 leftoverMakerAbs = makerAbs - fill;
        int256 newMakerQty = M.toSigned(isBuy, leftoverMakerAbs);
        if (leftoverMakerAbs == 0) {
            _removeRestingOrder(_makerOrderId, _expirationAt, makerPrice, makerParticipant, isBuy);
        } else {
            _decreaseOrderAggregate(makerParticipant, _expirationAt, makerPrice, fill, isBuy);
            _makerOrder.quantity = newMakerQty;
        }
        emit OrderUpdated(_makerOrderId, makerParticipant, newMakerQty);

        _emitOrderMatched(
            _makerOrderId,
            makerParticipant,
            _taker,
            _expirationAt,
            _price,
            takerFillQty,
            makerFeeAmt,
            takerFeeAmt
        );

        return M.toSigned(_isBuy, remainingAbs - fill);
    }

    /// @dev Post-fill `OrderMatched` with the parties' resulting net qty / entry price.
    ///      Extracted to keep `_executeMatch` under the stack limit.
    function _emitOrderMatched(
        bytes32 _makerOrderId,
        address _maker,
        address _taker,
        uint256 _expirationAt,
        uint256 _price,
        int256 _takerFillQty,
        int256 _makerFee,
        int256 _takerFee
    ) internal {
        emit OrderMatched(
            _makerOrderId,
            _maker,
            _taker,
            _expirationAt,
            _price,
            _takerFillQty,
            _makerFee,
            _takerFee,
            participantExpirationAtNetDelta[_maker][_expirationAt],
            participantExpirationAtNetDelta[_taker][_expirationAt],
            _avgEntryPrice(_maker, _expirationAt),
            _avgEntryPrice(_taker, _expirationAt)
        );
    }

    function _chargeMatchFees(address _maker, address _taker, int256 makerAmt, int256 takerAmt) internal {
        _transferFee(_maker, makerAmt);
        _transferFee(_taker, takerAmt);
    }

    /// @dev Move a signed trading fee between a participant and the fee pot
    ///      (`collectedFeesBalance`, held on this contract's vault account).
    ///
    ///      Both directions clamp, matching {_transferPnl} and {_chargeLiquidationFee}. The
    ///      hazard is an ordering one inside the fill, not keeper latency: {_executeMatch}
    ///      applies both parties' fills — realizing PnL against their balances — before it
    ///      charges either fee. An unclamped debit would let a maker whose balance the same
    ///      transaction just drained revert a stranger's taker order. Coverage of the fee
    ///      itself rests on the MM floor (`mmSpotShock` on the full resting notional against
    ///      a fee bounded by `MAX_FEE_BPS`), so the clamp only bites for an account already
    ///      below MM, where it costs the fee pot a few bps rather than blocking the book.
    ///
    ///      A rebate is capped at the pot, so rebates can only ever pay out fees already
    ///      collected — `makerFeeBps + takerFeeBps >= 0` keeps a single match from being a
    ///      net outflow, and this keeps a run of them from overdrawing the pot.
    function _transferFee(address _participant, int256 _fee) internal {
        if (_fee == 0) return;

        if (_fee > 0) {
            uint256 owed = uint256(_fee);
            uint256 available = vault.balanceOf(_participant);
            uint256 paid = M.min(owed, available);
            if (paid > 0) {
                collectedFeesBalance += paid;
                _internalTransfer(_participant, address(this), paid);
            }
            if (paid < owed) {
                emit BadDebt(_participant, owed - paid);
            }
            return;
        }

        uint256 rebate = M.min(uint256(-_fee), collectedFeesBalance);
        rebate = M.min(rebate, vault.balanceOf(address(this)));
        if (rebate > 0) {
            collectedFeesBalance -= rebate;
            _internalTransfer(address(this), _participant, rebate);
        }
    }

    /// @dev Average entry price derived from aggregates; 0 if flat.
    function _avgEntryPrice(address _user, uint256 _expirationAt) internal view returns (uint256) {
        int256 netQty = participantExpirationAtNetDelta[_user][_expirationAt];
        if (netQty == 0) return 0;
        return M.abs(participantExpirationAtNetEntryValue[_user][_expirationAt]) / M.abs(netQty);
    }

    // ── Internal helpers: position accounting ─────────────────────────────────

    /// @notice Apply a signed fill to a user's aggregate at `expirationAt`.
    /// @dev Scale-in / reduce / flip with exact `netEntryValue` accounting; realizes PnL via insurance fund.
    function _applyFill(address _user, int256 _signedQty, uint256 _tradePrice, uint256 _expirationAt) internal {
        if (_signedQty == 0) return;

        int256 netQty = participantExpirationAtNetDelta[_user][_expirationAt];
        int256 netEntry = participantExpirationAtNetEntryValue[_user][_expirationAt];

        if (netQty == 0) {
            participantExpirationAtNetDelta[_user][_expirationAt] = _signedQty;
            participantExpirationAtNetEntryValue[_user][_expirationAt] = _signedQty * int256(_tradePrice);
            participantActiveExpirationAts[_user].add(_expirationAt);
            return;
        }

        if (M.isSameSign(netQty, _signedQty)) {
            participantExpirationAtNetDelta[_user][_expirationAt] = netQty + _signedQty;
            participantExpirationAtNetEntryValue[_user][_expirationAt] = netEntry + _signedQty * int256(_tradePrice);
            return;
        }

        // Opposite direction: reduce / close / flip
        uint256 absDq = M.abs(_signedQty);
        uint256 absNet = M.abs(netQty);
        uint256 closedAbs = M.min(absDq, absNet);
        uint256 avgEntry = M.abs(netEntry) / absNet;

        int256 signedClosed = M.toSigned(netQty > 0, closedAbs);
        int256 pnl = (int256(_tradePrice) - int256(avgEntry)) * signedClosed;
        _transferPnl(_insuranceFundAccount(), _user, pnl);

        if (absDq < absNet) {
            // Partial reduce
            participantExpirationAtNetDelta[_user][_expirationAt] = netQty + _signedQty;
            participantExpirationAtNetEntryValue[_user][_expirationAt] =
                netEntry * int256(absNet - closedAbs) / int256(absNet);
        } else if (absDq == absNet) {
            // Flat
            participantExpirationAtNetDelta[_user][_expirationAt] = 0;
            participantExpirationAtNetEntryValue[_user][_expirationAt] = 0;
            participantActiveExpirationAts[_user].remove(_expirationAt);
        } else {
            // Flip: open remainder at trade price
            int256 openQty = _signedQty + netQty; // leftover in dq's direction
            participantExpirationAtNetDelta[_user][_expirationAt] = openQty;
            participantExpirationAtNetEntryValue[_user][_expirationAt] = openQty * int256(_tradePrice);
            // still active (non-zero)
        }
    }

    // ── Internal helpers: cancel / reduce / book upkeep ───────────────────────

    function _removeRestingOrder(
        bytes32 orderId,
        uint256 expirationAt,
        uint256 price,
        address participant,
        bool isBuy
    ) internal {
        StructuredLinkedList.List storage orderIndexId = _expirationAtPriceOrderIds(expirationAt, price, isBuy);
        _removeOrderFromQueue(orderIndexId, orderId, expirationAt, price, isBuy);
        participantOrderIdsIndex[participant].remove(orderId);
        participantExpirationAtPriceOrderIdsIndex[participant][expirationAt][price].remove(orderId);
        _decreaseOrderAggregate(participant, expirationAt, price, M.abs(orders[orderId].quantity), isBuy);
        delete orders[orderId];
    }

    function _addOrderToQueue(
        StructuredLinkedList.List storage orderIndexId,
        bytes32 _orderId,
        uint256 _expirationAt,
        uint256 _price,
        bool _isBuy
    ) internal {
        orderIndexId.pushBack(uint256(_orderId));
        _addPriceLevel(_expirationAt, _price, _isBuy);
    }

    function _removeOrderFromQueue(
        StructuredLinkedList.List storage orderIndexId,
        bytes32 _orderId,
        uint256 _expirationAt,
        uint256 _price,
        bool _isBuy
    ) internal {
        orderIndexId.remove(uint256(_orderId));
        _removePriceLevelIfEmpty(orderIndexId, _expirationAt, _price, _isBuy);
    }

    /// @notice Insert `_price` into the sorted ladder for `_expirationAt` if absent.
    function _addPriceLevel(uint256 _expirationAt, uint256 _price, bool _isBid) internal {
        StructuredLinkedList.List storage priceList = _isBid ? activeBidPrices[_expirationAt] : activeAskPrices[_expirationAt];
        PriceLadderLib.insertPrice(priceList, _price, _isBid, MAX_PRICE_LEVELS_PER_SIDE);
    }

    /// @notice Remove price level when its order queue is empty.
    function _removePriceLevelIfEmpty(
        StructuredLinkedList.List storage orderQueue,
        uint256 _expirationAt,
        uint256 _price,
        bool _isBid
    ) internal {
        StructuredLinkedList.List storage priceList = _isBid ? activeBidPrices[_expirationAt] : activeAskPrices[_expirationAt];
        PriceLadderLib.removeIfEmpty(orderQueue, priceList, _price);
    }

    // ── Internal helpers: admin / config ──────────────────────────────────────

    // ── Dependency probes ─────────────────────────────────────────────────────
    //
    // `catch` only fires on a revert raised by the callee, so the code check ahead of it is
    // load-bearing: a call to an address holding no code succeeds with empty return data and
    // fails later in this contract's decoder, out of the catch block's reach.

    function _requireContract(address target) internal view {
        if (target.code.length == 0) revert InvalidDependency();
    }

    /// @dev Validates a proposed (maker, taker) fee pair. Both bounds matter:
    ///      `MAX_FEE_BPS` keeps the unreserved fee small relative to the MM floor, and the
    ///      non-negative sum keeps a match from being a net outflow — without it a maker
    ///      rebate exceeding the taker fee drains the fee pot once per trade, unbounded in
    ///      volume.
    function _validateFees(int16 _makerFeeBps, int16 _takerFeeBps) internal pure {
        if (_makerFeeBps > MAX_FEE_BPS || _makerFeeBps < -MAX_FEE_BPS) revert InvalidFee();
        if (_takerFeeBps > MAX_FEE_BPS || _takerFeeBps < -MAX_FEE_BPS) revert InvalidFee();
        if (int256(_makerFeeBps) + int256(_takerFeeBps) < 0) revert InvalidFee();
    }

    // ── Internal helpers: points hook ─────────────────────────────────────────

    function _notifyFill(
        address _maker,
        address _taker,
        uint256 _notional,
        int256 _makerFee,
        int256 _takerFee,
        uint256 _makerPrice
    ) internal {
        IPointsHook _hook = hook;
        if (address(_hook) == address(0)) return;
        uint256 takerFeeAbs = _takerFee > 0 ? uint256(_takerFee) : 0;
        _hook.onFill(_maker, _taker, _notional, _makerFee, takerFeeAbs, _makerPrice, _refPriceForPoints());
    }

    function _refPriceForPoints() internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = priceOracle.latestRoundData();
        if (answer <= 0) return 0;
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) return 0;
        return _getMarketPrice(uint256(answer));
    }

    function _notifyLiquidation(address _liquidator, uint256 _fee) internal {
        IPointsHook _hook = hook;
        if (address(_hook) == address(0)) return;
        _hook.onLiquidation(_liquidator, _fee);
    }

    // ── Internal helpers: margin / liquidation ────────────────────────────────

    function _doLiquidateFullPosition(address _user, uint256 _expirationAt, int256 _netQty) internal {
        uint256 mark = _getMarketPrice(_getPrice());
        int256 netEntry = participantExpirationAtNetEntryValue[_user][_expirationAt];
        int256 pnl = int256(mark) * _netQty - netEntry;

        _transferPnl(_insuranceFundAccount(), _user, pnl);

        uint256 closedNotional = mark * M.abs(_netQty);
        uint256 liqFee = _chargeLiquidationFee(_user, closedNotional);

        participantExpirationAtNetDelta[_user][_expirationAt] = 0;
        participantExpirationAtNetEntryValue[_user][_expirationAt] = 0;
        participantActiveExpirationAts[_user].remove(_expirationAt);

        emit PositionLiquidated(_user, _msgSender(), _expirationAt, _netQty, pnl, liqFee);
        _notifyLiquidation(_msgSender(), liqFee);
    }

    function _doPartialLiquidatePosition(address _user, uint256 _expirationAt, int256 _netQty, uint256 _closeAbs)
        internal
        returns (int256 pnl, int256 signedClose)
    {
        uint256 mark = _getMarketPrice(_getPrice());
        int256 netEntry = participantExpirationAtNetEntryValue[_user][_expirationAt];
        uint256 absNet = M.abs(_netQty);
        uint256 avgEntry = M.abs(netEntry) / absNet;
        signedClose = M.toSigned(_netQty > 0, _closeAbs);
        pnl = (int256(mark) - int256(avgEntry)) * signedClose;
        _transferPnl(_insuranceFundAccount(), _user, pnl);

        // Reduce toward zero; scale netEntryValue proportionally.
        participantExpirationAtNetDelta[_user][_expirationAt] =
            _netQty - M.toSigned(_netQty > 0, _closeAbs);
        participantExpirationAtNetEntryValue[_user][_expirationAt] =
            netEntry * int256(absNet - _closeAbs) / int256(absNet);
    }

    // ── Internal helpers: pricing / views ─────────────────────────────────────

    function _getMarketPrice(uint256 _hashpriceUsd) internal view returns (uint256) {
        uint256 scaled = M.scaleDecimals(_hashpriceUsd, oracleDecimals, collateralDecimals);
        return M.roundToNearest(scaled, minimumPriceIncrement);
    }

    function _activePricesSlice(StructuredLinkedList.List storage priceList, uint256 _maxLevels)
        internal
        view
        returns (uint256[] memory)
    {
        uint256 total = priceList.sizeOf();
        uint256 count = M.min(total, _maxLevels);
        uint256[] memory out = new uint256[](count);
        (, uint256 current) = priceList.getNextNode(0);
        for (uint256 i = 0; i < count && current != 0; i++) {
            out[i] = current;
            (, current) = priceList.getNextNode(current);
        }
        return out;
    }

    function _getCurrentExpirationAtIndex() internal view returns (uint256) {
        if (block.timestamp > firstFutureExpirationDate) {
            return (block.timestamp - firstFutureExpirationDate) / expirationIntervalSeconds() + 1;
        }
        return 0;
    }

    function expirationIntervalSeconds() internal pure returns (uint256) {
        return EXPIRATION_INTERVAL_DAYS * SECONDS_PER_DAY;
    }

    function _expirationAtPriceOrderIds(uint256 _expirationAt, uint256 _price, bool _isBuy)
        internal
        view
        returns (StructuredLinkedList.List storage)
    {
        if (_isBuy) {
            return expirationAtPriceOrdersLongIdQueue[_expirationAt][_price];
        } else {
            return expirationAtPriceOrdersShortIdQueue[_expirationAt][_price];
        }
    }

    function _getPrice() internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = priceOracle.latestRoundData();
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) {
            revert OracleStale();
        }
        if (answer <= 0) {
            revert InvalidOracle();
        }
        return uint256(answer);
    }

    function _validateTIF(TimeInForce _tif) internal pure {
        if (uint8(_tif) > uint8(TimeInForce.FOK)) revert InvalidTimeInForce();
    }

    function _validateQty(int256 _qty) internal pure {
        if (_qty == 0) revert InvalidQty();
    }

    function _validatePrice(uint256 _price) internal pure {
        if (_price == 0) revert InvalidPrice();
        if (_price % minimumPriceIncrement != 0) revert InvalidPrice();
    }

    function _validateExpirationAt(uint256 _expirationAt) internal view {
        if (_expirationAt <= block.timestamp) {
            revert ExpirationDateShouldBeInTheFuture();
        }
        if (_expirationAt < firstFutureExpirationDate) {
            revert ExpirationDateNotAvailable();
        }
        uint256 elapsedFromFirst = _expirationAt - firstFutureExpirationDate;
        if (elapsedFromFirst % expirationIntervalSeconds() != 0) {
            revert ExpirationDateNotAvailable();
        }
        uint256 currentIndex = _getCurrentExpirationAtIndex();
        if (elapsedFromFirst > (futureExpirationDatesCount - 1 + currentIndex) * expirationIntervalSeconds()) {
            revert ExpirationDateNotAvailable();
        }
    }

    function _ensureNoCollateralDeficit(address _participant) internal view {
        uint256 required = portfolioMargin.computePortfolioIM(_participant);
        if (vault.balanceOf(_participant) < required) revert InsufficientMarginBalance();
    }

    // ── Internal helpers: collateral movement ─────────────────────────────────

    function _transferPnl(address _from, address _to, int256 _pnl) internal {
        if (_pnl == 0) return;
        address payer;
        address receiver;
        uint256 amount;
        if (_pnl > 0) {
            payer = _from;
            receiver = _to;
            amount = uint256(_pnl);
        } else {
            payer = _to;
            receiver = _from;
            amount = uint256(-_pnl);
        }

        uint256 available = vault.balanceOf(payer);
        if (available >= amount) {
            vault.internalTransfer(payer, receiver, amount);
            return;
        }

        if (available > 0) {
            vault.internalTransfer(payer, receiver, available);
        }
        emit BadDebt(payer, amount - available);
    }

    /// @notice Charge a liquidation fee on the closed notional value, split between
    ///         liquidator (msg.sender) and insurance fund according to `liquidatorShareBps`.
    /// @dev Fee is `_notionalValue * liquidationFeeBps / 10000`, capped at the user's
    ///      actual vault balance. The liquidator receives `fee * liquidatorShareBps / 10000`
    ///      (also capped at available balance), and the remainder goes to the insurance fund.
    /// @param _user The liquidated user (fee source)
    /// @param _notionalValue Notional value of the liquidated position/order
    /// @return totalFee Total fee actually collected (may be less than computed if balance insufficient)
    function _chargeLiquidationFee(address _user, uint256 _notionalValue) internal returns (uint256 totalFee) {
        uint16 feeBps = liquidationFeeBps;
        if (feeBps == 0) return 0;

        uint256 computedFee = _notionalValue * uint256(feeBps) / BPS;
        if (computedFee == 0) return 0;

        uint256 userBal = vault.balanceOf(_user);
        totalFee = M.min(computedFee, userBal);
        if (totalFee == 0) return 0;

        address liquidator = _msgSender();
        address insurance = _insuranceFundAccount();

        uint16 liqShareBps = liquidatorShareBps;
        uint256 liquidatorShare = totalFee * uint256(liqShareBps) / BPS;
        uint256 insuranceShare = totalFee - liquidatorShare;

        _internalTransfer(_user, liquidator, liquidatorShare);
        _internalTransfer(_user, insurance, insuranceShare);
    }

    function _insuranceFundAccount() internal view returns (address) {
        address fund = vault.INSURANCE_FUND_ADDR();
        if (fund == address(0)) revert InsuranceFundNotConfigured();
        return fund;
    }

    function _internalTransfer(address from, address to, uint256 amount) internal {
        vault.internalTransfer(from, to, amount);
    }
}
