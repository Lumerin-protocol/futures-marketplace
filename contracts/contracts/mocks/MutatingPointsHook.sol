// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPointsHook } from "collateral-margin/contracts/contracts/interfaces/IPointsHook.sol";

interface IMutablePriceFeed {
    function setPrice(int256 price) external;
}

/// @dev Test hook that moves the venue oracle after its first fill callback.
contract MutatingPointsHook is IPointsHook {
    IMutablePriceFeed public immutable oracle;
    int256 public immutable nextPrice;
    uint256[] public refPrices;

    constructor(IMutablePriceFeed _oracle, int256 _nextPrice) {
        oracle = _oracle;
        nextPrice = _nextPrice;
    }

    function onFill(address, address, uint256, int256, uint256, uint256, uint256 refPrice) external {
        refPrices.push(refPrice);
        if (refPrices.length == 1) oracle.setPrice(nextPrice);
    }

    function onLiquidation(address, uint256) external { }
}
