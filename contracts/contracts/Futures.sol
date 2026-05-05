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

// import { console } from "hardhat/console.sol";

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
    uint256 public orderFee; // fee for creating an order in tokens
    uint256 private nonce = 0; // nonce for the order id

    address private _gap;
    /// @notice Hashprice oracle returning the price of 100 TH/s per day denominated in the same currency as `token`
    /// @dev Chainlink-compatible aggregator (e.g. HashpriceUSD when `token` is a USD stablecoin).
    ///      Variable name retained from v1.x for storage / ABI backwards compatibility; semantically this is a
    ///      hashprice (not hashrate) feed.
    AggregatorV3Interface public hashrateOracle;
    address public validatorAddress; // address of the validator that can close orders that are not delivered and regularly calls marginCall function

    uint8 public deliveryDurationDays; // duration of the delivery in seconds
    uint8 public deliveryIntervalDays; // interval between two closest delivery dates in days
    uint8 public futureDeliveryDatesCount; // number of future delivery dates to be available for orders
    uint8 public liquidationMarginPercent;
    uint8 private _gap3;
    string public validatorURL;
    uint256 public collectedFeesBalance;
    uint256 private _gap2;
    mapping(address => uint8) private addressFeeDiscountPercent;
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

    // immutable
    /// @dev Unified collateral vault (Titan `CollateralVault` or compatible). Baked into the implementation via constructor.
    ICollateralVault public immutable collateralVault;
    uint8 private immutable _decimals; // decimals of the wrapped token

    // constants
    string public constant VERSION = "2.6.0";
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

    // events
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed participant,
        string destURL,
        uint256 pricePerDay,
        uint256 deliveryAt,
        bool isBuy
    );
    event OrderClosed(bytes32 indexed orderId, address indexed participant);
    event OrderFeeUpdated(uint256 orderFee);
    /// @notice Fired when a position is opened by matching two opposing orders.
    /// @param orderId       The resting (maker) order's id.
    /// @param takerOrderId  The aggressor (taker) order's id. Each taker fill mints
    ///                      a fresh orderId and is announced via a paired
    ///                      OrderCreated + OrderClosed in the same transaction so
    ///                      indexers see takers and makers symmetrically.
    event PositionCreated(
        bytes32 indexed positionId,
        address indexed seller,
        address indexed buyer,
        uint256 sellPricePerDay,
        uint256 buyPricePerDay,
        uint256 deliveryAt,
        string destURL,
        bytes32 orderId,
        bytes32 takerOrderId
    );
    event PositionClosed(bytes32 indexed positionId);
    event PositionExited(bytes32 indexed positionId, address indexed participant, int256 pnl); // positive pnl is participant's profit
    event PositionDeliveryClosed(bytes32 indexed positionId, address indexed closedBy);
    event PositionPaid(bytes32 indexed positionId);
    event PositionPaymentReceived(bytes32 indexed positionId);
    event ValidatorURLUpdated(string validatorURL);
    /// @notice Emitted at the end of `marginCall` when at least one order or position was force-closed.
    /// @param participant       Account whose orders/positions were liquidated
    /// @param liquidator        Validator address that triggered the margin call
    /// @param reclaimedMargin   Aggregate margin reclaimed by force-closing resting orders (token decimals)
    /// @param realizedPnl       Net change in `participant`'s collateral balance from forced position closes (token decimals, signed)
    event Liquidation(
        address indexed participant, address indexed liquidator, int256 reclaimedMargin, int256 realizedPnl
    );
    /// @notice Emitted when a transfer cannot be fully covered by the payer's vault balance during PnL settlement.
    ///         The transfer is partially executed using the payer's remaining balance and the shortfall is socialized.
    /// @param account The account that could not cover its loss (typically a liquidated participant or the insurance fund)
    /// @param amount  Shortfall amount that could not be covered (token decimals)
    event BadDebt(address indexed account, uint256 amount);

    // errors
    error InvalidPrice();
    error InvalidQty();
    error DeliveryDateShouldBeInTheFuture();
    error DeliveryDateNotAvailable();
    error OrderNotBelongToSender();
    error InsufficientMarginBalance();
    error OnlyValidator(); // when the function is called by a non-validator address
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
        setFutureDeliveryDatesCount(_futureDeliveryDatesCount);
        firstFutureDeliveryDate = _firstFutureDeliveryDate;
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

        bool orderCreatedOrMatched = false;

        for (uint8 i = 0; i < abs8(_qty); i++) {
            bool created = _createOrMatchSingleOrder(
                orderIndex,
                oppositeOrderIndex,
                participantPriceOrderIds,
                _msgSender(),
                _price,
                _deliveryDate,
                _destURL,
                _isBuy
            );
            if (created) {
                orderCreatedOrMatched = true;
            }
        }

        // order fee only for created or matched orders
        if (orderCreatedOrMatched) {
            _payOrderFee(_msgSender());
        }
        ensureNoCollateralDeficit(_msgSender());
    }

    function getOrderFee(address _participant) public view returns (uint256) {
        uint8 feeDiscountPercent = addressFeeDiscountPercent[_participant];
        return orderFee - orderFee * feeDiscountPercent / 100;
    }

    function _payOrderFee(address _participant) private {
        uint256 fee = getOrderFee(_participant);
        collectedFeesBalance += fee;
        if (fee > 0) {
            _internalTransfer(_participant, address(this), fee);
        }
    }

    function setFeeDiscountPercent(address _address, uint8 _feeDiscountPercent) external onlyOwner {
        if (_feeDiscountPercent > 100) {
            revert ValueOutOfRange(0, 100);
        }
        addressFeeDiscountPercent[_address] = _feeDiscountPercent;
    }

    /// @notice Creates or matches a single order
    /// @dev Creates a new order if no matching order is found, otherwise matches the order
    /// @return orderCreated Return true if the order was created or matched, false if it offsetted existing order (closed)
    function _createOrMatchSingleOrder(
        StructuredLinkedList.List storage orderIndexId,
        StructuredLinkedList.List storage oppositeOrderIndexId,
        EnumerableSet.Bytes32Set storage participantPriceOrderIds,
        address _participant,
        uint256 _price,
        uint256 _deliveryDate,
        string memory _destURL,
        bool _isBuy
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
                _closeOrder(orderId, order);
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
        _closeOrder(oppositeOrderId, oppositeOrder);

        // create new position
        _createPosition(oppositeOrderId, oppositeOrder, _participant, _destURL, takerOrderId);
        return true;
    }

    /// @dev Mints a fresh orderId for an immediately-filled taker fill and emits
    ///      `OrderCreated` followed by `OrderClosed` for it. The order itself is
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
        emit OrderClosed(takerOrderId, _participant);
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
        // if (order.participant == _otherParticipant) {
        // should never happen
        // }

        // create position

        Position memory _temp;

        // address seller;
        // address buyer;
        // string memory destURL;
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
        bool exited = _maybeExitExistingPosition(_temp, order, order.participant, order.isBuy);
        if (!exited) {
            exited = _maybeExitExistingPosition(_temp, order, _otherParticipant, !order.isBuy);
        }
        if (exited && _temp.buyer == _temp.seller) {
            // both parties exiting — no new position to create
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
        _emitPositionCreated(positionId, _temp, order.deliveryAt, orderId, takerOrderId);
    }

    /// @dev Extracted to keep `_createPosition` below the EVM stack-depth limit.
    function _emitPositionCreated(
        bytes32 positionId,
        Position memory _temp,
        uint256 deliveryAt,
        bytes32 orderId,
        bytes32 takerOrderId
    ) private {
        emit PositionCreated(
            positionId,
            _temp.seller,
            _temp.buyer,
            _temp.sellPricePerDay,
            _temp.buyPricePerDay,
            deliveryAt,
            _temp.destURL,
            orderId,
            takerOrderId
        );
    }

    /// @dev If `participant` already holds a position at `order.deliveryAt` on the opposite
    ///      side of the trade they are about to enter, exit that position: settle realized PnL
    ///      against the insurance fund, remove the old position, and rewire `_temp` so that
    ///      the remaining counterparty (the other side of the old position) takes
    ///      `participant`'s slot in the new position.
    ///      `participantNewSideIsBuy` indicates which side `participant` is taking in the
    ///      newly-executing trade.
    ///      Returns `true` iff an existing position was offset.
    function _maybeExitExistingPosition(
        Position memory _temp,
        Order memory order,
        address participant,
        bool participantNewSideIsBuy
    ) private returns (bool) {
        EnumerableSet.Bytes32Set storage participantPositions =
            participantDeliveryDatePositionIdsIndex[participant][order.deliveryAt];
        if (participantPositions.length() == 0) return false;

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
            return false;
        }

        _removePosition(existingPositionId, existingPosition);
        int256 pnl = pnlPerDay * int256(uint256(deliveryDurationDays));
        _transferPnl(participant, _insuranceFundAccount(), pnl);
        emit PositionExited(existingPositionId, participant, -pnl);

        if (_temp.buyer == _temp.seller) {
            // both parties exiting the position
            emit PositionExited(existingPositionId, _temp.buyer, pnl);
            _transferPnl(_insuranceFundAccount(), _temp.buyer, pnl);
        }
        return true;
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
                _closeOrder(orderId, order);
                count++;
            }
        }
    }

    function _closeOrder(bytes32 orderId, Order memory order) private {
        StructuredLinkedList.List storage orderIndexId =
            _deliveryDatePriceOrderIds(order.deliveryAt, order.pricePerDay, order.isBuy);
        _removeOrderFromQueue(orderIndexId, orderId, order.deliveryAt, order.pricePerDay, order.isBuy);

        participantOrderIdsIndex[order.participant].remove(orderId);
        participantDeliveryDatePriceOrderIdsIndex[order.participant][order.deliveryAt][order.pricePerDay].remove(
            orderId
        );
        delete orders[orderId];
        emit OrderClosed(orderId, order.participant);
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

    /// @notice Cancels a resting order owned by the caller. The locked margin is released
    ///         the next time `computePortfolioIM` is consulted (no on-chain bookkeeping
    ///         needed: order margin is recomputed on read).
    function closeOrder(bytes32 _orderId) external {
        Order memory order = orders[_orderId];
        if (order.participant != _msgSender()) revert OrderNotBelongToSender();
        _closeOrder(_orderId, order);
    }

    // Admin functions

    function setBreachPenaltyRatePerDay(uint256 _breachPenaltyRatePerDay) external onlyOwner {
        if (_breachPenaltyRatePerDay > MAX_BREACH_PENALTY_RATE_PER_DAY) {
            revert ValueOutOfRange(0, int256(MAX_BREACH_PENALTY_RATE_PER_DAY));
        }
        breachPenaltyRatePerDay = _breachPenaltyRatePerDay;
    }

    function setLiquidationMarginPercent(uint8 _liquidationMarginPercent) external onlyOwner {
        liquidationMarginPercent = _liquidationMarginPercent;
    }

    function setFutureDeliveryDatesCount(uint8 _futureDeliveryDatesCount) public onlyOwner {
        if (_futureDeliveryDatesCount < 1) {
            revert ValueOutOfRange(1, int256(uint256(type(uint8).max)));
        }
        futureDeliveryDatesCount = _futureDeliveryDatesCount;
    }

    function setOrderFee(uint256 _orderFee) external onlyOwner {
        orderFee = _orderFee;
        emit OrderFeeUpdated(_orderFee);
    }

    function setOracle(address addr) external onlyOwner {
        _setHashrateOracle(AggregatorV3Interface(addr));
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
        emit ValidatorURLUpdated(_validatorURL);
    }

    /// @notice Sets the validator address
    /// @dev Limits access to the functions with onlyValidator modifier
    function setValidatorAddress(address _validatorAddress) external onlyOwner {
        validatorAddress = _validatorAddress;
    }

    function setMarginEngine(address _marginEngine) external onlyOwner {
        marginEngine = IPortfolioMarginEngine(_marginEngine);
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
                _closeOrder(orderId, orders[orderId]);
            }

            // `_removePosition` mutates the counterparty's index as well, so a position is
            // only seen once even when both seller and buyer appear in `_participants`.
            EnumerableSet.Bytes32Set storage _positions = participantPositionIdsIndex[participant];
            for (uint256 i = _positions.length(); i > 0; i--) {
                bytes32 positionId = _positions.at(i - 1);
                _removePosition(positionId, positions[positionId]);
            }
        }
    }

    /// @notice Gets the maintenance margin of a position, the minimum amount of effective margin that is required to avoid a margin call
    function getMaintenanceMarginForPosition(uint256 _entryPricePerDay, int256 _qty) private view returns (uint256) {
        return _entryPricePerDay * deliveryDurationDays * abs(_qty) * getMarginPercent() / 100;
    }

    /// @notice Gets the minimal margin for a position, maintenacne margin + unrealized PnL
    function getMinMarginForPosition(uint256 _entryPricePerDay, int256 _qty) public view returns (int256) {
        uint256 marketPricePerDay = getMarketPrice();
        int256 pnl =
            (int256(marketPricePerDay) - int256(_entryPricePerDay)) * int256(uint256(deliveryDurationDays)) * _qty;
        uint256 maintenanceMargin = getMaintenanceMarginForPosition(_entryPricePerDay, _qty);
        int256 effectiveMargin = int256(maintenanceMargin) - pnl;

        return effectiveMargin;
    }

    /// @notice Gets the minimal margin required to avoid a margin call,
    /// @dev sum of min margin for all positions
    function getMinMargin(address _participant) public view returns (int256) {
        int256 effectiveMargin = 0;
        // calculate orders
        EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_participant];
        for (uint256 i = 0; i < _orders.length(); i++) {
            bytes32 orderId = _orders.at(i);
            Order memory order = orders[orderId];
            if (order.deliveryAt < block.timestamp) {
                continue;
            }
            int256 qty = order.isBuy ? int256(1) : int256(-1);
            // clamp cuts off negative values for orders, because otherwise orders with negative effective margin
            // will affect total effective margin of the participant, reducing it
            // but if the order is close to market we have to make sure it maintains the margin requirement,
            // so it could be immediately matched
            int256 margin = int256(clamp(getMinMarginForPosition(order.pricePerDay, qty)));
            effectiveMargin += margin;
        }
        // calculate positions
        EnumerableSet.Bytes32Set storage _positions = participantPositionIdsIndex[_participant];
        for (uint256 i = 0; i < _positions.length(); i++) {
            bytes32 positionId = _positions.at(i);
            Position memory position = positions[positionId];
            if (position.deliveryAt < block.timestamp) {
                continue;
            }
            int256 qty = position.buyer == _participant ? int256(1) : int256(-1);
            uint256 entryPricePerDay =
                position.buyer == _participant ? position.buyPricePerDay : position.sellPricePerDay;
            int256 _margin = getMinMarginForPosition(entryPricePerDay, qty);
            effectiveMargin += _margin;
        }
        return effectiveMargin;
    }

    function getMarginPercent() private view returns (uint8) {
        uint8 breachPenaltyMarginPercent =
            uint8(breachPenaltyRatePerDay * deliveryDurationSeconds() / 10 ** (BREACH_PENALTY_DECIMALS - 2));
        return liquidationMarginPercent + breachPenaltyMarginPercent;
    }

    function marginCall(address _participant) external onlyValidator {
        int256 effectiveMargin = getMinMargin(_participant);
        int256 startBalance = int256(collateralVault.balanceOf(_participant));

        if (startBalance > effectiveMargin) {
            return;
        }

        int256 marginShortfall = effectiveMargin - startBalance;
        int256 reclaimedMargin; // amount of margin that will be reclaimed by closing positions/orders
        bool liquidated;

        // closing orders
        EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_participant];
        for (; _orders.length() > 0;) {
            bytes32 orderId = _orders.at(0);
            Order memory order = orders[orderId];

            int256 qty = order.isBuy ? int256(1) : int256(-1);
            int256 _margin = int256(clamp(getMinMarginForPosition(order.pricePerDay, qty)));
            _closeOrder(orderId, order);
            liquidated = true;

            reclaimedMargin += _margin;
            if (reclaimedMargin >= marginShortfall) {
                _emitLiquidation(_participant, reclaimedMargin, startBalance);
                return;
            }
        }

        // closing positions
        EnumerableSet.Bytes32Set storage _positions = participantPositionIdsIndex[_participant];
        for (; _positions.length() > 0;) {
            bytes32 positionId = _positions.at(0);
            Position storage position = positions[positionId];

            // Force liquidation: settle unrealized PnL at market price and close position
            //TODO: avoid calling getMinMargin on each iteration, return reclaimed margin instead
            _forceLiquidatePosition(positionId, position, _participant);
            liquidated = true;
            if (int256(collateralVault.balanceOf(_participant)) >= getMinMargin(_participant)) {
                _emitLiquidation(_participant, reclaimedMargin, startBalance);
                return;
            }
        }

        if (liquidated) {
            _emitLiquidation(_participant, reclaimedMargin, startBalance);
        }
    }

    /// @dev Stack-saving wrapper around the `Liquidation` emit. `realizedPnl = currentBalance - startBalance`.
    function _emitLiquidation(address _participant, int256 _reclaimedMargin, int256 _startBalance) private {
        int256 realizedPnl = int256(collateralVault.balanceOf(_participant)) - _startBalance;
        emit Liquidation(_participant, _msgSender(), _reclaimedMargin, realizedPnl);
    }

    /**
     * @notice Cash settles the remaining delivery and pays the breach penalty
     * @dev Buyer, seller or validator can call this function
     * @dev Validator chooses the blame party
     * @param _positionId The id of the position to close the delivery of
     * @param _blameSeller Whether the seller is blamed, ignored if called by buyer or seller
     */
    function closeDelivery(bytes32 _positionId, bool _blameSeller) external {
        // if validator closes the position then it is not delivered
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

    /**
     * @notice Cash settles the remaining delivery and pays the breach penalty
     * @param _positionId The id of the position to close the delivery of
     * @param position The position to close the delivery of
     * @param _blameSeller Whether the seller is blamed, ignored if called by buyer or seller
     */
    function _closeAndCashSettleDeliveryAndPenalize(bytes32 _positionId, Position storage position, bool _blameSeller)
        private
    {
        // calculate and pay breach penalty

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
        _closeAndCashSettleDelivery(_positionId, position);
        emit PositionDeliveryClosed(_positionId, _msgSender());
    }

    /**
     * @notice Settles position or remaining delivery in cash
     * @param _positionId The id of the position to close and settle
     * @param position The position to close and settle
     */
    function _closeAndCashSettleDelivery(bytes32 _positionId, Position storage position) private {
        uint256 positionElapsedTime = 0;
        uint256 positionRemainingTime = 0;
        if (block.timestamp > position.deliveryAt) {
            positionElapsedTime = block.timestamp - position.deliveryAt;
            positionRemainingTime = position.deliveryAt + deliveryDurationSeconds() - block.timestamp;
        } else {
            positionRemainingTime = deliveryDurationSeconds();
        }

        // payment for a delivered portion of the hashrate
        int256 priceDifference = int256(position.sellPricePerDay) - int256(position.buyPricePerDay);
        if (priceDifference > 0) {
            uint256 buyerPaysToSeller =
                position.buyPricePerDay * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            uint256 contractPaysToSeller =
                uint256(priceDifference) * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            _internalTransfer(_insuranceFundAccount(), position.seller, contractPaysToSeller);
            _internalTransfer(position.buyer, position.seller, buyerPaysToSeller);
        } else if (priceDifference < 0) {
            uint256 buyerPaysToSeller =
                position.sellPricePerDay * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            uint256 buyerPaysToContract =
                uint256(-priceDifference) * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            _internalTransfer(_insuranceFundAccount(), position.buyer, buyerPaysToContract);
            _internalTransfer(position.buyer, position.seller, buyerPaysToSeller);
        } else {
            uint256 buyerPaysToSeller =
                position.buyPricePerDay * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            _internalTransfer(position.buyer, position.seller, buyerPaysToSeller);
        }

        // Payment for the remaining portion of the hashrate
        uint256 hashpriceUsd = _getHashpriceUsd();
        uint256 currentPrice = _getMarketPrice(hashpriceUsd);
        uint256 mult = uint256(deliveryDurationDays) * positionRemainingTime / uint256(deliveryDurationSeconds());

        int256 sellerPnl = (int256(position.sellPricePerDay) - int256(currentPrice)) * int256(mult);
        int256 buyerPnl = (int256(currentPrice) - int256(position.buyPricePerDay)) * int256(mult);

        emit PositionExited(_positionId, position.seller, -sellerPnl);
        emit PositionExited(_positionId, position.buyer, -buyerPnl);

        _transferPnl(_insuranceFundAccount(), position.seller, sellerPnl);
        _transferPnl(_insuranceFundAccount(), position.buyer, buyerPnl);

        // remove position
        _removePosition(_positionId, position);
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
            isBuy
        );

        _closeAndCashSettleDelivery(_positionId, position);
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
        emit PositionClosed(_positionId);
    }

    function getMarketPrice() public view returns (uint256) {
        return _getMarketPrice(_getHashpriceUsd());
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

    /// @notice Returns how much participant needs to add to their collateral to cover the margin shortfall
    function getCollateralDeficit(address _participant) public view returns (int256) {
        int256 effectiveMargin = getMinMargin(_participant);
        uint256 balance = collateralVault.balanceOf(_participant);
        return int256(effectiveMargin) - int256(balance);
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
    function getFuturesOrderMargin(address _participant) external view returns (uint256) {
        EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_participant];
        uint256 len = _orders.length();
        if (len == 0) return 0;
        uint256 total = 0;
        uint256 marketPricePerDay = getMarketPrice();
        int256 durationDays = int256(uint256(deliveryDurationDays));
        uint256 marginPct = getMarginPercent();
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
        StructuredLinkedList.List storage queue =
            _isBid ? deliveryDatePriceOrdersLongIdQueue[_deliveryDate][_price]
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
        emit PositionPaid(positionId);
    }

    function withdrawDeliveryPayment(uint256 _deliveryDate) external {
        if (block.timestamp < _deliveryDate + deliveryDurationSeconds()) {
            revert DeliveryNotFinishedYet();
        }
        bool withdrew = false;

        // get all user positions for the delivery date
        EnumerableSet.Bytes32Set storage _positions =
            participantDeliveryDatePositionIdsIndex[_msgSender()][_deliveryDate];
        for (uint256 i = 0; i < _positions.length(); i++) {
            bytes32 positionId = _positions.at(i);
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
                _internalTransfer(address(this), fund, buyerDeposit);
                _internalTransfer(fund, position.seller, sellerOwed);
                position.paid = false;
                withdrew = true;
                emit PositionPaymentReceived(positionId);
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

    function abs(int256 _value) private pure returns (uint256) {
        if (_value > 0) {
            return uint256(_value);
        } else {
            return uint256(-_value);
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

    modifier onlyValidator() {
        if (_msgSender() != validatorAddress) {
            revert OnlyValidator();
        }
        _;
    }
}
