//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { IMarkRangeOracle } from "../interfaces/IMarkRangeOracle.sol";

/// @title MarkRangeOracleMock
/// @notice Test-only mark oracle over any index feed: every expiry's range is the index itself, as
///         `HashpriceGlideUSD` reports for dates before the halving window. Lets tests drive the
///         venue through a plain `PriceFeedMock` without the Bitcoin oracle chain.
contract MarkRangeOracleMock is IMarkRangeOracle {
    AggregatorV3Interface public immutable index;

    constructor(AggregatorV3Interface _index) {
        index = _index;
    }

    function hashpriceUsd() external view returns (address) {
        return address(index);
    }

    function markRangesAt(uint256[] calldata expiries)
        external
        view
        returns (uint256[] memory low, uint256[] memory high, uint256 updatedAt)
    {
        int256 answer;
        (, answer,, updatedAt,) = index.latestRoundData();
        low = new uint256[](expiries.length);
        for (uint256 i = 0; i < expiries.length; i++) {
            low[i] = uint256(answer);
        }
        high = low;
    }

    function markRangeAt(uint256) external view returns (uint256 low, uint256 high, uint256 updatedAt) {
        int256 answer;
        (, answer,, updatedAt,) = index.latestRoundData();
        low = high = uint256(answer);
    }
}
