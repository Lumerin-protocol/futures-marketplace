import { describe, expect, test } from "vitest";
import {
  DEFAULT_MARGIN_RATIO_THRESHOLDS,
  deriveMarginFigures,
  formatMarginRatio,
  marginStatusCopy,
  marginRatioPercent,
  type MarginShocks,
  marginTier,
  thresholdsFromShocks,
  type MarginRatioThresholds,
} from "./marginRisk";

/** WAD-scaled fraction, as the engine stores its shocks. */
const wad = (fraction: number) => BigInt(Math.round(fraction * 1e18));

/** The shocks the engine ships with: IM 10%, MM 5%. */
const shipped: MarginShocks = { imSpotShock: wad(0.1), mmSpotShock: wad(0.05) };

/** Whole USDC at the payment token's 6 decimals. */
const usdc = (amount: number) => BigInt(Math.round(amount * 1e6));

/** Deliberately not the shipped values, so the tests prove the argument is honoured. */
const thresholds: MarginRatioThresholds = { caution: 60, danger: 80 };

describe("marginRatioPercent", () => {
  // A 2,000 notional at the shipped shocks stresses to 200 (IM) and 100 (MM).
  // Every state below adds the same loss L to both requirements, as the engine
  // does, and checks the ratio at the boundaries the engine actually enforces.
  const withLoss = (L: number) => ({ im: usdc(200 + L), mm: usdc(100 + L) });

  test("loss-free it is plain MM / balance", () => {
    const { im, mm } = withLoss(0);
    expect(marginRatioPercent(usdc(400), im, mm, shipped)).toBeCloseTo(25, 6);
    expect(marginRatioPercent(usdc(200), im, mm, shipped)).toBeCloseTo(50, 6);
    expect(marginRatioPercent(usdc(100), im, mm, shipped)).toBeCloseTo(100, 6);
  });

  test("reads 50% exactly where balance meets IM, whatever the loss", () => {
    for (const L of [0, 24.02, 100, 1_000]) {
      const { im, mm } = withLoss(L);
      expect(marginRatioPercent(im, im, mm, shipped)).toBeCloseTo(50, 6);
    }
  });

  test("reads 100% exactly where balance meets MM, whatever the loss", () => {
    for (const L of [0, 24.02, 100, 1_000]) {
      const { im, mm } = withLoss(L);
      expect(marginRatioPercent(mm, im, mm, shipped)).toBeCloseTo(100, 6);
    }
  });

  test("reads the danger point exactly half-way from IM to MM, whatever the loss", () => {
    const { danger } = thresholdsFromShocks(shipped);
    for (const L of [0, 24.02, 100, 1_000]) {
      const { im, mm } = withLoss(L);
      const ratio = marginRatioPercent((im + mm) / 2n, im, mm, shipped);
      expect(ratio).toBeCloseTo(66.67, 1);
      expect(Math.round(ratio ?? 0)).toBe(danger);
    }
  });

  test("the raw MM / balance would have missed the IM boundary once losses exist", () => {
    // The reason for the stress-over-equity form: with a 100 loss on the book,
    // MM / balance sits at 67% when balance meets IM, not 50%.
    const { im, mm } = withLoss(100);
    expect((Number(mm) / Number(im)) * 100).toBeCloseTo(66.67, 1);
    expect(marginRatioPercent(im, im, mm, shipped)).toBeCloseTo(50, 6);
  });

  test("follows other shocks: the IM boundary lands on s / S", () => {
    const shocks: MarginShocks = { imSpotShock: wad(0.15), mmSpotShock: wad(0.05) };
    // Stress 300 / 100 plus a 50 loss.
    const im = usdc(350);
    const mm = usdc(150);
    expect(marginRatioPercent(im, im, mm, shocks)).toBeCloseTo(33.33, 1);
    expect(marginRatioPercent(mm, im, mm, shocks)).toBeCloseTo(100, 6);
  });

  test("no exposure reads 0%, an empty account has no ratio", () => {
    expect(marginRatioPercent(usdc(200), 0n, 0n, shipped)).toBe(0);
    expect(marginRatioPercent(0n, 0n, 0n, shipped)).toBeNull();
  });

  test("caps once equity is gone rather than dividing by zero or going negative", () => {
    const { im, mm } = withLoss(100);
    // Balance below the shared loss term: equity ≤ 0, far past liquidation.
    expect(marginRatioPercent(usdc(50), im, mm, shipped)).toBe(999);
    expect(marginRatioPercent(0n, im, mm, shipped)).toBe(999);
  });

  test("a mid-flight read with MM above IM counts as no stress", () => {
    expect(marginRatioPercent(usdc(200), usdc(50), usdc(60), shipped)).toBe(0);
  });
});

