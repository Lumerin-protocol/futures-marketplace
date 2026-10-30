/**
 * Order-entry affordability, asked the way the venue's gate answers it.
 *
 * `Futures.createOrder` places the order and only then checks
 * `vault.balanceOf(user) >= portfolioMargin.computePortfolioIM(user)`: the
 * account's *whole* portfolio initial margin, measured with the order already on
 * the book. `@hashpower/portfolio-margin` replicates that requirement — it is the
 * model the keeper runs — so order entry can put the same question to the same
 * math instead of approximating it.
 *
 * The approximation this replaces answered a different question, and always
 * answered it low, which is what let a 100%-of-balance order through the widget
 * and into an `InsufficientMarginBalance` revert. It charged the *maintenance*
 * spot shock where the gate charges the initial one, and it credited the order's
 * signed distance from the mark, where the engine clamps that credit at zero per
 * side — so a bid below the mark priced out cheaper than free.
 */

import {
  imRequired,
  type AccountSnapshot,
  type FuturesRestingOrders,
  type MMParams,
  type RestingOrders,
} from "@hashpower/portfolio-margin";

/** Which venue's book an order sits on. The two scale quantity differently. */
export type OrderVenue = "futures" | "perps";

/**
 * The book an order sits on. Futures keep one book per expiry, and the venue
 * bounds each expiry's fill loss on its own, so a futures order names its expiry.
 */
export type OrderBook = { venue: "perps" } | { venue: "futures"; expirationAt: bigint };

/**
 * One order's margin-relevant identity: which book it sits on, at what limit
 * price, and what signed size.
 *
 * `quantity` is signed (+bid / −ask) in the venue's own units: whole contracts
 * for futures, `10^perpQuantityDecimals` units for perps.
 */
export type OrderLeg = OrderBook & {
  /** Limit price, token decimals. */
  price: bigint;
  quantity: bigint;
};

/**
 * A hypothetical change to the account, evaluated against the same requirement
 * the venues gate on.
 *
 * `place` / `cancel` are the resting book. A modify is a cancel and a place in
 * one transaction, and the venue checks margin once at the end, so both sides
 * have to be applied before the requirement is read.
 */
export interface PortfolioChanges {
  /** Legs joining the book. */
  place?: readonly OrderLeg[];
  /** Legs leaving it. */
  cancel?: readonly OrderLeg[];
  /**
   * Take the perps venue's position to zero. Margin is pooled, so removing a leg
   * is how its own contribution is quoted: the requirement as the account stands,
   * less the requirement without it.
   *
   * One flag rather than a list because the venue nets every fill into a single
   * position.
   */
  closePerps?: boolean;
  /**
   * Futures expiries whose position is taken to zero, by `expirationAt`.
   *
   * Per expiry because that is the granularity the account carries: the venue
   * aggregates one signed `netQuantity` per `(user, expirationAt)`. Note the
   * engine then nets those into a single `netPositionDelta`, so two expiries on
   * opposite sides largely pay for each other and neither can be priced alone.
   */
  closeFutures?: readonly bigint[];
}

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/** Divisor taking a venue's `quantity` to whole contracts. */
function quantityScale(venue: OrderVenue, params: MMParams): bigint {
  return venue === "perps" ? 10n ** BigInt(params.perpQuantityDecimals) : 1n;
}

/**
 * Notional at the leg's own limit price (token decimals) — what both venues
 * charge maker/taker fees on.
 */
export function orderNotional(leg: OrderLeg, params: MMParams): bigint {
  return (abs(leg.quantity) * leg.price) / quantityScale(leg.venue, params);
}

/**
 * `orders` with `leg` applied to its side, `sign` being `1n` to add it and `-1n`
 * to take it off.
 *
 * Both venues keep a side's quantity and its first two price moments, in their
 * own quantity units and unscaled, so this is one piece of arithmetic for either
 * venue — see `RestingOrders`.
 */
