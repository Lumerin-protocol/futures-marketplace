# Futures.sol Security Audit Report

**Auditor:** Independent Security Review  
**Date:** January 20, 2026  
**Contract:** Futures.sol v1.2.0  
**Solidity Version:** ^0.8.20  
**Commit:** Current working version  
**Revision:** Re-audit after initial fixes

---

## Executive Summary

This audit report covers the `Futures.sol` smart contract, a hashrate futures trading platform built on ERC20 with UUPS upgradeability. The contract enables participants to trade futures contracts for hashrate delivery, with margin requirements, order matching, position management, and cash settlement functionality.

**Overall Risk Assessment:** MEDIUM

The contract has been updated to v1.2.0, fixing 5 of the originally identified issues. Remaining issues primarily relate to oracle validation, gas optimization, and operational concerns. High-severity issues remain related to potential DoS in margin calls and reserve pool solvency.

---

## Findings Summary

| ID   | Severity      | Title                                                               | Status       |
| ---- | ------------- | ------------------------------------------------------------------- | ------------ |
| F-01 | Low           | Division by Zero in `_getMarketPrice` When Oracle Returns Zero      | Open         |
| F-02 | Low           | Unbounded Loops in `marginCall` Can Cause DoS                       | Open         |
| F-03 | High          | Missing Stale Oracle Data Validation                                | Open         |
| F-04 | Medium        | Reserve Pool Insolvency Risk During Mass Liquidations               | Acknowledged |
| F-05 | Medium        | `depositDeliveryPayment(uint256, uint256)` Missing Buyer Validation | **Fixed**    |
| F-06 | Medium        | Silent Failure in Self-Matching Prevention                          | **Fixed**    |
| F-07 | Informational | Precision Loss in Cash Settlement Calculations                      | Acknowledged |
| F-08 | Medium        | `withdrawCollectedFees` Doesn't Burn Wrapped Tokens                 | **Fixed**    |
| F-09 | Informational | Missing Zero Address Validation in Admin Functions                  | Acknowledged |
| F-10 | Low           | Missing Event for Liquidation Actions                               | Open         |
| F-11 | Low           | Order Fee Can Be Set to Zero Bypassing Fee Collection               | Open         |
| F-12 | Low           | `getMinMargin` Unbounded Loop Gas Concerns                          | Open         |
| F-13 | Low           | Missing Pausability Mechanism                                       | Open         |
| F-14 | Low           | Outdated Orders Not Cleaned in Position Matching                    | Open         |
| F-15 | Informational | Centralization Risks                                                | Open         |
| F-16 | Informational | Inconsistent Error Handling Patterns                                | **Fixed**    |
| F-17 | Informational | Unused Return Value in `_forceLiquidatePosition`                    | **Fixed**    |
| F-18 | Informational | Magic Numbers in Code                                               | Open         |

---

## Detailed Findings

### F-01: Division by Zero in `_getMarketPrice` When Oracle Returns Zero

**Severity:** Low (Downgraded from Critical)

**Location:** Lines 757-759

```solidity
function _getMarketPrice(uint256 _hashesForToken) private view returns (uint256) {
    return _roundToNearest(SECONDS_PER_DAY * speedHps / _hashesForToken, minimumPriceIncrement);
}
```

**Description:**  
If `hashrateOracle.getHashesforToken()` returns 0 (due to oracle malfunction, manipulation, or uninitialized state), the `_getMarketPrice` function will cause a division by zero panic.

**Impact:**  
The practical impact is limited since a dysfunctional oracle (returning 0) would break the contract regardless of error handling. The difference is only in error messaging:

- Current: Generic panic (division by zero)
- With validation: Descriptive revert message

**Recommendation (Optional - Quality of Life improvement):**  
Adding explicit validation would provide better error messages for debugging:

```solidity
function _getHashesForToken() private view returns (uint256) {
    uint256 hashesForToken = hashrateOracle.getHashesforToken();
    require(hashesForToken > 0, "Invalid oracle data");
    return hashesForToken;
}
```

This is a UX/debugging improvement rather than a security fix.

---

### F-02: Unbounded Loops in `marginCall` Can Cause DoS

**Severity:** Low (Downgraded from High)

**Location:** Lines 551-599

```solidity
function marginCall(address _participant) external onlyValidator {
    // ...
    EnumerableSet.Bytes32Set storage _orders = participantOrderIdsIndex[_participant];
    for (; _orders.length() > 0;) {
        // Process all orders
    }

    EnumerableSet.Bytes32Set storage _positions = participantPositionIdsIndex[_participant];
    for (; _positions.length() > 0;) {
        // Process all positions
    }
}
```

