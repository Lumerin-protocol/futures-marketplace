# Audit Report: `contracts/contracts/Futures.sol`

Scope: `contracts/contracts/Futures.sol`  
Compiler: `pragma solidity ^0.8.20`  
Methodology: Manual review for correctness, access control, economic safety, and edge cases.

## Summary

The contract contains correctness issues around liquidation flows and matching behavior, plus several edge cases that can lead to unexpected outcomes. The most severe issues are:

- Liquidation flow creates or matches orders on behalf of the counterparty without their consent and without updating their collateral constraints properly.

## Findings

### High

1. **Forced liquidation can create orders for a counterparty without consent and without margin validation**

   - **Where**: `_forceLiquidatePosition`.
   - **Impact**: Counterparty can be forced into an order or match that they did not place, potentially violating their margin constraints or pricing assumptions.
   - **Details**: The counterparty order is created/matched inside liquidation without their approval; `ensureNoCollateralDeficit` is not checked for that counterparty.
   - **Recommendation**: Liquidate by closing the position using explicit settlement logic, not by creating orders for unrelated parties. If orders are created, enforce margin checks for that participant and obtain consent in advance.

2. **Self-matching order logic can lead to silent no-op and inconsistent state**

   - **Where**: `_createPosition` returns early if `order.participant == _otherParticipant`.
   - **Impact**: Order is closed, but no position is created. User may pay fees without getting expected outcome; state and economics are inconsistent.
   - **Details**: The match path closes the opposite order before `_createPosition`, then returns without emitting a clear event.
   - **Recommendation**: Prevent self-matching earlier, or explicitly revert when self-match occurs, or handle it with a deterministic offset strategy.

### Medium

3. **Margin checks can be bypassed in settlement flows**

   - **Where**: `_closeAndCashSettleDelivery` and `_transferPnl` use `_transfer` without `enoughMarginBalance`.
   - **Impact**: Settlement can move balances even if it brings participant below margin requirements.
   - **Recommendation**: Apply margin checks for outgoing transfers or settle with a dedicated accounting mechanism that enforces maintenance requirements.

4. **Outdated orders are only removed on `createOrder` and in `marginCall`**

   - **Where**: `removeOutdatedOrdersForParticipant` is called only in `createOrder`.
   - **Impact**: Stale orders remain in storage, contributing to margin calculations (`getMinMargin`) until removed via other paths.
   - **Recommendation**: Provide a public cleanup that anyone can call for a participant or automatically ignore outdated orders in all relevant calculations.

5. **Price rounding in `_getMarketPrice` can revert on zero hashes**

   - **Where**: `_getMarketPrice`, `_roundToNearest`.
   - **Impact**: Division by zero if oracle returns 0, breaking core functionality.
   - **Recommendation**: Validate oracle output > 0 and revert with a clear error.

6. **`depositDeliveryPayment(uint256 _amount, uint256 _deliveryDate)` returns false without reverting**

- **Where**: `depositDeliveryPayment(uint256,uint256)`.
- **Impact**: Silent failure can mislead callers; partial payments are not accepted, but the function does not enforce full payment.
- **Recommendation**: Revert on insufficient `_amount`, or accept partial payments with accounting per position.

### Low

7. **Fee discount allows 100% discount without restriction**

- **Where**: `setFeeDiscountPercent`.
- **Impact**: Owner can set full discount, potentially intended but should be explicit in docs.
- **Recommendation**: Document expected ranges or add governance constraints.

8. **`createOrder` loop can consume large gas for high absolute qty**

- **Where**: `for (uint8 i = 0; i < abs8(_qty); i++)`.
- **Impact**: `int8` caps at 127, but still may be high in gas. Worse, `abs8(-128)` overflows and returns `uint8(128)`? It returns `uint8(-(-128))` which is undefined behavior in two's complement; in Solidity 0.8 it reverts on overflow for signed negation.
- **Recommendation**: Validate `_qty` bounds explicitly and use `uint8 qty = uint8(_qty > 0 ? _qty : -_qty);` with a check for `_qty == type(int8).min`.

9. **Potential mismatch between `deliveryDurationDays` and `deliveryDurationSeconds` calculations**

- **Where**: `deliveryDurationSeconds`.
- **Impact**: `deliveryDurationDays` is `uint8`; multiplication can overflow in extreme configs (unlikely but possible).
- **Recommendation**: Validate inputs in `initialize` to safe ranges.

### Informational

10. **No explicit reentrancy protection**

- **Where**: `addMargin`, `removeMargin`, settlement flows.
- **Impact**: External token transfers could be reentered if token is malicious. Some functions mint/burn before or after transfer, but not protected.
- **Recommendation**: Consider `ReentrancyGuard` or checks-effects-interactions for external calls.

11. **Order ID and position ID use `nonce++` and `block.timestamp`**

- **Where**: `_createOrder`, `_createPosition`.
- **Impact**: IDs are predictable; likely acceptable but should be documented.
- **Recommendation**: Document that IDs are not secret.

## Additional Notes / Assumptions

- Assumed invariant (per clarification): wrapped token balances are always fully collateralized by deposits, and transfers move claim to underlying collateral.
- The reserve pool accounting uses `reservePoolBalance` and mints wrapped tokens to the contract; redemption flows for these reserves are not enforced.

## Suggested Tests

- Liquidation edge cases where counterparty has insufficient margin.
- Oracle returns zero; verify reverts.
- Self-matching order scenario; ensure deterministic behavior.
- Settlement when reserve pool is insufficient; ensure expected reverts.
