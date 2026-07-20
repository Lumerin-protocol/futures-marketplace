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
    uint256 public minimumPriceIncrement;
    /// @notice Flat fee charged to the taker per matched contract unit.
    /// @dev Occupies the former `orderFee` slot.
    uint256 public takerFee;
    uint256 private nonce = 0;

    address private _gap;
    /// @notice Hashprice oracle (price of 100 TH/s per day in `token` currency).
    AggregatorV3Interface public hashrateOracle;
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

    IPortfolioMarginEngine public marginEngine;
    /// @notice Canonical net position quantity per (participant, expirationAt). +long / -short.
    mapping(address => mapping(uint256 => int256)) private participantExpirationAtNetDelta;
    /// @notice Canonical Σ qty_i * entryPrice_i per (participant, expirationAt), token decimals.
    mapping(address => mapping(uint256 => int256)) private participantExpirationAtNetEntryValue;

    mapping(uint256 => EnumerableSet.UintSet) private activeBidPrices;
    mapping(uint256 => EnumerableSet.UintSet) private activeAskPrices;

    uint256 public liquidationFee;

    /// @notice Flat fee charged to the maker per matched contract unit.
    uint256 public makerFee;

    IPointsHook public hook;

    /// @notice Pinned cash-settlement price per expiration (`0` = unset).
    mapping(uint256 => uint256) public settlementPrice;

    /// @dev Expiration timestamps at which a participant holds a non-zero aggregate position.
    mapping(address => EnumerableSet.UintSet) private participantActiveExpirationAts;

    // immutable
    ICollateralVault public immutable collateralVault;
    uint8 private immutable _decimals;

    // constants
    string public constant VERSION = "3.0.0";
    uint256 public constant ORACLE_UNIT_HPS_DAY = 100 * 1e12;
    uint256 public constant CONTRACT_SIZE_HPS_DAY = 1e15;
    uint8 public constant MAX_ORDERS_PER_PARTICIPANT = 100;
    uint32 private constant SECONDS_PER_DAY = 3600 * 24;
    uint256 public constant MAX_ORACLE_STALENESS = 3600; // 1 hour
    uint8 public constant EXPIRATION_INTERVAL_DAYS = 30;

    // ── Structs ───────────────────────────────────────────────────────────────

    /// @notice Resting-order storage (layout-preserving vs v2: `quantityAbs` reuses the `destURL` slot).
    struct Order {
        bool isBuy;
        address participant;
        uint256 quantityAbs; // remaining abs qty; 0 = closed/empty
        uint256 price; // was pricePerDay
        uint256 expirationAt;
        uint256 createdAt;
    }

    /// @notice Public/ABI order shape (signed remaining quantity).
    struct OrderView {
        address participant;
        uint256 price;
        int256 quantity;
        uint256 expirationAt;
    }

    /// @notice One placement in a `createOrders` batch.
    struct OrderIntent {
        uint256 price;
        uint256 expirationAt;
        int256 quantity;
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

    struct Config {
        uint256 makerFee;
        uint256 takerFee;
        uint256 liquidationFee;
        uint256 minimumPriceIncrement;
        uint8 liquidationMarginPercent;
        uint8 futureExpirationDatesCount;
        address hashrateOracle;
        address marginEngine;
    }

    // ── Events ────────────────────────────────────────────────────────────────

    event OrderCreated(
        bytes32 indexed orderId, address indexed participant, uint256 price, int256 quantity, uint256 expirationAt
    );
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
    event ConfigUpdated(Config config);
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
    error OverLiquidation();
    error OrderNotBelongToUser();
    error OrderNotExists();
    error OrderNotExpired();
    error ArrayLengthMismatch();

    /// @param _collateralVault Must use the same underlying ERC20 as initialized against.
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
        uint256 _minimumPriceIncrement,
        uint8, // was expirationIntervalDays — now EXPIRATION_INTERVAL_DAYS
        uint8 _futureExpirationDatesCount,
        uint256 _firstFutureExpirationDate
    ) public initializer {
        __Ownable_init(_msgSender());
        __UUPSUpgradeable_init();
        _setHashrateOracle(_hashrateOracle);
        liquidationMarginPercent = _liquidationMarginPercent;
        minimumPriceIncrement = _minimumPriceIncrement;
        if (_futureExpirationDatesCount < 1) {
            revert ValueOutOfRange(1, int256(uint256(type(uint8).max)));
        }
        futureExpirationDatesCount = _futureExpirationDatesCount;
        firstFutureExpirationDate = _firstFutureExpirationDate;
        _emitConfigUpdated();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner { }

    // ── Order placement ───────────────────────────────────────────────────────

    /// @notice Place a single order. `quantity` > 0 = buy/long, < 0 = sell/short (whole contracts).
    function createOrder(uint256 _price, uint256 _expirationAt, int256 _quantity) external {
        address sender = _msgSender();
        _createOrderInternal(sender, _price, _expirationAt, _quantity);
        ensureNoCollateralDeficit(sender);
    }

    /// @notice Batched placement — IM check once at the end.
    function createOrders(OrderIntent[] calldata _intents) external {
        address sender = _msgSender();
        uint256 len = _intents.length;
        for (uint256 i = 0; i < len; i++) {
            OrderIntent calldata intent = _intents[i];
            _createOrderInternal(sender, intent.price, intent.expirationAt, intent.quantity);
        }
        ensureNoCollateralDeficit(sender);
    }

    /// @dev Per-leg body of `createOrder` without the IM-check epilogue.
    function _createOrderInternal(address _participant, uint256 _price, uint256 _expirationAt, int256 _quantity)
        private
    {
        validatePrice(_price);
        validateExpirationAt(_expirationAt);
        if (_quantity == 0) revert InvalidQty();

        bool isBuy = _quantity > 0;
        uint256 remainingAbs = _abs(_quantity);

        bytes32 orderId = bytes32(++nonce);
        emit OrderCreated(orderId, _participant, _price, _quantity, _expirationAt);

        StructuredLinkedList.List storage oppositeQueue = _expirationAtPriceOrderIds(_expirationAt, _price, !isBuy);
        EnumerableSet.Bytes32Set storage participantPriceOrderIds =
            participantExpirationAtPriceOrderIdsIndex[_participant][_expirationAt][_price];

        while (remainingAbs > 0 && oppositeQueue.sizeOf() > 0) {
            // Self-trade: cancel own opposite resting order rather than matching self.
            if (participantPriceOrderIds.length() > 0) {
                bytes32 ownId = participantPriceOrderIds.at(0);
                Order memory ownOrder = orders[ownId];
                if (ownOrder.participant == _participant && ownOrder.isBuy != isBuy && ownOrder.quantityAbs > 0) {
                    uint256 cancelledAbs = ownOrder.quantityAbs;
                    _removeRestingOrder(ownId, ownOrder);
                    emit OrderCancelled(ownId, _participant);
                    remainingAbs -= cancelledAbs < remainingAbs ? cancelledAbs : remainingAbs;
                    continue;
                }
            }

            (, uint256 headIdUint) = oppositeQueue.getNextNode(0);
            bytes32 headId = bytes32(headIdUint);
            Order memory head = orders[headId];
            if (head.participant == address(0) || head.quantityAbs == 0) {
                // Defensive: drop corrupt/empty head
                oppositeQueue.remove(headIdUint);
                continue;
            }

            // Guard: never match against self (also covered by self-trade cancel above).
            if (head.participant == _participant) {
                _removeRestingOrder(headId, head);
                emit OrderCancelled(headId, _participant);
                remainingAbs -= head.quantityAbs < remainingAbs ? head.quantityAbs : remainingAbs;
                continue;
            }

            uint256 fill = head.quantityAbs < remainingAbs ? head.quantityAbs : remainingAbs;
            int256 takerFillQty = isBuy ? int256(fill) : -int256(fill);

            _applyFill(head.participant, -takerFillQty, _price, _expirationAt);
            _applyFill(_participant, takerFillQty, _price, _expirationAt);

            uint256 makerFeeAmt = makerFee * fill;
            uint256 takerFeeAmt = takerFee * fill;
            _chargeMatchFees(head.participant, _participant, makerFeeAmt, takerFeeAmt);
            _notifyFill(head.participant, _participant, _price * fill, int256(makerFeeAmt), takerFeeAmt, _price);

            uint256 newHeadAbs = head.quantityAbs - fill;
            if (newHeadAbs == 0) {
                _removeRestingOrder(headId, head);
                emit OrderUpdated(headId, head.participant, 0);
            } else {
                orders[headId].quantityAbs = newHeadAbs;
                int256 newMakerQty = head.isBuy ? int256(newHeadAbs) : -int256(newHeadAbs);
                emit OrderUpdated(headId, head.participant, newMakerQty);
            }

            emit OrderMatched(
                headId,
                head.participant,
                _participant,
                _expirationAt,
                _price,
                takerFillQty,
                int256(makerFeeAmt),
                int256(takerFeeAmt),
                participantExpirationAtNetDelta[head.participant][_expirationAt],
                participantExpirationAtNetDelta[_participant][_expirationAt],
                _avgEntryPrice(head.participant, _expirationAt),
                _avgEntryPrice(_participant, _expirationAt)
            );

            remainingAbs -= fill;
        }

        int256 remainingQty = isBuy ? int256(remainingAbs) : -int256(remainingAbs);
        if (remainingAbs != _abs(_quantity)) {
            emit OrderUpdated(orderId, _participant, remainingQty);
        }

        if (remainingAbs > 0) {
            EnumerableSet.Bytes32Set storage participantOrders = participantOrderIdsIndex[_participant];
            if (participantOrders.length() >= MAX_ORDERS_PER_PARTICIPANT) {
                revert MaxOrdersPerParticipantReached();
            }
            orders[orderId] = Order({
                isBuy: isBuy,
                participant: _participant,
                quantityAbs: remainingAbs,
                price: _price,
                expirationAt: _expirationAt,
                createdAt: block.timestamp
            });
            StructuredLinkedList.List storage orderQueue = _expirationAtPriceOrderIds(_expirationAt, _price, isBuy);
            _addOrderToQueue(orderQueue, orderId, _expirationAt, _price, isBuy);
            participantOrders.add(orderId);
            participantPriceOrderIds.add(orderId);
        }
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
        Order memory order = orders[_orderId];
        if (order.participant != _msgSender()) revert OrderNotBelongToSender();
        if (order.quantityAbs == 0) revert OrderNotExists();
        _removeRestingOrder(_orderId, order);
        emit OrderCancelled(_orderId, order.participant);
    }

    /// @notice Permissionlessly close a resting order whose `expirationAt` is in the past.
    function removeOutdatedOrder(bytes32 _orderId) external {
        Order memory order = orders[_orderId];
        if (order.participant == address(0) || order.quantityAbs == 0) revert OrderNotExists();
        if (order.expirationAt >= block.timestamp) revert OrderNotExpired();
        _removeRestingOrder(_orderId, order);
        emit OrderCancelled(_orderId, order.participant);
    }

    function _removeRestingOrder(bytes32 orderId, Order memory order) private {
        StructuredLinkedList.List storage orderIndexId =
            _expirationAtPriceOrderIds(order.expirationAt, order.price, order.isBuy);
        _removeOrderFromQueue(orderIndexId, orderId, order.expirationAt, order.price, order.isBuy);
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
        bool wasEmpty = orderIndexId.sizeOf() == 0;
        orderIndexId.pushBack(uint256(_orderId));
        if (wasEmpty) {
            (_isBuy ? activeBidPrices : activeAskPrices)[_expirationAt].add(_price);
        }
    }

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

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setLiquidationMarginPercent(uint8 _liquidationMarginPercent) external onlyOwner {
        liquidationMarginPercent = _liquidationMarginPercent;
        _emitConfigUpdated();
    }

    function setFutureExpirationDatesCount(uint8 _futureExpirationDatesCount) public onlyOwner {
        if (_futureExpirationDatesCount < 1) {
            revert ValueOutOfRange(1, int256(uint256(type(uint8).max)));
        }
        futureExpirationDatesCount = _futureExpirationDatesCount;
        _emitConfigUpdated();
    }

    function setMakerFee(uint256 _makerFee) external onlyOwner {
        makerFee = _makerFee;
        _emitConfigUpdated();
    }

    function setTakerFee(uint256 _takerFee) external onlyOwner {
        takerFee = _takerFee;
        _emitConfigUpdated();
    }

    function setLiquidationFee(uint256 _liquidationFee) external onlyOwner {
        liquidationFee = _liquidationFee;
        _emitConfigUpdated();
    }

    function setOracle(address addr) external onlyOwner {
        _setHashrateOracle(AggregatorV3Interface(addr));
        _emitConfigUpdated();
    }

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
        (, int256 answer,, uint256 updatedAt,) = hashrateOracle.latestRoundData();
        if (answer <= 0) return 0;
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) return 0;
        return _getMarketPrice(uint256(answer));
    }

    function _notifyLiquidation(address _liquidator, uint256 _fee) private {
        IPointsHook _hook = hook;
        if (address(_hook) == address(0)) return;
        _hook.onLiquidation(_liquidator, _fee);
    }

    function _emitConfigUpdated() private {
        emit ConfigUpdated(
            Config({
                makerFee: makerFee,
                takerFee: takerFee,
                liquidationFee: liquidationFee,
                minimumPriceIncrement: minimumPriceIncrement,
                liquidationMarginPercent: liquidationMarginPercent,
                futureExpirationDatesCount: futureExpirationDatesCount,
                hashrateOracle: address(hashrateOracle),
                marginEngine: address(marginEngine)
            })
        );
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
        return collateralVault.balanceOf(_participant) < marginEngine.computePortfolioMM(_participant);
    }

    function _underwater(address _participant) internal view returns (bool) {
        return collateralVault.balanceOf(_participant) < marginEngine.computePortfolioMM(_participant);
    }

    // ── Order liquidation ─────────────────────────────────────────────────────

    function liquidateOrder(address _user, bytes32 _orderId) external {
        if (!_underwater(_user)) revert NotLiquidatable();
        Order memory order = orders[_orderId];
        if (order.participant != _user) revert OrderNotBelongToUser();
        if (order.quantityAbs == 0) revert OrderNotExists();
        _doLiquidateOrder(_user, _orderId, order);
    }

    function liquidateOrders(address _user) external {
        EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_user];
        uint256 cancelled = 0;
        while (_orders.length() > 0) {
            if (!_underwater(_user)) break;
            bytes32 orderId = _orders.at(0);
            _doLiquidateOrder(_user, orderId, orders[orderId]);
            cancelled++;
        }
        if (cancelled == 0) revert NotLiquidatable();
    }

    function _doLiquidateOrder(address _user, bytes32 _orderId, Order memory _order) private {
        _removeRestingOrder(_orderId, _order);
        emit OrderUpdated(_orderId, _user, 0);
        emit OrderLiquidated(_orderId, _user, _msgSender(), 0);
        _notifyLiquidation(_msgSender(), 0);
    }

    // ── Position liquidation ──────────────────────────────────────────────────

    /// @notice Force-close up to `closeQty` contracts of an underwater user's net at `expirationAt`.
    /// @dev Orders-first: reverts `OrdersStillOpen` if the user still has resting orders.
    ///      No counterparty order recreation — only this user's aggregate is reduced.
    function liquidatePosition(address _user, uint256 _expirationAt, uint256 _closeQty) external {
        if (participantOrderIdsIndex[_user].length() != 0) revert OrdersStillOpen();
        if (!_underwater(_user)) revert NotLiquidatable();

        int256 netQty = participantExpirationAtNetDelta[_user][_expirationAt];
        if (netQty == 0) revert NotLiquidatable();
        if (_closeQty == 0) revert InvalidQty();

        uint256 absNet = _abs(netQty);
        uint256 closeAbs = _closeQty < absNet ? _closeQty : absNet;

        if (closeAbs == absNet) {
            _doLiquidateFullPosition(_user, _expirationAt, netQty);
            return;
        }

        (int256 pnl, int256 signedClose) = _doPartialLiquidatePosition(_user, _expirationAt, netQty, closeAbs);

        uint256 im = marginEngine.computePortfolioIM(_user);
        uint256 mm = marginEngine.computePortfolioMM(_user);
        if (im > mm && collateralVault.balanceOf(_user) > im) revert OverLiquidation();

        emit PositionLiquidated(_user, _msgSender(), _expirationAt, signedClose, pnl, 0);
        _notifyLiquidation(_msgSender(), 0);
    }

    /// @notice Batch liquidate across expiries. Keeper sizes worst-first off-chain.
    function liquidatePositions(address _user, uint256[] calldata _expirationAts, uint256[] calldata _closeQtys)
        external
    {
        if (_expirationAts.length != _closeQtys.length) revert ArrayLengthMismatch();
        if (participantOrderIdsIndex[_user].length() != 0) revert OrdersStillOpen();
        if (!_underwater(_user)) revert NotLiquidatable();

        uint256 closed = 0;
        for (uint256 i = 0; i < _expirationAts.length; i++) {
            uint256 expirationAt = _expirationAts[i];
            uint256 closeQty = _closeQtys[i];
            int256 netQty = participantExpirationAtNetDelta[_user][expirationAt];
            if (netQty == 0 || closeQty == 0) continue;

            uint256 absNet = _abs(netQty);
            uint256 closeAbs = closeQty < absNet ? closeQty : absNet;

            if (closeAbs == absNet) {
                _doLiquidateFullPosition(_user, expirationAt, netQty);
            } else {
                (int256 pnl, int256 signedClose) = _doPartialLiquidatePosition(_user, expirationAt, netQty, closeAbs);
                emit PositionLiquidated(_user, _msgSender(), expirationAt, signedClose, pnl, 0);
                _notifyLiquidation(_msgSender(), 0);
            }
            closed++;
        }

        if (closed == 0) revert NotLiquidatable();

        if (participantActiveExpirationAts[_user].length() > 0) {
            uint256 im = marginEngine.computePortfolioIM(_user);
            uint256 mm = marginEngine.computePortfolioMM(_user);
            if (im > mm && collateralVault.balanceOf(_user) > im) revert OverLiquidation();
        }
    }

    function _doLiquidateFullPosition(address _user, uint256 _expirationAt, int256 _netQty) private {
        uint256 mark = getMarketPrice();
        int256 netEntry = participantExpirationAtNetEntryValue[_user][_expirationAt];
        int256 pnl = int256(mark) * _netQty - netEntry;

        _transferPnl(_insuranceFundAccount(), _user, pnl);

        participantExpirationAtNetDelta[_user][_expirationAt] = 0;
        participantExpirationAtNetEntryValue[_user][_expirationAt] = 0;
        participantActiveExpirationAts[_user].remove(_expirationAt);

        emit PositionLiquidated(_user, _msgSender(), _expirationAt, _netQty, pnl, 0);
        _notifyLiquidation(_msgSender(), 0);
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
        participantExpirationAtNetDelta[_user][_expirationAt] = _netQty > 0
            ? _netQty - int256(_closeAbs)
            : _netQty + int256(_closeAbs);
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
            price = _getMarketPrice(_getHashpriceUsd());
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
        return _getMarketPrice(_getHashpriceUsd());
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function _getMarketPrice(uint256 _hashpriceUsd) private view returns (uint256) {
        uint256 rebased = (_hashpriceUsd * CONTRACT_SIZE_HPS_DAY) / (hashpriceScalingDivisor * ORACLE_UNIT_HPS_DAY);
        return _roundToNearest(rebased, minimumPriceIncrement);
    }

    function getOrder(bytes32 _orderId) external view returns (OrderView memory) {
        Order memory o = orders[_orderId];
        int256 qty = o.quantityAbs == 0 ? int256(0) : (o.isBuy ? int256(o.quantityAbs) : -int256(o.quantityAbs));
        return OrderView({ participant: o.participant, price: o.price, quantity: qty, expirationAt: o.expirationAt });
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
    /// @dev Maintenance × quantityAbs per order, minus mark PnL on the resting qty.
    function getOrderMargin(address _participant) public view returns (uint256) {
        EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_participant];
        uint256 len = _orders.length();
        if (len == 0) return 0;
        uint256 total = 0;
        uint256 marketPrice = getMarketPrice();
        uint256 marginPct = liquidationMarginPercent;
        for (uint256 i = 0; i < len; i++) {
            Order memory order = orders[_orders.at(i)];
            if (order.expirationAt < block.timestamp || order.quantityAbs == 0) continue;
            int256 qty = order.isBuy ? int256(order.quantityAbs) : -int256(order.quantityAbs);
            uint256 maintenanceMargin = order.price * marginPct / 100 * order.quantityAbs;
            int256 pnl = (int256(marketPrice) - int256(order.price)) * qty;
            total += clamp(int256(maintenanceMargin) - pnl);
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

    function getBidPrices(uint256 _expirationAt, uint256 _maxLevels) external view returns (uint256[] memory) {
        return _activePricesSlice(activeBidPrices[_expirationAt], _maxLevels);
    }

    function getAskPrices(uint256 _expirationAt, uint256 _maxLevels) external view returns (uint256[] memory) {
        return _activePricesSlice(activeAskPrices[_expirationAt], _maxLevels);
    }

    function getOrderBookPrices(uint256 _expirationAt, uint256 _maxLevels)
        external
        view
        returns (uint256[] memory bids, uint256[] memory asks)
    {
        bids = _activePricesSlice(activeBidPrices[_expirationAt], _maxLevels);
        asks = _activePricesSlice(activeAskPrices[_expirationAt], _maxLevels);
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

    /// @notice Sum of resting `quantityAbs` at one (expirationAt, price, side).
    function getQuantityAtPrice(uint256 _expirationAt, uint256 _price, bool _isBid) external view returns (uint256) {
        StructuredLinkedList.List storage queue = _isBid
            ? expirationAtPriceOrdersLongIdQueue[_expirationAt][_price]
            : expirationAtPriceOrdersShortIdQueue[_expirationAt][_price];

        uint256 total = 0;
        uint256 size = queue.sizeOf();
        if (size == 0) return 0;

        (, uint256 nodeId) = queue.getNextNode(0);
        for (uint256 i = 0; i < size && nodeId != 0; i++) {
            total += orders[bytes32(nodeId)].quantityAbs;
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

    function _abs(int256 _value) private pure returns (uint256) {
        return _value >= 0 ? uint256(_value) : uint256(-_value);
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

        if (available > 0) {
            collateralVault.internalTransfer(payer, receiver, available);
        }
        emit BadDebt(payer, amount - available);
    }

    function _insuranceFundAccount() private view returns (address) {
        address fund = collateralVault.INSURANCE_FUND_ADDR();
        if (fund == address(0)) revert InsuranceFundNotConfigured();
        return fund;
    }

    function _internalTransfer(address from, address to, uint256 amount) private {
        if (amount == 0) return;
        collateralVault.internalTransfer(from, to, amount);
    }
}
