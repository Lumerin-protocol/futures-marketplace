import { describe, expect, it, vi } from "vitest";

vi.mock("../graphql", () => ({ graphqlRequest: vi.fn() }));

const { fundingNet, fundingWithDrift, mapPerpsFundingWindow } = await import(
  "./usePerpsFundingWindow"
);

const me = {
  totalFundingPaid: "20",
  totalFundingReceived: "7",
  totalDriftPaid: "0",
  totalDriftReceived: "4",
};

describe("mapPerpsFundingWindow", () => {
  it("takes each baseline off its lifetime total", () => {
    expect(
      mapPerpsFundingWindow({
        me,
        fundingPaidBaseline: [{ cumulativeFundingPaid: "15" }],
        fundingReceivedBaseline: [{ cumulativeFundingReceived: "7" }],
        driftPaidBaseline: [],
        driftReceivedBaseline: [{ cumulativeDriftReceived: "1" }],
      }),
    ).toEqual({ funding: { paid: 5n, received: 0n }, drift: { paid: 0n, received: 3n } });
  });

  it("counts everything when nothing settled before the window", () => {
    expect(
      mapPerpsFundingWindow({
        me,
        fundingPaidBaseline: [],
        fundingReceivedBaseline: [],
        driftPaidBaseline: [],
        driftReceivedBaseline: [],
      }),
    ).toEqual({ funding: { paid: 20n, received: 7n }, drift: { paid: 0n, received: 4n } });
  });

  it("is zero for an account that never traded perps", () => {
    expect(mapPerpsFundingWindow({ me: null })).toEqual({
      funding: { paid: 0n, received: 0n },
      drift: { paid: 0n, received: 0n },
    });
  });
});

describe("funding figures", () => {
  const window = { funding: { paid: 5n, received: 2n }, drift: { paid: 1n, received: 3n } };

  it("adds only funding to realized PnL, since drift is already in it", () => {
    expect(fundingNet(window)).toBe(-3n);
  });

  it("shows funding and drift as one figure", () => {
    expect(fundingWithDrift(window)).toEqual({ paid: 6n, received: 5n });
  });
});
