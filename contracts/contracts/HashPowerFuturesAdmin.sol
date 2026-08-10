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

    /// @dev Vestigial — see {HashPowerFuturesBase-liquidationMarginPercent}. Setting this changes no
    ///      on-chain behaviour; margin comes from the portfolio margin engine.
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

    function setLiquidationFeeBps(uint16 _bps) external onlyOwner {
        liquidationFeeBps = _bps;
        emit LiquidationFeeBpsUpdated(_bps);
    }

    function setLiquidatorShareBps(uint16 _bps) external onlyOwner {
        if (_bps > BPS) revert ValueOutOfRange(0, int256(BPS));
        liquidatorShareBps = _bps;
        emit LiquidatorShareBpsUpdated(_bps);
    }

    function withdrawCollectedFees() external onlyOwner {
        uint256 amount = collectedFeesBalance;
        collectedFeesBalance = 0;
        vault.withdrawTo(owner(), amount);
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
        _validateAddressNotZero(address(_pm));
        _validatePortfolioMargin(_pm);
        _validateVaultMatch(_pm);

        portfolioMargin = _pm;
        emit PortfolioMarginUpdated(address(_pm));
    }

    function setHook(address _hook) external onlyOwner {
        if (_hook != address(0)) _requireContract(_hook);

        hook = IPointsHook(_hook);
        emit HookUpdated(_hook);
    }

    // ── Escape hatch ──────────────────────────────────────────────────────────

    /// @notice Drop pre-v4.3 resting orders at currently tradable delivery dates.
    /// @dev Intended for the one-transaction post-upgrade cutover. Historical expired
    ///      orders and all positions remain untouched. Repeated calls are harmless.
    function dropActiveOrders(address[] calldata _participants) external onlyOwner {
        for (uint256 p = 0; p < _participants.length; p++) {
            address participant = _participants[p];
            EnumerableSet.Bytes32Set storage legacyIds = participantOrderIdsIndex[participant];
            for (uint256 i = legacyIds.length(); i > 0; i--) {
                bytes32 orderId = legacyIds.at(i - 1);
                Order storage order = orders[orderId];
                if (!_isActiveExpirationAt(order.expirationAt)) continue;

                bool isBuy = order.quantity > 0;
                _removeRestingOrder(orderId, order.expirationAt, order.price, participant, isBuy);
                emit OrderCancelled(orderId, participant);
            }
        }
    }

    /// @notice Admin escape hatch: clear active orders + aggregate positions for the given participants.
    /// @dev Expired v4.3+ orders are already inert and remain available to optional permissionless
    ///      cleanup. Does not walk legacy lots for economics — zeros `netDelta` / `netEntryValue` /
    ///      `activeExpirationAts` directly. Also purges dead lot indexes and active order queues.
    function resetState(address[] calldata _participants) external onlyOwner {
        for (uint256 p = 0; p < _participants.length; p++) {
            address participant = _participants[p];
            (uint256[] memory orderExpirationAts, uint256 orderExpirationCount) =
                _activeOrderExpirations(participant);

            EnumerableSet.Bytes32Set storage legacyOrders = participantOrderIdsIndex[participant];
            for (uint256 i = legacyOrders.length(); i > 0; i--) {
                bytes32 orderId = legacyOrders.at(i - 1);
                Order storage order = orders[orderId];
                bool isBuy = order.quantity > 0;
                _removeRestingOrder(orderId, order.expirationAt, order.price, order.participant, isBuy);
                emit OrderCancelled(orderId, participant);
            }
            for (uint256 d = 0; d < orderExpirationCount; d++) {
                EnumerableSet.Bytes32Set storage deliveryOrders =
                    participantExpirationAtOrderIdsIndex[participant][orderExpirationAts[d]];
                while (deliveryOrders.length() > 0) {
                    bytes32 orderId = deliveryOrders.at(deliveryOrders.length() - 1);
                    Order storage order = orders[orderId];
                    bool isBuy = order.quantity > 0;
                    _removeRestingOrder(orderId, order.expirationAt, order.price, participant, isBuy);
                    emit OrderCancelled(orderId, participant);
                }
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
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) {
            revert InvalidOracle();
        }
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) revert OracleStale();

        uint8 dec;
        try _oracle.decimals() returns (uint8 _dec) {
            dec = _dec;
        } catch {
            revert InvalidDependency();
        }
        return dec;
    }

    /// @dev Probes plain storage reads rather than `computePortfolioIM`: the margin path needs
    ///      the engine's own oracle, and wiring a venue must not depend on that being set yet.
    function _validatePortfolioMargin(IPortfolioMarginEngine _pm) private view {
        _requireContract(address(_pm));

        try _pm.imSpotShock() returns (uint256) { }
        catch {
            revert InvalidDependency();
        }

        try _pm.mmSpotShock() returns (uint256) { }
        catch {
            revert InvalidDependency();
        }

        try _pm.linearOrderMargin(0) returns (uint256) { }
        catch {
            revert InvalidDependency();
        }
    }

    /// @dev The engine must aggregate this venue's own vault, or margin is computed elsewhere.
    function _validateVaultMatch(IPortfolioMarginEngine _pm) private view {
        try _pm.vault() returns (ICollateralVault pinned) {
            if (address(pinned) != address(vault)) revert VaultMismatch();
        } catch {
            revert InvalidDependency();
        }
    }

    function _validateAddressNotZero(address addr) private pure {
        if (addr == address(0)) {
            revert ZeroAddress();
        }
    }
}