**Description:**  
The `marginCall` function iterates through all orders and positions of a participant.

**Mitigating Factor:**  
Orders are bounded by `MAX_ORDERS_PER_PARTICIPANT = 100`, which fits within transaction gas limits. Positions are derived from matched orders and are also practically bounded.

**Impact:**  
Gas costs for liquidating users with many orders/positions will be higher, but should remain within block limits.

**Recommendation (Optional):**  
Consider adding explicit position limits for consistency, or document the expected gas costs for worst-case liquidation scenarios.

---

### F-03: Missing Stale Oracle Data Validation

**Severity:** High

**Location:** Line 922

```solidity
function _getHashesForToken() private view returns (uint256) {
    return hashrateOracle.getHashesforToken();
}
```

**Description:**  
The contract calls `getHashesforToken()` without checking if the data is stale. The oracle has a V2 function `getHashesForTokenV2()` that returns both value and `updatedAt` timestamp, but this is not used. Stale oracle data could lead to incorrect price calculations and unfair liquidations.

**Impact:**

- Users could be liquidated based on outdated prices
- Traders could exploit stale prices for profit
- Settlement calculations could be incorrect

**Recommendation:**  
Use the V2 oracle function and implement staleness checks:

```solidity
function _getHashesForToken() private view returns (uint256) {
    (uint256 value, uint256 updatedAt) = hashrateOracle.getHashesForTokenV2();
    require(block.timestamp - updatedAt < MAX_ORACLE_STALENESS, "Stale oracle data");
    require(value > 0, "Invalid oracle data");
    return value;
}
```

---

### F-04: Reserve Pool Insolvency Risk During Mass Liquidations

**Severity:** Medium (Downgraded from High)

**Status:** ✅ **Acknowledged - Operational Risk**

**Location:** Lines 957-974, 983-989

**Description:**  
The reserve pool (`reservePoolBalance`) is used to pay out profits when positions are exited or cash settled. In extreme market conditions with many simultaneous profitable exits, the reserve pool could be insufficient.

**Mitigating Factor:**  
This is an operational risk managed by ensuring the reserve pool is adequately funded. The contract owner is responsible for maintaining sufficient reserves to accommodate extreme market scenarios.

**Operational Recommendation:**

- Monitor reserve pool levels relative to open position exposure
- Maintain reserve pool buffer for worst-case scenarios
- Consider off-chain alerts for low reserve pool conditions

---

### F-05: `depositDeliveryPayment(uint256, uint256)` Missing Buyer Validation

**Severity:** Medium

**Status:** ✅ **FIXED** in v1.2.0

**Location:** Previously Lines 824-848

**Description:**  
Unlike the overloaded `depositDeliveryPayment(bytes32[])` function which validates the caller is the buyer and checks for destURL, this version didn't perform these validations upfront.

**Resolution:**  
The problematic `depositDeliveryPayment(uint256, uint256)` function was removed entirely. A new `depositDeliveryPaymentV2(bytes32)` function was introduced (lines 816-834) with proper validation:

```solidity
function depositDeliveryPaymentV2(bytes32 positionId) public {
    Position storage position = positions[positionId];
    if (position.deliveryAt <= block.timestamp) {
        revert DeliveryDateExpired();
    }
    if (position.buyer != _msgSender()) {
        revert OnlyPositionBuyer();
    }
    if (position.paid) {
        revert PositionAlreadyPaid();
    }
    if (bytes(position.destURL).length == 0) {
        revert PositionDestURLNotSet();
    }
    // ...
}
```

The old `depositDeliveryPayment(bytes32[])` now delegates to `depositDeliveryPaymentV2` and is marked as deprecated.

---

### F-06: Silent Failure in Self-Matching Prevention

**Severity:** Medium

**Status:** ✅ **FIXED** in v1.2.0

**Location:** Previously Lines 319-331

**Description:**  
When a participant tried to match their own order, the function silently returned without creating a position or emitting any event.

**Resolution:**  
The self-matching logic has been reworked. The problematic code has been removed (now commented out at lines 322-324 with "should never happen" note). Self-matching is now properly prevented earlier in `_createOrMatchSingleOrder` (lines 273-280) where if a participant has an opposite order at the same price, their existing order is closed instead of creating a self-match:

```solidity
// Check if there are no matching orders by the same participant, ignoring their ordering
if (participantPriceOrderIds.length() > 0) {
    bytes32 orderId = participantPriceOrderIds.at(0);
    Order memory order = orders[orderId];
    if (order.isBuy != _isBuy) {
        _closeOrder(orderId, order);  // Close existing opposite order
        return false;  // No fee charged for offset
    }
}
```

