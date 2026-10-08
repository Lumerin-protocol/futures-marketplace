//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { ICollateralVault } from "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol";
import { IPortfolioMarginEngine } from "collateral-margin/contracts/contracts/interfaces/IPortfolioMarginEngine.sol";
import { IPointsHook } from "collateral-margin/contracts/contracts/interfaces/IPointsHook.sol";
import { HashPowerFuturesBase } from "./HashPowerFuturesBase.sol";

/// @title HashPowerFuturesAdmin — owner-only governance surface for {HashPowerFutures}
/// @notice Every entry point here is `onlyOwner`, plus the UUPS upgrade authorization
///         hook. Splitting them out keeps {HashPowerFutures} to the permissionless surface —
///         trading, liquidation and views — so a reader can tell at a glance which
///         calls a counterparty can make and which only governance can.
/// @dev Declares **no storage**. It sits between {HashPowerFuturesBase} and {HashPowerFutures} purely to
///      partition the function surface, and a stateless layer cannot move a slot: state
///      is laid out in linearization order and every variable is declared in
///      {HashPowerFuturesBase}. That property is load-bearing — this contract is deployed behind
///      a UUPS proxy, so any reordering here would corrupt live storage on upgrade.
///      Keep it stateless. If admin-only state is ever needed, declare it in
///      {HashPowerFuturesBase} at the end alongside the existing gap slots.
abstract contract HashPowerFuturesAdmin is HashPowerFuturesBase {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner { }

    // ── Risk parameters ───────────────────────────────────────────────────────

    // `liquidationMarginPercent` has no setter: it is vestigial (see {HashPowerFuturesBase}) and the
    // setter's bytecode was reclaimed to keep the venue under EIP-170.

    function setFutureExpirationDatesCount(uint8 _futureExpirationDatesCount) public onlyOwner {
        if (_futureExpirationDatesCount < 1) {
            revert ValueOutOfRange(1, int256(uint256(type(uint8).max)));
        }
        futureExpirationDatesCount = _futureExpirationDatesCount;
        emit FutureExpirationDatesCountUpdated(_futureExpirationDatesCount);
    }

    // ── Fees ──────────────────────────────────────────────────────────────────

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

    // ── Wiring ────────────────────────────────────────────────────────────────

    /// @dev Smoke-tests the feed before adopting it. Requires it to already serve a positive,
    ///      initialized round: a feed that never answers reads as price 0, which would settle
    ///      and mark every position at zero.
    /// @dev `public` rather than `external` because `initialize` wires the first feed through
    ///      here — it runs after `__Ownable_init`, so `onlyOwner` is satisfied.
    function setOracle(AggregatorV3Interface _oracle) public onlyOwner {
        if (address(_oracle) == address(0)) revert InvalidOracle();

        oracleDecimals = _validateOracleContract(_oracle);

        priceOracle = _oracle;
        emit OracleUpdated(address(_oracle));
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

    // ── Escape hatch ──────────────────────────────────────────────────────────

    /// @notice Close the given (user, expiry) legs at the current mark, realizing PnL against the
    ///         insurance fund. No fee, no backstop hand-off: the fund's implicit position closes
    ///         with the users'. Emits `PositionLiquidated` so indexers need nothing new.
    /// @dev Only while the vault is halted, so no fill can land between legs. Reverts
    ///      `PositionMatured` on a matured leg: those are worth their settlement price and must go
    ///      through `settlePositions`. Empty legs are skipped. Resting orders are left alone; they
    ///      carry no exposure until they fill.
    function forceClosePositions(address[] calldata _users, uint256[] calldata _expirationAts) external onlyOwner {
        if (!vault.halted()) revert NotHalted();
        if (_users.length != _expirationAts.length) revert ArrayLengthMismatch();
        uint256 mark = _getMarketPrice(_getPrice());
        for (uint256 i = 0; i < _users.length; i++) {
            address user = _users[i];
            uint256 expirationAt = _expirationAts[i];
            if (block.timestamp >= expirationAt) revert PositionMatured();
            int256 netQty = participantExpirationAtNetDelta[user][expirationAt];
            if (netQty == 0) continue;
            int256 pnl = _applyFill(user, -netQty, mark, expirationAt, false);
            emit PositionLiquidated(user, _msgSender(), expirationAt, netQty, pnl, 0);
        }
    }

    /// @notice Admin escape hatch: clear active orders + aggregate positions for the given participants.
    /// @dev Expired v4.3+ orders are already inert and remain available to optional permissionless
    ///      cleanup. Does not walk legacy lots for economics — zeros `netDelta` / `netEntryValue` /
    ///      `activeExpirationAts` directly. Pre-v3 lot indexes and the pre-v4.3 global order index
    ///      are no longer purged here: nothing has written them for several releases, and the
    ///      bytecode they cost pushed the venue over EIP-170.
    function resetState(address[] calldata _participants) external onlyOwner {
        for (uint256 p = 0; p < _participants.length; p++) {
            address participant = _participants[p];
            (uint256[] memory orderExpirationAts, uint256 orderExpirationCount) =
                _activeOrderExpirations(participant);

            for (uint256 d = 0; d < orderExpirationCount; d++) {
                EnumerableSet.Bytes32Set storage deliveryOrders =
                    participantExpirationAtOrderIdsIndex[participant][orderExpirationAts[d]];
                while (deliveryOrders.length() > 0) {
                    bytes32 orderId = deliveryOrders.at(deliveryOrders.length() - 1);
                    Order storage order = orders[orderId];
                    bool isBuy = order.quantity > 0;
                    _removeRestingOrder(orderId, order.expirationAt, order.price, participant, isBuy, true);
                    emit OrderCancelled(orderId, participant);
                }
            }

            // Clear aggregates + active dates directly (no lot iteration for economics).
            EnumerableSet.UintSet storage dates = participantActiveExpirationAts[participant];
            while (dates.length() > 0) {
                uint256 date = dates.at(0);
                delete participantExpirationAtNetDelta[participant][date];
                delete participantExpirationAtNetEntryValue[participant][date];
                dates.remove(date);
            }
        }
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