describe("thresholdsFromShocks", () => {
  test("at the shipped shocks, caution is the IM boundary and danger half the cushion", () => {
    expect(thresholdsFromShocks(shipped)).toEqual({ caution: 50, danger: 67 });
  });

  test("the shipped default is that same answer", () => {
    expect(DEFAULT_MARGIN_RATIO_THRESHOLDS).toEqual(thresholdsFromShocks(shipped));
  });

  test("follows the shocks when they change", () => {
    // IM 15%, MM 5%: IM at 33%, half-cushion at 2·5/20 = 50%.
    expect(thresholdsFromShocks({ imSpotShock: wad(0.15), mmSpotShock: wad(0.05) })).toEqual({
      caution: 33,
      danger: 50,
    });
    // IM 8%, MM 6%: a thin IM-to-MM band — 75% and 2·6/14 = 86%.
    expect(thresholdsFromShocks({ imSpotShock: wad(0.08), mmSpotShock: wad(0.06) })).toEqual({
      caution: 75,
      danger: 86,
    });
  });

  test("danger always sits between caution and liquidation", () => {
    for (const [S, s] of [
      [0.1, 0.05],
      [0.2, 0.05],
      [0.12, 0.1],
      [0.5, 0.01],
    ]) {
      const t = thresholdsFromShocks({ imSpotShock: wad(S), mmSpotShock: wad(s) });
      expect(t.caution).toBeLessThan(t.danger);
      expect(t.danger).toBeLessThan(100);
    }
  });

  test("falls back to the default on a degenerate read", () => {
    expect(thresholdsFromShocks({ imSpotShock: 0n, mmSpotShock: wad(0.05) })).toEqual(
      DEFAULT_MARGIN_RATIO_THRESHOLDS,
    );
    expect(thresholdsFromShocks({ imSpotShock: wad(0.05), mmSpotShock: wad(0.05) })).toEqual(
      DEFAULT_MARGIN_RATIO_THRESHOLDS,
    );
    expect(thresholdsFromShocks({ imSpotShock: wad(0.05), mmSpotShock: wad(0.1) })).toEqual(
      DEFAULT_MARGIN_RATIO_THRESHOLDS,
    );
  });
});

describe("deriveMarginFigures", () => {
  // The screenshot that prompted the redesign: IM exceeds balance while the
  // account sits at a 56% margin ratio, nowhere near liquidation.
  test("the worked example adds up", () => {
    const figures = deriveMarginFigures({
      balance: usdc(200),
      im: usdc(219.73),
      mm: usdc(121.88),
      netUnrealizedPnl: usdc(-24.02),
      unrealizedLossTerm: usdc(24.02),
      shocks: shipped,
    });

    expect(figures.equity).toBe(usdc(175.98));
    expect(figures.marginUsed).toBe(usdc(195.71));
    expect(figures.available).toBe(0n);
    // Stress 219.73 − 121.88 = 97.85 over equity 200 − 24.03 = 175.97: just past
    // the 50% IM boundary, consistent with belowIM.
    expect(figures.ratioPercent).toBeCloseTo(55.61, 2);
    expect(figures.belowIM).toBe(true);
  });

  test("an account with no exposure has its whole balance available", () => {
    const figures = deriveMarginFigures({
      balance: usdc(200),
      im: 0n,
      mm: 0n,
      netUnrealizedPnl: 0n,
      unrealizedLossTerm: 0n,
      shocks: shipped,
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
      shocks: shipped,
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
      shocks: shipped,
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
      shocks: shipped,
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
      shocks: shipped,
    });

    expect(figures.marginUsed).toBe(0n);
  });
});

describe("marginTier", () => {
  test("healthy below the caution threshold", () => {
    expect(marginTier(0, thresholds)).toBe("healthy");
    expect(marginTier(59.9, thresholds)).toBe("healthy");
  });

  test("tiers begin at their thresholds", () => {
    expect(marginTier(60, thresholds)).toBe("caution");
    expect(marginTier(79.9, thresholds)).toBe("caution");
    expect(marginTier(80, thresholds)).toBe("danger");
    expect(marginTier(99.9, thresholds)).toBe("danger");
    expect(marginTier(100, thresholds)).toBe("liquidatable");
    expect(marginTier(999, thresholds)).toBe("liquidatable");
  });

  // Each boundary is an engine fact, so the tier has no memory: it clears the
  // moment the ratio is back under the line.
  test("has no hysteresis", () => {
    expect(marginTier(59.9, thresholds)).toBe("healthy");
    expect(marginTier(79.9, thresholds)).toBe("caution");
    expect(marginTier(99.9, thresholds)).toBe("danger");
  });

  test("uses the shipped thresholds by default", () => {
    expect(marginTier(49.9)).toBe("healthy");
    expect(marginTier(50)).toBe("caution");
    expect(marginTier(67)).toBe("danger");
  });

  test("an account without a ratio has no tier", () => {
    expect(marginTier(null, thresholds)).toBe("healthy");
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