This approach properly handles the offset case and returns `false` so no order fee is charged.

---

### F-07: Precision Loss in Cash Settlement Calculations

**Severity:** Informational (Downgraded from Medium)

**Status:** ✅ **Acknowledged - By Design**

**Location:** Lines 666-714

```solidity
uint256 buyerPaysToSeller =
    position.buyPricePerDay * deliveryDurationDays * positionElapsedTime / deliveryDurationSeconds();
```

**Description:**  
Cash settlement calculations involve integer division which can lead to minor precision loss.

**Mitigating Factor:**  
The calculations correctly follow the best practice pattern: all multiplications are performed first, with a single division at the end. This minimizes precision loss to the unavoidable remainder of the final division.

**Impact:**  
Minimal - only the remainder of the final division (< 1 unit) may be lost, which is standard and acceptable for integer arithmetic.

---

### F-08: `withdrawCollectedFees` Doesn't Burn Wrapped Tokens

**Severity:** Medium

**Status:** ✅ **FIXED** in v1.2.0

**Location:** Lines 976-981

**Description:**  
When fees were collected via `_payOrderFee`, the tokens were transferred to the contract. When the owner withdrew fees, wrapped tokens were transferred but never burned.

**Resolution:**  
The function now properly burns wrapped tokens and transfers underlying assets to the owner:

```solidity
function withdrawCollectedFees() external onlyOwner {
    uint256 amount = collectedFeesBalance;
    collectedFeesBalance = 0;
    _burn(address(this), amount);
    token.safeTransfer(owner(), amount);
}
```

This is now consistent with the `withdrawReservePool` pattern.

---

### F-09: Missing Zero Address Validation in Admin Functions

**Severity:** Informational (Downgraded from Medium)

**Status:** ✅ **Acknowledged - By Design**

**Location:** Multiple setter functions

```solidity
function setOracle(address addr) external onlyOwner {
    hashrateOracle = HashrateOracle(addr);
}

function setValidatorAddress(address _validatorAddress) external onlyOwner {
    validatorAddress = _validatorAddress;
}
```

**Description:**  
Administrative functions that set critical addresses don't validate against the zero address.

**Mitigating Factor:**  
These are owner-only functions. The contract owner is trusted and responsible for setting correct values. Misconfiguration is an operational concern, not a code vulnerability.

**Impact:**  
None if operated correctly. Owner must ensure proper values are set.

---

### F-10: Missing Event for Liquidation Actions

**Severity:** Low

**Location:** Lines 558-606

**Description:**  
The `marginCall` function closes orders and positions but doesn't emit a specific event indicating a liquidation occurred. While `OrderClosed` and `PositionClosed` events are emitted, there's no way to distinguish between voluntary closures and forced liquidations from on-chain data.

**Impact:**

- Difficult to track liquidations off-chain
- Reduced transparency for monitoring systems
- Harder to audit liquidation behavior

**Recommendation:**  
Add a dedicated liquidation event:

```solidity
event Liquidation(address indexed participant, bytes32[] ordersClosed, bytes32[] positionsClosed);
```

---

### F-11: Order Fee Can Be Set to Zero Bypassing Fee Collection

**Severity:** Low

**Location:** Lines 477-480

```solidity
function setOrderFee(uint256 _orderFee) external onlyOwner {
    orderFee = _orderFee;
    emit OrderFeeUpdated(_orderFee);
}
```

**Description:**  
The order fee can be set to zero, which would effectively disable fee collection. Combined with 100% fee discounts, this creates potential for fee-free trading.

**Impact:**

- Loss of protocol revenue if misconfigured
- Potential for preferred users to trade without fees

**Recommendation:**  
Consider adding minimum fee validation if fee collection is required for protocol sustainability.

---

### F-12: `getMinMargin` Unbounded Loop Gas Concerns

**Severity:** Low

**Location:** Lines 517-549

```solidity
function getMinMargin(address _participant) public view returns (int256) {
    // ...
    for (uint256 i = 0; i < _orders.length(); i++) {
        // ...
    }
    for (uint256 i = 0; i < _positions.length(); i++) {
        // ...
    }
}
```

**Description:**  
This view function iterates through all orders and positions. While view functions don't consume gas for direct calls, they're called within state-changing functions (`marginCall`, `ensureNoCollateralDeficit`), making those transactions expensive.

**Impact:**

- High gas costs for users with many orders/positions
- Potential DoS if gas exceeds limits
- Affects `createOrder`, `removeMargin`, and other critical functions

**Recommendation:**

