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
    mapping(uint256 => mapping(uint256 => StructuredLinkedList.List)) private deliveryDatePriceOrdersLongIdQueue; // FIFO queue of long orders by delivery date and price
    mapping(uint256 => mapping(uint256 => StructuredLinkedList.List)) private deliveryDatePriceOrdersShortIdQueue; // FIFO queue of short orders by delivery date and price
    mapping(address => EnumerableSet.Bytes32Set) private participantPositionIdsIndex; // index of  positions by participant
    mapping(address => EnumerableSet.Bytes32Set) private participantOrderIdsIndex; // index of orders by participant
    mapping(address => mapping(uint256 => EnumerableSet.Bytes32Set)) private participantDeliveryDatePositionIdsIndex; // index of positions by participant and delivery date
    mapping(address => mapping(uint256 => mapping(uint256 => EnumerableSet.Bytes32Set))) private
        participantDeliveryDatePriceOrderIdsIndex;

    uint256 public breachPenaltyRatePerDay; // penalty for breaching the contract either by seller or buyer
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
    address public validatorAddress; // address of the validator authorized to close delivery on behalf of either participant during the delivery window

    uint8 public deliveryDurationDays; // duration of the delivery in seconds
    uint8 public deliveryIntervalDays; // interval between two closest delivery dates in days
    uint8 public futureDeliveryDatesCount; // number of future delivery dates to be available for orders
    uint8 public liquidationMarginPercent;
    uint8 private _gap3;
    string public validatorURL;
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
    mapping(address => mapping(uint256 => int256)) private participantDeliveryDateNetDelta; // net delta per participant per delivery date (pre-scaled by deliveryDurationDays, without 1e18)
    mapping(address => mapping(uint256 => int256)) private participantDeliveryDateNetEntryValue; // sum of qty_i * entryPrice_i * durationDays per participant per delivery date (token decimals)

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

    // immutable
    /// @dev Unified collateral vault (Titan `CollateralVault` or compatible). Baked into the implementation via constructor.
    ICollateralVault public immutable collateralVault;
    uint8 private immutable _decimals; // decimals of the wrapped token

    // constants
    string public constant VERSION = "2.10.0";
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
        string destURL;
        uint256 pricePerDay; // price of the hashrate in tokens for one day
        uint256 deliveryAt; // date of delivery, when contract delivery is started
        uint256 createdAt; // timestamp of the creation of the order
    }

    /// @notice Represents a couple of matched counterparty orders with bindings, active futures contract between seller and buyer
    /// @dev Created when two opposing orders are matched
    struct Position {
        address seller; // party obligated to deliver
        address buyer; // party entitled to receive delivery
        string destURL;
        uint256 sellPricePerDay;
        uint256 buyPricePerDay;
        uint256 deliveryAt; // start of the delivery
        uint256 createdAt; // timestamp of the creation of the position
        bool paid; // true if the delivery payment is paid, false if not
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
    enum LotCloseReason {
        MUTUAL_EXIT, // both parties offset via opposing orders
        LIQUIDATION, // forced cash-settle at market price
        BREACH, // closeDelivery called during delivery window
        SETTLED, // withdrawDeliveryPayment after window expires
        RESET // admin resetState
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
        uint256 breachPenaltyRatePerDay;
        uint256 minimumPriceIncrement;
        uint8 liquidationMarginPercent;
        uint8 futureDeliveryDatesCount;
        address validatorAddress;
        address hashrateOracle;
        address marginEngine;
        string validatorURL;
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
    ///         (positive = profit). For BREACH, closedBy is the address that called closeDelivery.
    /// @dev When `reason == LIQUIDATION` a paired `LotLiquidated` carries the liquidator / fee
    ///      context; merging those fields here would tax every settle/breach/mutual-exit.
    event LotClosed(
        bytes32 indexed lotId,
        address indexed seller,
        address indexed buyer,
        int256 sellerPnl,
        int256 buyerPnl,
        address closedBy,
        LotCloseReason reason
    );

    /// @notice Buyer deposited full delivery payment into escrow (replaces PositionPaid).
    event LotPaid(bytes32 indexed lotId);

    /// @notice Seller withdrew escrowed payment after delivery window (replaces PositionPaymentReceived).
    event LotPaymentWithdrawn(bytes32 indexed lotId);

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
    event LotLiquidated(
        bytes32 indexed lotId, address indexed participant, address indexed liquidator, uint256 fee
    );

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
    error InvalidOracle(); // hashprice oracle returned a non-positive answer
    error NotLiquidatable(); // liquidate{Order,Orders,Position} called on a healthy participant
    error OrdersStillOpen(); // liquidatePosition called while participant has resting orders
    error OrderNotBelongToParticipant(); // liquidateOrder/liquidateOrders received an id not owned by `participant`
    error PositionNotBelongToParticipant(); // liquidatePosition received a positionId where participant is neither buyer nor seller

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
        address _validatorAddress,
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
        validatorAddress = _validatorAddress;
        liquidationMarginPercent = _liquidationMarginPercent;
        breachPenaltyRatePerDay = 0;
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

    function createOrder(uint256 _price, uint256 _deliveryDate, string memory _destURL, int8 _qty) external {
        // Remove outdated orders to keep state clean and ensure accurate limit checks
        removeOutdatedOrdersForParticipant(_msgSender());

        validatePrice(_price);
        validateDeliveryDate(_deliveryDate);
        validateQty(_qty);

        bool _isBuy = _qty > 0;

        // cache order indexes since they are the same for the loop
        StructuredLinkedList.List storage orderIndex = _deliveryDatePriceOrderIds(_deliveryDate, _price, _isBuy);
        StructuredLinkedList.List storage oppositeOrderIndex =
            _deliveryDatePriceOrderIds(_deliveryDate, _price, !_isBuy);
        EnumerableSet.Bytes32Set storage participantPriceOrderIds =
            participantDeliveryDatePriceOrderIdsIndex[_msgSender()][_deliveryDate][_price];

        for (uint8 i = 0; i < abs8(_qty); i++) {
            _createOrMatchSingleOrder(
                orderIndex,
                oppositeOrderIndex,
                participantPriceOrderIds,
                _msgSender(),
                _price,
                _deliveryDate,
                _destURL,
                _isBuy,
                true
            );
        }

        ensureNoCollateralDeficit(_msgSender());
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
        uint256 _deliveryDate,
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
            bytes32 _orderId = _createOrder(_participant, _price, _deliveryDate, _isBuy, _destURL);
            _addOrderToQueue(orderIndexId, _orderId, _deliveryDate, _price, _isBuy);
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
        bytes32 takerOrderId = _emitTakerMatchOrder(_participant, _price, _deliveryDate, _isBuy, _destURL);

        // delete matching order
        _closeOrder(oppositeOrderId, oppositeOrder, OrderCloseReason.MATCHED);

        // charge maker/taker fees on the fill (skipped for liquidation-driven matches).
        if (_chargeFees) {
            _chargeMatchFees(oppositeOrder.participant, _participant);
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
            emit LotClosed(ex.lotId, ex.oldSeller, ex.oldBuyer, sellerPnl, buyerPnl, address(0), LotCloseReason.MUTUAL_EXIT);
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
        participantDeliveryDatePositionIdsIndex[_temp.seller][order.deliveryAt].add(positionId);
        participantDeliveryDatePositionIdsIndex[_temp.buyer][order.deliveryAt].add(positionId);
        int256 _delta = int256(uint256(deliveryDurationDays));
        participantDeliveryDateNetDelta[_temp.seller][order.deliveryAt] -= _delta;
        participantDeliveryDateNetDelta[_temp.buyer][order.deliveryAt] += _delta;
        participantDeliveryDateNetEntryValue[_temp.seller][order.deliveryAt] -= int256(_temp.sellPricePerDay) * _delta;
        participantDeliveryDateNetEntryValue[_temp.buyer][order.deliveryAt] += int256(_temp.buyPricePerDay) * _delta;

        if (ex.exited) {
            // Counterparty transfer: one party exited the old lot, a new participant takes their slot.
            address newParticipant = (ex.exitingParticipant == ex.oldBuyer) ? _temp.buyer : _temp.seller;
            _emitLotTransferred(
                ex.lotId, positionId, ex.exitingParticipant, newParticipant,
                ex.exitPnl, _temp.sellPricePerDay, _temp.buyPricePerDay, orderId, takerOrderId
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
            participantDeliveryDatePositionIdsIndex[participant][order.deliveryAt];
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

    /// @notice Removes all outdated orders for a specific participant
    /// @dev An order is considered outdated if its deliveryAt timestamp is in the past
    /// @param _participant The address of the participant whose outdated orders should be removed
    /// @return count The number of outdated orders removed
    function removeOutdatedOrdersForParticipant(address _participant) public returns (uint256 count) {
        EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_participant];
        uint256 ordersLength = _orders.length();

        // Iterate backwards to safely remove items while iterating
        for (uint256 i = ordersLength; i > 0; i--) {
            bytes32 orderId = _orders.at(i - 1);
            Order memory order = orders[orderId];

            // Check if order is outdated (delivery date has passed)
            if (order.deliveryAt < block.timestamp) {
                _closeOrder(orderId, order, OrderCloseReason.EXPIRED);
                count++;
            }
        }
    }

    function _closeOrder(bytes32 orderId, Order memory order, OrderCloseReason reason) private {
        StructuredLinkedList.List storage orderIndexId =
            _deliveryDatePriceOrderIds(order.deliveryAt, order.pricePerDay, order.isBuy);
        _removeOrderFromQueue(orderIndexId, orderId, order.deliveryAt, order.pricePerDay, order.isBuy);

        participantOrderIdsIndex[order.participant].remove(orderId);
        participantDeliveryDatePriceOrderIdsIndex[order.participant][order.deliveryAt][order.pricePerDay].remove(
            orderId
        );
        delete orders[orderId];
        emit OrderClosed(orderId, reason);
    }

    /// @dev Pushes `_orderId` onto the per-(deliveryDate, price) FIFO queue and, if the queue
    ///      transitioned from empty → non-empty, records the price level in
    ///      `activeBidPrices` / `activeAskPrices` so off-chain consumers can enumerate live depth.
    function _addOrderToQueue(
        StructuredLinkedList.List storage orderIndexId,
        bytes32 _orderId,
        uint256 _deliveryDate,
        uint256 _price,
        bool _isBuy
    ) private {
        bool wasEmpty = orderIndexId.sizeOf() == 0;
        orderIndexId.pushBack(uint256(_orderId));
        if (wasEmpty) {
            (_isBuy ? activeBidPrices : activeAskPrices)[_deliveryDate].add(_price);
        }
    }

    /// @dev Removes `_orderId` from the per-(deliveryDate, price) queue and, if the queue is now
    ///      empty, drops the price level from the active-price set.
    function _removeOrderFromQueue(
        StructuredLinkedList.List storage orderIndexId,
        bytes32 _orderId,
        uint256 _deliveryDate,
        uint256 _price,
        bool _isBuy
    ) private {
        orderIndexId.remove(uint256(_orderId));
        if (orderIndexId.sizeOf() == 0) {
            (_isBuy ? activeBidPrices : activeAskPrices)[_deliveryDate].remove(_price);
        }
    }

    /// @notice Cancels a resting order owned by the caller.
    function closeOrder(bytes32 _orderId) external {
        Order memory order = orders[_orderId];
        if (order.participant != _msgSender()) revert OrderNotBelongToSender();
        _closeOrder(_orderId, order, OrderCloseReason.CANCELLED);
    }

    // Admin functions

    function setBreachPenaltyRatePerDay(uint256 _breachPenaltyRatePerDay) external onlyOwner {
        if (_breachPenaltyRatePerDay > MAX_BREACH_PENALTY_RATE_PER_DAY) {
            revert ValueOutOfRange(0, int256(MAX_BREACH_PENALTY_RATE_PER_DAY));
        }
        breachPenaltyRatePerDay = _breachPenaltyRatePerDay;
        _emitConfigUpdated();
    }

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

    /// @notice Sets the validator URL
    /// @param _validatorURL the validator endpoint, you can omit protocol prefix and use host.com:port
    function setValidatorURL(string memory _validatorURL) external onlyOwner {
        validatorURL = _validatorURL;
        _emitConfigUpdated();
    }

    /// @notice Sets the validator address authorized to call `closeDelivery` on behalf of either participant.
    function setValidatorAddress(address _validatorAddress) external onlyOwner {
        validatorAddress = _validatorAddress;
        _emitConfigUpdated();
    }

    function setMarginEngine(address _marginEngine) external onlyOwner {
        marginEngine = IPortfolioMarginEngine(_marginEngine);
        _emitConfigUpdated();
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
                breachPenaltyRatePerDay: breachPenaltyRatePerDay,
                minimumPriceIncrement: minimumPriceIncrement,
                liquidationMarginPercent: liquidationMarginPercent,
                futureDeliveryDatesCount: futureDeliveryDatesCount,
                validatorAddress: validatorAddress,
                hashrateOracle: address(hashrateOracle),
                marginEngine: address(marginEngine),
                validatorURL: validatorURL
            })
        );
    }

    /// @notice Admin escape hatch that clears every order and position belonging to the
    ///         supplied participants along with all derived bookkeeping (per-participant
    ///         order/position indices, per-delivery-date price queues, and the net delta /
    ///         entry-value accumulators).
    /// @dev Collateral balances in the vault and `collectedFeesBalance` are deliberately left
    ///      untouched; any delivery payments already escrowed in `address(this)` via
    ///      `depositDeliveryPaymentV2` also remain — refund them out-of-band if needed.
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

        // Cash-settle through `_forceLiquidatePosition`: it builds an offsetting taker
        // order from the counterparty side and routes PnL through the insurance fund.
        _forceLiquidatePosition(_positionId, position, _participant);

        uint256 fee = liquidationFee;
        uint256 paid;
        if (fee > 0) {
            uint256 balance = collateralVault.balanceOf(_participant);
            paid = fee < balance ? fee : balance;
            if (paid > 0) {
                _internalTransfer(_participant, _msgSender(), paid);
            }
        }

        emit LotLiquidated(_positionId, _participant, _msgSender(), paid);
    }

    /// @dev Cancels a single order on behalf of a (verified-underwater) participant and pays
    ///      the flat liquidation fee. Caller must have already verified `_underwater` and
    ///      `_order.participant == _participant`.
    function _doLiquidateOrder(address _participant, bytes32 _orderId, Order memory _order) private {
        _closeOrder(_orderId, _order, OrderCloseReason.LIQUIDATED);

        uint256 fee = liquidationFee;
        uint256 paid;
        if (fee > 0) {
            uint256 balance = collateralVault.balanceOf(_participant);
            paid = fee < balance ? fee : balance;
            if (paid > 0) {
                _internalTransfer(_participant, _msgSender(), paid);
            }
        }

        emit OrderLiquidated(_orderId, _participant, _msgSender(), paid);
    }

    /**
     * @notice Cash settles the remaining delivery and pays the breach penalty
     * @dev Buyer, seller or validator can call this function
     * @dev Validator chooses the blame party
     * @param _positionId The id of the position to close the delivery of
     * @param _blameSeller Whether the seller is blamed, ignored if called by buyer or seller
     */
    function closeDelivery(bytes32 _positionId, bool _blameSeller) external {
        Position storage position = positions[_positionId];
        if (position.seller == address(0)) {
            revert PositionNotExists();
        }

        if (_msgSender() == position.seller) {
            _blameSeller = true;
        } else if (_msgSender() == position.buyer) {
            _blameSeller = false;
        } else if (_msgSender() != validatorAddress) {
            revert OnlyValidatorOrPositionParticipant();
        }

        if (block.timestamp < position.deliveryAt) {
            revert PositionDeliveryNotStartedYet();
        }
        if (block.timestamp > position.deliveryAt + deliveryDurationSeconds()) {
            revert PositionDeliveryExpired();
        }

        _closeAndCashSettleDeliveryAndPenalize(_positionId, position, _blameSeller);
    }

    function _closeAndCashSettleDeliveryAndPenalize(bytes32 _positionId, Position storage position, bool _blameSeller)
        private
    {
        if (_blameSeller) {
            uint256 breachPenalty = _calculateBreachPenalty(
                position.sellPricePerDay * deliveryDurationDays,
                position.deliveryAt + deliveryDurationSeconds() - block.timestamp
            );
            _internalTransfer(position.seller, position.buyer, breachPenalty);
        } else {
            uint256 breachPenalty = _calculateBreachPenalty(
                position.buyPricePerDay * deliveryDurationDays,
                position.deliveryAt + deliveryDurationSeconds() - block.timestamp
            );
            _internalTransfer(position.buyer, position.seller, breachPenalty);
        }
        _closeAndCashSettleDelivery(_positionId, position, LotCloseReason.BREACH, _msgSender());
    }

    /// @notice Settles position or remaining delivery in cash.
    /// @dev    Delivery payment (for elapsed hashrate) always flows from escrow (`address(this)`)
    ///         when `position.paid == true`; falls back to pulling from `position.buyer` when
    ///         `paid == false` (pre-delivery liquidation where elapsed time == 0 → no-op transfer).
    ///         MTM cash settlement on the remaining undelivered portion always flows from vault/margin.
    function _closeAndCashSettleDelivery(
        bytes32 _positionId,
        Position storage position,
        LotCloseReason reason,
        address closedBy
    ) private {
        uint256 positionElapsedTime = 0;
        uint256 positionRemainingTime = 0;
        if (block.timestamp > position.deliveryAt) {
            positionElapsedTime = block.timestamp - position.deliveryAt;
            positionRemainingTime = position.deliveryAt + deliveryDurationSeconds() - block.timestamp;
        } else {
            positionRemainingTime = deliveryDurationSeconds();
        }

        // Delivery payment for the elapsed portion of hashrate.
        // Source: escrow at address(this) when paid=true; buyer's vault otherwise (elapsed==0 → no-op).
        uint256 escrowTotal = position.buyPricePerDay * deliveryDurationDays;
        uint256 buyerPaysToSeller;
        int256 priceDifference = int256(position.sellPricePerDay) - int256(position.buyPricePerDay);

        if (priceDifference > 0) {
            buyerPaysToSeller =
                position.buyPricePerDay * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            uint256 contractPaysToSeller =
                uint256(priceDifference) * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            _internalTransfer(_insuranceFundAccount(), position.seller, contractPaysToSeller);
        } else if (priceDifference < 0) {
            buyerPaysToSeller =
                position.sellPricePerDay * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            uint256 buyerPaysToContract =
                uint256(-priceDifference) * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            _internalTransfer(_insuranceFundAccount(), position.buyer, buyerPaysToContract);
        } else {
            buyerPaysToSeller =
                position.buyPricePerDay * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
        }

        if (position.paid) {
            _internalTransfer(address(this), position.seller, buyerPaysToSeller);
            _internalTransfer(address(this), position.buyer, escrowTotal - buyerPaysToSeller);
        } else {
            _internalTransfer(position.buyer, position.seller, buyerPaysToSeller);
        }

        // MTM cash settlement on the remaining undelivered portion (always from vault/margin).
        uint256 hashpriceUsd = _getHashpriceUsd();
        uint256 currentPrice = _getMarketPrice(hashpriceUsd);
        uint256 mult = uint256(deliveryDurationDays) * positionRemainingTime / uint256(deliveryDurationSeconds());

        int256 sellerPnl = (int256(position.sellPricePerDay) - int256(currentPrice)) * int256(mult);
        int256 buyerPnl = (int256(currentPrice) - int256(position.buyPricePerDay)) * int256(mult);

        _transferPnl(_insuranceFundAccount(), position.seller, sellerPnl);
        _transferPnl(_insuranceFundAccount(), position.buyer, buyerPnl);

        address seller = position.seller;
        address buyer = position.buyer;
        _removePosition(_positionId, position);
        emit LotClosed(_positionId, seller, buyer, sellerPnl, buyerPnl, closedBy, reason);
    }

    function _calculateBreachPenalty(uint256 _price, uint256 remainingTime) private view returns (uint256) {
        return _price * breachPenaltyRatePerDay * remainingTime / SECONDS_PER_DAY / 10 ** BREACH_PENALTY_DECIMALS;
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
            _deliveryDatePriceOrderIds(position.deliveryAt, orderPricePerDay, isBuy),
            _deliveryDatePriceOrderIds(position.deliveryAt, orderPricePerDay, !isBuy),
            participantDeliveryDatePriceOrderIdsIndex[counterparty][position.deliveryAt][orderPricePerDay],
            counterparty,
            orderPricePerDay,
            position.deliveryAt,
            position.destURL,
            isBuy,
            false
        );

        _closeAndCashSettleDelivery(_positionId, position, LotCloseReason.LIQUIDATION, address(0));
    }

    function _removePosition(bytes32 _positionId, Position memory position) private {
        participantDeliveryDatePositionIdsIndex[position.seller][position.deliveryAt].remove(_positionId);
        participantDeliveryDatePositionIdsIndex[position.buyer][position.deliveryAt].remove(_positionId);
        participantPositionIdsIndex[position.seller].remove(_positionId);
        participantPositionIdsIndex[position.buyer].remove(_positionId);
        int256 _delta = int256(uint256(deliveryDurationDays));
        participantDeliveryDateNetDelta[position.seller][position.deliveryAt] += _delta;
        participantDeliveryDateNetDelta[position.buyer][position.deliveryAt] -= _delta;
        participantDeliveryDateNetEntryValue[position.seller][position.deliveryAt] +=
            int256(position.sellPricePerDay) * _delta;
        participantDeliveryDateNetEntryValue[position.buyer][position.deliveryAt] -=
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

    function getPositionsByParticipantDeliveryDate(address _participant, uint256 _deliveryDate)
        external
        view
        returns (bytes32[] memory)
    {
        EnumerableSet.Bytes32Set storage _positions =
            participantDeliveryDatePositionIdsIndex[_participant][_deliveryDate];
        return _positions.values();
    }

    // ── Portfolio-margin view functions (used by PortfolioMarginEngine) ──────

    /// @notice Net linear delta of all active *positions* in WAD (1e18) units.
    ///         Each long contract contributes +deliveryDurationDays * WAD delta;
    ///         each short contract contributes -deliveryDurationDays * WAD delta.
    ///         Resting orders are excluded — their margin is reported separately
    ///         via `getFuturesOrderMargin`.
    function getNetPositionDelta(address _participant) external view returns (int256) {
        int256 netDelta = 0;
        uint256 currentIndex = _getCurrentDeliveryDateIndex();
        uint256 interval = deliveryIntervalSeconds();
        for (uint256 i = 0; i < futureDeliveryDatesCount; i++) {
            uint256 date = firstFutureDeliveryDate + interval * (currentIndex + i);
            netDelta += participantDeliveryDateNetDelta[_participant][date];
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
        // Margin pct: liquidation margin pct + breach-penalty pct (informational
        // tail used to bound the contract's downside on resting orders). Inlined
        // from the v2.6 `getMarginPercent` helper which was deleted with the
        // legacy futures-only margin path.
        uint256 marginPct = liquidationMarginPercent
            + breachPenaltyRatePerDay * deliveryDurationSeconds() / 10 ** (BREACH_PENALTY_DECIMALS - 2);
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
    function getFuturesUnrealizedPnl(address _participant) external view returns (int256) {
        uint256 currentIndex = _getCurrentDeliveryDateIndex();
        uint256 interval = deliveryIntervalSeconds();
        int256 totalNetDelta = 0;
        int256 totalNetEntryValue = 0;
        for (uint256 i = 0; i < futureDeliveryDatesCount; i++) {
            uint256 date = firstFutureDeliveryDate + interval * (currentIndex + i);
            totalNetDelta += participantDeliveryDateNetDelta[_participant][date];
            totalNetEntryValue += participantDeliveryDateNetEntryValue[_participant][date];
        }
        // totalPnl = Σ(marketPrice - entryPrice_i) * durationDays * qty_i
        //          = marketPrice * Σ(qty_i * durationDays) - Σ(qty_i * entryPrice_i * durationDays)
        //          = marketPrice * totalNetDelta - totalNetEntryValue
        return int256(getMarketPrice()) * totalNetDelta - totalNetEntryValue;
    }

    function getDeliveryDates() external view returns (uint256[] memory) {
        uint256 currentDeliveryDateIndex = _getCurrentDeliveryDateIndex();

        uint256[] memory deliveryDatesArray = new uint256[](futureDeliveryDatesCount);
        for (uint256 i = 0; i < futureDeliveryDatesCount; i++) {
            deliveryDatesArray[i] = firstFutureDeliveryDate + deliveryIntervalSeconds() * (currentDeliveryDateIndex + i);
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
    function getBidPrices(uint256 _deliveryDate, uint256 _maxLevels) external view returns (uint256[] memory) {
        return _activePricesSlice(activeBidPrices[_deliveryDate], _maxLevels);
    }

    /// @notice Mirror of `getBidPrices` for the ask side.
    function getAskPrices(uint256 _deliveryDate, uint256 _maxLevels) external view returns (uint256[] memory) {
        return _activePricesSlice(activeAskPrices[_deliveryDate], _maxLevels);
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

    /// @notice Sum of resting quantities at one (deliveryDate, price, side).
    /// @dev Each order in the FIFO queue contributes ±1 contract; we sum the queue size.
    ///      Returned value is unsigned (absolute aggregate quantity) for symmetry with perps.
    function getQuantityAtPrice(uint256 _deliveryDate, uint256 _price, bool _isBid) external view returns (uint256) {
        StructuredLinkedList.List storage queue = _isBid
            ? deliveryDatePriceOrdersLongIdQueue[_deliveryDate][_price]
            : deliveryDatePriceOrdersShortIdQueue[_deliveryDate][_price];
        return queue.sizeOf();
    }

    /// @dev Returns the index of the current (closest available in the future) delivery date relative to the first future delivery date
    function _getCurrentDeliveryDateIndex() private view returns (uint256) {
        if (block.timestamp > firstFutureDeliveryDate) {
            return (block.timestamp - firstFutureDeliveryDate) / deliveryIntervalSeconds() + 1;
        }
        return 0;
    }

    /// @notice Deposits delivery payment for a list of positions
    /// @dev DEPRECATED, use depositDeliveryPaymentV2 instead with multicall
    function depositDeliveryPayment(bytes32[] memory _positionIds) external {
        for (uint256 i = 0; i < _positionIds.length; i++) {
            depositDeliveryPaymentV2(_positionIds[i]);
        }
    }

    /// @notice Deposits delivery payment for a single position
    /// @param positionId The id of the position to deposit payment for
    /// @dev Use multicall to deposit payment for multiple positions
    function depositDeliveryPaymentV2(bytes32 positionId) public {
        Position storage position = positions[positionId];
        if (position.deliveryAt <= block.timestamp) {
            revert DeliveryDateExpired();
        }
        if (position.buyer != _msgSender()) {
            revert OnlyPositionBuyer();
        }
        if (position.paid) {
            revert PositionAlreadyPaid();
        }
        if (bytes(position.destURL).length == 0) {
            revert PositionDestURLNotSet();
        }
        uint256 totalPayment = position.buyPricePerDay * deliveryDurationDays;
        _transferEnsureMarginBalance(position.buyer, address(this), totalPayment);
        position.paid = true;
        emit LotPaid(positionId);
    }

    function withdrawDeliveryPayment(uint256 _deliveryDate) external {
        if (block.timestamp < _deliveryDate + deliveryDurationSeconds()) {
            revert DeliveryNotFinishedYet();
        }
        bool withdrew = false;

        // get all user positions for the delivery date
        EnumerableSet.Bytes32Set storage _positions =
            participantDeliveryDatePositionIdsIndex[_msgSender()][_deliveryDate];

        // Iterate backwards — _removePosition swap-and-pops from this set, so elements
        // that move to vacated slots were already visited (safe backward iteration).
        for (uint256 i = _positions.length(); i > 0; i--) {
            bytes32 positionId = _positions.at(i - 1);
            Position storage position = positions[positionId];
            if (position.seller == _msgSender() && position.paid) {
                // The buyer escrowed `buyPricePerDay * days` into `address(this)` at deposit time,
                // but the seller is owed `sellPricePerDay * days`. When `_maybeExitExistingPosition`
                // rewired this position the price differential (sellPx - buyPx) was already settled
                // against the insurance fund via `_transferPnl`. Route the buyer's escrow through
                // the fund so the seller can be paid in full while the fund's balance net-nets to
                // zero across the position's lifecycle.
                uint256 buyerDeposit = position.buyPricePerDay * deliveryDurationDays;
                uint256 sellerOwed = position.sellPricePerDay * deliveryDurationDays;
                address fund = _insuranceFundAccount();
                address seller = position.seller;
                address buyer = position.buyer;
                _internalTransfer(address(this), fund, buyerDeposit);
                _internalTransfer(fund, position.seller, sellerOwed);
                position.paid = false;
                withdrew = true;
                emit LotPaymentWithdrawn(positionId);
                emit LotClosed(positionId, seller, buyer, 0, 0, address(0), LotCloseReason.SETTLED);
                _removePosition(positionId, position);
            }
        }
        if (!withdrew) {
            revert NothingToWithdraw();
        }
    }

    // Helper functions

    function deliveryDurationSeconds() private view returns (uint256) {
        return deliveryDurationDays * SECONDS_PER_DAY;
    }

    function deliveryIntervalSeconds() private view returns (uint256) {
        return deliveryIntervalDays * SECONDS_PER_DAY;
    }

    /// @dev Convenience function to get the order index by delivery date and price
    function _deliveryDatePriceOrderIds(uint256 _deliveryDate, uint256 _price, bool _isBuy)
        private
        view
        returns (StructuredLinkedList.List storage)
    {
        if (_isBuy) {
            return (deliveryDatePriceOrdersLongIdQueue[_deliveryDate][_price]);
        } else {
            return (deliveryDatePriceOrdersShortIdQueue[_deliveryDate][_price]);
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

    function validateDeliveryDate(uint256 _deliveryDate) private view {
        if (_deliveryDate <= block.timestamp) {
            revert DeliveryDateShouldBeInTheFuture();
        }
        if (_deliveryDate < firstFutureDeliveryDate) {
            revert DeliveryDateNotAvailable();
        }
        uint256 elapsedFromFirst = _deliveryDate - firstFutureDeliveryDate;
        if (elapsedFromFirst % deliveryIntervalSeconds() != 0) {
            revert DeliveryDateNotAvailable();
        }
        uint256 currentIndex = _getCurrentDeliveryDateIndex();
        if (elapsedFromFirst > (futureDeliveryDatesCount - 1 + currentIndex) * deliveryIntervalSeconds()) {
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

        // Payer cannot cover full amount: transfer what's available and socialize the shortfall.
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

    function _transferEnsureMarginBalance(address _from, address _to, uint256 _amount) private {
        collateralVault.internalTransferWithMarginCheck(_from, _to, _amount);
    }

    // Modifiers

}
