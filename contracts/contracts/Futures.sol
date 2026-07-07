//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { MulticallUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { StructuredLinkedList } from "solidity-linked-list/contracts/StructuredLinkedList.sol";
import { Versionable } from "./interfaces/Versionable.sol";
import { ICollateralVault } from "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol";
import { IPortfolioMarginEngine } from "collateral-margin/contracts/contracts/interfaces/IPortfolioMarginEngine.sol";
import { IPointsHook } from "collateral-margin/contracts/contracts/interfaces/IPointsHook.sol";

// TODO:
// 6. Do we need to batch same price and delivery date orders/positions so it is a single entry?

contract Futures is UUPSUpgradeable, OwnableUpgradeable, MulticallUpgradeable, Versionable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using StructuredLinkedList for StructuredLinkedList.List;

    // mappings
    mapping(bytes32 => Order) private orders;
    mapping(bytes32 => Position) private positions;
    mapping(uint256 => mapping(uint256 => StructuredLinkedList.List)) private expirationAtPriceOrdersLongIdQueue; // FIFO queue of long orders by expiration date and price
    mapping(uint256 => mapping(uint256 => StructuredLinkedList.List)) private expirationAtPriceOrdersShortIdQueue; // FIFO queue of short orders by expiration date and price
    mapping(address => EnumerableSet.Bytes32Set) private participantPositionIdsIndex; // index of  positions by participant
    mapping(address => EnumerableSet.Bytes32Set) private participantOrderIdsIndex; // index of orders by participant
    mapping(address => mapping(uint256 => EnumerableSet.Bytes32Set)) private participantExpirationAtPositionIdsIndex; // index of positions by participant and expiration date
    mapping(address => mapping(uint256 => mapping(uint256 => EnumerableSet.Bytes32Set))) private
        participantExpirationAtPriceOrderIdsIndex;

    uint256 private _gap5;
    uint256 public firstFutureDeliveryDate; // timestamp of the first future delivery date
    /// @notice Hashes/second represented by one unit of futures. As of v2 the contract assumes one unit equals
    ///         100 TH/s per day (matching the hashprice oracle's quote unit), so this value is informational only
    ///         and no longer participates in market-price calculation. Retained as state for ABI back-compat.
    uint256 public speedHps;
    uint256 public minimumPriceIncrement; // difference between two closest prices in the order table
    /// @notice Flat fee charged to the taker (the incoming order's owner) on every matched unit.
    /// @dev Occupies the storage slot previously named `orderFee` so existing on-chain fee values are preserved across upgrade.
    uint256 public takerFee;
    uint256 private nonce = 0; // nonce for the order id

    address private _gap;
    /// @notice Hashprice oracle returning the price of 100 TH/s per day denominated in the same currency as `token`
    /// @dev Chainlink-compatible aggregator (e.g. HashpriceUSD when `token` is a USD stablecoin).
    ///      Variable name retained from v1.x for storage / ABI backwards compatibility; semantically this is a
    ///      hashprice (not hashrate) feed.
    AggregatorV3Interface public hashrateOracle;
    address private _gap6;

    /// @notice Notional multiplier ("contract size"): every unit of a futures position settles
    ///         `pricePerDay * deliveryDurationDays` of value. The legacy name is kept for ABI
    ///         back-compat; it no longer denotes a physical-delivery duration.
    uint8 public deliveryDurationDays;
    /// @notice Spacing, in days, between consecutive expiration dates offered on the book.
    /// @dev Legacy name retained for ABI back-compat; `deliveryAt`/"delivery date" now means the
    ///      position's expiration (maturity) timestamp at which it cash-settles.
    uint8 public deliveryIntervalDays;
    uint8 public futureDeliveryDatesCount; // number of future delivery dates to be available for orders
    uint8 public liquidationMarginPercent;
    uint8 private _gap3;
    string private _gap7;
    uint256 public collectedFeesBalance;
    uint256 private _gap2;
    /// @dev Reserved slot — previously `mapping(address => uint8) addressFeeDiscountPercent`. Kept to preserve
    ///      storage layout for variables that follow. Stale entries from before the upgrade are unreadable.
    mapping(address => uint8) private _gap4;
    /// @notice Precomputed divisor used to rebase oracle answers from `oracle.decimals()` to the wrapped
    ///         token's decimals. Recomputed whenever the oracle is set.
    /// @dev Equals 10^(oracle.decimals() - token.decimals()). Reverts on `setOracle` if the oracle has
    ///      fewer decimals than the token.
    uint256 public hashpriceScalingDivisor;

    IPortfolioMarginEngine public marginEngine;
    mapping(address => mapping(uint256 => int256)) private participantExpirationAtNetDelta; // net delta per participant per expiration date (pre-scaled by deliveryDurationDays, without 1e18)
    mapping(address => mapping(uint256 => int256)) private participantExpirationAtNetEntryValue; // sum of qty_i * entryPrice_i * durationDays per participant per expiration date (token decimals)

    /// @notice Set of price levels that currently have at least one resting buy order, per delivery date.
    /// @dev Maintained by `_addOrderToQueue` / `_removeOrderFromQueue`. Used by the off-chain market maker
    ///      and indexers to walk active depth without scanning every possible price tick.
    mapping(uint256 => EnumerableSet.UintSet) private activeBidPrices;
    /// @notice Set of price levels that currently have at least one resting sell order, per delivery date.
    mapping(uint256 => EnumerableSet.UintSet) private activeAskPrices;

    /// @notice Flat fee paid by the underwater participant to the caller of any permissionless
    ///         liquidation entry point — `liquidateOrder` / `liquidateOrders` (per cancelled
    ///         order) and `liquidatePosition` (per closed position). Settable by the owner.
    uint256 public liquidationFee;

    /// @notice Flat fee charged to the maker (the resting order's owner) on every matched unit.
    /// @dev Appended at the end of storage during the maker/taker fee upgrade.
    uint256 public makerFee;

    /// @notice Optional points/rewards hook notified on fills and liquidations.
    /// @dev Appended at the end of storage to preserve the upgradeable layout. When unset
    ///      (`address(0)`) the venue mints no points and skips the call entirely. When set,
    ///      hook calls are NOT wrapped in try/catch: a reverting hook will revert the fill or
    ///      liquidation. The hook is a simple, owner-controlled contract and can be unplugged
    ///      instantly via `setHook(address(0))`; unplug it before finalizing the POINTS token.
    IPointsHook public hook;

    /// @notice Pinned cash-settlement price per expiration (`deliveryAt` => price in token decimals).
    /// @dev `0` means not yet recorded. Set once by `recordSettlementPrice` (or lazily by the first
    ///      `settlePosition`) at/after maturity and never overwritten, so every position sharing a
    ///      `deliveryAt` settles at one deterministic price regardless of when its settlement tx lands.
    ///      Appended at end of storage to preserve the upgradeable layout.
    mapping(uint256 => uint256) public settlementPrice;

    /// @dev Expiration dates (`deliveryAt`) at which a participant currently holds at least one open
    ///      position. Maintained alongside `participantExpirationAtPositionIdsIndex` so the portfolio
    ///      margin views keep counting matured-but-unsettled positions — collateral stays locked until
    ///      `settlePosition` removes the position. Appended at end of storage for UUPS layout safety.
    mapping(address => EnumerableSet.UintSet) private participantActiveExpirationAts;

    // immutable
    /// @dev Unified collateral vault (Titan `CollateralVault` or compatible). Baked into the implementation via constructor.
    ICollateralVault public immutable collateralVault;
    uint8 private immutable _decimals; // decimals of the wrapped token

    // constants
    string public constant VERSION = "2.16.0";
    uint8 public constant MAX_ORDERS_PER_PARTICIPANT = 100;
    /// @notice Maximum absolute quantity accepted in a single `createOrder` call.
    /// @dev Bounded by the int8 parameter type. Exposed as a constant so off-chain
    ///      callers (e.g. the market maker) can clamp without hard-coding the limit.
    int8 public constant MAX_ORDER_QTY = type(int8).max;
    uint8 public constant BREACH_PENALTY_DECIMALS = 18;
    uint32 private constant SECONDS_PER_DAY = 3600 * 24;
    uint256 private constant MAX_BREACH_PENALTY_RATE_PER_DAY = 5 * 10 ** (BREACH_PENALTY_DECIMALS - 2); // 5%
    /// @notice Maximum age of the hashprice oracle answer that is still considered fresh.
    /// @dev Reads of `_getHashpriceUsd` revert with `OracleStale` once `block.timestamp - updatedAt`
    ///      exceeds this value. Sized generously above the upstream feed's heartbeat so brief delays
    ///      don't halt trading, while still preventing trades on multi-hour-old data.
    uint256 public constant MAX_ORACLE_STALENESS = 3600; // 1 hour

    /// @notice Represents an order to buy or sell a futures contract
    /// @dev Created when a participant places an order
    struct Order {
        bool isBuy; // true if long/buy position, false if short/sell position
        address participant; // address of seller or buyer
        string destURL; // DEPRECATED: legacy stratum destination for physical delivery; ignored by cash settlement
        uint256 pricePerDay; // price of the hashrate in tokens for one day
        uint256 deliveryAt; // expiration (maturity) timestamp at which the resulting position cash-settles
        uint256 createdAt; // timestamp of the creation of the order
    }

    /// @notice One placement in a `createOrders` batch. Mirrors the per-leg arguments of
    ///         `createOrder` so the batch entrypoint can amortize the IM check and
    ///         outdated-orders pruning across many placements.
    /// @param pricePerDay   Order price per delivery-day (token decimals).
    /// @param deliveryDate  Delivery start timestamp; must be one of `getDeliveryDates()`.
    /// @param destURL       Optional stratum URL set on the resulting position (buyer side).
    /// @param qty           Signed quantity: `> 0` for buy / long, `< 0` for sell / short.
    ///                      Bounded by `int8` so callers can clamp to `MAX_ORDER_QTY`.
    struct OrderIntent {
        uint256 pricePerDay;
        uint256 deliveryDate;
        string destURL;
        int8 qty;
    }

    /// @notice Represents a couple of matched counterparty orders with bindings, active futures contract between seller and buyer
    /// @dev Created when two opposing orders are matched
    struct Position {
        address seller; // short side
        address buyer; // long side
        string destURL; // DEPRECATED: legacy stratum destination for physical delivery; ignored by cash settlement
        uint256 sellPricePerDay;
        uint256 buyPricePerDay;
        uint256 deliveryAt; // expiration (maturity) timestamp at which the position cash-settles
        uint256 createdAt; // timestamp of the creation of the position
        bool paid; // DEPRECATED: legacy physical-delivery escrow flag; always false (escrow is retired)
    }

    // ── Order reasons ───────────────────────────────────────────────────────
    enum OrderCloseReason {
        MATCHED,
        CANCELLED,
        EXPIRED,
        LIQUIDATED,
        RESET
    }

    // ── Lot (matched unit) close reasons ────────────────────────────────────
    /// @dev Ordinals are part of the off-chain (indexer) ABI and MUST stay stable. BREACH and EXPIRED
    ///      belonged to the retired physical-delivery flow and are no longer emitted; they are kept only
    ///      to preserve the enum ordinals of the reasons that follow.
    enum LotCloseReason {
        MUTUAL_EXIT, // both parties offset via opposing orders
        LIQUIDATION, // forced cash-settle at market price
        BREACH, // DEPRECATED (legacy physical delivery): no longer emitted
        SETTLED, // cash-settled at maturity via settlePosition / settlePositions
        RESET, // admin resetState
        EXPIRED // DEPRECATED (legacy physical delivery): no longer emitted
    }

    // events
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed participant,
        string destURL,
        uint256 pricePerDay,
        uint256 deliveryAt,
        bool isBuy
    );

    /// @notice Fired when an order is closed for any reason.
    /// @dev Participant is intentionally omitted — it is always recoverable from the matching
    ///      `OrderCreated`/`orders[orderId].participant` mapping, and OrderCreated is permanently
    ///      observable by any indexer subscribed to this event stream.
    ///      When `reason == LIQUIDATED` a paired `OrderLiquidated` carries the liquidator /
    ///      fee context; merging those fields here would tax every cancel/match/expire.
    /// @param reason  MATCHED — part of a fill; CANCELLED — user cancel; EXPIRED — past deliveryAt;
    ///                LIQUIDATED — permissionless liquidation; RESET — admin reset.
    event OrderClosed(bytes32 indexed orderId, OrderCloseReason reason);

    /// @notice Snapshot of every owner-settable configuration field. Emitted by `ConfigUpdated`
    ///         whenever any setter mutates state, and once at the end of `initialize`. Off-chain
    ///         consumers can refresh their entire view in O(1) instead of subscribing to each
    ///         individual `set*` event.
    struct Config {
        uint256 makerFee;
        uint256 takerFee;
        uint256 liquidationFee;
        uint256 minimumPriceIncrement;
        uint8 liquidationMarginPercent;
        uint8 futureDeliveryDatesCount;
        address hashrateOracle;
        address marginEngine;
    }

    /// @notice Whole-config snapshot. Replaces the per-field
    ///         `MakerFeeUpdated`/`TakerFeeUpdated`/`LiquidationFeeUpdated`/`ValidatorURLUpdated`
    ///         events so the off-chain indexer only needs one handler to refresh state.
    event ConfigUpdated(Config config);

    /// @notice Fired when a new matched unit (qty=1) is created.
    /// @param lotId         The on-chain position ID of this matched unit.
    /// @param makerOrderId  The resting order that was matched.
    /// @param takerOrderId  The synthetic taker order (OrderCreated+OrderClosed(MATCHED) already fired).
    event LotCreated(
        bytes32 indexed lotId,
        address indexed seller,
        address indexed buyer,
        uint256 pricePerDay,
        uint256 deliveryAt,
        bytes32 makerOrderId,
        bytes32 takerOrderId
    );

    /// @notice Atomic counterparty transfer: one party exits an existing lot and a new
    ///         participant takes their slot. The remaining party's session is NEVER touched.
    /// @dev `newSellPricePerDay` / `newBuyPricePerDay` may differ when the remaining
    ///      counterparty carries their original entry price forward (see
    ///      `_maybeExitExistingPosition`). Off-chain consumers MUST use both fields rather
    ///      than collapsing to a single price.
    event LotTransferred(
        bytes32 indexed oldLotId,
        bytes32 indexed newLotId,
        address exitingParticipant,
        address newParticipant,
        int256 exitPnl,
        uint256 newSellPricePerDay,
        uint256 newBuyPricePerDay,
        bytes32 makerOrderId,
        bytes32 takerOrderId
    );

    /// @notice Fired when a lot is closed for any reason. sellerPnl/buyerPnl are signed
    ///         (positive = profit). For SETTLED, closedBy is whoever called `settlePosition`.
    /// @dev When `reason == LIQUIDATION` a paired `LotLiquidated` carries the liquidator / fee
    ///      context; merging those fields here would tax every settle/mutual-exit.
    event LotClosed(
        bytes32 indexed lotId,
        address indexed seller,
        address indexed buyer,
        int256 sellerPnl,
        int256 buyerPnl,
        address closedBy,
        LotCloseReason reason
    );

    /// @notice Emitted when a transfer cannot be fully covered by the payer's vault balance during PnL settlement.
    event BadDebt(address indexed account, uint256 amount);

    /// @notice Emitted when a resting order is force-cancelled by a permissionless liquidator.
    ///         Paired with `OrderClosed(LIQUIDATED)` in the same tx; subscribed-to only by
    ///         keepers / indexers that need per-liquidation attribution.
    event OrderLiquidated(
        bytes32 indexed orderId, address indexed participant, address indexed liquidator, uint256 fee
    );

    /// @notice Emitted when a lot is force-closed by a permissionless liquidator. Paired with
    ///         `LotClosed(LIQUIDATION)` in the same tx.
    event LotLiquidated(bytes32 indexed lotId, address indexed participant, address indexed liquidator, uint256 fee);

    /// @notice Emitted once per expiration when its cash-settlement price is pinned. All positions at
    ///         `deliveryAt` subsequently settle at `price`. `recordedBy` is whoever pinned it (an
    ///         explicit `recordSettlementPrice` caller or the first `settlePosition` for that expiry).
    event SettlementPriceRecorded(uint256 indexed deliveryAt, uint256 price, address recordedBy);

    // errors
    error InvalidPrice();
    error InvalidQty();
    error DeliveryDateShouldBeInTheFuture();
    error DeliveryDateNotAvailable();
    error OrderNotBelongToSender();
    error InsufficientMarginBalance();
    error OnlyValidatorOrPositionParticipant();
    error PositionNotExists();
    error PositionDeliveryNotStartedYet();
    error PositionDeliveryExpired();
    error PositionDeliveryNotExpired(); // DEPRECATED (legacy physical delivery): no longer thrown
    error DeliveryDateExpired();
    error MaxOrdersPerParticipantReached();
    error ValueOutOfRange(int256 min, int256 max);
    error DeliveryNotFinishedYet();
    error OnlyPositionBuyer();
    error PositionAlreadyPaid();
    error PositionDestURLNotSet();
    error NothingToWithdraw();
    error CollateralTokenMismatch();
    error ZeroAddress();
    error InsufficientContractReserve(uint256 reserve, uint256 required);
    error InsuranceFundNotConfigured();
    error TransferDisabled();
    error UnsupportedTokenDecimals(); // token decimals exceed oracle decimals
    error OracleStale(); // hashprice oracle answer older than MAX_ORACLE_STALENESS
    error SettlementDateNotReached(); // recordSettlementPrice called before the expiration matured
    error InvalidOracle(); // hashprice oracle returned a non-positive answer
    error NotLiquidatable(); // liquidate{Order,Orders,Position} called on a healthy participant
    error OrdersStillOpen(); // liquidatePosition called while participant has resting orders
    error OverLiquidation(); // liquidatePositions closed too many lots — leftover balance above the IM buffer
    error OrderNotBelongToParticipant(); // liquidateOrder/liquidateOrders received an id not owned by `participant`
    error PositionNotBelongToParticipant(); // liquidatePosition received a positionId where participant is neither buyer nor seller
    error OrderNotExists(); // removeOutdatedOrder received an unknown / already-closed orderId
    error OrderNotExpired(); // removeOutdatedOrder called on an order whose deliveryAt is still in the future

    /// @param _collateralVault Must use the same underlying ERC20 as `token` passed to `initialize`.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(ICollateralVault _collateralVault) {
        if (address(_collateralVault) == address(0)) revert ZeroAddress();
        collateralVault = _collateralVault;
        _decimals = IERC20Metadata(address(_collateralVault)).decimals();
        _disableInitializers();
    }

    function initialize(
        AggregatorV3Interface _hashrateOracle,
        uint8 _liquidationMarginPercent,
        uint256 _speedHps,
        uint256 _minimumPriceIncrement,
        uint8 _deliveryDurationDays,
        uint8 _deliveryIntervalDays,
        uint8 _futureDeliveryDatesCount,
        uint256 _firstFutureDeliveryDate
    ) public initializer {
        __Ownable_init(_msgSender());
        __UUPSUpgradeable_init();
        _setHashrateOracle(_hashrateOracle);
        liquidationMarginPercent = _liquidationMarginPercent;
        minimumPriceIncrement = _minimumPriceIncrement;
        speedHps = _speedHps;
        deliveryDurationDays = _deliveryDurationDays;
        deliveryIntervalDays = _deliveryIntervalDays;
        if (_futureDeliveryDatesCount < 1) {
            revert ValueOutOfRange(1, int256(uint256(type(uint8).max)));
        }
        futureDeliveryDatesCount = _futureDeliveryDatesCount;
        firstFutureDeliveryDate = _firstFutureDeliveryDate;
        _emitConfigUpdated();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        // Only the owner can upgrade the contract
    }

    function createOrder(uint256 _price, uint256 _expirationAt, string memory _destURL, int8 _qty) external {
        address sender = _msgSender();
        _createOrderInternal(sender, _price, _expirationAt, _destURL, _qty);
        ensureNoCollateralDeficit(sender);
    }

    /// @notice Batched placement. Runs the IM check (`ensureNoCollateralDeficit`) exactly
    ///         once at the end of the batch, instead of once per placement.
    /// @dev    Semantically equivalent to calling `createOrder` once per intent but materially
    ///         cheaper: `marginEngine.computePortfolioIM` (and the hashprice-oracle read it
    ///         performs via `getFuturesOrderMargin`) runs once at the end rather than after
    ///         every placement. Reverts atomically if any intent fails validation or if the
    ///         final batch state is collateral-deficit, leaving the book unchanged.
    ///
    ///         Expired-order cleanup is intentionally NOT performed here — that is the job
    ///         of the permissionless `removeOutdatedOrdersForParticipant(address)`, which any
    ///         caller can invoke independently (typically composed with this entrypoint via
    ///         the inherited Multicall when the participant wants to free up order-count slots
    ///         in the same tx).
    /// @param _intents Per-leg placement arguments. Empty array is a no-op apart from the
    ///                 single IM check.
    function createOrders(OrderIntent[] calldata _intents) external {
        address sender = _msgSender();
        uint256 len = _intents.length;
        for (uint256 i = 0; i < len; i++) {
            OrderIntent calldata intent = _intents[i];
            _createOrderInternal(sender, intent.pricePerDay, intent.deliveryDate, intent.destURL, intent.qty);
        }
        ensureNoCollateralDeficit(sender);
    }

    /// @dev Per-leg body of `createOrder`, without the IM-check epilogue
    ///      (`ensureNoCollateralDeficit`). Both `createOrder` and `createOrders` wrap this so
    ///      the batch entrypoint amortizes the expensive epilogue across N placements.
    function _createOrderInternal(
        address _participant,
        uint256 _price,
        uint256 _expirationAt,
        string memory _destURL,
        int8 _qty
    ) private {
        validatePrice(_price);
        validateExpirationAt(_expirationAt);
        validateQty(_qty);

        bool _isBuy = _qty > 0;

        // cache order indexes since they are the same for the loop
        StructuredLinkedList.List storage orderIndex = _expirationAtPriceOrderIds(_expirationAt, _price, _isBuy);
        StructuredLinkedList.List storage oppositeOrderIndex =
            _expirationAtPriceOrderIds(_expirationAt, _price, !_isBuy);
        EnumerableSet.Bytes32Set storage participantPriceOrderIds =
            participantExpirationAtPriceOrderIdsIndex[_participant][_expirationAt][_price];

        uint8 absQty = abs8(_qty);
        for (uint8 i = 0; i < absQty; i++) {
            _createOrMatchSingleOrder(
                orderIndex,
                oppositeOrderIndex,
                participantPriceOrderIds,
                _participant,
                _price,
                _expirationAt,
                _destURL,
                _isBuy,
                true
            );
        }
    }

    /// @dev Charges flat maker and taker fees, transferring them from the participants' vault balances
    ///      into `address(this)` and crediting `collectedFeesBalance`. Called only on actual matches
    ///      (not on plain order placement and not on liquidation-driven matches).
    function _chargeMatchFees(address _maker, address _taker) private {
        uint256 makerAmt = makerFee;
        uint256 takerAmt = takerFee;
        if (makerAmt > 0) {
            collectedFeesBalance += makerAmt;
            _internalTransfer(_maker, address(this), makerAmt);
        }
        if (takerAmt > 0) {
            collectedFeesBalance += takerAmt;
            _internalTransfer(_taker, address(this), takerAmt);
        }
    }

    /// @notice Creates or matches a single order
    /// @dev Creates a new order if no matching order is found, otherwise matches the order
    /// @param _chargeFees When true and a match occurs, maker/taker fees are charged. Set to false for
    ///                    liquidation-driven matches that must not impose trading fees on either side.
    /// @return orderCreated Return true if the order was created or matched, false if it offsetted existing order (closed)
    function _createOrMatchSingleOrder(
        StructuredLinkedList.List storage orderIndexId,
        StructuredLinkedList.List storage oppositeOrderIndexId,
        EnumerableSet.Bytes32Set storage participantPriceOrderIds,
        address _participant,
        uint256 _price,
        uint256 _expirationAt,
        string memory _destURL,
        bool _isBuy,
        bool _chargeFees
    ) private returns (bool orderCreated) {
        //
        // No matching order found
        //
        if (oppositeOrderIndexId.sizeOf() == 0) {
            EnumerableSet.Bytes32Set storage participantOrders = participantOrderIdsIndex[_participant];
            if (participantOrders.length() >= MAX_ORDERS_PER_PARTICIPANT) {
                revert MaxOrdersPerParticipantReached();
            }
            bytes32 _orderId = _createOrder(_participant, _price, _expirationAt, _isBuy, _destURL);
            _addOrderToQueue(orderIndexId, _orderId, _expirationAt, _price, _isBuy);
            participantOrders.add(_orderId);
            participantPriceOrderIds.add(_orderId);
            return true;
        }

        //
        // Check if there are no matching orders by the same participant, ignoring their ordering
        //
        if (participantPriceOrderIds.length() > 0) {
            bytes32 orderId = participantPriceOrderIds.at(0);
            Order memory order = orders[orderId];
            if (order.isBuy != _isBuy) {
                _closeOrder(orderId, order, OrderCloseReason.CANCELLED);
                return false;
            }
        }

        //
        // found matching order
        //
        (, uint256 oppositeOrderIdUint) = oppositeOrderIndexId.getNextNode(0);
        bytes32 oppositeOrderId = bytes32(oppositeOrderIdUint);
        Order memory oppositeOrder = orders[oppositeOrderId];

        // Mint a transient orderId for the taker leg too so off-chain consumers
        // see a symmetric OrderCreated → OrderClosed pair for both sides of the
        // match. The taker order is never persisted to storage — it lives only
        // in the event log.
        bytes32 takerOrderId = _emitTakerMatchOrder(_participant, _price, _expirationAt, _isBuy, _destURL);

        // delete matching order
        _closeOrder(oppositeOrderId, oppositeOrder, OrderCloseReason.MATCHED);

        // charge maker/taker fees on the fill (skipped for liquidation-driven matches).
        if (_chargeFees) {
            _chargeMatchFees(oppositeOrder.participant, _participant);
            _notifyFill(oppositeOrder.participant, _participant, _price, oppositeOrder.pricePerDay);
        }

        // create new position
        _createPosition(oppositeOrderId, oppositeOrder, _participant, _destURL, takerOrderId);
        return true;
    }

    /// @dev Mints a fresh orderId for an immediately-filled taker fill and emits
    ///      `OrderCreated` followed by `OrderClosed(MATCHED)` for it. The order itself is
    ///      not stored — these events exist solely to let indexers materialize
    ///      and resolve a complete Order record for the taker.
    function _emitTakerMatchOrder(
        address _participant,
        uint256 _pricePerDay,
        uint256 _deliveryAt,
        bool _isBuy,
        string memory _destURL
    ) private returns (bytes32 takerOrderId) {
        takerOrderId = bytes32(++nonce);
        emit OrderCreated(takerOrderId, _participant, _destURL, _pricePerDay, _deliveryAt, _isBuy);
        emit OrderClosed(takerOrderId, OrderCloseReason.MATCHED);
    }

    function _createOrder(
        address _participant,
        uint256 _pricePerDay,
        uint256 _deliveryAt,
        bool _isBuy,
        string memory _destURL
    ) private returns (bytes32) {
        bytes32 orderId = bytes32(++nonce);
        orders[orderId] = Order({
            participant: _participant,
            pricePerDay: _pricePerDay,
            deliveryAt: _deliveryAt,
            isBuy: _isBuy,
            createdAt: block.timestamp,
            destURL: _destURL
        });

        emit OrderCreated(orderId, _participant, _destURL, _pricePerDay, _deliveryAt, _isBuy);
        return orderId;
    }

    function _createPosition(
        bytes32 orderId,
        Order memory order,
        address _otherParticipant,
        string memory _destURL,
        bytes32 takerOrderId
    ) private {
        Position memory _temp;

        if (order.isBuy) {
            _temp.buyer = order.participant;
            _temp.seller = _otherParticipant;
            _temp.destURL = order.destURL;
        } else {
            _temp.buyer = _otherParticipant;
            _temp.seller = order.participant;
            _temp.destURL = _destURL;
        }
        _temp.sellPricePerDay = order.pricePerDay;
        _temp.buyPricePerDay = order.pricePerDay;

        // Either side of the new trade may already hold an opposite-side position at this
        // delivery date — exit it before creating the new position. `order.isBuy` is the
        // side the resting-order placer takes; the new-order placer takes the opposite side.
        ExitResult memory ex = _maybeExitExistingPosition(_temp, order, order.participant, order.isBuy);
        if (!ex.exited) {
            ex = _maybeExitExistingPosition(_temp, order, _otherParticipant, !order.isBuy);
        }

        if (ex.exited && _temp.buyer == _temp.seller) {
            // Both parties exited the old lot — no new lot to create.
            int256 sellerPnl = (ex.exitingParticipant == ex.oldSeller) ? ex.exitPnl : -ex.exitPnl;
            int256 buyerPnl = (ex.exitingParticipant == ex.oldBuyer) ? ex.exitPnl : -ex.exitPnl;
            emit LotClosed(
                ex.lotId, ex.oldSeller, ex.oldBuyer, sellerPnl, buyerPnl, address(0), LotCloseReason.MUTUAL_EXIT
            );
            return;
        }

        bytes32 positionId = bytes32(++nonce);
        positions[positionId] = Position({
            seller: _temp.seller,
            buyer: _temp.buyer,
            sellPricePerDay: _temp.sellPricePerDay,
            buyPricePerDay: _temp.buyPricePerDay,
            deliveryAt: order.deliveryAt,
            createdAt: block.timestamp,
            destURL: _temp.destURL,
            paid: false
        });
        participantPositionIdsIndex[_temp.seller].add(positionId);
        participantPositionIdsIndex[_temp.buyer].add(positionId);
        participantExpirationAtPositionIdsIndex[_temp.seller][order.deliveryAt].add(positionId);
        participantExpirationAtPositionIdsIndex[_temp.buyer][order.deliveryAt].add(positionId);
        participantActiveExpirationAts[_temp.seller].add(order.deliveryAt);
        participantActiveExpirationAts[_temp.buyer].add(order.deliveryAt);
        int256 _delta = int256(uint256(deliveryDurationDays));
        participantExpirationAtNetDelta[_temp.seller][order.deliveryAt] -= _delta;
        participantExpirationAtNetDelta[_temp.buyer][order.deliveryAt] += _delta;
        participantExpirationAtNetEntryValue[_temp.seller][order.deliveryAt] -= int256(_temp.sellPricePerDay) * _delta;
        participantExpirationAtNetEntryValue[_temp.buyer][order.deliveryAt] += int256(_temp.buyPricePerDay) * _delta;

        if (ex.exited) {
            // Counterparty transfer: one party exited the old lot, a new participant takes their slot.
            address newParticipant = (ex.exitingParticipant == ex.oldBuyer) ? _temp.buyer : _temp.seller;
            _emitLotTransferred(
                ex.lotId,
                positionId,
                ex.exitingParticipant,
                newParticipant,
                ex.exitPnl,
                _temp.sellPricePerDay,
                _temp.buyPricePerDay,
                orderId,
                takerOrderId
            );
        } else {
            _emitLotCreated(positionId, _temp, order.deliveryAt, orderId, takerOrderId);
        }
    }

    /// @dev Extracted to keep `_createPosition` below the EVM stack-depth limit.
    function _emitLotCreated(
        bytes32 positionId,
        Position memory _temp,
        uint256 deliveryAt,
        bytes32 orderId,
        bytes32 takerOrderId
    ) private {
        emit LotCreated(positionId, _temp.seller, _temp.buyer, _temp.sellPricePerDay, deliveryAt, orderId, takerOrderId);
    }

    /// @dev Extracted to keep `_createPosition` below the EVM stack-depth limit.
    function _emitLotTransferred(
        bytes32 oldLotId,
        bytes32 newLotId,
        address exitingParticipant,
        address newParticipant,
        int256 exitPnl,
        uint256 newSellPricePerDay,
        uint256 newBuyPricePerDay,
        bytes32 makerOrderId,
        bytes32 takerOrderId
    ) private {
        emit LotTransferred(
            oldLotId,
            newLotId,
            exitingParticipant,
            newParticipant,
            exitPnl,
            newSellPricePerDay,
            newBuyPricePerDay,
            makerOrderId,
            takerOrderId
        );
    }

    /// @dev Result of an attempted exit of `participant`'s existing position via an offsetting trade.
    struct ExitResult {
        bool exited; // false: no opposite-side position found
        bytes32 lotId; // the old lot's id
        address oldSeller; // seller of the old lot
        address oldBuyer; // buyer of the old lot
        address exitingParticipant; // = participant (the one offsetting out)
        int256 exitPnl; // signed PnL credited to `exitingParticipant` (positive = profit)
    }

    /// @dev If `participant` already holds a position at `order.deliveryAt` on the opposite
    ///      side of the trade they are about to enter, exit it: settle realized PnL against
    ///      the insurance fund, remove the old position, and rewire `_temp` so the old lot's
    ///      counterparty takes `participant`'s slot in the new lot.
    ///      `participantNewSideIsBuy` indicates which side `participant` is taking in the new trade.
    ///      No events are emitted here — the caller emits `LotClosed(MUTUAL_EXIT)` or `LotTransferred`.
    function _maybeExitExistingPosition(
        Position memory _temp,
        Order memory order,
        address participant,
        bool participantNewSideIsBuy
    ) private returns (ExitResult memory result) {
        EnumerableSet.Bytes32Set storage participantPositions =
            participantExpirationAtPositionIdsIndex[participant][order.deliveryAt];
        if (participantPositions.length() == 0) return result;

        bytes32 existingPositionId = participantPositions.at(0);
        Position memory existingPosition = positions[existingPositionId];

        int256 pnlPerDay; // negative is profit, positive is loss
        if (existingPosition.buyer == participant && !participantNewSideIsBuy) {
            // long → flat: bought high (buyPx) and sells now at order.pricePerDay
            pnlPerDay = int256(existingPosition.buyPricePerDay) - int256(order.pricePerDay);
            _temp.seller = existingPosition.seller;
            _temp.sellPricePerDay = existingPosition.sellPricePerDay;
        } else if (existingPosition.seller == participant && participantNewSideIsBuy) {
            // short → flat: sold at sellPx and buys back now at order.pricePerDay
            pnlPerDay = int256(order.pricePerDay) - int256(existingPosition.sellPricePerDay);
            _temp.buyer = existingPosition.buyer;
            _temp.buyPricePerDay = existingPosition.buyPricePerDay;
        } else {
            // existing position is on the same side as the new trade — nothing to offset
            return result;
        }

        _removePosition(existingPositionId, existingPosition);
        int256 pnl = pnlPerDay * int256(uint256(deliveryDurationDays));
        _transferPnl(participant, _insuranceFundAccount(), pnl);

        if (_temp.buyer == _temp.seller) {
            // mutual exit — the old counterparty also gets out via the same trade
            _transferPnl(_insuranceFundAccount(), _temp.buyer, pnl);
        }

        result.exited = true;
        result.lotId = existingPositionId;
        result.oldSeller = existingPosition.seller;
        result.oldBuyer = existingPosition.buyer;
        result.exitingParticipant = participant;
        result.exitPnl = -pnl; // positive pnl arg = paid out, so participant received -pnl
    }

    /// @notice Closes a single resting order whose `deliveryAt` is already in the past.
    ///         Permissionless — any address may call it for any orderId, since closing
    ///         an expired order is unambiguously correct (it frees up a slot under
    ///         `MAX_ORDERS_PER_PARTICIPANT` for the owner and removes a dead level from
    ///         the book).
    /// @dev    No longer invoked from `createOrder` / `createOrders` — those entrypoints
    ///         skip this cleanup on the hot path to keep gas predictable. Callers that
    ///         want bulk cleanup compose multiple calls via the inherited `multicall(bytes[])`
    ///         (typically `[removeOutdatedOrder(id1), …, removeOutdatedOrder(idN),
    ///         createOrders(intents)]`), or run it independently as a keeper job.
    ///         Reverts `OrderNotExists` for an unknown / already-closed id, and
    ///         `OrderNotExpired` for an order whose `deliveryAt` is still in the future,
    ///         so silent no-ops can't hide caller bugs.
    ///
    /// @dev    TODO(keeper-incentive): right now closing an expired order pays the caller
    ///         nothing — the keeper bears gas with no on-chain reward. Worth exploring a
    ///         maker-side escrow that doubles as a cleanup bounty:
    ///
    ///           1. Charge `makerFee` from the participant on `createOrder` /
    ///              `createOrders`, holding it inside the contract as an escrowed bounty.
    ///           2. On `closeOrder` (user cancel) — refund the maker fee in full,
    ///              so cooperative MMs that cancel before expiration pay nothing.
    ///           3. On `removeOutdatedOrder` (keeper sweep) — forward the escrowed
    ///              maker fee to `_msgSender()` as a bounty, making expired-order
    ///              cleanup profitable for whoever calls it first.
    ///           4. On match (`MATCHED`) — keep the existing maker-fee accounting
    ///              into `collectedFeesBalance`; no change needed there.
    ///           5. On `liquidateOrder` / `RESET` — credit the escrow back to the
    ///              order owner (cleanup happens at the keeper's existing
    ///              `liquidationFee` price, no extra bounty).
    ///
    ///         Open design questions: (a) bounty sized to gas cost on the target
    ///         chain — flat `makerFee` may need a per-order floor / cap; (b) interaction
    ///         with `getFuturesOrderMargin` and IM accounting (escrow is collateral
    ///         that's already locked but currently uncounted toward maintenance margin);
    ///         (c) whether `RESET` should bounty the admin call too, or strictly refund.
    /// @param  _orderId The id of the order to close.
    function removeOutdatedOrder(bytes32 _orderId) external {
        Order memory order = orders[_orderId];
        if (order.participant == address(0)) revert OrderNotExists();
        if (order.deliveryAt >= block.timestamp) revert OrderNotExpired();
        _closeOrder(_orderId, order, OrderCloseReason.EXPIRED);
    }

    function _closeOrder(bytes32 orderId, Order memory order, OrderCloseReason reason) private {
        StructuredLinkedList.List storage orderIndexId =
            _expirationAtPriceOrderIds(order.deliveryAt, order.pricePerDay, order.isBuy);
        _removeOrderFromQueue(orderIndexId, orderId, order.deliveryAt, order.pricePerDay, order.isBuy);

        participantOrderIdsIndex[order.participant].remove(orderId);
        participantExpirationAtPriceOrderIdsIndex[order.participant][order.deliveryAt][order.pricePerDay].remove(
            orderId
        );
        delete orders[orderId];
        emit OrderClosed(orderId, reason);
    }

    /// @dev Pushes `_orderId` onto the per-(expirationAt, price) FIFO queue and, if the queue
    ///      transitioned from empty → non-empty, records the price level in
    ///      `activeBidPrices` / `activeAskPrices` so off-chain consumers can enumerate live depth.
    function _addOrderToQueue(
        StructuredLinkedList.List storage orderIndexId,
        bytes32 _orderId,
        uint256 _expirationAt,
        uint256 _price,
        bool _isBuy
    ) private {
        bool wasEmpty = orderIndexId.sizeOf() == 0;
        orderIndexId.pushBack(uint256(_orderId));
        if (wasEmpty) {
            (_isBuy ? activeBidPrices : activeAskPrices)[_expirationAt].add(_price);
        }
    }

    /// @dev Removes `_orderId` from the per-(expirationAt, price) queue and, if the queue is now
    ///      empty, drops the price level from the active-price set.
    function _removeOrderFromQueue(
        StructuredLinkedList.List storage orderIndexId,
        bytes32 _orderId,
        uint256 _expirationAt,
        uint256 _price,
        bool _isBuy
    ) private {
        orderIndexId.remove(uint256(_orderId));
        if (orderIndexId.sizeOf() == 0) {
            (_isBuy ? activeBidPrices : activeAskPrices)[_expirationAt].remove(_price);
        }
    }

    /// @notice Cancels a resting order owned by the caller.
    function closeOrder(bytes32 _orderId) external {
        Order memory order = orders[_orderId];
        if (order.participant != _msgSender()) revert OrderNotBelongToSender();
        _closeOrder(_orderId, order, OrderCloseReason.CANCELLED);
    }

    // Admin functions

    function setLiquidationMarginPercent(uint8 _liquidationMarginPercent) external onlyOwner {
        liquidationMarginPercent = _liquidationMarginPercent;
        _emitConfigUpdated();
    }

    function setFutureDeliveryDatesCount(uint8 _futureDeliveryDatesCount) public onlyOwner {
        if (_futureDeliveryDatesCount < 1) {
            revert ValueOutOfRange(1, int256(uint256(type(uint8).max)));
        }
        futureDeliveryDatesCount = _futureDeliveryDatesCount;
        _emitConfigUpdated();
    }

    /// @notice Set the flat maker fee charged to the resting order's owner on every matched unit.
    function setMakerFee(uint256 _makerFee) external onlyOwner {
        makerFee = _makerFee;
        _emitConfigUpdated();
    }

    /// @notice Set the flat taker fee charged to the incoming order's owner on every matched unit.
    function setTakerFee(uint256 _takerFee) external onlyOwner {
        takerFee = _takerFee;
        _emitConfigUpdated();
    }

    /// @notice Set the flat liquidation fee paid by `liquidateOrder` / `liquidateOrders`
    ///         (per cancelled order) and `liquidatePosition` (per closed position).
    function setLiquidationFee(uint256 _liquidationFee) external onlyOwner {
        liquidationFee = _liquidationFee;
        _emitConfigUpdated();
    }

    function setOracle(address addr) external onlyOwner {
        _setHashrateOracle(AggregatorV3Interface(addr));
        _emitConfigUpdated();
    }

    /// @dev Caches the oracle reference together with a precomputed scaling divisor based on its `decimals()`
    ///      and the wrapped token's decimals, so the hot-path `_getMarketPrice` avoids any extra storage reads.
    function _setHashrateOracle(AggregatorV3Interface _oracle) private {
        if (address(_oracle) == address(0)) {
            revert InvalidOracle();
        }
        hashrateOracle = _oracle;
        uint8 oracleDecimals = _oracle.decimals();
        if (_decimals > oracleDecimals) {
            revert UnsupportedTokenDecimals();
        }

        hashpriceScalingDivisor = 10 ** uint256(oracleDecimals - _decimals);
    }

    function setMarginEngine(address _marginEngine) external onlyOwner {
        marginEngine = IPortfolioMarginEngine(_marginEngine);
        _emitConfigUpdated();
    }

    /// @notice Emitted whenever the points hook address changes.
    event HookUpdated(address indexed hook);

    /// @notice Set (or clear) the points/rewards hook. Pass `address(0)` to disable points.
    /// @dev The venue must hold `HOOK_CALLER_ROLE` on the hook BEFORE it is plugged in: hook
    ///      calls are not try/catch-isolated, so a hook that reverts (e.g. missing role, or
    ///      after the POINTS token is finalized) would block fills and liquidations. Clear the
    ///      hook with `address(0)` to disable points instantly.
    function setHook(address _hook) external onlyOwner {
        hook = IPointsHook(_hook);
        emit HookUpdated(_hook);
    }

    /// @dev Notify the points hook of a matched fill. Skipped when no hook is configured. Not
    ///      isolated: a reverting hook reverts the fill (unplug via setHook). `notional` follows
    ///      the indexer convention `pricePerDay * deliveryDurationDays`; each match is one unit.
    function _notifyFill(address _maker, address _taker, uint256 _pricePerDay, uint256 _makerPrice) private {
        IPointsHook _hook = hook;
        if (address(_hook) == address(0)) return;
        uint256 notional = _pricePerDay * deliveryDurationDays;
        _hook.onFill(_maker, _taker, notional, int256(makerFee), takerFee, _makerPrice, _refPriceForPoints());
    }

    /// @dev Oracle reference price for the points price-improvement multiplier, in the same
    ///      per-day units as an order's price. Unlike `getMarketPrice()` (which routes through
    ///      `_getHashpriceUsd` and reverts on a stale/invalid oracle), this returns 0 so a
    ///      points-side read can never block a fill — the hook applies no bonus (1x) when 0.
    function _refPriceForPoints() private view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = hashrateOracle.latestRoundData();
        if (answer <= 0) return 0;
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) return 0;
        return _getMarketPrice(uint256(answer));
    }

    /// @dev Notify the points hook of a liquidation. Skipped when no hook is configured. Not
    ///      isolated: a reverting hook reverts the liquidation (unplug via setHook).
    function _notifyLiquidation(address _liquidator, uint256 _fee) private {
        IPointsHook _hook = hook;
        if (address(_hook) == address(0)) return;
        _hook.onLiquidation(_liquidator, _fee);
    }

    /// @dev Builds a `Config` snapshot from current storage and emits `ConfigUpdated`. Called
    ///      by every setter (and `initialize`) so the indexer sees the entire mutable surface
    ///      via a single event handler.
    function _emitConfigUpdated() private {
        emit ConfigUpdated(
            Config({
                makerFee: makerFee,
                takerFee: takerFee,
                liquidationFee: liquidationFee,
                minimumPriceIncrement: minimumPriceIncrement,
                liquidationMarginPercent: liquidationMarginPercent,
                futureDeliveryDatesCount: futureDeliveryDatesCount,
                hashrateOracle: address(hashrateOracle),
                marginEngine: address(marginEngine)
            })
        );
    }

    /// @notice Admin escape hatch that clears every order and position belonging to the
    ///         supplied participants along with all derived bookkeeping (per-participant
    ///         order/position indices, per-delivery-date price queues, and the net delta /
    ///         entry-value accumulators).
    /// @dev Collateral balances in the vault and `collectedFeesBalance` are deliberately left
    ///      untouched; any legacy delivery payments still escrowed in `address(this)` from the
    ///      retired physical-delivery flow also remain — refund them out-of-band if needed.
    ///      Iterates each participant's index backwards so swap-and-pop removals stay safe.
    ///      Pass every participant with outstanding state — orders/positions belonging to
    ///      addresses not included in `_participants` will not be cleared.
    /// @param _participants Addresses whose orders and positions should be fully purged.
    function resetState(address[] calldata _participants) external onlyOwner {
        for (uint256 p = 0; p < _participants.length; p++) {
            address participant = _participants[p];

            EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[participant];
            for (uint256 i = _orders.length(); i > 0; i--) {
                bytes32 orderId = _orders.at(i - 1);
                _closeOrder(orderId, orders[orderId], OrderCloseReason.RESET);
            }

            // `_removePosition` mutates the counterparty's index as well, so a position is
            // only seen once even when both seller and buyer appear in `_participants`.
            EnumerableSet.Bytes32Set storage _positions = participantPositionIdsIndex[participant];
            for (uint256 i = _positions.length(); i > 0; i--) {
                bytes32 positionId = _positions.at(i - 1);
                if (positions[positionId].seller != address(0)) {
                    Position memory pos = positions[positionId];
                    emit LotClosed(positionId, pos.seller, pos.buyer, 0, 0, address(0), LotCloseReason.RESET);
                    _removePosition(positionId, pos);
                }
            }
        }
    }

    /// @notice True when the participant has at least one resting order or active
    ///         position and `balanceOf(user) < computePortfolioMM(user)`. Mirrors the
    ///         perps `isLiquidatable` shape so off-chain consumers can poll both venues
    ///         uniformly.
    function isLiquidatable(address _participant) public view returns (bool) {
        bool hasState = participantOrderIdsIndex[_participant].length() > 0
            || participantPositionIdsIndex[_participant].length() > 0;
        if (!hasState) return false;
        return collateralVault.balanceOf(_participant) < marginEngine.computePortfolioMM(_participant);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Permissionless keeper liquidation entry points.
    //
    // Strict two-step invariant enforced on-chain:
    //   1. clear all resting orders via `liquidateOrders(participant)` /
    //      `liquidateOrder(participant, id)` (any caller, paid per cancel)
    //   2. then close positions one-by-one via
    //      `liquidatePosition(participant, positionId)` (reverts
    //      `OrdersStillOpen` if step 1 wasn't completed)
    //
    // The keeper composes both steps atomically off-chain via Multicall3 and
    // re-checks portfolio MM between them so cross-product offsets
    // (perps/options) are honored.
    // ──────────────────────────────────────────────────────────────────────────

    /// @dev True iff `_participant` is below the portfolio MM predicate. Used as the predicate
    ///      for the permissionless `liquidate*` entry points (orders alone can break MM, so
    ///      this intentionally does NOT require state to exist — `OrderNotBelongToParticipant`
    ///      / `PositionNotBelongToParticipant` already cover the no-state cases).
    function _underwater(address _participant) internal view returns (bool) {
        return collateralVault.balanceOf(_participant) < marginEngine.computePortfolioMM(_participant);
    }

    /// @notice Force-cancel a single resting order owned by an underwater participant.
    ///         Permissionless; pays `liquidationFee` from the participant's vault to
    ///         `msg.sender`.
    function liquidateOrder(address _participant, bytes32 _orderId) external {
        if (!_underwater(_participant)) revert NotLiquidatable();

        Order memory order = orders[_orderId];
        if (order.participant != _participant) revert OrderNotBelongToParticipant();

        _doLiquidateOrder(_participant, _orderId, order);
    }

    /// @notice Force-cancel resting orders owned by an underwater participant FIFO until they
    ///         become healthy or the order book is empty. Permissionless; pays
    ///         `liquidationFee` per cancel.
    /// @dev    Reverts `NotLiquidatable` if zero orders were cancelled (caller mis-targeted or
    ///         the participant is healthy). Cross-product MM is re-evaluated each iteration so
    ///         cancellation stops as soon as offsets from perps / options bring the participant
    ///         back above MM — liquidators can't drain fees on a healthy account.
    function liquidateOrders(address _participant) external {
        EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_participant];

        uint256 cancelled = 0;
        // Always cancel the head of the set; `_closeOrder` swap-and-pops it out, so the next
        // head moves to index 0. Bail early once MM is healthy.
        while (_orders.length() > 0) {
            if (!_underwater(_participant)) break;
            bytes32 orderId = _orders.at(0);
            _doLiquidateOrder(_participant, orderId, orders[orderId]);
            cancelled++;
        }

        if (cancelled == 0) revert NotLiquidatable();
    }

    /// @notice Force-close a single position belonging to an underwater participant.
    ///         Permissionless; pays `liquidationFee` from the participant's vault to
    ///         `msg.sender`.
    /// @dev    Strict orders-first invariant: reverts `OrdersStillOpen` if the participant has
    ///         any resting orders. The keeper must clear them via `liquidateOrders` first
    ///         (composed atomically off-chain via Multicall3).
    function liquidatePosition(address _participant, bytes32 _positionId) external {
        Position storage position = positions[_positionId];
        if (position.seller == address(0)) revert PositionNotExists();
        if (position.seller != _participant && position.buyer != _participant) {
            revert PositionNotBelongToParticipant();
        }

        if (participantOrderIdsIndex[_participant].length() != 0) revert OrdersStillOpen();
        if (!_underwater(_participant)) revert NotLiquidatable();

        _liquidateOnePosition(_positionId, position, _participant);
    }

    /// @notice Force-close a keeper-supplied SET of positions belonging to an underwater
    ///         participant in a single call — the batched "close down to the IM buffer" path
    ///         that lets the keeper clear an account in one tx instead of one lot per tx.
    /// @dev    Preconditions checked once at entry: no resting orders (`OrdersStillOpen`) and
    ///         `_underwater` (`NotLiquidatable`). The loop does NOT recompute margin per lot —
    ///         the keeper sizes the worst-first subset off-chain. Stale (already-closed) or
    ///         foreign ids are skipped (not reverted) so a slightly outdated id list still makes
    ///         progress; reverts `NotLiquidatable` if nothing closed. End-of-batch over-liquidation
    ///         guard (a single margin read): if positions remain AND there is a real IM buffer
    ///         (`im > mm`), the leftover balance must sit at/under IM else `OverLiquidation`.
    ///         Degenerate `im <= mm` (no buffer): no upper bound. Fully-closed accounts skip the
    ///         guard entirely (bad-debt / full-deleverage path).
    /// @param  _participant  The underwater account whose lots are being closed.
    /// @param  _positionIds  Keeper-chosen worst-first subset of the participant's lot ids.
    function liquidatePositions(address _participant, bytes32[] calldata _positionIds) external {
        if (participantOrderIdsIndex[_participant].length() != 0) revert OrdersStillOpen();
        if (!_underwater(_participant)) revert NotLiquidatable();

        uint256 closed = 0;
        for (uint256 i = 0; i < _positionIds.length; i++) {
            bytes32 positionId = _positionIds[i];
            Position storage position = positions[positionId];
            // Skip stale (already-closed) or foreign ids so an outdated keeper list still
            // makes progress rather than reverting the whole batch.
            if (position.seller == address(0)) continue;
            if (position.seller != _participant && position.buyer != _participant) continue;
            _liquidateOnePosition(positionId, position, _participant);
            closed++;
        }

        if (closed == 0) revert NotLiquidatable();

        // Over-liquidation guard (single margin read). Only meaningful when positions remain
        // AND there is a real IM buffer above MM. Fully-closed accounts fall through (the
        // keeper deliberately closed everything — bad-debt / full-deleverage path).
        if (participantPositionIdsIndex[_participant].length() > 0) {
            uint256 im = marginEngine.computePortfolioIM(_participant);
            uint256 mm = marginEngine.computePortfolioMM(_participant);
            if (im > mm && collateralVault.balanceOf(_participant) > im) revert OverLiquidation();
        }
    }

    /// @dev Force-closes a single position on behalf of a (pre-verified underwater, orders-clear)
    ///      participant and pays the flat liquidation fee. Shared by `liquidatePosition` (single)
    ///      and `liquidatePositions` (batch). Behaviour is identical to the pre-batch inline body:
    ///      cash-settle via `_forceLiquidatePosition`, pay `min(fee, balance)`, emit `LotLiquidated`,
    ///      and notify the points hook. Callers MUST have already checked the orders-first /
    ///      underwater / ownership invariants.
    function _liquidateOnePosition(bytes32 _positionId, Position storage position, address _participant)
        private
    {
        // Cash-settle through `_forceLiquidatePosition`: it builds an offsetting taker
        // order from the counterparty side and routes PnL through the insurance fund.
        _forceLiquidatePosition(_positionId, position, _participant);

        // Keeper-incentive payout is DISABLED for now: the protocol runs the only
        // liquidator, so no `liquidationFee` is transferred to `_msgSender()`. The
        // `liquidationFee` state var, its setter, and the fee field on `LotLiquidated`
        // are retained (emitting 0) for a future incentive iteration.
        uint256 paid = 0;

        emit LotLiquidated(_positionId, _participant, _msgSender(), paid);

        _notifyLiquidation(_msgSender(), paid);
    }

    /// @dev Cancels a single order on behalf of a (verified-underwater) participant and pays
    ///      the flat liquidation fee. Caller must have already verified `_underwater` and
    ///      `_order.participant == _participant`.
    function _doLiquidateOrder(address _participant, bytes32 _orderId, Order memory _order) private {
        _closeOrder(_orderId, _order, OrderCloseReason.LIQUIDATED);

        // Keeper-incentive payout is DISABLED for now (see `_liquidateOnePosition`):
        // no `liquidationFee` is transferred; the state var / setter / event field are
        // retained (emitting 0) for a future incentive iteration.
        uint256 paid = 0;

        emit OrderLiquidated(_orderId, _participant, _msgSender(), paid);

        _notifyLiquidation(_msgSender(), paid);
    }

    /// @notice Pins the cash-settlement price for an expiration. Permissionless and idempotent
    ///         (set-once): the first call at/after `deliveryAt` records the current oracle price;
    ///         later calls are no-ops returning the already-recorded price.
    /// @dev    Lets a keeper fix the price at a well-defined moment so every position at `deliveryAt`
    ///         settles deterministically regardless of when its `settlePosition` tx lands. Reverts
    ///         `SettlementDateNotReached` before maturity and `OracleStale` if the feed is stale.
    /// @param  deliveryAt The expiration timestamp to pin.
    /// @return price The recorded settlement price (token decimals).
    function recordSettlementPrice(uint256 deliveryAt) external returns (uint256 price) {
        if (block.timestamp < deliveryAt) revert SettlementDateNotReached();
        return _ensureSettlementPrice(deliveryAt);
    }

    /// @dev Returns the pinned settlement price for `deliveryAt`, recording it from the live oracle
    ///      on first use. Never overwrites an existing value, so the price is stable once set.
    function _ensureSettlementPrice(uint256 deliveryAt) private returns (uint256) {
        uint256 price = settlementPrice[deliveryAt];
        if (price == 0) {
            price = _getMarketPrice(_getHashpriceUsd());
            if (price == 0) revert InvalidPrice();
            settlementPrice[deliveryAt] = price;
            emit SettlementPriceRecorded(deliveryAt, price, _msgSender());
        }
        return price;
    }

    /// @notice Permissionlessly cash-settles a matured position at its pinned settlement price.
    /// @dev    Callable by ANYONE (typically a keeper) once `block.timestamp >= position.deliveryAt`.
    ///         Pins the expiration's settlement price on first settle (lazy auto-pin), then settles
    ///         the full position notional (`pricePerDay * deliveryDurationDays`) at that price,
    ///         routing PnL through the insurance fund and removing the position. Because the price is
    ///         pinned per expiration, settlement is deterministic regardless of when this tx lands.
    ///         No physical delivery, escrow, validator, or breach penalty is involved.
    /// @param  _positionId The id of the matured position to settle.
    function settlePosition(bytes32 _positionId) public {
        Position storage position = positions[_positionId];
        if (position.seller == address(0)) revert PositionNotExists();
        if (block.timestamp < position.deliveryAt) revert PositionDeliveryNotStartedYet();
        uint256 price = _ensureSettlementPrice(position.deliveryAt);
        _settleAtMark(_positionId, position, _msgSender(), LotCloseReason.SETTLED, price);
    }

    /// @notice Batch variant of `settlePosition`. Settles each matured position in order.
    /// @dev    Reverts atomically (leaving the book unchanged) if any id is unknown or not yet
    ///         matured, so keepers must pre-filter to positions with `block.timestamp >= deliveryAt`.
    /// @param  _positionIds The matured positions to settle.
    function settlePositions(bytes32[] calldata _positionIds) external {
        for (uint256 i = 0; i < _positionIds.length; i++) {
            settlePosition(_positionIds[i]);
        }
    }

    /// @dev Pure mark-to-market cash settlement of the full position notional at `price`. No escrow,
    ///      no elapsed/remaining split, no breach penalty: the entire `deliveryDurationDays` notional
    ///      settles at `price`. PnL is routed through the insurance fund. Shared by maturity
    ///      settlement (`settlePosition`, pinned settlement price) and forced liquidation
    ///      (`_forceLiquidatePosition`, live mark price); `reason` distinguishes the two in `LotClosed`.
    function _settleAtMark(
        bytes32 _positionId,
        Position storage position,
        address closedBy,
        LotCloseReason reason,
        uint256 price
    ) private {
        uint256 currentPrice = price;
        int256 mult = int256(uint256(deliveryDurationDays));

        int256 sellerPnl = (int256(position.sellPricePerDay) - int256(currentPrice)) * mult;
        int256 buyerPnl = (int256(currentPrice) - int256(position.buyPricePerDay)) * mult;

        _transferPnl(_insuranceFundAccount(), position.seller, sellerPnl);
        _transferPnl(_insuranceFundAccount(), position.buyer, buyerPnl);

        address seller = position.seller;
        address buyer = position.buyer;
        _removePosition(_positionId, position);
        emit LotClosed(_positionId, seller, buyer, sellerPnl, buyerPnl, closedBy, reason);
    }

    /**
     * @notice Force liquidates a position by settling unrealized PnL at current market price
     * @param _positionId The id of the position to liquidate
     * @param position The position to liquidate
     */
    function _forceLiquidatePosition(bytes32 _positionId, Position storage position, address _participant) private {
        // Create order from a counterparty position
        address counterparty = position.seller == _participant ? position.buyer : position.seller;
        bool isBuy = position.buyer == counterparty;
        uint256 orderPricePerDay = isBuy ? position.buyPricePerDay : position.sellPricePerDay;
        _createOrMatchSingleOrder(
            _expirationAtPriceOrderIds(position.deliveryAt, orderPricePerDay, isBuy),
            _expirationAtPriceOrderIds(position.deliveryAt, orderPricePerDay, !isBuy),
            participantExpirationAtPriceOrderIdsIndex[counterparty][position.deliveryAt][orderPricePerDay],
            counterparty,
            orderPricePerDay,
            position.deliveryAt,
            position.destURL,
            isBuy,
            false
        );

        // Liquidation happens before maturity, so there is no pinned settlement price: mark to the
        // current oracle price.
        _settleAtMark(_positionId, position, address(0), LotCloseReason.LIQUIDATION, _getMarketPrice(_getHashpriceUsd()));
    }

    function _removePosition(bytes32 _positionId, Position memory position) private {
        participantExpirationAtPositionIdsIndex[position.seller][position.deliveryAt].remove(_positionId);
        participantExpirationAtPositionIdsIndex[position.buyer][position.deliveryAt].remove(_positionId);
        // Drop the expiration from each party's active-dates set once their last position there is gone,
        // so the margin views stop counting it (collateral is released exactly at settlement).
        if (participantExpirationAtPositionIdsIndex[position.seller][position.deliveryAt].length() == 0) {
            participantActiveExpirationAts[position.seller].remove(position.deliveryAt);
        }
        if (participantExpirationAtPositionIdsIndex[position.buyer][position.deliveryAt].length() == 0) {
            participantActiveExpirationAts[position.buyer].remove(position.deliveryAt);
        }
        participantPositionIdsIndex[position.seller].remove(_positionId);
        participantPositionIdsIndex[position.buyer].remove(_positionId);
        int256 _delta = int256(uint256(deliveryDurationDays));
        participantExpirationAtNetDelta[position.seller][position.deliveryAt] += _delta;
        participantExpirationAtNetDelta[position.buyer][position.deliveryAt] -= _delta;
        participantExpirationAtNetEntryValue[position.seller][position.deliveryAt] +=
            int256(position.sellPricePerDay) * _delta;
        participantExpirationAtNetEntryValue[position.buyer][position.deliveryAt] -=
            int256(position.buyPricePerDay) * _delta;
        delete positions[_positionId];
    }

    function getMarketPrice() public view returns (uint256) {
        return _getMarketPrice(_getHashpriceUsd());
    }

    /// @notice Decimals of the underlying collateral token (matches the vault's token).
    /// @dev Required by `IFutures` so the PortfolioMarginEngine can rescale token-decimal
    ///      values to/from WAD.
    function decimals() external view returns (uint8) {
        return _decimals;
    }

    /// @dev `_hashpriceUsd` is the latest oracle answer (price of 100 TH/s per day expressed in
    ///      `oracle.decimals()`). One unit of futures equals 100 TH/s per day, so the only conversion needed is
    ///      rebasing the answer from `oracle.decimals()` to the token's decimals via `hashpriceScalingDivisor`.
    function _getMarketPrice(uint256 _hashpriceUsd) private view returns (uint256) {
        return _roundToNearest(_hashpriceUsd / hashpriceScalingDivisor, minimumPriceIncrement);
    }

    function getOrderById(bytes32 _orderId) external view returns (Order memory) {
        return orders[_orderId];
    }

    function getPositionById(bytes32 _positionId) external view returns (Position memory) {
        return positions[_positionId];
    }

    function getPositionsByParticipantDeliveryDate(address _participant, uint256 _expirationAt)
        external
        view
        returns (bytes32[] memory)
    {
        EnumerableSet.Bytes32Set storage _positions =
            participantExpirationAtPositionIdsIndex[_participant][_expirationAt];
        return _positions.values();
    }

    // ── Portfolio-margin view functions (used by PortfolioMarginEngine) ──────

    /// @notice Net linear delta of all active *positions* in WAD (1e18) units.
    ///         Each long contract contributes +deliveryDurationDays * WAD delta;
    ///         each short contract contributes -deliveryDurationDays * WAD delta.
    ///         Resting orders are excluded — their margin is reported separately
    ///         via `getFuturesOrderMargin`.
    /// @dev    Iterates the participant's active expiration dates so matured-but-unsettled
    ///         positions stay counted until `settlePosition` removes them. Dates whose settlement
    ///         price is already pinned are excluded: their value is frozen and carries no market
    ///         risk, so they must not contribute to the stress-tested delta.
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
    ///         Computed as max(0, maintenanceMargin − unrealizedPnL) per order,
    ///         mirroring how `getMinMargin` handles the order book component.
    function getFuturesOrderMargin(address _participant) public view returns (uint256) {
        EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_participant];
        uint256 len = _orders.length();
        if (len == 0) return 0;
        uint256 total = 0;
        uint256 marketPricePerDay = getMarketPrice();
        int256 durationDays = int256(uint256(deliveryDurationDays));
        // Cash-settled futures carry no breach penalty, so the maintenance-margin rate on
        // resting orders is just the liquidation margin percent.
        uint256 marginPct = liquidationMarginPercent;
        for (uint256 i = 0; i < len; i++) {
            Order memory order = orders[_orders.at(i)];
            if (order.deliveryAt < block.timestamp) continue;
            int256 qty = order.isBuy ? int256(1) : int256(-1);
            uint256 maintenanceMargin = order.pricePerDay * uint256(durationDays) * marginPct / 100;
            int256 pnl = (int256(marketPricePerDay) - int256(order.pricePerDay)) * durationDays * qty;
            total += clamp(int256(maintenanceMargin) - pnl);
        }
        return total;
    }

    /// @notice Aggregate unrealized PnL across active positions (token decimals).
    ///         Positive = mark-to-market gain; negative = mark-to-market loss.
    /// @dev    Iterates the participant's active expiration dates so matured-but-unsettled positions
    ///         keep contributing (collateral stays locked until settlement). Each date is valued at
    ///         its pinned settlement price when recorded, else the live market price. The live price
    ///         is read lazily so a portfolio whose matured dates are all already priced does not
    ///         depend on a fresh oracle.
    ///         Per date: pnl = markPrice * netDelta - netEntryValue
    ///                       = Σ(markPrice - entryPrice_i) * durationDays * qty_i
    function getFuturesUnrealizedPnl(address _participant) external view returns (int256) {
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

    function getDeliveryDates() external view returns (uint256[] memory) {
        uint256 currentDeliveryDateIndex = _getCurrentExpirationAtIndex();

        uint256[] memory deliveryDatesArray = new uint256[](futureDeliveryDatesCount);
        for (uint256 i = 0; i < futureDeliveryDatesCount; i++) {
            deliveryDatesArray[i] = firstFutureDeliveryDate + expirationIntervalSeconds() * (currentDeliveryDateIndex + i);
        }

        return deliveryDatesArray;
    }

    // ── MM-helping views ────────────────────────────────────────────────────

    /// @notice All resting order ids owned by `_participant`. Order is set-iteration
    ///         order; callers that need ordering should sort off-chain.
    /// @dev Used by the market maker for own-state warm-up; replaces an event-scan path.
    function getOrderIds(address _participant) external view returns (bytes32[] memory) {
        return participantOrderIdsIndex[_participant].values();
    }

    /// @notice All active position ids `_participant` is a side of (buyer or seller).
    function getPositionIds(address _participant) external view returns (bytes32[] memory) {
        return participantPositionIdsIndex[_participant].values();
    }

    /// @notice Active price levels for one side of one delivery date, capped at `_maxLevels`.
    /// @dev Iteration order is the EnumerableSet's internal swap-and-pop order, i.e. unsorted.
    ///      Off-chain callers sort to derive the visible top of book.
    function getBidPrices(uint256 _expirationAt, uint256 _maxLevels) external view returns (uint256[] memory) {
        return _activePricesSlice(activeBidPrices[_expirationAt], _maxLevels);
    }

    /// @notice Mirror of `getBidPrices` for the ask side.
    function getAskPrices(uint256 _expirationAt, uint256 _maxLevels) external view returns (uint256[] memory) {
        return _activePricesSlice(activeAskPrices[_expirationAt], _maxLevels);
    }

    function _activePricesSlice(EnumerableSet.UintSet storage set, uint256 _maxLevels)
        private
        view
        returns (uint256[] memory)
    {
        uint256 total = set.length();
        uint256 count = total < _maxLevels ? total : _maxLevels;
        uint256[] memory out = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            out[i] = set.at(i);
        }
        return out;
    }

    /// @notice Sum of resting quantities at one (expirationAt, price, side).
    /// @dev Each order in the FIFO queue contributes ±1 contract; we sum the queue size.
    ///      Returned value is unsigned (absolute aggregate quantity) for symmetry with perps.
    function getQuantityAtPrice(uint256 _expirationAt, uint256 _price, bool _isBid) external view returns (uint256) {
        StructuredLinkedList.List storage queue = _isBid
            ? expirationAtPriceOrdersLongIdQueue[_expirationAt][_price]
            : expirationAtPriceOrdersShortIdQueue[_expirationAt][_price];
        return queue.sizeOf();
    }

    /// @dev Returns the index of the current (closest available in the future) delivery date relative to the first future delivery date
    function _getCurrentExpirationAtIndex() private view returns (uint256) {
        if (block.timestamp > firstFutureDeliveryDate) {
            return (block.timestamp - firstFutureDeliveryDate) / expirationIntervalSeconds() + 1;
        }
        return 0;
    }

    // Helper functions

    function expirationIntervalSeconds() private view returns (uint256) {
        return deliveryIntervalDays * SECONDS_PER_DAY;
    }

    /// @dev Convenience function to get the order index by delivery date and price
    function _expirationAtPriceOrderIds(uint256 _expirationAt, uint256 _price, bool _isBuy)
        private
        view
        returns (StructuredLinkedList.List storage)
    {
        if (_isBuy) {
            return (expirationAtPriceOrdersLongIdQueue[_expirationAt][_price]);
        } else {
            return (expirationAtPriceOrdersShortIdQueue[_expirationAt][_price]);
        }
    }

    /// @dev Reads the latest hashprice answer and rejects stale or non-positive values. Every code
    ///      path that prices futures (matching, margin checks, liquidation, cash settlement) ultimately
    ///      goes through here, so the oracle freshness contract is enforced uniformly.
    function _getHashpriceUsd() private view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = hashrateOracle.latestRoundData();

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

    function abs8(int8 _value) private pure returns (uint8) {
        if (_value > 0) {
            return uint8(_value);
        } else {
            return uint8(-_value);
        }
    }

    // Validation functions

    function validatePrice(uint256 _price) private view {
        if (_price == 0) {
            revert InvalidPrice();
        }
        if (_price % minimumPriceIncrement != 0) {
            revert InvalidPrice();
        }
    }

    function validateExpirationAt(uint256 _expirationAt) private view {
        if (_expirationAt <= block.timestamp) {
            revert DeliveryDateShouldBeInTheFuture();
        }
        if (_expirationAt < firstFutureDeliveryDate) {
            revert DeliveryDateNotAvailable();
        }
        uint256 elapsedFromFirst = _expirationAt - firstFutureDeliveryDate;
        if (elapsedFromFirst % expirationIntervalSeconds() != 0) {
            revert DeliveryDateNotAvailable();
        }
        uint256 currentIndex = _getCurrentExpirationAtIndex();
        if (elapsedFromFirst > (futureDeliveryDatesCount - 1 + currentIndex) * expirationIntervalSeconds()) {
            revert DeliveryDateNotAvailable();
        }
    }

    function validateQty(int8 _qty) private pure {
        if (_qty == 0) {
            revert InvalidQty();
        }
    }

    function ensureNoCollateralDeficit(address _participant) private view {
        uint256 required = marginEngine.computePortfolioIM(_participant);
        if (collateralVault.balanceOf(_participant) < required) revert InsufficientMarginBalance();
    }

    function withdrawCollectedFees() external onlyOwner {
        uint256 amount = collectedFeesBalance;
        collectedFeesBalance = 0;
        collateralVault.withdrawTo(owner(), amount);
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

        uint256 available = collateralVault.balanceOf(payer);
        if (available >= amount) {
            collateralVault.internalTransfer(payer, receiver, amount);
            return;
        }

        // Payer cannot cover full amount: transfer what's available and record the uncovered
        // remainder as bad debt. The counterparty here is always the insurance fund, so the
        // shortfall is absorbed by that protocol reserve (the fund receives less than it is owed,
        // or pays a winner from its own balance) — it is never taken from other users' collateral.
        // Surfaces previously-implicit reverts as a `BadDebt` signal for off-chain observers.
        if (available > 0) {
            collateralVault.internalTransfer(payer, receiver, available);
        }
        emit BadDebt(payer, amount - available);
    }

    /// @dev Shared reserve / PnL pool: vault `insuranceFund` receipt account.
    function _insuranceFundAccount() private view returns (address) {
        address fund = collateralVault.INSURANCE_FUND_ADDR();
        if (fund == address(0)) revert InsuranceFundNotConfigured();
        return fund;
    }

    function _internalTransfer(address from, address to, uint256 amount) private {
        if (amount == 0) return;
        collateralVault.internalTransfer(from, to, amount);
    }

    // Modifiers
}
