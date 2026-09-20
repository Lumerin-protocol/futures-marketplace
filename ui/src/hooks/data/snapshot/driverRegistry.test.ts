import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSnapshotRunner,
  dropInFlightSnapshot,
  hasSnapshotDriver,
  resetSnapshotRegistry,
  runSnapshotOnce,
  setSnapshotRunner,
} from "./driverRegistry";
import { readViaSnapshot, SnapshotUnavailableError } from "./snapshotFed";
import { isRateLimited, subgraphRetryOptions } from "../subgraphRetry";

/** A runner whose completion the test controls, so overlap is deterministic. */
const deferredRunner = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = vi.fn(async () => {
    await gate;
  });
  return { run, release };
};

beforeEach(() => {
  resetSnapshotRegistry();
});

describe("runSnapshotOnce", () => {
  it("coalesces concurrent callers into one request", async () => {
    const { run, release } = deferredRunner();
    setSnapshotRunner("futures", run);

    // Stands in for the cold-load fan-out: the driver plus every fed hook.
    const callers = Array.from({ length: 15 }, () => runSnapshotOnce("futures"));
    release();
    await Promise.all(callers);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps venues independent", async () => {
    const futures = vi.fn(async () => {});
    const perps = vi.fn(async () => {});
    setSnapshotRunner("futures", futures);
    setSnapshotRunner("perpetual", perps);

    await Promise.all([runSnapshotOnce("futures"), runSnapshotOnce("perpetual")]);

    expect(futures).toHaveBeenCalledTimes(1);
    expect(perps).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh request once the previous one has settled", async () => {
    const run = vi.fn(async () => {});
    setSnapshotRunner("futures", run);

    await runSnapshotOnce("futures");
    await runSnapshotOnce("futures");

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("returns null when no driver is mounted", () => {
    expect(runSnapshotOnce("futures")).toBeNull();
    expect(hasSnapshotDriver("futures")).toBe(false);
  });

  it("stops serving a driver that has unmounted", async () => {
    const run = vi.fn(async () => {});
    setSnapshotRunner("futures", run);
    clearSnapshotRunner("futures");

    expect(runSnapshotOnce("futures")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("survives StrictMode's remount sequence", async () => {
    const run = vi.fn(async () => {});
    // What React does in development: render, effect setup, cleanup, setup again.
    // Registering only in render would leave the venue driverless after the
    // cleanup, sending every fed hook down the fallback path.
    setSnapshotRunner("futures", run); // render
    setSnapshotRunner("futures", run); // effect setup
    clearSnapshotRunner("futures"); // StrictMode cleanup
    setSnapshotRunner("futures", run); // effect setup again

    expect(hasSnapshotDriver("futures")).toBe(true);
    await runSnapshotOnce("futures");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not let a later caller join a dropped in-flight snapshot", async () => {
    const first = deferredRunner();
    setSnapshotRunner("futures", first.run);

    const stale = runSnapshotOnce("futures");
    dropInFlightSnapshot("futures");

    const fresh = runSnapshotOnce("futures");
    expect(fresh).not.toBe(stale);

    first.release();
    await Promise.all([stale, fresh]);
    expect(first.run).toHaveBeenCalledTimes(2);
  });
});

describe("readViaSnapshot", () => {
  const KEY = ["Entity", "0xabc"];

  it("returns what the snapshot wrote, without fetching for itself", async () => {
    const qc = new QueryClient();
    const fallback = vi.fn(async () => "own fetch");
    setSnapshotRunner("futures", async () => {
      qc.setQueryData(KEY, "from snapshot");
    });

    await expect(readViaSnapshot(qc, "futures", KEY, fallback)).resolves.toBe("from snapshot");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("serves every fed hook from a single snapshot request", async () => {
    const qc = new QueryClient();
    const keys = Array.from({ length: 8 }, (_, i) => ["Entity", i]);
    const run = vi.fn(async () => {
      for (const [index, key] of keys.entries()) qc.setQueryData(key, index);
    });
    setSnapshotRunner("futures", run);

    const fallback = vi.fn(async () => -1);
    const results = await Promise.all(
      keys.map((key) => readViaSnapshot(qc, "futures", key, fallback)),
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("falls back when no driver is mounted", async () => {
    const qc = new QueryClient();
    const fallback = vi.fn(async () => "own fetch");

    await expect(readViaSnapshot(qc, "futures", KEY, fallback)).resolves.toBe("own fetch");
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("does not fetch for itself when the snapshot request fails", async () => {
    const qc = new QueryClient();
    const fallback = vi.fn(async () => "own fetch");
    const rateLimited = { response: { status: 429 } };
    setSnapshotRunner("futures", async () => {
      throw rateLimited;
    });

    // The whole point: a rate-limited snapshot must not turn into one fallback
    // request per fed hook, which is what tripped the limit in the first place.
    const read = readViaSnapshot(qc, "futures", KEY, fallback);
    await expect(read).rejects.toBeInstanceOf(SnapshotUnavailableError);
    await expect(read).rejects.toMatchObject({ reason: rateLimited });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("raises an error the shared retry policy will not retry", async () => {
    const qc = new QueryClient();
    setSnapshotRunner("futures", async () => {
      throw { response: { status: 429 } };
    });

    const error = await readViaSnapshot(qc, "futures", KEY, async () => "own fetch").then(
      () => new Error("the snapshot failure should have propagated"),
      (raised: Error) => raised,
    );

    // Retrying would start another snapshot; the driver's next tick covers this.
    expect(isRateLimited(error)).toBe(false);
    expect(subgraphRetryOptions.retry(0, error)).toBe(false);
  });

  it("falls back when the snapshot omits this entry", async () => {
    const qc = new QueryClient();
    const fallback = vi.fn(async () => "own fetch");
    // Mirrors the deep order book: the snapshot succeeds but deliberately leaves
    // this slice for the hook's own paginating fetcher.
    setSnapshotRunner("futures", async () => {
      qc.setQueryData(["Entity", "other"], "unrelated");
    });

    await expect(readViaSnapshot(qc, "futures", KEY, fallback)).resolves.toBe("own fetch");
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
