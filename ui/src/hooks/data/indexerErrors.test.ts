import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (fn: unknown) => fn,
}));

const loadModule = async () => {
  vi.resetModules();
  const mod = await import("./indexerErrors");
  const toastShown = () => mod.useIndexerOutageToast().toasts.length > 0;
  return { ...mod, toastShown };
};

describe("indexer outage grace period", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not show the toast when a request succeeds within the grace period", async () => {
    const { reportIndexerFailure, reportIndexerSuccess, toastShown } = await loadModule();
    reportIndexerFailure();
    vi.advanceTimersByTime(5_000);
    reportIndexerSuccess();
    vi.advanceTimersByTime(60_000);
    expect(toastShown()).toBe(false);
  });

  it("shows the toast once the outage lasts the full grace period", async () => {
    const { reportIndexerFailure, toastShown } = await loadModule();
    reportIndexerFailure();
    vi.advanceTimersByTime(14_999);
    expect(toastShown()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toastShown()).toBe(true);
  });

  it("does not restart the timer on repeated failures", async () => {
    const { reportIndexerFailure, toastShown } = await loadModule();
    reportIndexerFailure();
    vi.advanceTimersByTime(10_000);
    reportIndexerFailure();
    vi.advanceTimersByTime(5_000);
    expect(toastShown()).toBe(true);
  });
});
