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
import { HashrateOracle } from "hashprice-oracle/contracts/contracts/HashrateOracle.sol";
import { StructuredLinkedList } from "solidity-linked-list/contracts/StructuredLinkedList.sol";
import { Versionable } from "./Versionable.sol";

// import { console } from "hardhat/console.sol";

// TODO:
// 6. Do we need to batch same price and delivery date orders/positions so it is a single entry?

contract Futures is UUPSUpgradeable, OwnableUpgradeable, ERC20Upgradeable, MulticallUpgradeable, Versionable {
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
    uint256 public speedHps; // speed of the one unit of futures in hashes/second, constant for all positions
    uint256 public minimumPriceIncrement; // difference between two closest prices in the order table
    uint256 public orderFee; // fee for creating an order in tokens
    uint256 private nonce = 0; // nonce for the order id

    IERC20 public token;
    HashrateOracle public hashrateOracle;
    address public validatorAddress; // address of the validator that can close orders that are not delivered and regularly calls marginCall function

    uint8 public deliveryDurationDays; // duration of the delivery in seconds
    uint8 public deliveryIntervalDays; // interval between two closest delivery dates in days
    uint8 public futureDeliveryDatesCount; // number of future delivery dates to be available for orders
    uint8 public liquidationMarginPercent;
    uint8 private _decimals; // decimals of the wrapped token
    string public validatorURL;
    uint256 public collectedFeesBalance;
    uint256 public reservePoolBalance;
    mapping(address => uint8) private addressFeeDiscountPercent;

    // constants
    string public constant VERSION = "1.2.0";
    uint8 public constant MAX_ORDERS_PER_PARTICIPANT = 100;
    uint8 public constant BREACH_PENALTY_DECIMALS = 18;
    uint32 private constant SECONDS_PER_DAY = 3600 * 24;
    uint256 private constant MAX_BREACH_PENALTY_RATE_PER_DAY = 5 * 10 ** (BREACH_PENALTY_DECIMALS - 2); // 5%

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
    event PositionCreated(
        bytes32 indexed positionId,
        address indexed seller,
        address indexed buyer,
        uint256 sellPricePerDay,
        uint256 buyPricePerDay,
        uint256 deliveryAt,
        string destURL,
        bytes32 orderId
    );
    event PositionClosed(bytes32 indexed positionId);
    event PositionExited(bytes32 indexed positionId, address indexed participant, int256 pnl); // positive pnl is participant's profit
    event PositionDeliveryClosed(bytes32 indexed positionId, address indexed closedBy);
    event PositionPaid(bytes32 indexed positionId);
    event PositionPaymentReceived(bytes32 indexed positionId);
    event ValidatorURLUpdated(string validatorURL);

    // errors
    error InvalidPrice();
    error InvalidQty();
    error DeliveryDateShouldBeInTheFuture();
    error DeliveryDateNotAvailable();
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

    constructor() {
        _disableInitializers();
    }

    function initialize(
        IERC20Metadata _token,
        HashrateOracle _hashrateOracle,
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
        _initializeFuturesToken(_token);
        hashrateOracle = _hashrateOracle;
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

    function _initializeFuturesToken(IERC20Metadata _token) private {
        __ERC20_init(string.concat("Lumerin Futures ", _token.symbol()), string.concat("w", _token.symbol()));
        _decimals = _token.decimals();
        token = _token;
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
            _transfer(_participant, address(this), fee);
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
            orderIndexId.pushBack(uint256(_orderId));
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

        // delete matching order
        _closeOrder(oppositeOrderId, oppositeOrder);

        // create new position
        _createPosition(oppositeOrderId, oppositeOrder, _participant, _destURL);
        return true;
    }

    function _createOrder(
        address _participant,
        uint256 _pricePerDay,
        uint256 _deliveryAt,
        bool _isBuy,
        string memory _destURL
    ) private returns (bytes32) {
        bytes32 orderId =
            keccak256(abi.encode(_participant, _pricePerDay, _deliveryAt, _isBuy, block.timestamp, nonce++));
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

    function _createPosition(bytes32 orderId, Order memory order, address _otherParticipant, string memory _destURL)
        private
    {
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

        EnumerableSet.Bytes32Set storage participantDeliveryDatePositionIds =
            participantDeliveryDatePositionIdsIndex[order.participant][order.deliveryAt];
        if (participantDeliveryDatePositionIds.length() > 0) {
            bytes32 existingPositionId = participantDeliveryDatePositionIds.at(0);
            Position memory existingPosition = positions[existingPositionId];

            int256 pnlPerDay = 0; // negative is profit, positive is loss
            if (existingPosition.buyer == order.participant && !order.isBuy) {
                pnlPerDay = int256(existingPosition.buyPricePerDay) - int256(order.pricePerDay);
                _temp.seller = existingPosition.seller;
                _temp.buyer = _otherParticipant;
                _temp.sellPricePerDay = existingPosition.sellPricePerDay;
                _removePosition(existingPositionId, existingPosition);
            } else if (existingPosition.seller == order.participant && order.isBuy) {
                pnlPerDay = int256(order.pricePerDay) - int256(existingPosition.sellPricePerDay);
                _temp.seller = _otherParticipant;
                _temp.buyer = existingPosition.buyer;
                _temp.buyPricePerDay = existingPosition.buyPricePerDay;
                _removePosition(existingPositionId, existingPosition);
            }
            int256 pnl = pnlPerDay * int256(uint256(deliveryDurationDays));

            _transferPnl(order.participant, address(this), pnl);
            emit PositionExited(existingPositionId, order.participant, -pnl);

            if (_temp.buyer == _temp.seller) {
                // both parties exiting the position
                emit PositionExited(existingPositionId, _temp.buyer, pnl);
                _transferPnl(address(this), _temp.buyer, pnl);
                return;
            }
        }

        bytes32 positionId = keccak256(
            abi.encode(_temp.seller, _temp.buyer, order.pricePerDay, order.deliveryAt, block.timestamp, nonce++)
        );
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
        emit PositionCreated(
            positionId,
            _temp.seller,
            _temp.buyer,
            _temp.sellPricePerDay,
            _temp.buyPricePerDay,
            order.deliveryAt,
            _temp.destURL,
            orderId
        );
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
        orderIndexId.remove(uint256(orderId));

        participantOrderIdsIndex[order.participant].remove(orderId);
        participantDeliveryDatePriceOrderIdsIndex[order.participant][order.deliveryAt][order.pricePerDay].remove(
            orderId
        );
        delete orders[orderId];
        emit OrderClosed(orderId, order.participant);
    }

    function addMargin(uint256 _amount) external {
        _mint(_msgSender(), _amount);
        token.safeTransferFrom(_msgSender(), address(this), _amount);
    }

    function removeMargin(uint256 _amount) external enoughMarginBalance(_msgSender(), _amount) {
        _burn(_msgSender(), _amount);
        token.safeTransfer(_msgSender(), _amount);
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
        hashrateOracle = HashrateOracle(addr);
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
        uint256 userCollateral = balanceOf(_participant);

        if (int256(userCollateral) > effectiveMargin) {
            return;
        }

        int256 marginShortfall = effectiveMargin - int256(userCollateral);

        int256 reclaimedMargin; // amount of margin that will be reclaimed by closing positions/orders

        // closing orders
        EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_participant];
        for (; _orders.length() > 0;) {
            bytes32 orderId = _orders.at(0);
            Order memory order = orders[orderId];

            int256 qty = order.isBuy ? int256(1) : int256(-1);
            int256 _margin = int256(clamp(getMinMarginForPosition(order.pricePerDay, qty)));
            _closeOrder(orderId, order);

            reclaimedMargin += _margin;
            if (reclaimedMargin >= marginShortfall) {
                return;
            }
        }

        // closing positions
        EnumerableSet.Bytes32Set storage _positions = participantPositionIdsIndex[_participant];
        for (; _positions.length() > 0;) {
            bytes32 positionId = _positions.at(0);
            Position storage position = positions[positionId];

            // int256 qty = position.buyer == _participant ? int256(1) : int256(-1);
            // int256 _margin = getMinMarginForPosition(position.pricePerDay, qty);
            // Force liquidation: settle unrealized PnL at market price and close position
            //TODO: avoid calling getMinMargin on each iteration, return reclaimed margin instead
            _forceLiquidatePosition(positionId, position, _participant);
            uint256 collateralBalance = balanceOf(_participant);
            int256 minMargin = getMinMargin(_participant);
            if (int256(collateralBalance) >= minMargin) {
                return;
            }
        }

        //TODO: what happens if not enough funds to cover positions
        // the other party takes the loss
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
            _transfer(position.seller, position.buyer, breachPenalty);
        } else {
            uint256 breachPenalty = _calculateBreachPenalty(
                position.buyPricePerDay * deliveryDurationDays,
                position.deliveryAt + deliveryDurationSeconds() - block.timestamp
            );
            _transfer(position.buyer, position.seller, breachPenalty);
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
            _transfer(address(this), position.seller, contractPaysToSeller);
            _transfer(position.buyer, position.seller, buyerPaysToSeller);
        } else if (priceDifference < 0) {
            uint256 buyerPaysToSeller =
                position.sellPricePerDay * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            uint256 buyerPaysToContract =
                uint256(-priceDifference) * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            _transfer(address(this), position.buyer, buyerPaysToContract);
            _transfer(position.buyer, position.seller, buyerPaysToSeller);
        } else {
            uint256 buyerPaysToSeller =
                position.buyPricePerDay * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
            _transfer(position.buyer, position.seller, buyerPaysToSeller);
        }

        // Payment for the remaining portion of the hashrate
        uint256 hashesForToken = _getHashesForToken();
        uint256 currentPrice = _getMarketPrice(hashesForToken);
        uint256 mult = uint256(deliveryDurationDays) * positionRemainingTime / uint256(deliveryDurationSeconds());

        int256 sellerPnl = (int256(position.sellPricePerDay) - int256(currentPrice)) * int256(mult);
        int256 buyerPnl = (int256(currentPrice) - int256(position.buyPricePerDay)) * int256(mult);

        emit PositionExited(_positionId, position.seller, -sellerPnl);
        emit PositionExited(_positionId, position.buyer, -buyerPnl);

        _transferPnl(address(this), position.seller, sellerPnl);
        _transferPnl(address(this), position.buyer, buyerPnl);

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
        delete positions[_positionId];
        emit PositionClosed(_positionId);
    }

    function getMarketPrice() public view returns (uint256) {
        return _getMarketPrice(_getHashesForToken());
    }

    function _getMarketPrice(uint256 _hashesForToken) private view returns (uint256) {
        return _roundToNearest(SECONDS_PER_DAY * speedHps / _hashesForToken, minimumPriceIncrement);
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
        uint256 balance = balanceOf(_participant);
        return int256(effectiveMargin) - int256(balance);
    }

    function getDeliveryDates() external view returns (uint256[] memory) {
        uint256 currentDeliveryDateIndex = _getCurrentDeliveryDateIndex();

        uint256[] memory deliveryDatesArray = new uint256[](futureDeliveryDatesCount);
        for (uint256 i = 0; i < futureDeliveryDatesCount; i++) {
            deliveryDatesArray[i] = firstFutureDeliveryDate + deliveryIntervalSeconds() * (currentDeliveryDateIndex + i);
        }

        return deliveryDatesArray;
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
                uint256 totalPayment = position.sellPricePerDay * deliveryDurationDays;
                _transfer(address(this), position.seller, totalPayment);
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

    function _getHashesForToken() private view returns (uint256) {
        return hashrateOracle.getHashesforToken();
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
        int256 collateralDeficit = getCollateralDeficit(_participant);
        if (collateralDeficit > 0) {
            revert InsufficientMarginBalance();
        }
    }

    /// @notice Deposits collateral into the contract to credit participant when position is exited
    /// @param _amount The amount of collateral to deposit
    function depositReservePool(uint256 _amount) external {
        reservePoolBalance += _amount;
        _mint(address(this), _amount);
        token.safeTransferFrom(_msgSender(), address(this), _amount);
    }

    /// @notice Withdraws collateral from the contract to the sender
    /// @param _amount The amount of collateral to withdraw
    function withdrawReservePool(uint256 _amount) external onlyOwner {
        if (_amount > reservePoolBalance) {
            revert ERC20InsufficientBalance(address(this), reservePoolBalance, _amount);
        }
        reservePoolBalance -= _amount;
        _burn(address(this), _amount);
        token.safeTransfer(_msgSender(), _amount);
    }

    function withdrawCollectedFees() external onlyOwner {
        uint256 amount = collectedFeesBalance;
        collectedFeesBalance = 0;
        _burn(address(this), amount);
        token.safeTransfer(owner(), amount);
    }

    function _transferPnl(address _from, address _to, int256 _pnl) private {
        if (_pnl > 0) {
            _transfer(_from, _to, uint256(_pnl));
        } else if (_pnl < 0) {
            _transfer(_to, _from, uint256(-_pnl));
        }
    }

    // ERC20 functions

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function transfer(address _to, uint256 _amount)
        public
        override
        enoughMarginBalance(_msgSender(), _amount)
        returns (bool)
    {
        return super.transfer(_to, _amount);
    }

    function _transferEnsureMarginBalance(address _from, address _to, uint256 _amount)
        private
        enoughMarginBalance(_from, _amount)
        returns (bool)
    {
        _transfer(_from, _to, _amount);
        return true;
    }

    function transferFrom(address _from, address _to, uint256 _amount)
        public
        override
        enoughMarginBalance(_from, _amount)
        returns (bool)
    {
        return super.transferFrom(_from, _to, _amount);
    }

    // Modifiers

    modifier enoughMarginBalance(address _from, uint256 _amount) {
        uint256 depositedCollateral = balanceOf(_from);
        if (depositedCollateral < _amount) {
            revert ERC20InsufficientBalance(_from, depositedCollateral, _amount);
        }

        if (int256(_amount) > int256(depositedCollateral) - getMinMargin(_from)) {
            revert InsufficientMarginBalance();
        }
        _;
    }

    modifier onlyValidator() {
        if (_msgSender() != validatorAddress) {
            revert OnlyValidator();
        }
        _;
    }
}
