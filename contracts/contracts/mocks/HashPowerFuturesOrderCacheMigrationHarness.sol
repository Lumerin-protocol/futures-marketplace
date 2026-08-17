//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { ICollateralVault } from "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol";
import { HashPowerFuturesBase } from "../HashPowerFuturesBase.sol";

/// @dev Test-only implementation used to move newly created fixture orders into
///      the legacy global participant index before exercising the v4.3 cutover.
contract HashPowerFuturesOrderCacheMigrationHarness is HashPowerFuturesBase {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    string public constant VERSION = "test";

    constructor(ICollateralVault _vault) HashPowerFuturesBase(_vault) { }

    function _authorizeUpgrade(address) internal override onlyOwner { }

    function moveOrdersToLegacyIndex(address _participant, uint256 _expirationAt) external {
        EnumerableSet.Bytes32Set storage ids = participantExpirationAtOrderIdsIndex[_participant][_expirationAt];
        while (ids.length() > 0) {
            bytes32 orderId = ids.at(ids.length() - 1);
            ids.remove(orderId);
            participantOrderIdsIndex[_participant].add(orderId);
        }
    }
}
