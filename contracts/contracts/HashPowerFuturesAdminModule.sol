//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { ICollateralVault } from "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol";
import { IPortfolioMarginEngine } from "collateral-margin/contracts/contracts/interfaces/IPortfolioMarginEngine.sol";
import { IPointsHook } from "collateral-margin/contracts/contracts/interfaces/IPointsHook.sol";
import { MathLib as M } from "./libs/MathLib.sol";
import { HashPowerFuturesBase } from "./HashPowerFuturesBase.sol";
import { IMarkRangeOracle } from "./interfaces/IMarkRangeOracle.sol";

/// @title HashPowerFuturesAdminModule — the bodies {HashPowerFutures} runs by delegatecall
/// @notice Holds the owner-only functions, and the permissionless but keeper-driven ones
///         (liquidation, settlement, expired-order cleanup, `pinExpiry`), so {HashPowerFutures}
///         fits EIP-170 with its trading paths, margin views and delivery schedule inline. Created
///         by the implementation's constructor with the same vault, and run only by delegatecall
///         from the implementation, in the proxy's storage; the hop costs about 2.6k gas.
/// @dev Same storage layout as the implementation by inheriting {HashPowerFuturesBase}, and
///      declares none of its own. Called directly it has no owner (its initializers are
///      disabled), so every owner-only function reverts, and the permissionless ones act on an
///      empty book.
contract HashPowerFuturesAdminModule is HashPowerFuturesBase {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @notice {HashPowerFutures.VERSION} of the implementation that creates this module.
    string public constant VERSION = "6.18.1";

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(ICollateralVault _vault) HashPowerFuturesBase(_vault) { }

    /// @dev Upgrades go through the implementation, never the module.
    function _authorizeUpgrade(address) internal view override onlyOwner { }

    /// @dev The count can only grow: a lower count unlists dates that may hold resting orders,
    ///      which `getRiskView` then stops reserving although they can fill once the window
    ///      reaches those dates again. The initializer sets at least 1, so this also rejects 0.
    function setFutureExpirationDatesCount(uint8 _futureExpirationDatesCount) public onlyOwner {
        uint8 current = futureExpirationDatesCount;
        if (_futureExpirationDatesCount < current) {
            revert ValueOutOfRange(int256(uint256(current)), int256(uint256(type(uint8).max)));
        }
        futureExpirationDatesCount = _futureExpirationDatesCount;
        emit FutureExpirationDatesCountUpdated(_futureExpirationDatesCount);
    }

    /// @notice Set the maker fee in basis points. Bounded by {_validateFees}.
    function setMakerFeeBps(int16 _makerFeeBps) external onlyOwner {
        _validateFees(_makerFeeBps, takerFeeBps);
        makerFeeBps = _makerFeeBps;
        emit MakerFeeBpsUpdated(_makerFeeBps);
    }

    /// @notice Set the taker fee in basis points. Bounded by {_validateFees}.
    function setTakerFeeBps(int16 _takerFeeBps) external onlyOwner {
        _validateFees(makerFeeBps, _takerFeeBps);
        takerFeeBps = _takerFeeBps;
        emit TakerFeeBpsUpdated(_takerFeeBps);
    }

    /// @notice Set the liquidation fee in basis points on the liquidated notional.
    /// @param _bps Fee in bps (e.g., 50 = 0.5%). Capped at `BPS` (100% of notional).
    function setLiquidationFeeBps(uint16 _bps) external onlyOwner {
        _validateBPS(_bps);
        liquidationFeeBps = _bps;
        emit LiquidationFeeBpsUpdated(_bps);
    }

    function setLiquidatorShareBps(uint16 _bps) external onlyOwner {
        _validateBPS(_bps);
        liquidatorShareBps = _bps;
        emit LiquidatorShareBpsUpdated(_bps);
    }

    /// @notice Withdraw accrued trading and liquidation revenue to the venue owner.
    /// @dev Drains the venue's vault account (the fee pot). No separate accumulator.
    function withdrawCollectedFees() external onlyOwner {
        vault.withdrawTo(owner(), _vaultBalance(address(this)));
    }

    /// @dev Every order and every liquidation routes through the engine, and the venue never
    ///      null-checks it, so a wrong address here bricks the book. The engine must also
    ///      aggregate this venue's own vault.
    function setPortfolioMargin(IPortfolioMarginEngine _pm) external onlyOwner {
        if (address(_pm) == address(0)) revert ZeroAddress();
        _setPortfolioMargin(_pm);
    }

    function setHook(address _hook) external onlyOwner {
        if (_hook != address(0)) _requireContract(_hook);

        hook = IPointsHook(_hook);
        emit HookUpdated(_hook);
    }

    /// @notice Close the given (user, expiry) legs at the current mark with no fee, handing each to
    ///         the backstop like a liquidation, so positions keep summing to zero: closing a
    ///         one-sided set moves its net onto the backstop, closing every user leaves it flat.
    ///         Emits `BackstopAssigned` and `PositionLiquidated` so indexers need nothing new.
    /// @dev Only while the vault is halted, so no fill can land between legs. Listing the
    ///      backstop itself only re-marks its leg (realized against the fund, size unchanged).
    ///      Reverts `PositionMatured` on a matured leg: those are worth their settlement price and
    ///      must go through `settlePositions`. Empty legs are skipped. Resting orders are left
    ///      alone; they carry no exposure until they fill, and {forceCancelOrders} removes them.
    function forceClosePositions(address[] calldata _users, uint256[] calldata _expirationAts) external onlyOwner {
        if (!vault.halted()) revert NotHalted();
        if (_users.length != _expirationAts.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < _users.length; i++) {
            address user = _users[i];
            uint256 expirationAt = _expirationAts[i];
            if (block.timestamp >= expirationAt) revert PositionMatured();
            int256 netQty = participantExpirationAtNetDelta[user][expirationAt];
            if (netQty == 0) continue;
            int256 pnl = _closeToBackstop(user, expirationAt, netQty, _sideMark(expirationAt, netQty > 0));
            emit PositionLiquidated(user, _msgSender(), expirationAt, netQty, pnl, 0);
        }
    }

    /// @notice Cancel every resting order on the given (user, expiry) legs, emitting
    ///         `OrderCancelled` per order like a user's own cancel. Realizes nothing, so it runs
    ///         with or without a halt; pair it with `forceClosePositions` / `settlePositions` to
    ///         unwind users fully.
    /// @dev Any expiry is accepted: matured ones, whose orders sit inert, and dates that left the
    ///      trading window after `futureExpirationDatesCount` shrank. Clears each leg's aggregate
    ///      wholesale instead of subtracting per order, so it also removes orders placed before
    ///      6.10, which the aggregate never counted: run it as the call of any upgrade from
    ///      before 6.10, on every leg with resting orders. Legs without orders are skipped.
    function forceCancelOrders(address[] calldata _users, uint256[] calldata _expirationAts) external onlyOwner {
        if (_users.length != _expirationAts.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < _users.length; i++) {
            address user = _users[i];
            uint256 expirationAt = _expirationAts[i];
            bytes32[] memory orderIds = participantExpirationAtOrderIdsIndex[user][expirationAt].values();
            if (orderIds.length == 0) continue;
            for (uint256 j = 0; j < orderIds.length; j++) {
                _dropRestingOrder(orderIds[j], false);
            }
            _clearOrderAggregate(user, expirationAt);
        }
    }

    // ── Permissionless, keeper-driven bodies (the venue keeps delegatecall stubs) ─────────────

    /// @notice Optionally close expired resting orders in one maintenance transaction.
    /// @dev Missing, already-closed and not-yet-expired ids are skipped so concurrent
    ///      callers cannot revert unrelated cleanup work. No protocol path calls this
    ///      automatically; expired orders are inert and do not consume future delivery caps.
    function removeOutdatedOrders(bytes32[] calldata _orderIds) external returns (uint256 removed) {
        uint256 len = _orderIds.length;
        for (uint256 i = 0; i < len; i++) {
            bytes32 orderId = _orderIds[i];
            Order storage order = orders[orderId];
            if (order.participant == address(0) || order.quantity == 0 || order.expirationAt >= block.timestamp) {
                continue;
            }
            _dropRestingOrder(orderId, true);
            removed++;
        }
    }

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
        // A full opposite fill at the pinned price: realizes `price * net - entry` against the fund
        // and zeroes the leg, the same arithmetic this function used to spell out.
        int256 pnl = _applyFill(_user, -netQty, price, _expirationAt, false);

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
            price = _marketPrice();
            if (price == 0) revert InvalidPrice();
            settlementPrice[expirationAt] = price;
            emit SettlementPriceRecorded(expirationAt, price, _msgSender());
        }
        return price;
    }

    /// @notice Cancel one resting order of an underwater participant, charging the liquidation fee.
    function liquidateOrder(address _user, bytes32 _orderId) external {
        if (_user == BACKSTOP) revert BackstopAccount();
        if (!_underwater(_user)) revert NotLiquidatable();
        Order storage order = orders[_orderId];
        if (order.participant != _user) revert OrderNotBelongToUser();
        if (order.quantity == 0) revert OrderNotExists();
        _doLiquidateOrder(_user, _orderId, order);
    }

    /// @notice Cancel keeper-chosen resting orders. Keeps prior cancels; skips
    ///         raced/stale ids; stops when the user is healthy.
    function liquidateOrders(address _user, bytes32[] calldata _orderIds) external {
        if (_user == BACKSTOP) revert BackstopAccount();
        uint256 cancelled = 0;
        uint256 len = _orderIds.length;
        for (uint256 i = 0; i < len; i++) {
            bytes32 orderId = _orderIds[i];
            Order storage order = orders[orderId];
            // Skip raced/stale ids before the expensive portfolio MM check.
            if (order.participant != _user || order.quantity == 0) continue;
            if (!_underwater(_user)) break;
            _doLiquidateOrder(_user, orderId, order);
            cancelled++;
        }
        if (cancelled == 0) revert NotLiquidatable();
    }

    function _underwater(address _participant) internal view returns (bool) {
        return _vaultBalance(_participant) < portfolioMargin.computePortfolioMM(_participant);
    }

    function _doLiquidateOrder(address _user, bytes32 _orderId, Order storage _order) internal {
        uint256 orderNotional = _order.price * M.abs(_order.quantity);
        _dropRestingOrder(_orderId, true);

        uint256 liqFee = _chargeLiquidationFee(_user, orderNotional);

        emit OrderLiquidated(_orderId, _user, _msgSender(), liqFee);
        _notifyLiquidation(_msgSender(), liqFee);
    }

    /// @notice Force-close up to `closeQty` contracts of an underwater user's net at `expirationAt`.
    /// @dev Orders-first, portfolio-wide: any resting order delta at any venue gates this call,
    ///      not just this book's. Keeper sizes `closeQty` off-chain; the end-of-call
    ///      `OverLiquidation` guard reverts if leftover balance sits above IM while a real
    ///      IM>MM buffer exists. The guard runs after full closes too — a full close of one
    ///      expiry is still a partial close of the portfolio — but it is vacuous once no
    ///      portfolio risk remains (IM == MM == 0), which is the bad-debt / deep-underwater path.
    function liquidatePosition(address _user, uint256 _expirationAt, uint256 _closeQty) external {
        _liquidationPreflight(_user);
        if (_closeQty == 0) revert InvalidQty();
        // A matured leg is worth its settlement price, not the live mark; `settlePosition` closes it.
        if (block.timestamp >= _expirationAt) revert PositionMatured();

        int256 netQty = participantExpirationAtNetDelta[_user][_expirationAt];
        if (netQty == 0) revert NotLiquidatable();

        if (!_closePosition(_user, _expirationAt, netQty, _closeQty)) revert NotLiquidatable();
    }

    /// @notice Batch liquidate across expiries. Keeper chooses legs; keeps prior closes.
    /// @dev Skips empty and matured legs; stops when healthy. End-of-tx `OverLiquidation` if oversize.
    function liquidatePositions(address _user, uint256[] calldata _expirationAts, uint256[] calldata _closeQtys)
        external
    {
        if (_expirationAts.length != _closeQtys.length) revert ArrayLengthMismatch();
        _liquidationPreflight(_user);

        uint256 closed = 0;
        for (uint256 i = 0; i < _expirationAts.length; i++) {
            if (!_underwater(_user)) break;
            uint256 expirationAt = _expirationAts[i];
            uint256 closeQty = _closeQtys[i];
            int256 netQty = participantExpirationAtNetDelta[_user][expirationAt];
            // Skip empty/stale/matured legs; stop only once healthy.
            if (netQty == 0 || closeQty == 0 || block.timestamp >= expirationAt) continue;
            if (!_closePosition(_user, expirationAt, netQty, closeQty)) continue;
            closed++;
        }

        if (closed == 0) revert NotLiquidatable();
    }

    /// @dev Shared gate for position liquidation: not the backstop, orders-first, underwater.
    ///      Each leg closes at its own mark for the side closed (a long at the low mark).
    function _liquidationPreflight(address _user) internal view {
        if (_user == BACKSTOP) revert BackstopAccount();
        if (portfolioMargin.hasRestingOrderDelta(_user)) revert OrdersStillOpen();
        if (!_underwater(_user)) revert NotLiquidatable();
    }

    /// @dev Close up to `_closeQty` at `_expirationAt`, at the mark for the side closed. Returns
    ///      false when no positive close. Runs the portfolio OverLiquidation guard before
    ///      emit/notify so an oversize close does not pay log/hook gas on the revert path
    ///      (matches Perps).
    function _closePosition(address _user, uint256 _expirationAt, int256 _netQty, uint256 _closeQty)
        internal
        returns (bool)
    {
        uint256 closeAbs = M.min(_closeQty, M.abs(_netQty));
        if (closeAbs == 0) return false;

        // Full and partial closes share `_applyFill`, which zeroes the leg when `closeAbs == |net|`.
        int256 signedClose = M.toSigned(_netQty > 0, closeAbs);
        uint256 mark = _sideMark(_expirationAt, _netQty > 0);
        int256 pnl = _closeToBackstop(_user, _expirationAt, signedClose, mark);
        uint256 liqFee = _chargeLiquidationFee(_user, mark * closeAbs);

        _revertIfOverLiquidated(_user);
        emit PositionLiquidated(_user, _msgSender(), _expirationAt, signedClose, pnl, liqFee);
        _notifyLiquidation(_msgSender(), liqFee);
        return true;
    }

    /// @dev With remaining portfolio risk and a real IM>MM buffer, balance must be ≤ IM.
    function _revertIfOverLiquidated(address _user) internal view {
        (uint256 im, uint256 mm) = portfolioMargin.computePortfolioMargins(_user);
        if (im > mm && _vaultBalance(_user) > im) revert OverLiquidation();
    }

    /// @notice Pin the next delivery date, up to one slot past the tradable window: the chain's
    ///         date, moved to the nearer edge of the no-go zone around the estimated halving when it
    ///         falls inside it. Permissionless and deterministic from the oracle at this block; the
    ///         venue also pins any due slot itself on the first trade after a roll.
    /// @return slot The slot pinned
    /// @return expiry Its delivery date
    function pinExpiry() external returns (uint256 slot, uint256 expiry) {
        ExpirySchedule memory s = expirySchedule;
        if (s.pinnedCount > _currentSlot(s) + futureExpirationDatesCount) revert NothingToPin();
        slot = s.pinnedCount;
        expiry = _pinNext(s);
        expirySchedule = s;
    }

    /// @notice Pin every unpinned slot of the tradable window. Run by the venue itself, by
    ///         delegatecall, on the first trade after a roll; harmless to call directly.
    function pinWindow() external {
        _pinWindow();
    }

    /// @notice Adopt a mark oracle and the index it is built on: live expiries mark off its
    ///         ranges, settlement reads its index (`priceOracle`), so the two always agree.
    /// @dev Smoke-tests both before adopting them. Requires the index to already serve a
    ///      positive, initialized round: a feed that never answers reads as price 0, which would
    ///      settle and mark every position at zero.
    function setOracle(IMarkRangeOracle _oracle) external onlyOwner {
        if (address(_oracle) == address(0)) revert InvalidOracle();
        _requireContract(address(_oracle));
        AggregatorV3Interface index;
        try _oracle.hashpriceUsd() returns (address readIndex) {
            index = AggregatorV3Interface(readIndex);
        } catch {
            revert InvalidDependency();
        }
        if (address(index) == address(0)) revert InvalidOracle();

        oracleDecimals = _validateOracleContract(index);
        priceOracle = index;
        markOracle = _oracle;
        _marketPrice();
        _sideMark(block.timestamp, true);
        emit OracleUpdated(address(index));
        emit MarkOracleUpdated(address(_oracle));
    }

    /// @dev Returns the feed's decimals so the caller can cache them in the same pass.
    function _validateOracleContract(AggregatorV3Interface _oracle) private view returns (uint8) {
        _requireContract(address(_oracle));

        int256 answer;
        uint256 updatedAt;
        try _oracle.latestRoundData() returns (uint80, int256 _answer, uint256, uint256 _updatedAt, uint80) {
            answer = _answer;
            updatedAt = _updatedAt;
        } catch {
            revert InvalidDependency();
        }
        _validateOracleRound(answer, updatedAt);

        uint8 dec;
        try _oracle.decimals() returns (uint8 _dec) {
            dec = _dec;
        } catch {
            revert InvalidDependency();
        }
        return dec;
    }
}
