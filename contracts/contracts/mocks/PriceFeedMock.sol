//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title PriceFeedMock
/// @notice Test-only mock of an `AggregatorV3Interface` price feed used to drive `Futures.getMarketPrice()`
///         without standing up a live HashpriceUSD feed. Tests can move the price by calling
///         `setPrice` (auto-bumps roundId/timestamps) or `setRound` for full control.
/// @dev Defaults to 8 decimals and the description of `HashpriceUSD` so it is a drop-in stand-in for the
///      production hashprice oracle.
contract PriceFeedMock is AggregatorV3Interface {
    uint8 private _decimals;
    string private _description;

    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;

    event PriceUpdated(int256 answer, uint80 roundId, uint256 updatedAt);

    constructor(uint8 decimals_, string memory description_) {
        _decimals = decimals_;
        _description = description_;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80) external pure returns (uint80, int256, uint256, uint256, uint80) {
        revert("PriceFeedMock: getRoundData not supported");
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    /// @notice Push a new price; bumps `roundId` and stamps the current block timestamp.
    function setPrice(int256 price) external {
        _roundId++;
        _answer = price;
        _startedAt = block.timestamp;
        _updatedAt = block.timestamp;
        _answeredInRound = _roundId;
        emit PriceUpdated(price, _roundId, _updatedAt);
    }

    /// @notice Overwrite every round field; useful to simulate stale feeds, mismatched round ids, etc.
    function setRound(uint80 roundId_, int256 answer_, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_)
        external
    {
        _roundId = roundId_;
        _answer = answer_;
        _startedAt = startedAt_;
        _updatedAt = updatedAt_;
        _answeredInRound = answeredInRound_;
        emit PriceUpdated(answer_, roundId_, updatedAt_);
    }

    function setDecimals(uint8 newDecimals) external {
        _decimals = newDecimals;
    }
}
