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

/// @title Futures — cash-settled hashrate futures CLOB (v3: aggregate positions + qty-bearing orders)
contract Futures is UUPSUpgradeable, OwnableUpgradeable, MulticallUpgradeable, Versionable {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using StructuredLinkedList for StructuredLinkedList.List;

    // ── Storage (declaration order is part of the UUPS layout — do not reorder) ──

    mapping(bytes32 => Order) private orders;
    /// @dev Dead after v3 reset: former bilateral lot mapping. Slot retained for upgrade safety.
    mapping(bytes32 => LegacyLot) private positions;
    mapping(uint256 => mapping(uint256 => StructuredLinkedList.List)) private expirationAtPriceOrdersLongIdQueue;
    mapping(uint256 => mapping(uint256 => StructuredLinkedList.List)) private expirationAtPriceOrdersShortIdQueue;
    /// @dev Dead after v3: former bilateral lot index. Slot retained.
    mapping(address => EnumerableSet.Bytes32Set) private participantPositionIdsIndex;
    mapping(address => EnumerableSet.Bytes32Set) private participantOrderIdsIndex;
    /// @dev Dead after v3: former per-(user, expiry) lot index. Slot retained.
    mapping(address => mapping(uint256 => EnumerableSet.Bytes32Set)) private participantExpirationAtPositionIdsIndex;
    mapping(address => mapping(uint256 => mapping(uint256 => EnumerableSet.Bytes32Set))) private
        participantExpirationAtPriceOrderIdsIndex;

    uint256 private _gap5;
    uint256 public firstFutureExpirationDate;
    /// @dev Reserved — formerly `contractSizeHpsDay` / `speedHps`.
    uint256 private _gapContractSize;
    uint256 private _gapMinPriceIncrement;
    /// @dev Dead — former takerFee (flat). Now bps-based, appended at end of storage.
    uint256 private _gapTakerFee;
    uint256 private nonce = 0;

    address private _gap;
    /// @notice Hashprice oracle (price of 1 PH/s per day in `token` currency).
    AggregatorV3Interface public priceOracle;
    address private _gap6;

    /// @dev Reserved — formerly `deliveryDurationDays`.
    uint8 private _gapDeliveryDuration;
    /// @dev Reserved — formerly `expirationIntervalDays` (now `EXPIRATION_INTERVAL_DAYS` constant).
    uint8 public _gap7;
    uint8 public futureExpirationDatesCount;
    uint8 public liquidationMarginPercent;
    uint8 private _gap3;
    string private _gap8;
    uint256 public collectedFeesBalance;
    uint256 private _gap2;
    /// @dev Reserved — formerly `addressFeeDiscountPercent`.
    mapping(address => uint8) private _gap4;
    /// @notice 10^(oracle.decimals() - token.decimals()). Recomputed on `setOracle`.
    uint256 public hashpriceScalingDivisor;

    IPortfolioMarginEngine public portfolioMargin;
    /// @notice Canonical net position quantity per (participant, expirationAt). +long / -short.
    mapping(address => mapping(uint256 => int256)) private participantExpirationAtNetDelta;
    /// @notice Canonical Σ qty_i * entryPrice_i per (participant, expirationAt), token decimals.
    mapping(address => mapping(uint256 => int256)) private participantExpirationAtNetEntryValue;

    /// @dev Sorted bid prices per expiration (highest first).
    mapping(uint256 => StructuredLinkedList.List) private activeBidPrices;
    /// @dev Sorted ask prices per expiration (lowest first).
    mapping(uint256 => StructuredLinkedList.List) private activeAskPrices;

    /// @dev Dead — former liquidationFee (flat). Now bps-based via liquidationFeeBps.
    uint256 private _gapLiquidationFee;

    /// @dev Dead — former makerFee (flat). Now bps-based, appended at end of storage.
    uint256 private _gapMakerFee;

    IPointsHook public hook;

    /// @notice Pinned cash-settlement price per expiration (`0` = unset).
    mapping(uint256 => uint256) public settlementPrice;

    /// @dev Expiration timestamps at which a participant holds a non-zero aggregate position.
    mapping(address => EnumerableSet.UintSet) private participantActiveExpirationAts;

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

    /// @dev Dead — former vault. Moved to immutable.
    address private _gapCollateralVault;

    // immutable
    ICollateralVault public immutable vault;
    uint8 private immutable collateralDecimals;

    // constants
    string public constant VERSION = "3.8.0";
    /// @notice One contract settles 1 PH/s/day (hashes/s·day). Matches the hashprice oracle quote basis.
    uint256 public constant CONTRACT_SIZE_HPS_DAY = 1e15;
    uint8 public constant MAX_ORDERS_PER_PARTICIPANT = 100;
    uint256 public constant MAX_PRICE_LEVELS_PER_SIDE = 200;
    uint32 private constant SECONDS_PER_DAY = 3600 * 24;
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

    /// @notice One placement in a `createOrders` batch (GTC).
    struct OrderIntent {
        uint256 price;
        uint256 expirationAt;
        int256 quantity;
    }

    /// @notice One placement in a `createOrdersV2` batch.
    struct OrderIntentV2 {
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
    struct LegacyLot {
        address seller;
        address buyer;
        string destURL;
        uint256 sellPricePerDay;
        uint256 buyPricePerDay;
        uint256 expirationAt;
        uint256 createdAt;
        bool paid;
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

    /// @param _vault The shared collateral vault. Its `collateralToken()` provides the underlying ERC20.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(ICollateralVault _vault) {
        if (address(_vault) == address(0)) revert ZeroAddress();
        vault = _vault;
        collateralDecimals = IERC20Metadata(address(_vault.collateralToken())).decimals();
        _disableInitializers();
    }

    function initialize(
        AggregatorV3Interface _priceOracle,
        uint8 _liquidationMarginPercent,
        uint256, // was _minimumPriceIncrement — now constant = 1e4
        uint8, // was expirationIntervalDays — now EXPIRATION_INTERVAL_DAYS constant
        uint8 _futureExpirationDatesCount,
        uint256 _firstFutureExpirationDate
    ) public initializer {
        __Ownable_init(_msgSender());
        __UUPSUpgradeable_init();
        _setPriceOracle(_priceOracle);
        liquidationMarginPercent = _liquidationMarginPercent;
        if (_futureExpirationDatesCount < 1) {
            revert ValueOutOfRange(1, int256(uint256(type(uint8).max)));
        }
        futureExpirationDatesCount = _futureExpirationDatesCount;
        firstFutureExpirationDate = _firstFutureExpirationDate;
        emit LiquidationMarginPercentUpdated(_liquidationMarginPercent);
        emit FutureExpirationDatesCountUpdated(_futureExpirationDatesCount);
        emit OracleUpdated(address(_priceOracle));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner { }

    // ── Order placement ───────────────────────────────────────────────────────

    /// @notice Place a GTC limit order. `quantity` > 0 = buy/long, < 0 = sell/short.
    /// @dev Reduce-only legs (opposite side, size ≤ position at `expirationAt`) skip the IM check.
    function createOrder(uint256 _price, uint256 _expirationAt, int256 _quantity) external {
        address sender = _msgSender();
        bool skipMargin = _createOrderInternal(sender, _price, _expirationAt, _quantity, TimeInForce.GTC);
        if (!skipMargin) ensureNoCollateralDeficit(sender);
    }

    /// @notice Place a limit order with explicit time-in-force (GTC / IOC / FOK).
    /// @dev Reduce-only legs skip the IM check (same rule as `createOrder`).
    function createOrderV2(uint256 _price, uint256 _expirationAt, int256 _quantity, TimeInForce _tif) external {
        address sender = _msgSender();
        bool skipMargin = _createOrderInternal(sender, _price, _expirationAt, _quantity, _tif);
        if (!skipMargin) ensureNoCollateralDeficit(sender);
    }

    /// @notice Batched GTC placement — IM check once at the end.
    function createOrders(OrderIntent[] calldata _intents) external {
        address sender = _msgSender();
        uint256 len = _intents.length;
        for (uint256 i = 0; i < len; i++) {
            OrderIntent calldata intent = _intents[i];
            _createOrderInternal(sender, intent.price, intent.expirationAt, intent.quantity, TimeInForce.GTC);
        }
        ensureNoCollateralDeficit(sender);
    }

    /// @notice Batched placement with per-leg time-in-force — IM check once at the end.
    function createOrdersV2(OrderIntentV2[] calldata _intents) external {
        address sender = _msgSender();
        uint256 len = _intents.length;
        for (uint256 i = 0; i < len; i++) {
            OrderIntentV2 calldata intent = _intents[i];
            _createOrderInternal(sender, intent.price, intent.expirationAt, intent.quantity, intent.timeInForce);
        }
        ensureNoCollateralDeficit(sender);
    }

    /// @notice Cancel, reduce-in-place, then place GTC orders — IM check once at the end.
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
            _cancelOrderInternal(sender, _cancelIds[i]);
        }
        uint256 reduceLen = _reduces.length;
        for (uint256 r = 0; r < reduceLen; r++) {
            _reduceOrderSizeInternal(sender, _reduces[r].orderId, _reduces[r].newQuantity);
        }
        uint256 createLen = _intents.length;
        for (uint256 j = 0; j < createLen; j++) {
            OrderIntent calldata intent = _intents[j];
            _createOrderInternal(sender, intent.price, intent.expirationAt, intent.quantity, TimeInForce.GTC);
        }
        ensureNoCollateralDeficit(sender);
    }

    /// @notice Shrink a resting order owned by the caller without losing FIFO priority.
    /// @dev Rejects grow / sign flip / zero (use `cancelOrder` to remove entirely).
    function reduceOrderSize(bytes32 _orderId, int256 _newQuantity) external {
        _reduceOrderSizeInternal(_msgSender(), _orderId, _newQuantity);
    }

    /// @dev Per-leg body of `createOrder` / `createOrderV2` without the IM-check epilogue.
    ///      Returns true when the leg is reduce-only (single-order callers may skip IM);
    ///      batch callers always check once at the end.
    function _createOrderInternal(
        address _participant,
        uint256 _price,
        uint256 _expirationAt,
        int256 _quantity,
        TimeInForce _tif
    ) private returns (bool isReduceOnly) {
        if (uint8(_tif) > uint8(TimeInForce.FOK)) revert InvalidTimeInForce();
        validatePrice(_price);
        validateExpirationAt(_expirationAt);
        if (_quantity == 0) revert InvalidQty();

        // Snapshot before matching — reduce-only vs position minus already-resting reduces.
        int256 positionBefore = participantExpirationAtNetDelta[_participant][_expirationAt];
        uint256 reducingBefore = _restingReduceAbs(_participant, _expirationAt, positionBefore);

        bool isBuy = _quantity > 0;
        bytes32 orderId = bytes32(++nonce);
        emit OrderCreated(orderId, _participant, _price, _quantity, _expirationAt);

        int256 remainingQty = _matchWithOppositeOrders(_participant, _price, _expirationAt, _quantity);
        uint256 remainingAbs = _abs(remainingQty);
        bool partiallyOrFullyFilled = remainingAbs != _abs(_quantity);

        if (_tif == TimeInForce.FOK && remainingAbs > 0) revert TimeInForceNotFilled();
        // IOC with zero fill is a noop — revert rather than emit a closed empty order.
        if (_tif == TimeInForce.IOC && !partiallyOrFullyFilled) revert TimeInForceNotFilled();

        if (_tif == TimeInForce.GTC) {
            if (partiallyOrFullyFilled) {
                emit OrderUpdated(orderId, _participant, remainingQty);
            }
            if (remainingAbs > 0) {
                EnumerableSet.Bytes32Set storage participantOrders = participantOrderIdsIndex[_participant];
                if (participantOrders.length() >= MAX_ORDERS_PER_PARTICIPANT) {
                    revert MaxOrdersPerParticipantReached();
                }
                orders[orderId] = Order({
                    participant: _participant,
                    price: _price,
                    quantity: remainingQty,
                    expirationAt: _expirationAt
                });
                StructuredLinkedList.List storage orderQueue = _expirationAtPriceOrderIds(_expirationAt, _price, isBuy);
                _addOrderToQueue(orderQueue, orderId, _expirationAt, _price, isBuy);
                participantOrders.add(orderId);
                participantExpirationAtPriceOrderIdsIndex[_participant][_expirationAt][_price].add(orderId);
            }
        } else {
            // IOC (or FOK after a full fill): never rest; close the taker order id at 0.
            if (partiallyOrFullyFilled || _tif == TimeInForce.IOC) {
                emit OrderUpdated(orderId, _participant, 0);
            }
        }

        // Opposite side and combined reducing size (resting + this intent) ≤ position.
        isReduceOnly = positionBefore != 0 && (positionBefore > 0 ? _quantity < 0 : _quantity > 0)
            && _abs(_quantity) + reducingBefore <= _abs(positionBefore);
    }

    /// @dev Absolute qty of resting orders that reduce `_net` at `_expirationAt`.
    function _restingReduceAbs(address _user, uint256 _expirationAt, int256 _net)
        private
        view
        returns (uint256 total)
    {
        if (_net == 0) return 0;
        EnumerableSet.Bytes32Set storage ids = participantOrderIdsIndex[_user];
        uint256 len = ids.length();
        for (uint256 i = 0; i < len; i++) {
            Order memory order = orders[ids.at(i)];
            if (order.expirationAt != _expirationAt || order.quantity == 0) continue;
            if (_net > 0 ? order.quantity < 0 : order.quantity > 0) {
                total += _abs(order.quantity);
            }
        }
    }

    /// @notice Walk opposite sorted book from best price toward the taker limit; fill at maker price.
    function _matchWithOppositeOrders(
        address _taker,
        uint256 _limitPrice,
        uint256 _expirationAt,
        int256 _quantity
    ) private returns (int256 remainingQuantity) {
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
    ) private returns (int256) {
        StructuredLinkedList.List storage makerOrderQueue = _expirationAtPriceOrderIds(_expirationAt, _price, !_isBuy);

        (, uint256 orderIdUint) = makerOrderQueue.getNextNode(0);
        while (_remainingQty != 0 && orderIdUint != 0) {
            bytes32 makerOrderId = bytes32(orderIdUint);
            Order memory maker = orders[makerOrderId];

            uint256 makerAbs = _abs(maker.quantity);
            uint256 remainingAbs = _abs(_remainingQty);

            // Self-cross: net quantities; no trade, no fees.
            if (maker.participant == _taker) {
                uint256 cancelAmt = makerAbs < remainingAbs ? makerAbs : remainingAbs;
                if (cancelAmt == makerAbs) {
                    _removeRestingOrder(makerOrderId, maker);
                    emit OrderCancelled(makerOrderId, _taker);
                } else {
                    uint256 reducedMakerAbs = makerAbs - cancelAmt;
                    int256 newMakerQty = maker.quantity > 0 ? int256(reducedMakerAbs) : -int256(reducedMakerAbs);
                    orders[makerOrderId].quantity = newMakerQty;
                    emit OrderUpdated(makerOrderId, _taker, newMakerQty);
                }
                _remainingQty = _isBuy ? int256(remainingAbs - cancelAmt) : -int256(remainingAbs - cancelAmt);
                (, orderIdUint) = makerOrderQueue.getNextNode(0);
                continue;
            }

            uint256 fill = makerAbs < remainingAbs ? makerAbs : remainingAbs;
            int256 takerFillQty = _isBuy ? int256(fill) : -int256(fill);

            _applyFill(maker.participant, -takerFillQty, _price, _expirationAt);
            _applyFill(_taker, takerFillQty, _price, _expirationAt);

            uint256 notional = _price * fill;
            uint256 makerFeeAmt = notional * uint256(uint16(makerFeeBps)) / 10_000;
            uint256 takerFeeAmt = notional * uint256(uint16(takerFeeBps)) / 10_000;
            _chargeMatchFees(maker.participant, _taker, makerFeeAmt, takerFeeAmt);
            _notifyFill(maker.participant, _taker, notional, int256(makerFeeAmt), takerFeeAmt, _price);

            uint256 leftoverMakerAbs = makerAbs - fill;
            if (leftoverMakerAbs == 0) {
                _removeRestingOrder(makerOrderId, maker);
                emit OrderUpdated(makerOrderId, maker.participant, 0);
            } else {
                int256 newMakerQty = maker.quantity > 0 ? int256(leftoverMakerAbs) : -int256(leftoverMakerAbs);
                orders[makerOrderId].quantity = newMakerQty;
                emit OrderUpdated(makerOrderId, maker.participant, newMakerQty);
            }

            emit OrderMatched(
                makerOrderId,
                maker.participant,
                _taker,
                _expirationAt,
                _price,
                takerFillQty,
                int256(makerFeeAmt),
                int256(takerFeeAmt),
                participantExpirationAtNetDelta[maker.participant][_expirationAt],
                participantExpirationAtNetDelta[_taker][_expirationAt],
                _avgEntryPrice(maker.participant, _expirationAt),
                _avgEntryPrice(_taker, _expirationAt)
            );

            _remainingQty = _isBuy ? int256(remainingAbs - fill) : -int256(remainingAbs - fill);
            (, orderIdUint) = makerOrderQueue.getNextNode(0);
        }

        _removePriceLevelIfEmpty(_expirationAt, _price, !_isBuy);
        return _remainingQty;
    }

    function _chargeMatchFees(address _maker, address _taker, uint256 makerAmt, uint256 takerAmt) private {
        if (makerAmt > 0) {
            collectedFeesBalance += makerAmt;
            _internalTransfer(_maker, address(this), makerAmt);
        }
        if (takerAmt > 0) {
            collectedFeesBalance += takerAmt;
            _internalTransfer(_taker, address(this), takerAmt);
        }
    }

    /// @dev Average entry price derived from aggregates; 0 if flat.
    function _avgEntryPrice(address _user, uint256 _expirationAt) private view returns (uint256) {
        int256 netQty = participantExpirationAtNetDelta[_user][_expirationAt];
        if (netQty == 0) return 0;
        return _abs(participantExpirationAtNetEntryValue[_user][_expirationAt]) / _abs(netQty);
    }

    // ── Position accounting ───────────────────────────────────────────────────

    /// @notice Apply a signed fill to a user's aggregate at `expirationAt`.
    /// @dev Scale-in / reduce / flip with exact `netEntryValue` accounting; realizes PnL via insurance fund.
    function _applyFill(address _user, int256 _signedQty, uint256 _tradePrice, uint256 _expirationAt) private {
        if (_signedQty == 0) return;

        int256 netQty = participantExpirationAtNetDelta[_user][_expirationAt];
        int256 netEntry = participantExpirationAtNetEntryValue[_user][_expirationAt];

        if (netQty == 0) {
            participantExpirationAtNetDelta[_user][_expirationAt] = _signedQty;
            participantExpirationAtNetEntryValue[_user][_expirationAt] = _signedQty * int256(_tradePrice);
            participantActiveExpirationAts[_user].add(_expirationAt);
            return;
        }

        if (_isSameSign(netQty, _signedQty)) {
            participantExpirationAtNetDelta[_user][_expirationAt] = netQty + _signedQty;
            participantExpirationAtNetEntryValue[_user][_expirationAt] = netEntry + _signedQty * int256(_tradePrice);
            return;
        }

        // Opposite direction: reduce / close / flip
        uint256 absDq = _abs(_signedQty);
        uint256 absNet = _abs(netQty);
        uint256 closedAbs = absDq < absNet ? absDq : absNet;
        uint256 avgEntry = _abs(netEntry) / absNet;

        int256 signedClosed = netQty > 0 ? int256(closedAbs) : -int256(closedAbs);
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

    /// @notice Cancel a resting order owned by the caller.
    function cancelOrder(bytes32 _orderId) external {
        _cancelOrderInternal(_msgSender(), _orderId);
    }

    /// @dev Shared cancel body for `cancelOrder` / `updateOrders`.
    function _cancelOrderInternal(address _participant, bytes32 _orderId) private {
        Order memory order = orders[_orderId];
        if (order.participant != _participant) revert OrderNotBelongToSender();
        if (order.quantity == 0) revert OrderNotExists();
        _removeRestingOrder(_orderId, order);
        emit OrderCancelled(_orderId, order.participant);
    }

    /// @dev In-place size shrink. Keeps the order id in its price/expiry queue slot.
    function _reduceOrderSizeInternal(address _participant, bytes32 _orderId, int256 _newQuantity) private {
        Order storage order = orders[_orderId];
        if (order.participant == address(0) || order.quantity == 0) revert OrderNotExists();
        if (order.participant != _participant) revert OrderNotBelongToSender();

        int256 oldQty = order.quantity;
        if (_newQuantity == 0 || (_newQuantity > 0) != (oldQty > 0)) revert InvalidReduceQuantity();
        if (_abs(_newQuantity) >= _abs(oldQty)) revert InvalidReduceQuantity();

        order.quantity = _newQuantity;
        emit OrderUpdated(_orderId, order.participant, _newQuantity);
    }

    /// @notice Permissionlessly close a resting order whose `expirationAt` is in the past.
    function removeOutdatedOrder(bytes32 _orderId) external {
        Order memory order = orders[_orderId];
        if (order.participant == address(0) || order.quantity == 0) revert OrderNotExists();
        if (order.expirationAt >= block.timestamp) revert OrderNotExpired();
        _removeRestingOrder(_orderId, order);
        emit OrderCancelled(_orderId, order.participant);
    }

    function _removeRestingOrder(bytes32 orderId, Order memory order) private {
        StructuredLinkedList.List storage orderIndexId =
            _expirationAtPriceOrderIds(order.expirationAt, order.price, order.quantity > 0);
        _removeOrderFromQueue(orderIndexId, orderId, order.expirationAt, order.price, order.quantity > 0);
        participantOrderIdsIndex[order.participant].remove(orderId);
        participantExpirationAtPriceOrderIdsIndex[order.participant][order.expirationAt][order.price].remove(orderId);
        delete orders[orderId];
    }

    function _addOrderToQueue(
        StructuredLinkedList.List storage orderIndexId,
        bytes32 _orderId,
        uint256 _expirationAt,
        uint256 _price,
        bool _isBuy
    ) private {
        orderIndexId.pushBack(uint256(_orderId));
        _addPriceLevel(_expirationAt, _price, _isBuy);
    }

    function _removeOrderFromQueue(
        StructuredLinkedList.List storage orderIndexId,
        bytes32 _orderId,
        uint256 _expirationAt,
        uint256 _price,
        bool _isBuy
    ) private {
        orderIndexId.remove(uint256(_orderId));
        _removePriceLevelIfEmpty(_expirationAt, _price, _isBuy);
    }

    /// @notice Insert `_price` into the sorted ladder for `_expirationAt` if absent.
    function _addPriceLevel(uint256 _expirationAt, uint256 _price, bool _isBid) private {
        StructuredLinkedList.List storage priceList = _isBid ? activeBidPrices[_expirationAt] : activeAskPrices[_expirationAt];

        if (priceList.nodeExists(_price)) return;

        uint256 size = priceList.sizeOf();
        if (size >= MAX_PRICE_LEVELS_PER_SIDE) revert MaxPriceLevelsReached();

        if (size == 0) {
            priceList.pushFront(_price);
            return;
        }

        (, uint256 current) = priceList.getNextNode(0);
        uint256 prev = 0;

        while (current != 0) {
            if (_isBid) {
                if (current < _price) {
                    priceList.insertBefore(current, _price);
                    return;
                }
            } else {
                if (current > _price) {
                    priceList.insertBefore(current, _price);
                    return;
                }
            }
            prev = current;
            (, current) = priceList.getNextNode(current);
        }

        priceList.insertAfter(prev, _price);
    }

    /// @notice Remove price level when its order queue is empty.
    function _removePriceLevelIfEmpty(uint256 _expirationAt, uint256 _price, bool _isBid) private {
        StructuredLinkedList.List storage orderQueue = _expirationAtPriceOrderIds(_expirationAt, _price, _isBid);
        if (orderQueue.sizeOf() == 0) {
            StructuredLinkedList.List storage priceList = _isBid ? activeBidPrices[_expirationAt] : activeAskPrices[_expirationAt];
            if (priceList.nodeExists(_price)) {
                priceList.remove(_price);
            }
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setLiquidationMarginPercent(uint8 _liquidationMarginPercent) external onlyOwner {
        liquidationMarginPercent = _liquidationMarginPercent;
        emit LiquidationMarginPercentUpdated(_liquidationMarginPercent);
    }

    function setFutureExpirationDatesCount(uint8 _futureExpirationDatesCount) public onlyOwner {
        if (_futureExpirationDatesCount < 1) {
            revert ValueOutOfRange(1, int256(uint256(type(uint8).max)));
        }
        futureExpirationDatesCount = _futureExpirationDatesCount;
        emit FutureExpirationDatesCountUpdated(_futureExpirationDatesCount);
    }

    function setMakerFeeBps(int16 _makerFeeBps) external onlyOwner {
        makerFeeBps = _makerFeeBps;
        emit MakerFeeBpsUpdated(_makerFeeBps);
    }

    function setTakerFeeBps(int16 _takerFeeBps) external onlyOwner {
        takerFeeBps = _takerFeeBps;
        emit TakerFeeBpsUpdated(_takerFeeBps);
    }

    function setLiquidationFeeBps(uint16 _bps) external onlyOwner {
        liquidationFeeBps = _bps;
        emit LiquidationFeeBpsUpdated(_bps);
    }

    function setLiquidatorShareBps(uint16 _bps) external onlyOwner {
        if (_bps > 10_000) revert ValueOutOfRange(0, 10_000);
        liquidatorShareBps = _bps;
        emit LiquidatorShareBpsUpdated(_bps);
    }

    function setOracle(address addr) external onlyOwner {
        _setPriceOracle(AggregatorV3Interface(addr));
        emit OracleUpdated(addr);
    }

    function _setPriceOracle(AggregatorV3Interface _oracle) private {
        if (address(_oracle) == address(0)) {
            revert InvalidOracle();
        }
        priceOracle = _oracle;
        uint8 oracleDecimals = _oracle.decimals();
        if (collateralDecimals > oracleDecimals) {
            revert UnsupportedTokenDecimals();
        }
        hashpriceScalingDivisor = 10 ** uint256(oracleDecimals - collateralDecimals);
    }

    function setPortfolioMargin(IPortfolioMarginEngine _portfolioMargin) external onlyOwner {
        portfolioMargin = _portfolioMargin;
        emit PortfolioMarginUpdated(address(_portfolioMargin));
    }

    function setHook(address _hook) external onlyOwner {
        hook = IPointsHook(_hook);
        emit HookUpdated(_hook);
    }

    function _notifyFill(
        address _maker,
        address _taker,
        uint256 _notional,
        int256 _makerFee,
        uint256 _takerFee,
        uint256 _makerPrice
    ) private {
        IPointsHook _hook = hook;
        if (address(_hook) == address(0)) return;
        _hook.onFill(_maker, _taker, _notional, _makerFee, _takerFee, _makerPrice, _refPriceForPoints());
    }

    function _refPriceForPoints() private view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = priceOracle.latestRoundData();
        if (answer <= 0) return 0;
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) return 0;
        return _getMarketPrice(uint256(answer));
    }

    function _notifyLiquidation(address _liquidator, uint256 _fee) private {
        IPointsHook _hook = hook;
        if (address(_hook) == address(0)) return;
        _hook.onLiquidation(_liquidator, _fee);
    }

    /// @notice Admin escape hatch: clear orders + aggregate positions for the given participants.
    /// @dev Does not walk legacy lots for economics — zeros `netDelta` / `netEntryValue` /
    ///      `activeExpirationAts` directly. Also purges dead lot indexes and order queues.
    function resetState(address[] calldata _participants) external onlyOwner {
        for (uint256 p = 0; p < _participants.length; p++) {
            address participant = _participants[p];

            EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[participant];
            for (uint256 i = _orders.length(); i > 0; i--) {
                bytes32 orderId = _orders.at(i - 1);
                Order memory order = orders[orderId];
                _removeRestingOrder(orderId, order);
                emit OrderCancelled(orderId, participant);
            }

            // Clear aggregates + active dates directly (no lot iteration for economics).
            EnumerableSet.UintSet storage dates = participantActiveExpirationAts[participant];
            while (dates.length() > 0) {
                uint256 date = dates.at(0);
                delete participantExpirationAtNetDelta[participant][date];
                delete participantExpirationAtNetEntryValue[participant][date];

                // Purge dead per-date lot index entries.
                EnumerableSet.Bytes32Set storage dateLots = participantExpirationAtPositionIdsIndex[participant][date];
                while (dateLots.length() > 0) {
                    dateLots.remove(dateLots.at(0));
                }
                dates.remove(date);
            }

            // Purge dead global lot index + LegacyLot storage.
            EnumerableSet.Bytes32Set storage _positions = participantPositionIdsIndex[participant];
            while (_positions.length() > 0) {
                bytes32 positionId = _positions.at(0);
                delete positions[positionId];
                _positions.remove(positionId);
            }
        }
    }

    /// @notice True when the participant has resting orders or an active position and is below portfolio MM.
    function isLiquidatable(address _participant) public view returns (bool) {
        bool hasState = participantOrderIdsIndex[_participant].length() > 0
            || participantActiveExpirationAts[_participant].length() > 0;
        if (!hasState) return false;
        return vault.balanceOf(_participant) < portfolioMargin.computePortfolioMM(_participant);
    }

    function _underwater(address _participant) internal view returns (bool) {
        return vault.balanceOf(_participant) < portfolioMargin.computePortfolioMM(_participant);
    }

    // ── Order liquidation ─────────────────────────────────────────────────────

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

    function _doLiquidateOrder(address _user, bytes32 _orderId, Order memory _order) private {
        uint256 orderNotional = _order.price * _abs(_order.quantity);
        _removeRestingOrder(_orderId, _order);

        uint256 liqFee = _chargeLiquidationFee(_user, orderNotional);

        emit OrderCancelled(_orderId, _user);
        emit OrderLiquidated(_orderId, _user, _msgSender(), liqFee);
        _notifyLiquidation(_msgSender(), liqFee);
    }

    // ── Position liquidation ──────────────────────────────────────────────────

    /// @notice Force-close up to `closeQty` contracts of an underwater user's net at `expirationAt`.
    /// @dev Orders-first. Keeper sizes `closeQty` off-chain; partial closes revert `OverLiquidation`
    ///      if leftover balance sits above IM when a real IM>MM buffer exists. Full closes skip
    ///      that guard (bad-debt / deep-underwater path).
    function liquidatePosition(address _user, uint256 _expirationAt, uint256 _closeQty) external {
        if (participantOrderIdsIndex[_user].length() != 0) revert OrdersStillOpen();
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
        if (participantOrderIdsIndex[_user].length() != 0) revert OrdersStillOpen();

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
        private
        returns (bool)
    {
        uint256 absNet = _abs(_netQty);
        uint256 closeAbs = _closeQty < absNet ? _closeQty : absNet;
        if (closeAbs == 0) return false;

        if (closeAbs == absNet) {
            _doLiquidateFullPosition(_user, _expirationAt, _netQty);
            return true;
        }

        (int256 pnl, int256 signedClose) = _doPartialLiquidatePosition(_user, _expirationAt, _netQty, closeAbs);

        uint256 mark = getMarketPrice();
        uint256 closedNotional = mark * closeAbs;
        uint256 liqFee = _chargeLiquidationFee(_user, closedNotional);

        emit PositionLiquidated(_user, _msgSender(), _expirationAt, signedClose, pnl, liqFee);
        _notifyLiquidation(_msgSender(), liqFee);
        return true;
    }

    /// @dev With remaining portfolio risk and a real IM>MM buffer, balance must be ≤ IM.
    function _revertIfOverLiquidated(address _user) private view {
        uint256 im = portfolioMargin.computePortfolioIM(_user);
        uint256 mm = portfolioMargin.computePortfolioMM(_user);
        if (im > mm && vault.balanceOf(_user) > im) revert OverLiquidation();
    }

    function _doLiquidateFullPosition(address _user, uint256 _expirationAt, int256 _netQty) private {
        uint256 mark = getMarketPrice();
        int256 netEntry = participantExpirationAtNetEntryValue[_user][_expirationAt];
        int256 pnl = int256(mark) * _netQty - netEntry;

        _transferPnl(_insuranceFundAccount(), _user, pnl);

        uint256 closedNotional = mark * _abs(_netQty);
        uint256 liqFee = _chargeLiquidationFee(_user, closedNotional);

        participantExpirationAtNetDelta[_user][_expirationAt] = 0;
        participantExpirationAtNetEntryValue[_user][_expirationAt] = 0;
        participantActiveExpirationAts[_user].remove(_expirationAt);

        emit PositionLiquidated(_user, _msgSender(), _expirationAt, _netQty, pnl, liqFee);
        _notifyLiquidation(_msgSender(), liqFee);
    }

    function _doPartialLiquidatePosition(address _user, uint256 _expirationAt, int256 _netQty, uint256 _closeAbs)
        private
        returns (int256 pnl, int256 signedClose)
    {
        uint256 mark = getMarketPrice();
        int256 netEntry = participantExpirationAtNetEntryValue[_user][_expirationAt];
        uint256 absNet = _abs(_netQty);
        uint256 avgEntry = _abs(netEntry) / absNet;
        signedClose = _netQty > 0 ? int256(_closeAbs) : -int256(_closeAbs);
        pnl = (int256(mark) - int256(avgEntry)) * signedClose;
        _transferPnl(_insuranceFundAccount(), _user, pnl);

        // Reduce toward zero; scale netEntryValue proportionally.
        participantExpirationAtNetDelta[_user][_expirationAt] =
            _netQty > 0 ? _netQty - int256(_closeAbs) : _netQty + int256(_closeAbs);
        participantExpirationAtNetEntryValue[_user][_expirationAt] =
            netEntry * int256(absNet - _closeAbs) / int256(absNet);
    }

    // ── Settlement ────────────────────────────────────────────────────────────

    function recordSettlementPrice(uint256 expirationAt) external returns (uint256 price) {
        if (block.timestamp < expirationAt) revert SettlementDateNotReached();
        return _ensureSettlementPrice(expirationAt);
    }

    function _ensureSettlementPrice(uint256 expirationAt) private returns (uint256) {
        uint256 price = settlementPrice[expirationAt];
        if (price == 0) {
            price = _getMarketPrice(_getPrice());
            if (price == 0) revert InvalidPrice();
            settlementPrice[expirationAt] = price;
            emit SettlementPriceRecorded(expirationAt, price, _msgSender());
        }
        return price;
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

    function settlePositions(address[] calldata _users, uint256[] calldata _expirationAts) external {
        if (_users.length != _expirationAts.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < _users.length; i++) {
            settlePosition(_users[i], _expirationAts[i]);
        }
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getMarketPrice() public view returns (uint256) {
        return _getMarketPrice(_getPrice());
    }

    function decimals() external view returns (uint8) {
        return collateralDecimals;
    }

    function _getMarketPrice(uint256 _hashpriceUsd) private view returns (uint256) {
        // Oracle already quotes 1 PH/s/day (= CONTRACT_SIZE_HPS_DAY); only rescale decimals.
        uint256 scaled = _hashpriceUsd / hashpriceScalingDivisor;
        return _roundToNearest(scaled, minimumPriceIncrement);
    }

    function getOrder(bytes32 _orderId) external view returns (Order memory) {
        return orders[_orderId];
    }

    function getUserOrders(address _user) external view returns (bytes32[] memory) {
        return participantOrderIdsIndex[_user].values();
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

    function getNetPositionDelta(address _participant) external view returns (int256) {
        EnumerableSet.UintSet storage dates = participantActiveExpirationAts[_participant];
        uint256 len = dates.length();
        int256 netDelta = 0;
        for (uint256 i = 0; i < len; i++) {
            uint256 date = dates.at(i);
            if (settlementPrice[date] != 0) continue;
            netDelta += participantExpirationAtNetDelta[_participant][date];
        }
        return netDelta * 1e18;
    }

    /// @notice Minimum margin locked by resting orders (token decimals).
    /// @dev Per order: maintenance × |qty| − mark PnL. A reducing-side order at an
    ///      expiry with an open position is offset up to that position's remaining
    ///      margin cap (same spirit as perps `reducingVal`). No calendar scan —
    ///      position is read via `participantExpirationAtNetDelta[user][expiry]`.
    function getOrderMargin(address _participant) public view returns (uint256) {
        EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_participant];
        uint256 len = _orders.length();
        if (len == 0) return 0;

        uint256 marketPrice = getMarketPrice();
        uint256 marginPct = liquidationMarginPercent;

        // Remaining reduce-credit per expiry we've seen (at most one entry per
        // distinct resting-order expiry, ≤ len).
        uint256[] memory redExpiries = new uint256[](len);
        uint256[] memory redRemaining = new uint256[](len);
        uint256 nRed = 0;

        uint256 total = 0;
        for (uint256 i = 0; i < len; i++) {
            Order memory order = orders[_orders.at(i)];
            if (order.expirationAt < block.timestamp || order.quantity == 0) continue;

            uint256 absQty = _abs(order.quantity);
            uint256 maintenanceMargin = order.price * marginPct / 100 * absQty;
            int256 pnl = (int256(marketPrice) - int256(order.price)) * order.quantity;
            uint256 contrib = clamp(int256(maintenanceMargin) - pnl);

            int256 net = participantExpirationAtNetDelta[_participant][order.expirationAt];
            bool isReducing = net != 0 && (net > 0 ? order.quantity < 0 : order.quantity > 0);
            if (!isReducing) {
                total += contrib;
                continue;
            }

            // Lazy-init remaining cap for this expiry on first reducing order.
            uint256 slot = nRed;
            bool found = false;
            for (uint256 s = 0; s < nRed; s++) {
                if (redExpiries[s] == order.expirationAt) {
                    slot = s;
                    found = true;
                    break;
                }
            }
            if (!found) {
                redExpiries[nRed] = order.expirationAt;
                redRemaining[nRed] = marketPrice * marginPct / 100 * _abs(net);
                slot = nRed;
                nRed++;
            }

            uint256 credit = contrib < redRemaining[slot] ? contrib : redRemaining[slot];
            redRemaining[slot] -= credit;
            total += contrib - credit;
        }
        return total;
    }

    function getUnrealizedPnl(address _participant) external view returns (int256) {
        EnumerableSet.UintSet storage dates = participantActiveExpirationAts[_participant];
        uint256 len = dates.length();
        int256 totalPnl = 0;
        uint256 livePrice = 0;
        bool livePriceLoaded = false;
        for (uint256 i = 0; i < len; i++) {
            uint256 date = dates.at(i);
            uint256 markPrice = settlementPrice[date];
            if (markPrice == 0) {
                if (!livePriceLoaded) {
                    livePrice = getMarketPrice();
                    livePriceLoaded = true;
                }
                markPrice = livePrice;
            }
            totalPnl += int256(markPrice) * participantExpirationAtNetDelta[_participant][date]
                - participantExpirationAtNetEntryValue[_participant][date];
        }
        return totalPnl;
    }

    function getExpirationDates() external view returns (uint256[] memory) {
        uint256 currentExpirationDateIndex = _getCurrentExpirationAtIndex();
        uint256[] memory expirationDatesArray = new uint256[](futureExpirationDatesCount);
        for (uint256 i = 0; i < futureExpirationDatesCount; i++) {
            expirationDatesArray[i] =
                firstFutureExpirationDate + expirationIntervalSeconds() * (currentExpirationDateIndex + i);
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

    function _activePricesSlice(StructuredLinkedList.List storage priceList, uint256 _maxLevels)
        private
        view
        returns (uint256[] memory)
    {
        uint256 total = priceList.sizeOf();
        uint256 count = total < _maxLevels ? total : _maxLevels;
        uint256[] memory out = new uint256[](count);
        (, uint256 current) = priceList.getNextNode(0);
        for (uint256 i = 0; i < count && current != 0; i++) {
            out[i] = current;
            (, current) = priceList.getNextNode(current);
        }
        return out;
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
    /// @dev Skips own resting liquidity (matches on-match STP net-out).
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
                if (makerOrder.participant != msg.sender && makerOrder.quantity != 0) {
                    uint256 matchAmt = _abs(makerOrder.quantity) < _abs(remaining)
                        ? _abs(makerOrder.quantity)
                        : _abs(remaining);
                    if (matchAmt > 0) {
                        totalNotional += currentPrice * matchAmt;
                        totalFilledAbs += matchAmt;
                        remaining = isBuy ? remaining - int256(matchAmt) : remaining + int256(matchAmt);
                    }
                } else if (makerOrder.participant == msg.sender && makerOrder.quantity != 0) {
                    uint256 cancelAmt = _abs(makerOrder.quantity) < _abs(remaining)
                        ? _abs(makerOrder.quantity)
                        : _abs(remaining);
                    remaining = isBuy ? remaining - int256(cancelAmt) : remaining + int256(cancelAmt);
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
        StructuredLinkedList.List storage queue = _isBid
            ? expirationAtPriceOrdersLongIdQueue[_expirationAt][_price]
            : expirationAtPriceOrdersShortIdQueue[_expirationAt][_price];

        uint256 total = 0;
        uint256 size = queue.sizeOf();
        if (size == 0) return 0;

        (, uint256 nodeId) = queue.getNextNode(0);
        for (uint256 i = 0; i < size && nodeId != 0; i++) {
            total += _abs(orders[bytes32(nodeId)].quantity);
            (, nodeId) = queue.getNextNode(nodeId);
        }
        return total;
    }

    function _getCurrentExpirationAtIndex() private view returns (uint256) {
        if (block.timestamp > firstFutureExpirationDate) {
            return (block.timestamp - firstFutureExpirationDate) / expirationIntervalSeconds() + 1;
        }
        return 0;
    }

    function expirationIntervalDays() external pure returns (uint8) {
        return EXPIRATION_INTERVAL_DAYS;
    }

    function expirationIntervalSeconds() private pure returns (uint256) {
        return EXPIRATION_INTERVAL_DAYS * SECONDS_PER_DAY;
    }

    function _expirationAtPriceOrderIds(uint256 _expirationAt, uint256 _price, bool _isBuy)
        private
        view
        returns (StructuredLinkedList.List storage)
    {
        if (_isBuy) {
            return expirationAtPriceOrdersLongIdQueue[_expirationAt][_price];
        } else {
            return expirationAtPriceOrdersShortIdQueue[_expirationAt][_price];
        }
    }

    function _getPrice() private view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = priceOracle.latestRoundData();
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) {
            revert OracleStale();
        }
        if (answer <= 0) {
            revert InvalidOracle();
        }
        return uint256(answer);
    }

    function _roundToNearest(uint256 _value, uint256 _increment) private pure returns (uint256) {
        return (_value + _increment / 2) / _increment * _increment;
    }

    function clamp(int256 _value) private pure returns (uint256) {
        if (_value > 0) {
            return uint256(_value);
        } else {
            return 0;
        }
    }

    function _abs(int256 _value) private pure returns (uint256) {
        unchecked {
            return _value >= 0 ? uint256(_value) : uint256(-_value);
        }
    }

    function _isSameSign(int256 _a, int256 _b) private pure returns (bool) {
        return (_a > 0 && _b > 0) || (_a < 0 && _b < 0);
    }

    function validatePrice(uint256 _price) private view {
        if (_price == 0) revert InvalidPrice();
        if (_price % minimumPriceIncrement != 0) revert InvalidPrice();
    }

    function validateExpirationAt(uint256 _expirationAt) private view {
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

    function ensureNoCollateralDeficit(address _participant) private view {
        uint256 required = portfolioMargin.computePortfolioIM(_participant);
        if (vault.balanceOf(_participant) < required) revert InsufficientMarginBalance();
    }

    function withdrawCollectedFees() external onlyOwner {
        uint256 amount = collectedFeesBalance;
        collectedFeesBalance = 0;
        vault.withdrawTo(owner(), amount);
    }

    function _transferPnl(address _from, address _to, int256 _pnl) private {
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
    function _chargeLiquidationFee(address _user, uint256 _notionalValue) private returns (uint256 totalFee) {
        uint16 feeBps = liquidationFeeBps;
        if (feeBps == 0) return 0;

        uint256 computedFee = _notionalValue * uint256(feeBps) / 10_000;
        if (computedFee == 0) return 0;

        uint256 userBal = vault.balanceOf(_user);
        totalFee = computedFee < userBal ? computedFee : userBal;
        if (totalFee == 0) return 0;

        address liquidator = _msgSender();
        address insurance = _insuranceFundAccount();

        uint16 liqShareBps = liquidatorShareBps;
        uint256 liquidatorShare = totalFee * uint256(liqShareBps) / 10_000;
        uint256 insuranceShare = totalFee - liquidatorShare;

        if (liquidatorShare > 0) {
            _internalTransfer(_user, liquidator, liquidatorShare);
        }
        if (insuranceShare > 0) {
            _internalTransfer(_user, insurance, insuranceShare);
        }
    }

    function _insuranceFundAccount() private view returns (address) {
        address fund = vault.INSURANCE_FUND_ADDR();
        if (fund == address(0)) revert InsuranceFundNotConfigured();
        return fund;
    }

    function _internalTransfer(address from, address to, uint256 amount) private {
        if (amount == 0) return;
        vault.internalTransfer(from, to, amount);
    }
}
