// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TokenDecimalsMock is ERC20 {
    uint8 private immutable tokenDecimals;

    constructor(uint8 _decimals) ERC20("Test Collateral", "TEST") {
        tokenDecimals = _decimals;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }
}
