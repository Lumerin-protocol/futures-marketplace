import { describe, expect, test } from "vitest";
import {
  deriveMarginFigures,
  formatMarginRatio,
  marginStatusCopy,
  nextTier,
  type MarginRatioThresholds,
  type MarginTier,
} from "./marginRisk";

/** Whole USDC at the payment token's 6 decimals. */
const usdc = (amount: number) => BigInt(Math.round(amount * 1e6));

const thresholds: MarginRatioThresholds = { caution: 60, danger: 80 };

/** Walks a ratio series through the ladder the way successive polls would. */
const walk = (ratios: (number | null)[], from: MarginTier = "healthy"): MarginTier =>
  ratios.reduce<MarginTier>((tier, ratio) => nextTier(tier, ratio, thresholds), from);

describe("deriveMarginFigures", () => {
  // The screenshot that prompted the redesign: IM exceeds balance while the
  // account sits at a 61% margin ratio, nowhere near liquidation.
  test("the worked example adds up", () => {
    const figures = deriveMarginFigures({
      balance: usdc(200),
      im: usdc(219.73),
      mm: usdc(121.88),
      netUnrealizedPnl: usdc(-24.02),
      unrealizedLossTerm: usdc(24.02),
    });

    expect(figures.equity).toBe(usdc(175.98));
    expect(figures.marginUsed).toBe(usdc(195.71));
    expect(figures.available).toBe(0n);
    expect(figures.ratioPercent).toBeCloseTo(60.94, 2);
    expect(figures.belowIM).toBe(true);
  });

  test("an account with no exposure has its whole balance available", () => {
    const figures = deriveMarginFigures({
      balance: usdc(200),
      im: 0n,
      mm: 0n,
      netUnrealizedPnl: 0n,
      unrealizedLossTerm: 0n,
    });

    expect(figures.equity).toBe(usdc(200));
    expect(figures.marginUsed).toBe(0n);
    expect(figures.available).toBe(usdc(200));
    expect(figures.ratioPercent).toBe(0);
    expect(figures.belowIM).toBe(false);
  });

  // Dividing by an empty balance would report either Infinity or NaN as a
  // percentage, and neither is a risk level.
  test("an empty account has no margin ratio", () => {
    const figures = deriveMarginFigures({
      balance: 0n,
      im: 0n,
      mm: 0n,
      netUnrealizedPnl: 0n,
      unrealizedLossTerm: 0n,
    });

    expect(figures.ratioPercent).toBeNull();
    expect(figures.belowIM).toBe(false);
  });

  // IM ignores unrealized gains, so the panel deliberately does not reconcile:
  // Available is the vault's own check and stays authoritative.
  test("an account in profit has less available than equity minus margin used", () => {
    const figures = deriveMarginFigures({
      balance: usdc(200),
      im: usdc(50),
      mm: usdc(25),
      netUnrealizedPnl: usdc(30),
      unrealizedLossTerm: 0n,
    });

    expect(figures.equity).toBe(usdc(230));
    expect(figures.marginUsed).toBe(usdc(50));
    expect(figures.available).toBe(usdc(150));
    expect(figures.equity - figures.marginUsed).toBeGreaterThan(figures.available);
  });

  // Futures -30 and perps +10: the loss term clamps per market, so it charges
  // for the full 30 rather than the netted 20.
  test("mixed cross-venue PnL clamps the loss per market", () => {
    const figures = deriveMarginFigures({
      balance: usdc(200),
      im: usdc(100),
      mm: usdc(60),
      netUnrealizedPnl: usdc(-20),
      unrealizedLossTerm: usdc(30),
    });

    expect(figures.equity).toBe(usdc(180));
    expect(figures.marginUsed).toBe(usdc(70));
    expect(figures.available).toBe(usdc(100));
  });

  // The margins and risk-view polls run on different cadences, so a mid-flight
  // skew must not surface as a negative requirement.
  test("a loss term larger than IM floors margin used at zero", () => {
    const figures = deriveMarginFigures({
      balance: usdc(200),
      im: usdc(10),
      mm: usdc(5),
      netUnrealizedPnl: usdc(-15),
      unrealizedLossTerm: usdc(15),
    });

    expect(figures.marginUsed).toBe(0n);
  });
});

