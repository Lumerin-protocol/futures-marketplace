/**
 * What the account looks like once an order has *filled*, for the confirmation
 * preview. `orderMargin.snapshotWithChanges` models an order as resting, which
 * is the right question for the margin gate; the questions a trader asks before
 * confirming — "what will my position be?", "where does that put my liquidation
 * price?" — are about the fill, so this applies the leg to the position instead.
 *
 * Fills are assumed at the leg's limit price. Realised PnL from a reducing fill
 * is credited to balance the way the venues do on close, so a liquidation level
 * solved off the result accounts for it.
 */

import type { AccountSnapshot, MMParams } from "@hashpower/portfolio-margin";
import type { OrderLeg } from "./orderMargin";

const abs = (value: bigint): bigint => (value < 0n ? -value : value);
const sign = (value: bigint): bigint => (value < 0n ? -1n : value > 0n ? 1n : 0n);

/** Signed net size of the venue's position the leg lands on, in the leg's units. */
export function positionBefore(
  snapshot: AccountSnapshot,
  leg: Pick<OrderLeg, "venue">,
  expirationAt?: bigint,
): bigint {
  if (leg.venue === "perps") return snapshot.perp.netQty;
  return (
    snapshot.futures.positions.find((position) => position.expirationAt === expirationAt)
      ?.netQuantity ?? 0n
  );
}

/**
 * Realised PnL (token decimals) from closing `closed` units of a position with
 * `net` units at average entry `avgEntry`, filled at `price`.
 *
 * `scale` takes the venue's quantity units to whole contracts.
 */
function realised(net: bigint, avgEntry: bigint, closed: bigint, price: bigint, scale: bigint): bigint {
  const perContract = net > 0n ? price - avgEntry : avgEntry - price;
  return (perContract * closed) / scale;
}

/**
 * The snapshot once `leg` has filled in full at its limit price.
 *
 * Three cases, decided by the sign of the leg against the position:
 * - adding (same side, or from flat): size grows, entry is the size-weighted
 *   average of old entry and fill price;
 * - reducing (opposite side, not past flat): size shrinks, entry is unchanged,
 *   the closed part's PnL is realised into balance;
 * - flipping (opposite side, past flat): the whole position is closed and
 *   realised, and what remains of the leg opens a new one at the fill price.
 *
 * `expirationAt` is required for futures legs; perps ignore it.
 */
export function snapshotWithFill(
  snapshot: AccountSnapshot,
  params: MMParams,
  leg: OrderLeg,
  expirationAt?: bigint,
): AccountSnapshot {
  if (leg.quantity === 0n) return snapshot;

  if (leg.venue === "perps") {
    const scale = 10n ** BigInt(params.perpQuantityDecimals);
    const { netQty, entryPrice } = snapshot.perp;
    const after = netQty + leg.quantity;

    let balance = snapshot.balance;
    let entry: bigint;
    if (netQty === 0n || sign(netQty) === sign(leg.quantity)) {
      entry = (abs(netQty) * entryPrice + abs(leg.quantity) * leg.price) / (abs(netQty) + abs(leg.quantity));
    } else if (abs(leg.quantity) <= abs(netQty)) {
      balance += realised(netQty, entryPrice, abs(leg.quantity), leg.price, scale);
      entry = after === 0n ? 0n : entryPrice;
    } else {
      balance += realised(netQty, entryPrice, abs(netQty), leg.price, scale);
      entry = leg.price;
    }

    return {
      ...snapshot,
      balance,
      perp: { ...snapshot.perp, netQty: after, entryPrice: entry },
    };
  }

  if (expirationAt === undefined) return snapshot;
  const positions = snapshot.futures.positions;
  const index = positions.findIndex((position) => position.expirationAt === expirationAt);
  const current = index >= 0 ? positions[index] : undefined;
  const net = current?.netQuantity ?? 0n;
  const after = net + leg.quantity;

  let balance = snapshot.balance;
  let netEntryValue: bigint;
  if (current === undefined || net === 0n || sign(net) === sign(leg.quantity)) {
    netEntryValue = (current?.netEntryValue ?? 0n) + leg.price * leg.quantity;
  } else {
    // `netEntryValue / netQuantity` is the signed average entry.
    const avgEntry = current.netEntryValue / net;
    if (abs(leg.quantity) <= abs(net)) {
      balance += realised(net, avgEntry, abs(leg.quantity), leg.price, 1n);
      // The remainder keeps its average entry.
      netEntryValue = after === 0n ? 0n : avgEntry * after;
    } else {
      balance += realised(net, avgEntry, abs(net), leg.price, 1n);
      netEntryValue = leg.price * after;
    }
  }

  const rest = positions.filter((position) => position.expirationAt !== expirationAt);
  const nextPositions =
    after === 0n
      ? rest
      : [
          ...rest,
          {
            expirationAt,
            netQuantity: after,
            netEntryValue,
            // The leg trades on a live expiry, so it cannot carry a pinned price.
            settlementPrice: current?.settlementPrice ?? 0n,
          },
        ];

  return {
    ...snapshot,
    balance,
    futures: { ...snapshot.futures, positions: nextPositions },
  };
}