function applyLeg<T extends RestingOrders>(orders: T, leg: OrderLeg, sign: bigint): T {
  const qty = sign * abs(leg.quantity);
  const pq = qty * leg.price;
  const p2q = pq * leg.price;
  return leg.quantity > 0n
    ? {
        ...orders,
        buyQty: orders.buyQty + qty,
        buyPQ: orders.buyPQ + pq,
        buyP2Q: orders.buyP2Q + p2q,
      }
    : {
        ...orders,
        sellQty: orders.sellQty + qty,
        sellPQ: orders.sellPQ + pq,
        sellP2Q: orders.sellP2Q + p2q,
      };
}

/**
 * `books` with `leg` applied to its expiry's book, opening the book if needed and
 * dropping it once both sides are empty, as the snapshot reader does.
 */
function applyFuturesLeg(
  books: readonly FuturesRestingOrders[],
  leg: OrderLeg & { venue: "futures" },
  sign: bigint,
): FuturesRestingOrders[] {
  const existing = books.find((book) => book.expirationAt === leg.expirationAt);
  const book = existing ?? {
    expirationAt: leg.expirationAt,
    settlementPrice: 0n,
    buyQty: 0n,
    sellQty: 0n,
    buyPQ: 0n,
    buyP2Q: 0n,
    sellPQ: 0n,
    sellP2Q: 0n,
  };
  const updated = applyLeg(book, leg, sign);
  const rest = books.filter((other) => other !== existing);
  if (updated.buyQty === 0n && updated.sellQty === 0n) return rest;
  return existing ? books.map((other) => (other === existing ? updated : other)) : [...books, updated];
}

/**
 * The snapshot the engine would see once `changes` are applied.
 *
 * A crossing order (market / IOC / FOK) ends up a position rather than a resting
 * order, and this still quotes it safely: alone on its book, the engine's
 * fill-loss bound for it equals its IM unrealized-loss term once filled,
 * `max(0, adverse move × quantity)`, over the same stress delta. Sharing a book
 * with other orders, the bound covers at least the same loss, so the quote errs
 * high. Modelling every order as resting keeps one path through the math.
 */
export function snapshotWithChanges(
  snapshot: AccountSnapshot,
  changes: PortfolioChanges,
): AccountSnapshot {
  let perpOrders = snapshot.perp.orders;
  let futuresOrders = snapshot.futures.orders;

  const apply = (leg: OrderLeg, sign: bigint) => {
    if (leg.quantity === 0n) return;
    if (leg.venue === "perps") perpOrders = applyLeg(perpOrders, leg, sign);
    else futuresOrders = applyFuturesLeg(futuresOrders, leg, sign);
  };

  // Cancels first, so freed capacity is available to the places — the order the
  // contract's `updateOrders` applies them in.
  for (const leg of changes.cancel ?? []) apply(leg, -1n);
  for (const leg of changes.place ?? []) apply(leg, 1n);

  const closed = changes.closeFutures;
  const futuresPositions = closed?.length
    ? snapshot.futures.positions.filter(
        (position) => !closed.some((expirationAt) => expirationAt === position.expirationAt),
      )
    : snapshot.futures.positions;

  return {
    ...snapshot,
    perp: {
      ...snapshot.perp,
      orders: perpOrders,
      // A flat leg has no delta and no unrealized PnL. Funding already owed is
      // a debt rather than an exposure, so closing out does not clear it.
      ...(changes.closePerps ? { netQty: 0n, entryPrice: 0n } : {}),
    },
    futures: { ...snapshot.futures, orders: futuresOrders, positions: futuresPositions },
  };
}

export interface OrderMarginQuote {
  /** Portfolio IM as the account stands — the venue's `maxAllowedIm` ceiling. */
  imBefore: bigint;
  /** Portfolio IM once the changes land. This is the figure the gate reads. */
  imAfter: bigint;
  /**
   * What the changes add to the requirement. Negative when the change relieves
   * margin — a leg that hedges, a cancel, or a position taken flat.
   */
  imIncrease: bigint;
  /** Held back on top of IM. The venue charges the fee on fill, not at placement. */
  reservedFee: bigint;
  /** `balance − imAfter − reservedFee`. Negative means the gate would revert. */
  headroom: bigint;
  affordable: boolean;
}