1. Consider caching margin calculations
2. Limit the number of active orders/positions
3. Optimize by pre-aggregating margin requirements

---

### F-13: Missing Pausability Mechanism

**Severity:** Low

**Location:** Contract-wide

**Description:**  
The contract lacks a pause mechanism for emergencies. In case of critical bugs, oracle failures, or other emergencies, there's no way to halt trading and settlements.

**Impact:**

- Unable to stop contract during emergencies
- Potential for increased losses during exploits
- No graceful degradation option

**Recommendation:**  
Implement OpenZeppelin's `PausableUpgradeable`:

```solidity
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

function pause() external onlyOwner {
    _pause();
}

function unpause() external onlyOwner {
    _unpause();
}
```

---

### F-14: Outdated Orders Not Cleaned in Position Matching

**Severity:** Low

**Location:** Lines 285-290

```solidity
(, uint256 oppositeOrderIdUint) = oppositeOrderIndexId.getNextNode(0);
bytes32 oppositeOrderId = bytes32(oppositeOrderIdUint);
Order memory oppositeOrder = orders[oppositeOrderId];
```

**Description:**  
When matching orders, the function retrieves the first order from the queue without checking if it's outdated. While `removeOutdatedOrdersForParticipant` is called at the start of `createOrder`, outdated orders from other participants in the matching queue aren't cleaned.

**Impact:**

- Matching could fail silently with outdated orders
- Stale orders pollute the order book
- Increased gas costs due to processing invalid orders

**Recommendation:**  
Add validation when retrieving matching orders or implement periodic cleanup.

---

### F-15: Centralization Risks

**Severity:** Informational

**Location:** Various admin functions

**Description:**  
The contract has significant centralization in the owner role:

- Can upgrade the contract (UUPS)
- Can change the validator
- Can modify the oracle
- Can withdraw reserve pool funds
- Can set fee discounts

**Impact:**

- Single point of failure
- Trust assumptions on owner
- Potential for rug pull scenarios

**Recommendation:**

1. Implement timelocks for critical changes
2. Consider multi-sig ownership
3. Limit owner powers where possible
4. Add governance for key parameters

---

### F-16: Inconsistent Error Handling Patterns

**Severity:** Informational

**Status:** ✅ **FIXED** in v1.2.0

**Location:** Previously various functions

**Description:**  
Some functions returned boolean success/failure while others reverted.

**Resolution:**  
The problematic `depositDeliveryPayment(uint256, uint256)` function that returned `bool` has been removed. The new `depositDeliveryPaymentV2(bytes32)` function consistently reverts on failure, aligning with the modern Solidity pattern. The deprecated `depositDeliveryPayment(bytes32[])` now delegates to the new function and inherits its revert behavior.

---

### F-17: Unused Return Value in `_forceLiquidatePosition`

**Severity:** Informational

**Status:** ✅ **FIXED** in v1.2.0

**Location:** Lines 725-742

**Description:**  
The function signature previously indicated it returned an `int256`, but it always returned 0 and the value was never used.

**Resolution:**  
The return type has been removed from the function signature:

```solidity
function _forceLiquidatePosition(bytes32 _positionId, Position storage position, address _participant) private {
    // ...
}
```

---

### F-18: Magic Numbers in Code

**Severity:** Informational

**Location:** Various

**Description:**  
Several magic numbers are used throughout the code without named constants:

- `100` for percentage calculations
- Various timeframe calculations

**Impact:**

- Reduced readability
- Potential for errors in maintenance

**Recommendation:**  
Define named constants for all magic numbers.

---

## Gas Optimizations

### G-01: Repeated Storage Reads

Multiple functions read the same storage variables multiple times. Consider caching in memory.

### G-02: Unnecessary Storage in Struct

The `Order.destURL` and `Position.destURL` strings are stored in full. Consider using IPFS hashes or shorter identifiers.

### G-03: EnumerableSet Overhead

EnumerableSet has higher gas costs than mappings. Consider if all functionality is needed.

---

## Recommendations Summary

1. **Immediate Actions:**

   - Add oracle staleness validation (F-03)
   - Implement pause functionality (F-13)
   - Add zero address checks for admin functions (F-09)

2. **Short-term Actions:**

   - Add liquidation events (F-10)

3. **Long-term Actions:**
   - Implement governance/timelock
   - Add circuit breakers for extreme conditions
   - Consider reserve pool insurance mechanisms

---

## Disclaimer

This audit is not a guarantee of security. The findings represent potential issues identified during the review period. The absence of findings does not indicate the absence of vulnerabilities. Additional testing, formal verification, and ongoing monitoring are recommended.
