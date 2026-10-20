// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ICollateralVault } from "collateral-margin/contracts/contracts/interfaces/ICollateralVault.sol";
import { HashPowerFutures } from "../HashPowerFutures.sol";

/// @dev Test-only harness for reproducing pre-6.10 proxy state: resting orders whose
///      `Σ price²·qty` moments were never recorded.
contract HashPowerFuturesMigrationHarness is HashPowerFutures {
    constructor(ICollateralVault _vault) HashPowerFutures(_vault) { }

    function clearOrderMoments(address _user, uint256 _expirationAt) external {
        delete participantExpirationAtOrderMoments[_user][_expirationAt];
    }
}
