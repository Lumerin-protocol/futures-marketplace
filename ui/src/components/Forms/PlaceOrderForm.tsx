import { type FC, type ReactNode, useMemo, useState } from "react";
import {
  waitForOrderBookBlockNumber,
  getOrderBookQueryKey,
} from "../../hooks/data/orderBookHelpers";
import { TransactionFormV2 as TransactionForm } from "./Shared/MultistepForm";
import type { TransactionReceipt } from "viem";
import { useCreateOrder } from "../../hooks/data/useCreateOrder";
import { useCreatePerpsOrder } from "../../hooks/data/perps/useCreatePerpsOrder";
import { useUpdateFuturesOrders } from "../../hooks/data/useModifyOrder";
import { useUpdatePerpsOrders } from "../../hooks/data/perps/useUpdatePerpsOrders";
import { PARTICIPANT_QK } from "../../hooks/data/getUserFuturesOrders";
import { POSITION_BOOK_QK } from "../../hooks/data/getUserFuturesPositions";
import { USER_PERPS_ORDERS_QK } from "../../hooks/data/perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "../../hooks/data/perps/useUserPositionSessions";
import { HISTORICAL_ORDERS_QK } from "../../hooks/data/useHistoricalOrders";
import { FUTURES_POSITION_HISTORY_QK } from "../../hooks/data/useFuturesPositionHistory";
import { USER_FUTURES_TRADES_QK } from "../../hooks/data/useUserFuturesTrades";
import { invalidatePortfolioPnl } from "../../hooks/data/pnl/invalidate";
import { PERPS_ORDER_HISTORY_QK } from "../../hooks/data/perps/usePerpsOrderHistory";
import { PERPS_POSITION_HISTORY_QK } from "../../hooks/data/perps/usePerpsPositionHistory";
import { USER_TRADES_QK } from "../../hooks/data/perps/useUserTrades";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, } from "wagmi";
import type { Participant } from "../../hooks/data/getUserFuturesOrders";
import type { ContractMode } from "../../types/types";
import { useOrderMargin } from "../../hooks/data/useOrderMargin";
import { useLiquidationThresholds } from "../../hooks/data/useLiquidationThresholds";
import { useGetMarketPrice } from "../../hooks/data/useGetMarketPrice";
import { formatMonthDay } from "../../lib/dates";
import { type OrderLeg, type OrderMarginQuote, snapshotWithChanges } from "../../lib/orderMargin";
import { positionBefore, snapshotWithFill } from "../../lib/orderPreview";
import { imRequired, mmRequired, type AccountSnapshot } from "@hashpower/portfolio-margin";
import {
  formatMarginRatio,
  MARGIN_RATIO_THRESHOLDS,
  type MarginTier,
  tierAtEntry,
} from "../../lib/marginRisk";
import {
  pickLiquidationLevel,
  solveLiquidationThresholds,
  type LiquidationLevel,
} from "../../lib/portfolioMargin";
import { useMakerTakerFees } from "../../hooks/data/useMakerTakerFees";
import { usePointsHookWeights } from "../../hooks/data/usePointsHookWeights";
import type { PerpsCollection } from "../../hooks/data/perps/usePerpsCollection";
import {
  PAYMENT_TOKEN_SCALE_NUM,
  QUANTITY_SCALE,
  QUANTITY_SCALE_NUM,
} from "../../lib/units";
import { quoteOrderFees } from "../../lib/orderFees";
import { type OrderExecution, summarizeOrderExecution } from "../../lib/orderExecution";
import { TimeInForce, type TimeInForceValue } from "../../types/timeInForce";
import {
  Bright,
  CostCard,
  CostDivider,
  CostRow,
  Delta,
  GroupDivider,
  Headline,
  HeadlineAt,
  HeadlineDelivery,
  HeadlineDetail,
  HeadlineMeta,
  HeadlineStat,
  HeadlineStats,
  HeadlineTitle,
  HeadlineTop,
  HelpTip,
  Note,
  Review,
  Section,
  SectionTitle,
  SideBadge,
  type Tone,
} from "./Shared/ReviewPrimitives";

const TIF_LABELS: Record<TimeInForceValue, string> = {
  [TimeInForce.GTC]: "GTC",
  [TimeInForce.IOC]: "IOC",
  [TimeInForce.FOK]: "FOK",
};

const usdc = (value: bigint) => `${(Number(value) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)} USDC`;
const abs = (value: bigint) => (value < 0n ? -value : value);

/**
 * How an incoming order nets against the user's own resting orders on the other
 * side of the book. Quantities are in display units — whole contracts for
 * futures, decimal for perps — the same units as the `quantity` prop.
 */
export interface OrderOffsetPlan {
  cancelIds: `0x${string}`[];
  reduces: { orderId: `0x${string}`; newQuantity: bigint }[];
  /** Absorbed by the cancels and reduces. */
  offsetQty: number;
  /** Exceeds the resting size and still has to be placed. */
  leftoverQty: number;
}

interface Props {
  price: bigint;
  expirationAt: bigint;
  quantity: number; // Positive for Buy, Negative for Sell
  participantData?: Participant | null;
  onOrderPlaced?: () => void | Promise<void>;
  closeForm: () => void;
  bypassConflictCheck?: boolean; // Allow proceeding despite conflicting orders
  /** Set when the user chose to net against their resting orders instead of placing. */
  offsetPlan?: OrderOffsetPlan | null;
  contractMode?: ContractMode;
  perpsCollection?: PerpsCollection;
  isMarketOrder?: boolean;
  /** Fraction (0.05 = 5%) by which the widget slipped the mark to price a market order. */
  marketSlippage?: number;
  timeInForce?: TimeInForceValue;
  /** Modal title; defaults to "Place Bid/Ask Order". Set when this order is the means to some other end, e.g. closing a position. */
  title?: string;
  /** Label of the confirm button; defaults to the title. */
  executeLabel?: string;
  /**
   * Caption over the order card on the review step. Unset when the modal title
   * already names the order; set when it names the goal instead, so the card
   * can be tied back to the step that produced it ("Closing order").
   */
  orderCaption?: string;
  /** Where "Back" on the review step goes. Without it the modal closes. */
  onBack?: () => void;
}

