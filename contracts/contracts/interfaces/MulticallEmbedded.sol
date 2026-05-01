// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMulticallEmbedded {
    function multicall(bytes[] calldata data) external returns (bytes[] memory results);
}
