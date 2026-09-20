import { describe, expect, it } from "vitest";
import { commonSlices } from "./common";
import * as futures from "./futures";
import { oracleOverlaySlices } from "./oracles";
import * as perps from "./perps";
import { buildDocument, type QueryGroup, type Slice } from "./slice";

/**
 * The audit.
 *
 * The inventory below is checked against the slice files, so adding, removing or
 * regrouping a query fails here until the table is updated. That is the point:
 * the diff on this file is the record of what the app asks the indexer for and
 * how often, in a form that can be read without opening the query files.
 */

type Row = [alias: string, group: QueryGroup];

const FUTURES_INVENTORY: Row[] = [
  ["specs", "constants"],
  ["book", "market"],
  ["recentTrades", "market"],
  ["myOrders", "account"],
  ["positions", "account"],
  ["exposure", "account"],
  ["liquidations", "account"],
  ["me", "account"],
  ["realizedBaseline", "account"],
  ["historyOrders", "history"],
  ["historyPositions", "history"],
  ["historyTrades", "history"],
  ["sessionTrades", "history"],
];

const PERPS_INVENTORY: Row[] = [
  ["collection", "constants"],
  ["book", "market"],
  ["recentTrades", "market"],
  ["funding", "market"],
  ["myOrders", "account"],
  ["sessions", "account"],
  ["liquidations", "account"],
  ["me", "account"],
  ["realizedBaseline", "account"],
  ["historyOrders", "history"],
  ["historyPositions", "history"],
  ["sessionTrades", "history"],
  ["historyTrades", "history"],
];

/**
 * The oracle overlay: the bar in progress on each index chart.
 *
 * Two entries per series because the 1D range buckets raw ticks while 5D and 1M
 * bucket the indexer's hourly aggregations.
 */
const ORACLE_OVERLAY_INVENTORY: Row[] = [
  ["hashpriceUsds", "market"],
  ["btcUsds", "market"],
  ["networkHashrate7Ds", "market"],
  ["hashpriceUsdCandles", "market"],
  ["btcUsdCandles", "market"],
  ["networkHashrate7DCandles", "market"],
];

const inventoryOf = (slices: Record<string, Slice>): Row[] =>
  Object.values(slices).map((slice) => [slice.alias, slice.group]);

describe("the query inventory", () => {
  it("matches what the futures venue declares", () => {
    expect(inventoryOf(futures.futuresSlices)).toEqual(FUTURES_INVENTORY);
  });

  it("matches what the perps venue declares", () => {
    expect(inventoryOf(perps.perpsSlices)).toEqual(PERPS_INVENTORY);
  });

  it("matches what the oracle overlay declares", () => {
    expect(inventoryOf(oracleOverlaySlices)).toEqual(ORACLE_OVERLAY_INVENTORY);
  });

  it("never puts a paginated table on a tick", () => {
    // `history` is the group that must not acquire an interval: these are the
    // "Load More" tables, and polling one refetches every page already scrolled.
    for (const slices of [futures.futuresSlices, perps.perpsSlices]) {
      for (const slice of Object.values(slices)) {
        if (slice.group !== "history") continue;
        expect(slice.field).toMatch(/\$history(First|Skip)|\$sessionIds/);
      }
    }
  });

  it("keys every slice by the name it responds under", () => {
    for (const slices of [futures.futuresSlices, perps.perpsSlices]) {
      for (const [name, slice] of Object.entries(slices)) {
        expect(name).toBe(slice.alias);
        // The alias has to appear in the field, or the response key will not
        // be what the fan-out and the standalone consumers read.
        expect(slice.field).toContain(`${slice.alias}:`);
      }
    }

    // The overlay's slices respond under their own root field name, so they
    // carry no explicit alias and the field opens with the name instead.
    for (const [name, slice] of Object.entries(oracleOverlaySlices)) {
      expect(name).toBe(slice.alias);
      expect(slice.field.trimStart()).toMatch(new RegExp(`^${slice.alias}\\(`));
    }
  });
});

describe("document assembly", () => {
  const documentsOf = (module: Record<string, unknown>) =>
    Object.entries(module).filter(
      (entry): entry is [string, string] =>
        entry[0].endsWith("Query") && typeof entry[1] === "string",
    );

  const allDocuments = [...documentsOf(futures), ...documentsOf(perps)];

  it("builds a document for every exported query", () => {
    expect(allDocuments.length).toBeGreaterThan(20);
  });

  it.each(allDocuments)("%s declares every variable it uses", (_name, document) => {
    // The header holds the declarations, everything after the first brace holds
    // the uses. An undeclared variable is the failure mode of assembling a
    // document from parts, and the server would only tell us at runtime.
    const bodyStart = document.indexOf("{");
    const declared = new Set(
      [...document.slice(0, bodyStart).matchAll(/\$(\w+):/g)].map((m) => m[1]),
    );
    const used = [...document.slice(bodyStart).matchAll(/\$(\w+)/g)].map((m) => m[1]);

    expect(used.length).toBeGreaterThanOrEqual(0);
    for (const variable of used) expect([...declared]).toContain(variable);
  });

  it.each(allDocuments)("%s selects the block it read at", (_name, document) => {
    expect(document).toContain("_meta");
  });

  it("refuses a document with no slices", () => {
    expect(() => buildDocument("Empty", [])).toThrow(/no slices/);
  });

  it("refuses to merge one variable name under two types", () => {
    const a: Slice = { alias: "a", group: "market", vars: { n: "Int!" }, field: "a: x", cacheKey: "" };
    const b: Slice = { alias: "b", group: "market", vars: { n: "BigInt!" }, field: "b: y", cacheKey: "" };
    expect(() => buildDocument("Clash", [a, b])).toThrow(/declared as both/);
  });

  it("merges a variable shared by two slices into one declaration", () => {
    const document = buildDocument("Shared", [
      futures.futuresSlices.positions,
      futures.futuresSlices.exposure,
    ]);
    expect([...document.matchAll(/\$address:/g)]).toHaveLength(1);
  });

  it("reuses the slices that are valid on both venues", () => {
    // Not a copy — the same object, so the two venues cannot drift.
    expect(futures.futuresSlices.recentTrades).toBe(commonSlices.recentTrades);
    expect(perps.perpsSlices.recentTrades).toBe(commonSlices.recentTrades);
    expect(futures.futuresSlices.realizedBaseline).toBe(commonSlices.realizedBaseline);
    expect(perps.perpsSlices.realizedBaseline).toBe(commonSlices.realizedBaseline);
  });

  it("feeds the batched history page and the single tables the same fields", () => {
    // The reason slices exist: these used to be four hand-written copies of the
    // same three filters, and the mappers read whichever arrived.
    for (const slice of [
      futures.futuresSlices.historyOrders,
      futures.futuresSlices.historyPositions,
      futures.futuresSlices.historyTrades,
    ]) {
      expect(futures.FuturesHistoryFirstPageQuery).toContain(slice.field);
    }
    expect(futures.HistoricalOrdersQuery).toContain(futures.futuresSlices.historyOrders.field);
    expect(futures.HistoricalPositionsQuery).toContain(
      futures.futuresSlices.historyPositions.field,
    );
    expect(futures.UserFuturesTradesQuery).toContain(futures.futuresSlices.historyTrades.field);
  });
});
