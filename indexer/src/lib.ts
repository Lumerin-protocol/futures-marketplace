/// Signed-i32 helpers used by the per-(user, expirationAt) net-quantity
/// bookkeeping. Quantities in the futures market are integer unit counts.

export function isSameSignI32(a: i32, b: i32): boolean {
  return (a > 0 && b > 0) || (a < 0 && b < 0);
}

export function absI32(a: i32): i32 {
  return a < 0 ? -a : a;
}

export function minI32(a: i32, b: i32): i32 {
  return a < b ? a : b;
}
