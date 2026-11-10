// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Mark ranges per expiry from the venue's index and a known schedule (`HashpriceGlideUSD`).
interface IMarkRangeOracle {
    /// @notice The mark range of a contract settling at each expiry, in the index feed's units:
    ///         venues value longs and bids at `low`, shorts and asks at `high`.
    /// @return low Per expiry
    /// @return high Per expiry
    /// @return updatedAt The index feed's `updatedAt`
    function markRangesAt(uint256[] calldata expiries)
        external
        view
        returns (uint256[] memory low, uint256[] memory high, uint256 updatedAt);

    /// @notice `markRangesAt` for one expiry.
    function markRangeAt(uint256 expiry) external view returns (uint256 low, uint256 high, uint256 updatedAt);

    /// @notice The index feed the ranges derive from; must be the venue's settlement feed.
    function hashpriceUsd() external view returns (address);

    /// @notice Estimated timestamp of the next halving; 0 when there is none to estimate. Venues keep
    ///         their delivery dates clear of it.
    function halvingEta() external view returns (uint256);
}
