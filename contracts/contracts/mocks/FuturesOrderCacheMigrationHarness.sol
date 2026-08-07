//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MulticallUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import { ICollateralVault } from "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol";
import { Futures } from "../Futures.sol";

/// @dev Test-only implementation used to simulate an upgraded proxy whose canonical
///      orders predate the per-expiration aggregate cache and which still exposes
///      the legacy embedded multicall removed in v4.2.
contract FuturesOrderCacheMigrationHarness is Futures, MulticallUpgradeable {
    constructor(ICollateralVault _vault) Futures(_vault) { }

    function clearOrderAggregateCache(address _participant) external {
        _clearOrderAggregateCache(_participant);
    }
}
