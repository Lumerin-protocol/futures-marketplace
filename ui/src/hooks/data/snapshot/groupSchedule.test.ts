import { beforeEach, describe, expect, it } from "vitest";
import { SNAPSHOT_TICK_MS } from "./config";
import {
  dueGroups,
  expireVenueGroups,
  markRequested,
  onTheSchedule,
  resetGroupSchedule,
} from "./groupSchedule";

const connected = { hasAddress: true, isActiveVenue: true };

describe("which groups a tick asks for", () => {
  beforeEach(() => {
    resetGroupSchedule();
  });

  it("asks for everything on the first tick", () => {
    expect(dueGroups("futures", connected, 1_000)).toEqual(["constants", "account", "market"]);
  });

  it("stops asking for the constants once it has them", () => {
    const groups = dueGroups("futures", connected, 1_000);
    markRequested("futures", groups, 1_000);

    const next = dueGroups("futures", connected, 1_000 + SNAPSHOT_TICK_MS);
    expect(next).not.toContain("constants");
    expect(next).toEqual(["account", "market"]);
  });

  it("asks for nothing again until the interval has passed", () => {
    markRequested("futures", dueGroups("futures", connected, 1_000), 1_000);
    expect(dueGroups("futures", connected, 1_000 + SNAPSHOT_TICK_MS / 2)).toEqual([]);
  });

  it("counts a tick that fires slightly early", () => {
    // The intervals equal the tick, so an exact comparison would drop a request
    // whenever the timer ran a millisecond short and halve the refresh rate.
    markRequested("futures", dueGroups("futures", connected, 1_000), 1_000);
    expect(dueGroups("futures", connected, 1_000 + SNAPSHOT_TICK_MS - 1)).toEqual([
      "account",
      "market",
    ]);
  });

  it("leaves out market data for the venue that is not on screen", () => {
    const groups = dueGroups("perpetual", { hasAddress: true, isActiveVenue: false }, 1_000);
    expect(groups).toEqual(["constants", "account"]);
  });

  it("leaves out the account entirely when no wallet is connected", () => {
    const groups = dueGroups("futures", { hasAddress: false, isActiveVenue: true }, 1_000);
    expect(groups).toEqual(["constants", "market"]);
  });

  it("keeps the two venues on separate schedules", () => {
    markRequested("futures", dueGroups("futures", connected, 1_000), 1_000);
    // Perps has fetched nothing, so it is still due everything.
    expect(dueGroups("perpetual", connected, 1_000)).toEqual(["constants", "account", "market"]);
  });

  it("ignores the intervals when forced", () => {
    markRequested("futures", dueGroups("futures", connected, 1_000), 1_000);
    const forced = dueGroups("futures", { ...connected, force: true }, 1_001);
    // Not the constants: forcing is about ignoring intervals, and they have none.
    expect(forced).toEqual(["account", "market"]);
  });

  it("still leaves out what does not apply when forced", () => {
    // Forcing does not mean asking for things that have no wallet to be scoped
    // to, or a market nobody is looking at.
    const forced = dueGroups(
      "futures",
      { hasAddress: false, isActiveVenue: false, force: true },
      1_000,
    );
    expect(forced).toEqual(["constants"]);
  });

  it("does not hold a failed request to its interval", async () => {
    const groups = dueGroups("futures", connected, 1_000);
    await expect(
      onTheSchedule("futures", groups, 1_000, () => Promise.reject(new Error("rate limited"))),
    ).rejects.toThrow("rate limited");

    // Otherwise a failed first tick would mark the constants as fetched, and
    // they have no interval to come round on — they would never be asked for.
    expect(dueGroups("futures", connected, 1_001)).toEqual(["constants", "account", "market"]);
  });

  it("holds a successful request to its interval", async () => {
    const groups = dueGroups("futures", connected, 1_000);
    await onTheSchedule("futures", groups, 1_000, () => Promise.resolve("rows"));

    expect(dueGroups("futures", connected, 1_001)).toEqual([]);
  });

  it("makes everything due again after a transaction, short of the constants", () => {
    markRequested("futures", dueGroups("futures", connected, 1_000), 1_000);
    expireVenueGroups("futures");

    // A transaction cannot have changed the tick size or the fee schedule.
    expect(dueGroups("futures", connected, 1_001)).toEqual(["account", "market"]);
  });

  it("expires one venue without touching the other", () => {
    markRequested("futures", dueGroups("futures", connected, 1_000), 1_000);
    markRequested("perpetual", dueGroups("perpetual", connected, 1_000), 1_000);

    expireVenueGroups("futures");

    expect(dueGroups("futures", connected, 1_001)).toEqual(["account", "market"]);
    expect(dueGroups("perpetual", connected, 1_001)).toEqual([]);
  });
});
