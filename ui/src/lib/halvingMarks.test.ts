import { describe, expect, test } from "vitest";
import { imRequired, type AccountSnapshot, type MMParams } from "@hashpower/portfolio-margin";
import { quoteOrderMargin, type OrderLeg } from "./orderMargin";
import { snapshotWithFill } from "./orderPreview";

/**
 * CF-321: futures values each expiry at its mark range (a date settling after a halving at
 * about half the index), and order entry has to put the same question to the same math.
 * An order on an expiry the account does not trade yet carries that expiry's range.
 */

const PARAMS: MMParams = {
  imSpotShock: 10n ** 17n, // 10%
  mmSpotShock: 5n * 10n ** 16n, // 5%
  tokenDecimals: 6,
  perpQuantityDecimals: 6,
};
const usd = (dollars: bigint) => dollars * 1_000_000n;
const INDEX = usd(40n);
const POST = usd(20n);
const POST_DATE = 1_756_416_000n;

const snapshot: AccountSnapshot = {
  user: "0x1111111111111111111111111111111111111111",
  balance: usd(1_000n),
  accountDebt: 0n,
  index: INDEX,
  perp: {
    netQty: 0n,
    entryPrice: 0n,
    orders: { buyQty: 0n, sellQty: 0n, buyPQ: 0n, buyP2Q: 0n, sellPQ: 0n, sellP2Q: 0n },
    fundingOwed: 0n,
    mark: INDEX,
  },
  futures: { positions: [], orders: [] },
};

/** 10 contracts bid at the post-halving date's mark. */
const bid: OrderLeg = {
  venue: "futures",
  expirationAt: POST_DATE,
  low: POST,
  high: POST,
  price: POST,
  quantity: 10n,
};

describe("CF-321 — order entry values a post-halving date at its marks", () => {
  test("quotes a bid on a post-halving date at the date's low mark", () => {
    const quote = quoteOrderMargin({
      snapshot,
      params: PARAMS,
      markPrice: INDEX,
      changes: { place: [bid] },
    });
    // The venue values the bid at its low mark: 10 × $20 of exposure, IM 10%.
    expect(quote.imAfter).toBe(usd(20n));
  });

  test("a fill on a post-halving date opens a position marked at the date's range", () => {
    const filled = snapshotWithFill(snapshot, PARAMS, bid, POST_DATE);
    // Long 10 at $20 marked at $20: no PnL, 10 × $20 of exposure, IM 10%.
    expect(imRequired(filled, PARAMS, INDEX)).toBe(usd(20n));
  });
});