const toneOf = (tier: MarginTier): Tone =>
  tier === "healthy" ? "neutral" : tier === "caution" ? "caution" : "danger";

/** The account's risk figures at one moment, as the "After this order" card shows them. */
interface RiskFigures {
  /** `balance − IM − reserved fee`: what is left to trade with. */
  available: bigint;
  liq: LiquidationLevel | undefined;
  underwater: boolean;
  /** `MM / balance × 100`, the header's margin ratio; `null` with no balance. */
  ratio: number | null;
}

/** Which of the figures differ between two moments. */
interface RiskChanges {
  available: boolean;
  liq: boolean;
  ratio: boolean;
}

const NO_CHANGES: RiskChanges = { available: false, liq: false, ratio: false };

function riskChanges(from: RiskFigures, to: RiskFigures): RiskChanges {
  return {
    available: from.available !== to.available,
    liq:
      from.underwater !== to.underwater ||
      from.liq?.price !== to.liq?.price ||
      from.liq?.direction !== to.liq?.direction,
    ratio: from.ratio !== to.ratio,
  };
}

export const PlaceOrderForm: FC<Props> = ({
  price,
  expirationAt,
  quantity,
  participantData,
  onOrderPlaced,
  closeForm,
  bypassConflictCheck = false,
  offsetPlan = null,
  contractMode = "futures",
  perpsCollection,
  isMarketOrder = false,
  marketSlippage,
  timeInForce = TimeInForce.GTC,
  title,
  executeLabel,
  orderCaption,
  onBack,
}) => {
  // Conditionally use futures or perps create order hook
  const futuresCreateOrder = useCreateOrder();
  const perpsCreateOrder = useCreatePerpsOrder();
  const { updateOrdersAsync: futuresUpdateOrders } = useUpdateFuturesOrders();
  const { updateOrdersAsync: perpsUpdateOrders } = useUpdatePerpsOrders();
  const qc = useQueryClient();
  const { address } = useAccount();
  const _publicClient = usePublicClient();
  const {
    feeFor,
    makerFeeBps: futuresMakerFeeBps,
    takerFeeBps: futuresTakerFeeBps,
    isLoading: isFeesLoading,
  } = useMakerTakerFees();
  const { wMaker, wTaker, weightScale, isLoading: isWeightsLoading } = usePointsHookWeights();
  // What the transaction did, read from its receipt once it has confirmed, and
  // the account figures frozen the moment it was sent so the result step can
  // show `before → now` against live reads.
  const [execution, setExecution] = useState<OrderExecution | null>(null);
  // The live account reads have been refetched since the receipt; until then
  // their values are the pre-trade ones and the "now" side must not show them.
  const [accountFresh, setAccountFresh] = useState(false);
  const [baseline, setBaseline] = useState<{
    available: bigint | undefined;
    im: bigint | undefined;
    liq: LiquidationLevel | undefined;
    underwater: boolean;
  } | null>(null);

  // Determine order type from quantity sign
  const isBuy = quantity > 0;
  const absoluteQuantity = Math.abs(quantity);

  // Only the part that outlives the offset reaches the book, so it is the only
  // part that needs margin or shows up as a new resting order.
  const restingQuantity = offsetPlan ? offsetPlan.leftoverQty : absoluteQuantity;

  // Notional size (USDC) of this order — the "Notional" stat in the headline.
  const sizeUSDC = (Number(price) / PAYMENT_TOKEN_SCALE_NUM) * absoluteQuantity;

  // Estimated points rewards: points = weight * size / WEIGHT_SCALE.
  const makerReward =
    wMaker !== undefined && weightScale ? (Number(wMaker) * sizeUSDC) / Number(weightScale) : null;
  const takerReward =
    wTaker !== undefined && weightScale ? (Number(wTaker) * sizeUSDC) / Number(weightScale) : null;

  const orderMargin = useOrderMargin();

  /**
   * What the gate reads for this order: `undefined` while the reads it needs are
   * in flight, `null` when nothing reaches the book.
   *
   * Both venues quote the same gate — the rise in portfolio IM once the order
   * rests — so this modal shows the figure the order widget showed and the one
   * `createOrder` will check. The reserved fee is the worse of maker/taker on
   * the resting notional: at submit we do not know which the fill will charge.
   */
  const marginQuote = useMemo<OrderMarginQuote | null | undefined>(() => {
    const venue = contractMode === "perpetual" ? "perps" : "futures";
    const scale = venue === "perps" ? QUANTITY_SCALE_NUM : 1;
    const nativeQty = BigInt(Math.round(restingQuantity * scale));
    if (nativeQty === 0n) return null;

    const notional =
      venue === "perps" ? (price * nativeQty) / QUANTITY_SCALE : price * nativeQty;
    let reservedFee = 0n;
    if (venue === "perps") {
      const maker = perpsCollection?.makerFeeBps;
      const taker = perpsCollection?.takerFeeBps;
      if (maker !== undefined && taker !== undefined) {
        const worst = Math.max(maker, taker);
        if (worst > 0) reservedFee = (notional * BigInt(worst)) / 10_000n;
      }
    } else {
      reservedFee = feeFor(notional);
    }

    return orderMargin.quote(
      { place: [{ venue, price, quantity: isBuy ? nativeQty : -nativeQty }] },
      { reservedFee },
    );
  }, [
    contractMode,
    price,
    restingQuantity,
    isBuy,
    orderMargin.quote,
    perpsCollection?.makerFeeBps,
    perpsCollection?.takerFeeBps,
    feeFor,
  ]);

  // Margin this order commits, `null` while loading. A leg that hedges the rest
  // of the book can lower IM; it never earns credit.
  const requiredMargin: bigint | null =
    marginQuote === undefined
      ? null
      : marginQuote === null
        ? 0n
        : marginQuote.imIncrease > 0n
          ? marginQuote.imIncrease
          : 0n;
  /**
   * How the account's risk figures move because of the placed part, read at
   * three moments: as it stands, once the order is *placed*, and once it has
   * *filled*.
   *
   * The engine stresses a resting order as if it had filled in the worse
   * direction, so an order that adds exposure moves the figures the moment it
   * lands, while one that reduces exposure — a close — earns nothing until it
   * fills. Which moment a row is shown at is decided below, per figure: an
   * order that cannot rest has no "placed" state at all, and for one that can,
   * a figure that only moves on fill belongs under "If fully filled".
   *
   * Same snapshot, shocks and mark the margin quote and the page's risk panel
   * read, so the "before" figures match what the header shows and the placed
   * available balance equals the quote's headroom.
   */
  const {
    snapshot: riskSnapshot,
    params: riskParams,
    liqPrice: liveLiqPrice,
    liqDirection: liveLiqDirection,
    alreadyUnderwater: liveUnderwater,
  } = useLiquidationThresholds(address);
  const { data: marketPrice } = useGetMarketPrice();
  const reservedFee = marginQuote?.reservedFee ?? 0n;
  const fillPreview = useMemo<
    | {
        positionBefore: bigint;
        positionAfter: bigint;
        before: RiskFigures;
        placed: RiskFigures;
        filled: RiskFigures;
      }
    | undefined
  >(() => {
    const snapshot = riskSnapshot;
    const params = riskParams;
    const mark = marketPrice as bigint | undefined;
    if (!snapshot || !params || !mark || mark <= 0n) return undefined;

    const venue = contractMode === "perpetual" ? "perps" : "futures";
    const scale = venue === "perps" ? QUANTITY_SCALE_NUM : 1;
    const nativeQty = BigInt(Math.round(restingQuantity * scale));
    if (nativeQty === 0n) return undefined;
    const leg: OrderLeg = { venue, price, quantity: isBuy ? nativeQty : -nativeQty };
    const expiry = venue === "futures" ? expirationAt : undefined;

    const placed = snapshotWithChanges(snapshot, params, { place: [leg] });
    const filled = snapshotWithFill(snapshot, params, leg, expiry);
    // The fee is held back from placement on, so it is in every state but "before".
    const figures = (snap: AccountSnapshot, fee: bigint): RiskFigures => {
      const thresholds = solveLiquidationThresholds(snap, params, mark);
      return {
        available: snap.balance - imRequired(snap, params, mark) - fee,
        liq: pickLiquidationLevel(snap, params, thresholds, mark),
        underwater: thresholds.alreadyUnderwater,
        ratio: snap.balance === 0n ? null : (Number(mmRequired(snap, params, mark)) / Number(snap.balance)) * 100,
      };
    };
    return {
      positionBefore: positionBefore(snapshot, leg, expiry),
      positionAfter: positionBefore(filled, leg, expiry),
      before: figures(snapshot, 0n),
      placed: figures(placed, reservedFee),
      filled: figures(filled, reservedFee),
    };
  }, [
    riskSnapshot,
    riskParams,
    marketPrice,
    contractMode,
    restingQuantity,
    price,
    isBuy,
    expirationAt,
    reservedFee,
  ]);
  const availableBefore = fillPreview?.before.available;

  const positionLabel = (net: bigint): string => {
    if (net === 0n) return "Flat";
    const scale = contractMode === "perpetual" ? QUANTITY_SCALE_NUM : 1;
    const size = Number(net < 0n ? -net : net) / scale;
    const formatted = contractMode === "perpetual" ? String(Number(size.toFixed(6))) : size.toFixed(0);
    return `${net > 0n ? "Long" : "Short"} ${formatted}`;
  };
  const liqLabel = (figures: RiskFigures, sharedDirection: LiquidationLevel["direction"] | undefined): string => {
    if (figures.underwater) return "Liquidatable";
    if (!figures.liq) return "None";
    const arrow = sharedDirection ? "" : figures.liq.direction === "down" ? "↓ " : "↑ ";
    return `${arrow}${usdc(figures.liq.price)}`;
  };
  /** Result-step variant: before and now are independent reads, so each carries its arrow. */
  const liqLabelWithArrow = (level: LiquidationLevel | undefined, underwater: boolean): string => {
    if (underwater) return "Liquidatable";
    if (!level) return "None";
    return `${level.direction === "down" ? "↓" : "↑"} ${usdc(level.price)}`;
  };
  const ratioTone = (ratio: number | null): Tone =>
    ratio === null ? "neutral" : toneOf(tierAtEntry(ratio, MARGIN_RATIO_THRESHOLDS));
  // Opening from flat is obvious from the badge; the row earns its place when
  // it reduces, closes or flips something the user already holds.
  const showPosition = fillPreview !== undefined && fillPreview.positionBefore !== 0n;

  // A GTC limit may fill now (taker) or rest and fill later (maker); market,
  // IOC and FOK never rest, so they are takers for whatever they fill.
  const canRest = !isMarketOrder && timeInForce === TimeInForce.GTC;
  /**
   * Which figures move between two states. For an order that can rest, the
   * ones that move at placement go above the "If fully filled" rule and the
   * ones that move only on fill go under it; a figure that moves at neither
   * is left out rather than shown as `x → x`. An order that cannot rest is
   * either filled or gone, so its one comparison is before → filled.
   */
  const atPlacement = fillPreview && canRest ? riskChanges(fillPreview.before, fillPreview.placed) : NO_CHANGES;
  const atFill = fillPreview
    ? canRest
      ? riskChanges(fillPreview.placed, fillPreview.filled)
      : riskChanges(fillPreview.before, fillPreview.filled)
    : NO_CHANGES;
  const anyChange = (c: RiskChanges) => c.available || c.liq || c.ratio;
  // Rows the card shows right away, and rows that wait for the fill. For an
  // order that cannot rest everything is "right away" in the sense that there
  // is no other moment; the position row still closes the card.
  const hasImmediateRows = anyChange(canRest ? atPlacement : atFill);
  const hasFillRows = showPosition || (canRest && anyChange(atFill));

  /** The rows for one comparison, in the card's fixed order. */
  const riskRows = (from: RiskFigures, to: RiskFigures, show: RiskChanges): ReactNode => {
    // When both levels lie the same way the direction goes in the label once;
    // when the fill flips it (a net long becoming net short) each value carries its arrow.
    const directions = new Set([from.liq, to.liq].flatMap((l) => (l ? [l.direction] : [])));
    const shared = directions.size === 1 ? [...directions][0] : undefined;
    return (
      <>
        {show.available && (
          <CostRow
            muted
            label="Available balance"
            value={
              <Delta
                before={usdc(from.available)}
                after={usdc(to.available)}
                tone={to.available < 0n ? "danger" : "neutral"}
              />
            }
          />
        )}
        {show.liq && (
          <CostRow
            muted
            label={shared === "down" ? "Liq. price (below)" : shared === "up" ? "Liq. price (above)" : "Liq. price"}
            tooltip={`The mark price at which the account can be liquidated — ${
              shared === "down"
                ? "the price has to fall to reach it"
                : shared === "up"
                  ? "the price has to rise to reach it"
                  : "each arrow shows which way the price has to move"
            }. The margin engine counts a resting order as if it had already filled, so an order that adds exposure moves this the moment it is placed, and one that reduces exposure only once it fills. Account-wide: one collateral pool backs every futures and perps position.`}
            value={
              <Delta
                before={liqLabel(from, shared)}
                after={liqLabel(to, shared)}
                tone={to.underwater ? "danger" : "neutral"}
              />
            }
          />
        )}
        {show.ratio && (
          <CostRow
            muted
            label="Margin ratio"
            tooltip={`Maintenance margin ÷ balance — the same figure as the balance panel. The margin engine counts a resting order as if it had already filled, so an order that adds exposure moves this the moment it is placed, and one that reduces exposure only once it fills. Amber from ${MARGIN_RATIO_THRESHOLDS.caution}%, red from ${MARGIN_RATIO_THRESHOLDS.danger}%; the account can be liquidated at 100%.`}
            value={
              <Delta
                before={formatMarginRatio(from.ratio)}
                after={formatMarginRatio(to.ratio)}
                tone={ratioTone(to.ratio)}
              />
            }
          />
        )}
      </>
    );
  };
  // FOK either fills in full or is cancelled, so its outcome is not conditional.
  const fillIsConditional = timeInForce !== TimeInForce.FOK;
  // The book drifts between this screen and the transaction, so how much
  // matches now versus rests (GTC) or is cancelled (IOC) is unknown until it
  // lands. Everything above is a bound; this says which way.
  const fillNote = fillIsConditional
    ? timeInForce === TimeInForce.GTC && !isMarketOrder
      ? "The book may move before this lands: part of the order can match immediately and the rest may rest, so fees and points fall between the maker and taker figures, and the position may build in steps. Figures above the rule apply as soon as the order is placed; those under it need the fill."
      : "The book may move before this lands: whatever cannot be matched immediately is cancelled, so the fill may be partial. Figures assume a full fill; a partial one costs less and moves the account less."
    : undefined;

  // Check for conflicting orders (opposite action, same price, same expiration date)
  const hasConflictingOrder = () => {
    if (!participantData?.orders) return false;

    const priceInWei = price;
    const expirationAtValue = expirationAt;
    const oppositeIsBuy = !isBuy;

    return participantData.orders.some(
      (order) =>
        order.isActive &&
        order.isBuy === oppositeIsBuy &&
        order.pricePerDay === priceInWei &&
        order.expirationAt === expirationAtValue,
    );
  };

  const oppositeAction = isBuy ? "Ask" : "Bid";

  // ---- Display-only derivations for the review step ----------------------
  const isPerps = contractMode === "perpetual";

  // Notional of the part that reaches the book, in token units — what fees are
  // charged on. Mirrors the notional the margin memo above reserves against.
  const placedNotional = (() => {
    const nativeQty = BigInt(Math.round(restingQuantity * (isPerps ? QUANTITY_SCALE_NUM : 1)));
    return isPerps ? (price * nativeQty) / QUANTITY_SCALE : price * nativeQty;
  })();

  const makerFeeBps = isPerps ? perpsCollection?.makerFeeBps : futuresMakerFeeBps;
  const takerFeeBps = isPerps ? perpsCollection?.takerFeeBps : futuresTakerFeeBps;
  const feeRatesLoading = isPerps ? perpsCollection === undefined : isFeesLoading;
  const fees =
    makerFeeBps !== undefined && takerFeeBps !== undefined
      ? quoteOrderFees({ notional: placedNotional, makerFeeBps, takerFeeBps, canRest })
      : undefined;
  // `fees.reserved` is max(maker, taker) clamped at zero — the same reserve the
  // margin memo passes to the gate — so margin + reserved is the total required.
  const totalRequired =
    requiredMargin !== null && fees !== undefined ? requiredMargin + fees.reserved : undefined;
  const placesNothing = restingQuantity <= 0;

  // Perps sizes are decimal; drop trailing zeros so the headline reads "0.5", not "0.500000".
  const qtyLabel = (value: number) =>
    `${isPerps ? String(Number(value.toFixed(6))) : value.toFixed(0)} ${value === 1 ? "contract" : "contracts"}`;
  const priceLabel = `${(Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)} USDC`;
  const expiresLabel = formatMonthDay(expirationAt);
  const tifLabel = TIF_LABELS[timeInForce];
  const pct = (bps: number) => `${(Math.abs(bps) / 100).toFixed(2)}%`;
  const slippageLabel =
    isMarketOrder && marketSlippage !== undefined
      ? `max ${String(Number((marketSlippage * 100).toFixed(2)))}% slippage`
      : undefined;

  // Zero fees still get their row — the user is paying attention to cost — but
  // read "None" rather than a pair of zeros; zero points drop their row.
  const feeIsZero =
    makerFeeBps !== undefined && takerFeeBps !== undefined && (canRest ? makerFeeBps === 0 : true) && takerFeeBps === 0;
  const pointsAreZero = wMaker !== undefined && wTaker !== undefined && wMaker === 0n && wTaker === 0n;

  /** Fee row: `maker / taker` for an order that may rest, the taker fee alone otherwise. */
  const feeValue: ReactNode = (() => {
    if (fees === undefined) return feeRatesLoading ? "Loading…" : "—";
    if (feeIsZero) return "None";
    if (!canRest || fees.maker === undefined) return usdc(fees.taker);
    const maker = fees.maker < 0n ? `−${usdc(-fees.maker)}` : (Number(fees.maker) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
    return `${maker} / ${usdc(fees.taker)}`;
  })();
  const feeTooltip = (() => {
    const lock =
      "Locked from your balance when the order is placed and returned if the order is cancelled or expires unfilled. Only the fee for the amount that actually fills is charged.";
    if (fees === undefined || makerFeeBps === undefined || takerFeeBps === undefined) return lock;
    if (feeIsZero) return "This market currently charges no trading fee, so nothing is locked for fees.";
    if (!canRest || fees.maker === undefined) {
      return `${lock} This order cannot rest on the book, so the taker fee of ${pct(takerFeeBps)} applies.`;
    }
    const makerPart =
      fees.maker < 0n
        ? `you receive the maker rebate of ${usdc(-fees.maker)} (${pct(makerFeeBps)})`
        : `you pay the maker fee of ${usdc(fees.maker)} (${pct(makerFeeBps)})`;
    return `${lock} If the order is not matched immediately and rests on the book until filled, ${makerPart}. If it is matched immediately, you pay the taker fee of ${usdc(
      fees.taker,
    )} (${pct(
      takerFeeBps,
    )}). A partial match pays taker on the matched part and maker on the rest. The higher of the two is locked and the difference is returned on fill.`;
  })();

  // ---- The result step: what the receipt says happened --------------------
  const nativeScale = isPerps ? QUANTITY_SCALE_NUM : 1;
  const nativeQty = (value: bigint): number => Math.abs(Number(value)) / nativeScale;
  const result = (() => {
    if (!execution) return undefined;
    const { placed, filled, resting, cancelled, feePaid, averagePrice, positionAfter } = execution;
    const fillNotionalUSDC = execution.fills.reduce(
      (sum, fill) => sum + (Number(fill.price) / PAYMENT_TOKEN_SCALE_NUM) * nativeQty(fill.quantity),
      0,
    );
    const pointsEarned =
      wTaker !== undefined && weightScale ? (Number(wTaker) * fillNotionalUSDC) / Number(weightScale) : null;
    // The fee for the resting part is charged on fill; the venue holds the worse
    // of maker/taker against it until then, exactly as it did at review.
    const restingNotional = isPerps ? (price * abs(resting)) / QUANTITY_SCALE : price * abs(resting);
    const feeLocked =
      resting !== 0n && makerFeeBps !== undefined && takerFeeBps !== undefined
        ? quoteOrderFees({ notional: restingNotional, makerFeeBps, takerFeeBps, canRest: true }).reserved
        : 0n;
    const outcome =
      placed === 0n
        ? "Nothing new placed"
        : filled === 0n
          ? "Resting on the book"
          : filled === placed
            ? "Filled"
            : resting !== 0n
              ? "Partially filled"
              : "Partially filled, rest cancelled";
    const detail =
      filled !== 0n && filled === placed
        ? "Matched immediately as taker"
        : filled !== 0n
          ? "Part matched immediately as taker"
          : resting !== 0n
            ? "Waiting on the book to be matched"
            : undefined;

    // Live reads against the frozen baseline. `undefined` until the reads have
    // been refetched past the receipt, so the row shows "Updating…" rather than
    // a stale pair.
    const availableNow =
      accountFresh && orderMargin.balance !== undefined && orderMargin.currentIm !== undefined
        ? orderMargin.balance - orderMargin.currentIm
        : undefined;
    const marginLocked =
      accountFresh && baseline?.im !== undefined && orderMargin.currentIm !== undefined
        ? orderMargin.currentIm - baseline.im
        : undefined;
    const liqNow: LiquidationLevel | undefined =
      accountFresh && liveLiqPrice !== undefined && liveLiqDirection !== undefined
        ? { price: liveLiqPrice, direction: liveLiqDirection }
        : undefined;

    return {
      placed,
      filled,
      resting,
      cancelled,
      feePaid,
      feeLocked,
      averagePrice,
      positionAfter,
      pointsEarned,
      outcome,
      detail,
      fillCount: execution.fills.length,
      availableNow,
      marginLocked,
      liqNow,
    };
  })();

  const defaultTitle = offsetPlan ? "Offset Order" : isBuy ? "Place Bid Order" : "Place Ask Order";
  const modalTitle = title ?? defaultTitle;

  return (
    <TransactionForm
      onClose={closeForm}
      onBack={onBack}
      title={modalTitle}
      description={""}
      executeLabel={executeLabel ?? modalTitle}
      reviewForm={(_props) => (
        <Review>
          {/* What the order is — the terms the user just entered, in one glance. */}
          <Section>
            {orderCaption && <SectionTitle>{orderCaption}</SectionTitle>}
            <Headline>
              <HeadlineTop>
                <SideBadge $isBuy={isBuy}>{isBuy ? "Bid" : "Ask"}</SideBadge>
                <HeadlineMeta>
                  {[isMarketOrder ? "Market" : "Limit", tifLabel, slippageLabel]
                    .filter(Boolean)
                    .join(" · ")}
                </HeadlineMeta>
                {contractMode === "futures" && (
                  <HeadlineDelivery>
                    <span>Expires</span> {expiresLabel}
                  </HeadlineDelivery>
                )}
              </HeadlineTop>
              {/* Contracts at price is the order as entered; the notional beneath is
                  the USDC it adds up to, which is how perps traders size a trade. */}
              <HeadlineTitle>
                {qtyLabel(absoluteQuantity)}
                <HeadlineAt> {isMarketOrder ? "at market" : `@ ${priceLabel}`}</HeadlineAt>
              </HeadlineTitle>
              <HeadlineStats>
                <HeadlineStat>
                  <span>Notional</span>
                  <strong>{sizeUSDC.toFixed(2)} USDC</strong>
                </HeadlineStat>
                {!pointsAreZero && (
                  <HeadlineStat>
                    <span>
                      Points
                      <HelpTip
                        title={
                          canRest
                            ? "Estimated points for a full fill, credited as the order is matched. Maker points for the part that rests on the book until filled, taker points for the part matched immediately — a partial match earns a mix. A resting order earns nothing until it fills."
                            : "Estimated points, credited when the order is matched. This order cannot rest on the book, so it earns taker points."
                        }
                      />
                    </span>
                    <strong>
                      {makerReward !== null && takerReward !== null
                        ? canRest
                          ? `${makerReward.toFixed(2)} / ${takerReward.toFixed(2)} pts`
                          : `${takerReward.toFixed(2)} pts`
                        : isWeightsLoading
                          ? "Loading…"
                          : "—"}
                    </strong>
                  </HeadlineStat>
                )}
              </HeadlineStats>
            </Headline>
          </Section>

          {offsetPlan && (
            <Note>
              Nets <strong>{qtyLabel(offsetPlan.offsetQty)}</strong> against your resting{" "}
              {oppositeAction} in one transaction — nothing is sent to the market for that part.{" "}
              {offsetPlan.leftoverQty > 0
                ? `The remaining ${qtyLabel(offsetPlan.leftoverQty)} are placed as a new ${
                    isBuy ? "bid" : "ask"
                  }; the costs below are for that part only.`
                : "Nothing new is placed, so no margin or fee is required."}
            </Note>
          )}

          {/* What it costs — the part the user has not seen yet. */}
          {!placesNothing && (
            <Section>
              <SectionTitle>Locked from balance</SectionTitle>
              <CostCard>
                <CostRow
                  label="Margin required"
                  value={requiredMargin !== null ? usdc(requiredMargin) : "Loading…"}
                  hint={
                    requiredMargin === 0n
                      ? "Reduces your exposure — no extra collateral needed"
                      : undefined
                  }
                />
                <CostRow
                  muted
                  label={canRest ? "Fee maker/taker" : "Fee taker"}
                  tooltip={feeTooltip}
                  value={feeValue}
                />
                <CostDivider />
                <CostRow
                  emphasis
                  label="Total locked"
                  tooltip={
                    feeIsZero
                      ? "Taken from your available balance now. This market charges no trading fee, so it is the margin alone. Returned in full if the order is cancelled or expires unfilled, and released when the position is closed."
                      : "Taken from your available balance now: the margin plus the highest fee this order could incur. Everything not used is returned — the whole amount if the order is cancelled or expires unfilled, and the margin when the position is closed."
                  }
                  value={totalRequired !== undefined ? usdc(totalRequired) : "Loading…"}
                />
              </CostCard>
            </Section>
          )}

          {/* How the account changes. For an order that can rest, what moves at
              placement sits above the rule and what waits for a match — the
              position, and any figure the engine only credits on fill — under
              it. An order that cannot rest is either filled or gone, so every
              row is the filled state and the note on the title says so. */}
          {!placesNothing && fillPreview && (hasImmediateRows || hasFillRows) && (
            <Section>
              <SectionTitle>
                After this order
                {fillNote && <HelpTip title={fillNote} />}
              </SectionTitle>
              <CostCard>
                {canRest
                  ? riskRows(fillPreview.before, fillPreview.placed, atPlacement)
                  : riskRows(fillPreview.before, fillPreview.filled, atFill)}
                {hasFillRows &&
                  (canRest ? (
                    <GroupDivider>
                      <span>If fully filled</span>
                    </GroupDivider>
                  ) : (
                    hasImmediateRows && <CostDivider />
                  ))}
                {canRest && riskRows(fillPreview.placed, fillPreview.filled, atFill)}
                {showPosition && (
                  <CostRow
                    muted
                    label="Position"
                    value={
                      <Delta
                        before={positionLabel(fillPreview.positionBefore)}
                        after={positionLabel(fillPreview.positionAfter)}
                      />
                    }
                  />
                )}
              </CostCard>
            </Section>
          )}
        </Review>
      )}
      resultForm={(_props) =>
        result ? (
          <Review style={{ marginTop: "1.25rem" }}>
            {/* Same shape as the review headline, so the eye lands where it did. */}
            <Headline>
              <HeadlineTop>
                <SideBadge $isBuy={isBuy}>{isBuy ? "Bid" : "Ask"}</SideBadge>
                <HeadlineMeta>{result.outcome}</HeadlineMeta>
              </HeadlineTop>
              {result.filled !== 0n && result.averagePrice !== undefined ? (
                <HeadlineTitle>
                  {qtyLabel(nativeQty(result.filled))}
                  <HeadlineAt>
                    {" "}
                    @ {(Number(result.averagePrice) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)} USDC
                    {result.fillCount > 1 ? " avg" : ""}
                  </HeadlineAt>
                </HeadlineTitle>
              ) : result.resting !== 0n ? (
                <HeadlineTitle>
                  {qtyLabel(nativeQty(result.resting))}
                  <HeadlineAt> @ {priceLabel}</HeadlineAt>
                </HeadlineTitle>
              ) : (
                <HeadlineTitle>
                  {offsetPlan
                    ? `${qtyLabel(offsetPlan.offsetQty)} netted against your resting ${oppositeAction}`
                    : "No change"}
                </HeadlineTitle>
              )}
              {result.detail && <HeadlineDetail>{result.detail}</HeadlineDetail>}
            </Headline>

            {/* Only the parts that did *not* fill need a line of their own — the
                fill is the headline. */}
            {(result.resting !== 0n || result.cancelled !== 0n) && result.filled !== 0n && (
              <Section>
                <SectionTitle>Remainder</SectionTitle>
                <CostCard>
                  {result.resting !== 0n && (
                    <CostRow
                      label="Resting on the book"
                      value={`${qtyLabel(nativeQty(result.resting))} @ ${priceLabel}`}
                      hint="Waits to be matched; fee and points for this part apply when it fills"
                    />
                  )}
                  {result.cancelled !== 0n && (
                    <CostRow
                      label="Cancelled"
                      value={qtyLabel(nativeQty(result.cancelled))}
                      hint="Could not be matched immediately, so this part was not placed"
                    />
                  )}
                </CostCard>
              </Section>
            )}

            <Section>
              <SectionTitle>Your account now</SectionTitle>
              <CostCard>
                {result.filled !== 0n && (
                  <CostRow
                    label={result.feePaid < 0n ? "Fee rebate" : "Fee charged"}
                    value={usdc(result.feePaid < 0n ? -result.feePaid : result.feePaid)}
                    hint={result.fillCount > 1 ? `Across ${result.fillCount} fills` : undefined}
                  />
                )}
                {result.resting !== 0n && (
                  <CostRow
                    label="Fee locked"
                    tooltip="Held against the resting part until it fills or is cancelled: the higher of the maker and taker fee. The unused difference is returned on fill; the whole amount if the order is cancelled or expires."
                    value={usdc(result.feeLocked)}
                  />
                )}
                {baseline?.im !== undefined && (
                  <CostRow
                    label={
                      result.marginLocked !== undefined && result.marginLocked < 0n
                        ? "Margin released"
                        : "Margin locked"
                    }
                    tooltip="Change in your portfolio initial margin from this transaction — what the venue now holds for the filled position and the resting part together."
                    value={result.marginLocked !== undefined ? usdc(abs(result.marginLocked)) : "Updating…"}
                  />
                )}
                <CostDivider />
                {baseline?.available !== undefined && (
                  <CostRow
                    muted
                    label="Available balance"
                    value={
                      <Delta
                        before={usdc(baseline.available)}
                        after={result.availableNow !== undefined ? usdc(result.availableNow) : "Updating…"}
                        tone={result.availableNow !== undefined && result.availableNow < 0n ? "danger" : "neutral"}
                      />
                    }
                  />
                )}
                {baseline && (baseline.liq || baseline.underwater || result.liqNow || (accountFresh && liveUnderwater)) && (
                  <CostRow
                    muted
                    label="Liq. price"
                    value={
                      <Delta
                        before={liqLabelWithArrow(baseline.liq, baseline.underwater)}
                        after={accountFresh ? liqLabelWithArrow(result.liqNow, liveUnderwater) : "Updating…"}
                        tone={accountFresh && liveUnderwater ? "danger" : "neutral"}
                      />
                    }
                  />
                )}
                {result.positionAfter !== undefined && (
                  <CostRow muted label="Position" value={positionLabel(result.positionAfter)} />
                )}
                {result.pointsEarned !== null && result.pointsEarned > 0 && (
                  <CostRow
                    label="Points earned"
                    value={<Bright>{result.pointsEarned.toFixed(2)} pts</Bright>}
                  />
                )}
              </CostCard>
            </Section>
          </Review>
        ) : (
          <p className="w-6/6 text-left font-normal text-s mt-5">
            {offsetPlan && offsetPlan.leftoverQty === 0
              ? "Your resting order has been offset and will leave the order book shortly."
              : "Your order has been placed and will appear in the order book shortly."}
          </p>
        )
      }
      transactionSteps={[
        {
          label: executeLabel ?? modalTitle,
          action: async () => {
            // Check for conflicting order before proceeding. The offset path is
            // the deliberate resolution of that conflict, so it never applies.
            if (!offsetPlan && !bypassConflictCheck && hasConflictingOrder()) {
              const priceInUSDC = Number(price) / PAYMENT_TOKEN_SCALE_NUM;
              throw new Error(
                `Cannot create ${
                  isBuy ? "Bid" : "Ask"
                } order at price ${priceInUSDC} USDC. You already have an active ${oppositeAction} order at the same price and expiration date. Please cancel or modify the existing order first.`,
              );
            }

            // Freeze the "before" side of the result step now; the live reads
            // move on once the transaction lands.
            setAccountFresh(false);
            setBaseline({
              available: availableBefore,
              im: orderMargin.currentIm,
              liq: fillPreview?.before.liq,
              underwater: fillPreview?.before.underwater ?? false,
            });

            let txhash: `0x${string}` | undefined;
            if (offsetPlan) {
              // One transaction: the cancels and reduces retire the overlapping
              // size, and only what exceeds it is placed as a new order.
              const leftover = offsetPlan.leftoverQty;
              if (contractMode === "perpetual") {
                txhash = await perpsUpdateOrders({
                  cancelIds: offsetPlan.cancelIds,
                  reduces: offsetPlan.reduces,
                  creates:
                    leftover > 0 ? [{ price, quantity: isBuy ? leftover : -leftover }] : [],
                });
              } else {
                const leftoverUnits = BigInt(Math.round(leftover));
                txhash = await futuresUpdateOrders({
                  cancelIds: offsetPlan.cancelIds,
                  reduces: offsetPlan.reduces,
                  creates:
                    leftoverUnits > 0n
                      ? [
                          {
                            price,
                            expirationAt,
                            quantity: isBuy ? leftoverUnits : -leftoverUnits,
                            timeInForce,
                          },
                        ]
                      : [],
                });
              }
            } else if (contractMode === "perpetual") {
              // Perps only needs price and quantity
              txhash = await perpsCreateOrder.createOrderAsync({
                price,
                quantity,
                timeInForce,
              });
            } else {
              txhash = await futuresCreateOrder.createOrderAsync({
                price,
                expirationAt,
                quantity,
                timeInForce,
              });
            }
            return {
              isSkipped: false,
              txhash: txhash,
            };
          },
          postConfirmation: async (receipt: TransactionReceipt) => {
            const venue = contractMode === "perpetual" ? "perps" : "futures";
            const contractAddress = (
              venue === "perps"
                ? process.env.REACT_APP_PERPS_TOKEN_ADDRESS
                : process.env.REACT_APP_FUTURES_TOKEN_ADDRESS
            ) as `0x${string}` | undefined;
            // The receipt is the record; decode it straight away so the summary
            // is on screen the moment the step reads "successful".
            if (address) {
              setExecution(
                summarizeOrderExecution({ logs: receipt.logs, venue, user: address, contractAddress }),
              );
            }

            // Wait for block number to ensure indexer has updated
            await waitForOrderBookBlockNumber(
              receipt.blockNumber,
              qc,
              contractMode,
              Number(expirationAt),
            );

            // Invalidate queries based on contract mode
            if (contractMode === "perpetual") {
              // For perps, invalidate perps-specific queries
              await Promise.all([
                qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
                address && qc.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, address] }),
                address && qc.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, address] }),
                // Reset every perps history table back to its newest page.
                address && qc.resetQueries({ queryKey: [PERPS_ORDER_HISTORY_QK, address] }),
                address && qc.resetQueries({ queryKey: [PERPS_POSITION_HISTORY_QK, address] }),
                address && qc.resetQueries({ queryKey: [USER_TRADES_QK, address] }),
                // address && qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
                invalidatePortfolioPnl(qc),
              ]);
            } else {
              // For futures, invalidate futures-specific queries
              await Promise.all([
                qc.invalidateQueries({ queryKey: [getOrderBookQueryKey(contractMode)] }),
                address && qc.invalidateQueries({ queryKey: [POSITION_BOOK_QK] }),
                address && qc.invalidateQueries({ queryKey: [PARTICIPANT_QK] }),
                // Reset every futures history table back to its newest page.
                address && qc.resetQueries({ queryKey: [HISTORICAL_ORDERS_QK, address] }),
                address && qc.resetQueries({ queryKey: [FUTURES_POSITION_HISTORY_QK, address] }),
                address && qc.resetQueries({ queryKey: [USER_FUTURES_TRADES_QK, address] }),
                invalidatePortfolioPnl(qc),
              ]);
            }

            // The balance, IM and liquidation level on the result step are live
            // reads that otherwise refresh on a 10s poll. Refetch them, and only
            // then let the "now" side show — before that it is the pre-trade value.
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["readContract"] }),
              qc.invalidateQueries({ queryKey: ["readContracts"] }),
            ]);
            setAccountFresh(true);

            if (onOrderPlaced) {
              await onOrderPlaced();
            }
          },
        },
      ]}
    />
  );
};
