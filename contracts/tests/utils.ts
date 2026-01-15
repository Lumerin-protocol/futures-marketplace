export function quantizePrice(price: bigint, priceLadderStep: bigint) {
  return price - (price % priceLadderStep);
}
