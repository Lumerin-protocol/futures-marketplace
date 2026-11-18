//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { StructuredLinkedList } from "solidity-linked-list/contracts/StructuredLinkedList.sol";
import { MathLib as M } from "./MathLib.sol";
import { HashPowerFuturesBase } from "../HashPowerFuturesBase.sol";

/// @title FuturesBookLib — order-book views of {HashPowerFutures} that only off-chain callers use
/// @notice An external library (deployed once, linked into the venue) so the venue's runtime fits
///         EIP-170. Its functions are `view` and read the venue's book through storage pointers;
///         the compiler reaches them by `delegatecall`, which costs nothing in an `eth_call`. No
///         on-chain path of the venue calls into it.
library FuturesBookLib {
    using StructuredLinkedList for StructuredLinkedList.List;

    /// @notice Simulate a limit order for `_sender`: filled qty, VWAP, and remainder. Skips the
    ///         sender's own resting liquidity, as the on-match self-trade prevention nets it out.
    function simulateOrder(
        mapping(uint256 => StructuredLinkedList.List) storage _activeBidPrices,
        mapping(uint256 => StructuredLinkedList.List) storage _activeAskPrices,
        mapping(uint256 => mapping(uint256 => StructuredLinkedList.List)) storage _longQueues,
        mapping(uint256 => mapping(uint256 => StructuredLinkedList.List)) storage _shortQueues,
        mapping(bytes32 => HashPowerFuturesBase.Order) storage _orders,
        address _sender,
        uint256 _expirationAt,
        uint256 _price,
        int256 _quantity
    ) external view returns (int256 filledQuantity, uint256 averageFillPrice, int256 remainingQuantity) {
        if (_quantity == 0) return (0, 0, 0);

        bool isBuy = _quantity > 0;
        int256 remaining = _quantity;
        uint256 totalNotional = 0;
        uint256 totalFilledAbs = 0;
        StructuredLinkedList.List storage oppositePrices =
            isBuy ? _activeAskPrices[_expirationAt] : _activeBidPrices[_expirationAt];
        (, uint256 currentPrice) = oppositePrices.getNextNode(0);

        while (currentPrice != 0 && remaining != 0) {
            if (isBuy && currentPrice > _price) break;
            if (!isBuy && currentPrice < _price) break;

            // The maker side is the opposite of the taker's.
            StructuredLinkedList.List storage orderQueue =
                isBuy ? _shortQueues[_expirationAt][currentPrice] : _longQueues[_expirationAt][currentPrice];
            (, uint256 orderIdUint) = orderQueue.getNextNode(0);

            while (orderIdUint != 0 && remaining != 0) {
                HashPowerFuturesBase.Order storage makerOrder = _orders[bytes32(orderIdUint)];
                if (makerOrder.quantity != 0) {
                    uint256 amt = M.min(M.abs(makerOrder.quantity), M.abs(remaining));
                    if (makerOrder.participant != _sender) {
                        // A fill.
                        totalNotional += currentPrice * amt;
                        totalFilledAbs += amt;
                    }
                    // Own resting size nets out instead of filling: either way `amt` leaves the taker.
                    remaining -= M.toSigned(isBuy, amt);
                }
                (, orderIdUint) = orderQueue.getNextNode(orderIdUint);
            }

            (, currentPrice) = oppositePrices.getNextNode(currentPrice);
        }

        remainingQuantity = remaining;
        filledQuantity = _quantity - remainingQuantity;
        if (totalFilledAbs > 0) {
            averageFillPrice = totalNotional / totalFilledAbs;
        }
    }

    /// @notice Sum of resting abs quantity in one FIFO queue (one (expiry, price, side)).
    function quantityInQueue(
        StructuredLinkedList.List storage _queue,
        mapping(bytes32 => HashPowerFuturesBase.Order) storage _orders
    ) external view returns (uint256 total) {
        uint256 size = _queue.sizeOf();
        if (size == 0) return 0;
        (, uint256 nodeId) = _queue.getNextNode(0);
        for (uint256 i = 0; i < size && nodeId != 0; i++) {
            total += M.abs(_orders[bytes32(nodeId)].quantity);
            (, nodeId) = _queue.getNextNode(nodeId);
        }
    }
}
