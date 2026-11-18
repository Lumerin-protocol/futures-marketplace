import { beforeEach, describe, expect, it, vi } from "vitest";

const { graphqlRequest } = vi.hoisted(() => ({ graphqlRequest: vi.fn() }));
vi.mock("../graphql", () => ({ graphqlRequest }));

const { FEES_PAGE_SIZE, totalWindowFees } = await import("./windowFees");

const SCOPE = { address: "0xd916bd29e2adb2c3c6b60fba82057454bc92f26a", cutoff: 1_790_000_000 };

/** `count` rows paying `fee` each, with ids that sort in page order from `from`. */
const rows = (count: number, fee: string, from = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `0x${(from + i).toString(16).padStart(8, "0")}`,
    tradingFee: fee,
    liquidationFee: null,
  }));

beforeEach(() => {
  graphqlRequest.mockReset();
});

describe("totalWindowFees", () => {
  it("sums a short first page without another request", async () => {
    await expect(totalWindowFees(rows(3, "100"), SCOPE)).resolves.toBe(300n);
    expect(graphqlRequest).not.toHaveBeenCalled();
  });

  it("counts liquidation fees alongside trading fees", async () => {
    const page = [
      { id: "0x01", tradingFee: "0", liquidationFee: "20000000" },
      { id: "0x02", tradingFee: "480200", liquidationFee: null },
    ];
    await expect(totalWindowFees(page, SCOPE)).resolves.toBe(20480200n);
  });

  it("pages past a full page from its last id until a short one", async () => {
    const first = rows(FEES_PAGE_SIZE, "1");
    const second = rows(FEES_PAGE_SIZE, "2", FEES_PAGE_SIZE);
    graphqlRequest
      .mockResolvedValueOnce({ feesInWindow: second })
      .mockResolvedValueOnce({ feesInWindow: rows(5, "3", 2 * FEES_PAGE_SIZE) });

    await expect(totalWindowFees(first, SCOPE)).resolves.toBe(BigInt(FEES_PAGE_SIZE * 3 + 15));
    expect(graphqlRequest).toHaveBeenCalledTimes(2);
    expect(graphqlRequest.mock.calls[0][1]).toEqual({
      ...SCOPE,
      feesFirst: FEES_PAGE_SIZE,
      feesAfterId: first[FEES_PAGE_SIZE - 1].id,
    });
    expect(graphqlRequest.mock.calls[1][1]).toMatchObject({
      feesAfterId: second[FEES_PAGE_SIZE - 1].id,
    });
  });

  it("asks the venue's own subgraph for the rest", async () => {
    graphqlRequest.mockResolvedValueOnce({ feesInWindow: [] });
    await totalWindowFees(rows(FEES_PAGE_SIZE, "1"), {
      ...SCOPE,
      subgraphUrl: "https://perps.example/gn",
    });

    expect(graphqlRequest).toHaveBeenCalledTimes(1);
    expect(graphqlRequest.mock.calls[0][2]).toBe("https://perps.example/gn");
  });
});