/**
 * What a set of changes would cost the account, and whether the gate takes them.
 *
 * `imIncrease` is the number to show a user as an order's or a position's
 * margin: `imAfter` alone includes everything they already have on, and the
 * difference is what this one leg accounts for. It can be zero or negative for a
 * leg that hedges exposure elsewhere in the portfolio, which a per-leg estimate
 * cannot express at all.
 */
export function quoteOrderMargin(args: {
  snapshot: AccountSnapshot;
  params: MMParams;
  /** Spot the engine stresses around (token decimals) — the venue's own mark. */
  markPrice: bigint;
  changes: PortfolioChanges;
  /** Worst of maker/taker on the placed notional; see `useMakerTakerFees`. */
  reservedFee?: bigint;
  /**
   * The venue accepts a locally reducing leg below IM so long as portfolio IM
   * does not rise — `createOrder`'s `maxAllowedIm` branch. Only the caller knows
   * whether the leg reduces its venue's own position at that expiry. Batched
   * placement (`createOrders` / `updateOrders`) has no such exception.
   */
  locallyReducing?: boolean;
}): OrderMarginQuote {
  const {
    snapshot,
    params,
    markPrice,
    changes,
    reservedFee = 0n,
    locallyReducing = false,
  } = args;

  const imBefore = imRequired(snapshot, params, markPrice);
  const imAfter = imRequired(snapshotWithChanges(snapshot, changes), params, markPrice);
  const headroom = snapshot.balance - imAfter - reservedFee;

  return {
    imBefore,
    imAfter,
    imIncrease: imAfter - imBefore,
    reservedFee,
    headroom,
    affordable: headroom >= 0n || (locallyReducing && imAfter <= imBefore),
  };
}

/**
 * Termination guard for the size search below. Size stops costing margin only at
 * a zero IM spot shock, which no live engine configures; this keeps a
 * misconfigured read from spinning and is not meant to express a position limit.
 */
const MAX_SEARCH_QUANTITY = 1n << 40n;

/**
 * Largest size the gate would still accept, in the venue's quantity units.
 *
 * The requirement never falls as size grows — the stress leg and the fill-loss
 * bound both rise with it — so the affordable sizes form one interval and a
 * bisection lands exactly on its edge. The search is seeded from the account as
 * it stands, so it reports *funded* capacity only: an account already at or past
 * its IM has none and gets zero. Unwinding from there goes through the gate's
 * other branch, so callers union this with their reduce-only capacity.
 */
export function maxAffordableQuantity(
  args: OrderBook & {
    snapshot: AccountSnapshot;
    params: MMParams;
    /** Limit price, token decimals. */
    price: bigint;
    markPrice: bigint;
    isBuy: boolean;
    /** Fee to hold back for a candidate notional. */
    reserveFee?: (notional: bigint) => bigint;
  },
): bigint {
  const { snapshot, params, price, markPrice, isBuy, reserveFee } = args;
  if (price <= 0n || markPrice <= 0n) return 0n;
  const book: OrderBook =
    args.venue === "perps" ? { venue: "perps" } : { venue: "futures", expirationAt: args.expirationAt };

  const affordable = (quantity: bigint): boolean => {
    const leg: OrderLeg = { ...book, price, quantity: isBuy ? quantity : -quantity };
    const reservedFee = reserveFee ? reserveFee(orderNotional(leg, params)) : 0n;
    return quoteOrderMargin({
      snapshot,
      params,
      markPrice,
      changes: { place: [leg] },
      reservedFee,
    }).affordable;
  };

  if (!affordable(1n)) return 0n;

  let low = 1n;
  let high = 2n;
  while (high <= MAX_SEARCH_QUANTITY && affordable(high)) {
    low = high;
    high *= 2n;
  }
  if (high > MAX_SEARCH_QUANTITY) return low;

  while (high - low > 1n) {
    const mid = low + (high - low) / 2n;
    if (affordable(mid)) low = mid;
    else high = mid;
  }
  return low;
}
