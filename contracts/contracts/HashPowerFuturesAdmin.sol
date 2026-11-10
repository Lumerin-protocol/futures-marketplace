//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ICollateralVault } from "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol";
import { IPortfolioMarginEngine } from "collateral-margin/contracts/contracts/interfaces/IPortfolioMarginEngine.sol";
import { HashPowerFuturesBase } from "./HashPowerFuturesBase.sol";
import { IMarkRangeOracle } from "./interfaces/IMarkRangeOracle.sol";
import { HashPowerFuturesAdminModule } from "./HashPowerFuturesAdminModule.sol";

/// @title HashPowerFuturesAdmin — owner-only governance surface for {HashPowerFutures}
/// @notice Every entry point here is `onlyOwner` (checked in the module), plus the UUPS upgrade
///         authorization hook, with one exception: `pinExpiry`, permissionless, whose body also
///         lives in the module for bytecode size. Splitting them out keeps {HashPowerFutures} to
///         the permissionless surface — trading, liquidation and views — so a reader can tell at
///         a glance which calls a counterparty can make and which only governance can.
///         Apart from `setOracle` (which `initialize` calls) the bodies live in
///         {HashPowerFuturesAdminModule}, so the implementation fits EIP-170: each entry point
///         here forwards its calldata there by delegatecall, in the proxy's storage, and the
///         module checks `onlyOwner`.
/// @dev Declares **no storage**. It sits between {HashPowerFuturesBase} and {HashPowerFutures} purely to
///      partition the function surface, and a stateless layer cannot move a slot: state
///      is laid out in linearization order and every variable is declared in
///      {HashPowerFuturesBase}. That property is load-bearing — this contract is deployed behind
///      a UUPS proxy, so any reordering here would corrupt live storage on upgrade.
///      Keep it stateless. If admin-only state is ever needed, declare it in
///      {HashPowerFuturesBase} at the end alongside the existing gap slots.
abstract contract HashPowerFuturesAdmin is HashPowerFuturesBase {
    /// @dev Created with this implementation and the same vault, so its immutables match.
    ///      Bytecode, not storage: the layout is unchanged.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable adminModule;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(ICollateralVault _vault) {
        adminModule = address(new HashPowerFuturesAdminModule(_vault));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner { }

    // ── Risk parameters ───────────────────────────────────────────────────────

    // `liquidationMarginPercent` has no setter: it is vestigial (see {HashPowerFuturesBase}) and the
    // setter's bytecode was reclaimed to keep the venue under EIP-170.

    /// @notice See {HashPowerFuturesAdminModule-setFutureExpirationDatesCount}.
    function setFutureExpirationDatesCount(uint8 _futureExpirationDatesCount) external {
        _futureExpirationDatesCount;
        _delegateToAdminModule();
    }

    // ── Fees ──────────────────────────────────────────────────────────────────

    /// @notice See {HashPowerFuturesAdminModule-setMakerFeeBps}.
    function setMakerFeeBps(int16 _makerFeeBps) external {
        _makerFeeBps;
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-setTakerFeeBps}.
    function setTakerFeeBps(int16 _takerFeeBps) external {
        _takerFeeBps;
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-setLiquidationFeeBps}.
    function setLiquidationFeeBps(uint16 _bps) external {
        _bps;
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-setLiquidatorShareBps}.
    function setLiquidatorShareBps(uint16 _bps) external {
        _bps;
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-withdrawCollectedFees}.
    function withdrawCollectedFees() external {
        _delegateToAdminModule();
    }

    // ── Wiring ────────────────────────────────────────────────────────────────

    /// @notice See {HashPowerFuturesAdminModule-pinExpiry}. Permissionless: the module checks
    ///         nothing but the schedule.
    function pinExpiry() external returns (uint256 slot, uint256 expiry) {
        (slot, expiry);
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-setOracle}. `initialize` reaches it through
    ///      `_delegateCallAdminModule`, since a stub forwards the transaction's own calldata.
    function setOracle(IMarkRangeOracle _oracle) external {
        _oracle;
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-setPortfolioMargin}.
    function setPortfolioMargin(IPortfolioMarginEngine _pm) external {
        _pm;
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-setHook}.
    function setHook(address _hook) external {
        _hook;
        _delegateToAdminModule();
    }

    // ── Escape hatch ──────────────────────────────────────────────────────────

    /// @notice See {HashPowerFuturesAdminModule-forceClosePositions}.
    function forceClosePositions(address[] calldata _users, uint256[] calldata _expirationAts) external {
        (_users, _expirationAts);
        _delegateToAdminModule();
    }

    /// @notice See {HashPowerFuturesAdminModule-forceCancelOrders}.
    function forceCancelOrders(address[] calldata _users, uint256[] calldata _expirationAts) external {
        (_users, _expirationAts);
        _delegateToAdminModule();
    }


    /// @dev Run this call's calldata in the admin module, in this contract's storage, and
    ///      return or revert with its result. The stubs keep their parameter names for the ABI
    ///      and name them once only so the compiler does not report them unused; the module
    ///      decodes the calldata itself.
    function _delegateToAdminModule() private {
        address module = adminModule;
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), module, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }

    /// @dev `_delegateToAdminModule` for a call made from inside this contract, whose calldata
    ///      is not the transaction's: runs `data` in the admin module and reverts with its error.
    function _delegateCallAdminModule(bytes memory data) internal {
        (bool ok, bytes memory result) = adminModule.delegatecall(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
    }
}