describe("nextTier", () => {
  test("a healthy account stays healthy below the caution threshold", () => {
    expect(nextTier("healthy", 59.9, thresholds)).toBe("healthy");
  });

  test("tiers are entered at their thresholds", () => {
    expect(nextTier("healthy", 60, thresholds)).toBe("caution");
    expect(nextTier("healthy", 80, thresholds)).toBe("danger");
    expect(nextTier("healthy", 100, thresholds)).toBe("liquidatable");
  });

  // A gap between polls can skip tiers entirely; throttling the escalation
  // would leave the user reading "caution" while the keeper is already able to
  // close them out.
  test("escalation is immediate even across several tiers", () => {
    expect(nextTier("healthy", 120, thresholds)).toBe("liquidatable");
  });

  test("a tier holds until the ratio clears its exit threshold", () => {
    expect(nextTier("caution", 58, thresholds)).toBe("caution");
    expect(nextTier("caution", 54.9, thresholds)).toBe("healthy");
    expect(nextTier("danger", 78, thresholds)).toBe("danger");
    expect(nextTier("danger", 74.9, thresholds)).toBe("caution");
  });

  // Being liquidatable is an on-chain fact rather than a warning level, so the
  // 100% boundary gets no hysteresis.
  test("liquidatable clears as soon as the ratio drops below 100", () => {
    expect(nextTier("liquidatable", 99.9, thresholds)).toBe("danger");
  });

  test("de-escalation walks the whole ladder down in one step", () => {
    expect(nextTier("liquidatable", 10, thresholds)).toBe("healthy");
  });

  test("a ratio oscillating inside the hysteresis band does not flap", () => {
    expect(walk([61, 58, 61, 57, 59])).toBe("caution");
  });

  test("an account that recovers ends up healthy again", () => {
    expect(walk([85, 76, 70, 56, 40])).toBe("healthy");
  });

  test("an account without a ratio has no tier", () => {
    expect(nextTier("danger", null, thresholds)).toBe("healthy");
  });
});

describe("formatMarginRatio", () => {
  test("rounds to whole percent", () => {
    expect(formatMarginRatio(60.94)).toBe("61%");
  });

  test("clamps runaway ratios", () => {
    expect(formatMarginRatio(4200)).toBe("999%");
  });

  test("renders an em dash when there is no ratio", () => {
    expect(formatMarginRatio(null)).toBe("—");
  });
});

describe("marginStatusCopy", () => {
  test("a healthy account has nothing to say", () => {
    expect(marginStatusCopy("healthy", { ratioPercent: 12 })).toBeNull();
  });

  test("caution quotes the ratio and the liquidation point", () => {
    expect(marginStatusCopy("caution", { ratioPercent: 72 })).toBe(
      "Margin ratio 72%. Liquidation at 100%.",
    );
  });

  test("danger names the liquidation price once the solver has one", () => {
    expect(marginStatusCopy("danger", { ratioPercent: 85, liqPrice: usdc(41.5) })).toBe(
      "Liquidation risk. Deposit or reduce your position. Liq. price ≈ 41.50.",
    );
  });

  // The solver needs a full account snapshot, which can lag the margin read.
  test("danger drops the price clause until the solver has one", () => {
    expect(marginStatusCopy("danger", { ratioPercent: 85 })).toBe(
      "Liquidation risk. Deposit or reduce your position.",
    );
  });

  test("liquidatable states the position plainly", () => {
    expect(marginStatusCopy("liquidatable", { ratioPercent: 104 })).toBe(
      "Account is liquidatable. Positions may be closed at any moment.",
    );
  });
});
