import { type FC, type ReactNode, useMemo } from "react";
import styled from "@mui/material/styles/styled";
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
import { useFuturesContractSpecs } from "../../hooks/data/useFuturesContractSpecs";
import { useOrderMargin } from "../../hooks/data/useOrderMargin";
import type { OrderMarginQuote } from "../../lib/orderMargin";
import Tooltip from "@mui/material/Tooltip";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { useMakerTakerFees } from "../../hooks/data/useMakerTakerFees";
import { usePointsHookWeights } from "../../hooks/data/usePointsHookWeights";
import type { PerpsCollection } from "../../hooks/data/perps/usePerpsCollection";
import {
  formatHashratePHPS,
  PAYMENT_TOKEN_SCALE_NUM,
  QUANTITY_SCALE,
  QUANTITY_SCALE_NUM,
} from "../../lib/units";
import { quoteOrderFees } from "../../lib/orderFees";
import { TimeInForce, type TimeInForceValue } from "../../types/timeInForce";
import { tokens } from "../../styles/tokens";

const TIF_LABELS: Record<TimeInForceValue, string> = {
  [TimeInForce.GTC]: "GTC",
  [TimeInForce.IOC]: "IOC",
  [TimeInForce.FOK]: "FOK",
};

const usdc = (value: bigint) => `${(Number(value) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2)} USDC`;

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
  timeInForce?: TimeInForceValue;
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
  timeInForce = TimeInForce.GTC,
}) => {
  // Conditionally use futures or perps create order hook
  const futuresCreateOrder = useCreateOrder();
  const perpsCreateOrder = useCreatePerpsOrder();
  const { updateOrdersAsync: futuresUpdateOrders } = useUpdateFuturesOrders();
  const { updateOrdersAsync: perpsUpdateOrders } = useUpdatePerpsOrders();
  const qc = useQueryClient();
  const { address } = useAccount();
  const _publicClient = usePublicClient();
  const contractSpecsQuery = useFuturesContractSpecs();
  const {
    feeFor,
    makerFeeBps: futuresMakerFeeBps,
    takerFeeBps: futuresTakerFeeBps,
    isLoading: isFeesLoading,
  } = useMakerTakerFees();
  const { wMaker, wTaker, weightScale, isLoading: isWeightsLoading } = usePointsHookWeights();

  // Determine order type from quantity sign
  const isBuy = quantity > 0;
  const absoluteQuantity = Math.abs(quantity);

  // Only the part that outlives the offset reaches the book, so it is the only
  // part that needs margin or shows up as a new resting order.
  const restingQuantity = offsetPlan ? offsetPlan.leftoverQty : absoluteQuantity;

  // Notional size (USDC) of this order — matches the "Size" row below.
  const sizeUSDC = (Number(price) / PAYMENT_TOKEN_SCALE_NUM) * absoluteQuantity;

  // Expected hashrate = order quantity × on-chain contract size (hashes/s·day),
  // formatted as PH/s. One unit settles the value of `contractSizeHpsDay`.
  const contractSizeHpsDay = contractSpecsQuery.data?.data?.contractSizeHpsDay;
  const expectedHashrate =
    contractSizeHpsDay !== undefined
      ? formatHashratePHPS(
          (contractSizeHpsDay * BigInt(Math.round(absoluteQuantity * QUANTITY_SCALE_NUM))) /
            QUANTITY_SCALE,
        ).full
      : null;

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
  // `headroom` is balance − IM after − reserved fee: what is left to trade with.
  const availableAfter = marginQuote?.headroom;
  const availableBefore = marginQuote
    ? marginQuote.headroom + marginQuote.imIncrease + marginQuote.reservedFee
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

  // A GTC limit may fill now (taker) or rest and fill later (maker); market,
  // IOC and FOK never rest, so they are takers for whatever they fill.
  const canRest = !isMarketOrder && timeInForce === TimeInForce.GTC;
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
  const deliveryLabel = new Date(Number(expirationAt) * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const tifLabel = TIF_LABELS[timeInForce];
  const pct = (bps: number) => `${(Math.abs(bps) / 100).toFixed(2)}%`;

  /** Fee row: the figure that is held, with how it splits by fill role underneath. */
  const feeValue: ReactNode = (() => {
    if (fees === undefined) return feeRatesLoading ? "Loading…" : "—";
    if (!canRest || fees.maker === undefined || fees.maker === fees.taker) return usdc(fees.taker);
    return `up to ${usdc(fees.reserved)}`;
  })();
  const feeTooltip = (() => {
    const lock =
      "Locked from your balance when the order is placed and returned if the order is cancelled or expires unfilled. The fee is only actually charged on the amount that fills.";
    if (fees === undefined || makerFeeBps === undefined || takerFeeBps === undefined) return lock;
    if (!canRest || fees.maker === undefined) {
      return `${lock} This order cannot rest on the book, so the taker rate of ${pct(takerFeeBps)} applies.`;
    }
    const makerPart =
      fees.maker < 0n
        ? `you receive a ${usdc(-fees.maker)} rebate (${pct(makerFeeBps)})`
        : `you pay ${usdc(fees.maker)} (${pct(makerFeeBps)})`;
    return `${lock} If it fills immediately you pay the taker fee of ${usdc(fees.taker)} (${pct(
      takerFeeBps,
    )}); if it rests on the book and fills later ${makerPart}. The higher of the two is locked.`;
  })();

  return (
    <TransactionForm
      onClose={closeForm}
      title={offsetPlan ? "Offset Order" : isBuy ? "Place Bid Order" : "Place Ask Order"}
      description={""}
      reviewForm={(_props) => (
        <Review>
          {/* What the order is — the terms the user just entered, in one glance. */}
          <Headline>
            <HeadlineTop>
              <SideBadge $isBuy={isBuy}>{isBuy ? "Bid" : "Ask"}</SideBadge>
              <HeadlineMeta>
                {isMarketOrder ? "Market" : "Limit"} · {tifLabel}
              </HeadlineMeta>
              {contractMode === "futures" && (
                <HeadlineDelivery title="Delivery date">{deliveryLabel}</HeadlineDelivery>
              )}
            </HeadlineTop>
            {/* Perps are sized in USDC, so notional leads; futures trade in whole
                contracts backed by hashrate, so the contract count leads there. */}
            <HeadlineTitle>
              {qtyLabel(absoluteQuantity)}
              <HeadlineAt> {isMarketOrder ? "at market" : `@ ${priceLabel}`}</HeadlineAt>
            </HeadlineTitle>
            <HeadlineStats>
              <HeadlineStat>
                <span>Notional</span>
                <strong>{sizeUSDC.toFixed(2)} USDC</strong>
              </HeadlineStat>
              {contractMode === "futures" && expectedHashrate && (
                <HeadlineStat>
                  <span>Hashrate</span>
                  <strong>{expectedHashrate}</strong>
                </HeadlineStat>
              )}
              <HeadlineStat>
                <span>
                  Points (est.)
                  <HelpTip title="Points are only rewarded if your order is matched and becomes a position. Maker points apply if it rests and fills later; taker points if it fills immediately." />
                </span>
                <strong>
                  {makerReward !== null && takerReward !== null
                    ? `${makerReward.toFixed(2)} maker / ${takerReward.toFixed(2)} taker`
                    : isWeightsLoading
                      ? "Loading…"
                      : "—"}
                </strong>
              </HeadlineStat>
            </HeadlineStats>
          </Headline>

          {offsetPlan && (
            <OffsetNote>
              Nets <strong>{qtyLabel(offsetPlan.offsetQty)}</strong> against your resting{" "}
              {oppositeAction} in one transaction — nothing is sent to the market for that part.{" "}
              {offsetPlan.leftoverQty > 0
                ? `The remaining ${qtyLabel(offsetPlan.leftoverQty)} are placed as a new ${
                    isBuy ? "bid" : "ask"
                  }; the costs below are for that part only.`
                : "Nothing new is placed, so no margin or fee is required."}
            </OffsetNote>
          )}

          {/* What it costs — the part the user has not seen yet. */}
          {!placesNothing && (
            <Section>
              <SectionTitle>What you pay</SectionTitle>
              <CostCard>
                <CostRow
                  label="Margin required"
                  tooltip="Locked from your balance when the order is placed and held while the order rests or the position is open. Returned in full if the order is cancelled or expires unfilled, and released when the position is closed."
                  value={requiredMargin !== null ? usdc(requiredMargin) : "Loading…"}
                  hint={
                    requiredMargin === 0n
                      ? "Reduces your exposure — no extra collateral needed"
                      : undefined
                  }
                />
                <CostRow
                  label={canRest ? "Trading fee (est.)" : "Trading fee"}
                  tooltip={feeTooltip}
                  value={feeValue}
                />
                <CostDivider />
                <CostRow
                  emphasis
                  label="Total locked"
                  tooltip="Taken from your available balance now: the margin plus the highest fee this order could incur. Everything not used is returned — the whole amount if the order is cancelled or expires unfilled, and the margin when the position is closed."
                  value={totalRequired !== undefined ? usdc(totalRequired) : "Loading…"}
                />
                {availableBefore !== undefined && availableAfter !== undefined && (
                  <CostRow
                    muted
                    label="Available balance"
                    tooltip="Your balance not locked by orders or positions, before and after placing this order."
                    value={
                      <>
                        <Muted>{usdc(availableBefore)}</Muted>
                        <Arrow>→</Arrow>
                        <Balance $negative={availableAfter < 0n}>{usdc(availableAfter)}</Balance>
                      </>
                    }
                  />
                )}
              </CostCard>
            </Section>
          )}
        </Review>
      )}
      resultForm={(_props) => (
        <>
          <p className="w-6/6 text-left font-normal text-s mt-5">
            {offsetPlan && offsetPlan.leftoverQty === 0
              ? "Your resting order has been offset and will leave the order book shortly."
              : "Your order has been placed and will appear in the order book shortly."}
          </p>
        </>
      )}
      transactionSteps={[
        {
          label: offsetPlan ? "Offset Order" : `Place ${isBuy ? "Bid" : "Ask"} Order`,
          action: async () => {
            // Check for conflicting order before proceeding. The offset path is
            // the deliberate resolution of that conflict, so it never applies.
            if (!offsetPlan && !bypassConflictCheck && hasConflictingOrder()) {
              const priceInUSDC = Number(price) / PAYMENT_TOKEN_SCALE_NUM;
              throw new Error(
                `Cannot create ${
                  isBuy ? "Bid" : "Ask"
                } order at price ${priceInUSDC} USDC. You already have an active ${oppositeAction} order at the same price and expiration date. Please close or modify the existing order first.`,
              );
            }

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

            if (onOrderPlaced) {
              await onOrderPlaced();
            }
          },
        },
      ]}
    />
  );
};

const HelpTip = ({ title }: { title: string }) => (
  <Tooltip title={title} arrow placement="top">
    <HelpOutlineIcon sx={{ fontSize: 14, cursor: "help", color: tokens.text.muted }} />
  </Tooltip>
);

/** One line of the cost card: label on the left, USDC on the right, optional hint under it. */
const CostRow = ({
  label,
  tooltip,
  value,
  hint,
  emphasis = false,
  muted = false,
}: {
  label: string;
  tooltip?: string;
  value: ReactNode;
  hint?: ReactNode;
  emphasis?: boolean;
  muted?: boolean;
}) => (
  <CostRowRoot>
    <CostRowMain>
      <CostLabel $emphasis={emphasis} $muted={muted}>
        {label}
        {tooltip && <HelpTip title={tooltip} />}
      </CostLabel>
      <CostValue $emphasis={emphasis} $muted={muted}>
        {value}
      </CostValue>
    </CostRowMain>
    {hint && <CostHint>{hint}</CostHint>}
  </CostRowRoot>
);

const Review = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const Headline = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.875rem 1rem;
  background: ${tokens.surface.inputIsland};
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.md};
`;

const HeadlineTop = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
`;

const SideBadge = styled("span")<{ $isBuy: boolean }>`
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: ${tokens.radius.sm};
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: ${(p) => (p.$isBuy ? tokens.trading.longHighlightBg : tokens.trading.shortHighlightBg)};
  color: ${(p) => (p.$isBuy ? tokens.trading.long : tokens.trading.short)};
`;

const HeadlineMeta = styled("span")`
  font-size: 0.8rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
`;

const HeadlineDelivery = styled("span")`
  margin-left: auto;
  font-size: 0.75rem;
  color: ${tokens.text.secondary};
  white-space: nowrap;
`;

const HeadlineTitle = styled("div")`
  font-size: 1.25rem;
  font-weight: 600;
  color: ${tokens.text.onDark};
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
`;

const HeadlineAt = styled("span")`
  font-weight: 500;
  color: ${tokens.text.secondary};
`;

const HeadlineStats = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.5rem;
  padding-top: 0.625rem;
  border-top: 1px solid ${tokens.border.default};
`;

const HeadlineStat = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;

  span {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: ${tokens.text.secondary};
  }

  strong {
    color: ${tokens.text.onDark};
    font-weight: 600;
    text-align: right;
  }
`;

const OffsetNote = styled("p")`
  margin: 0;
  padding: 0.75rem 1rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: ${tokens.text.secondary};
  background: ${tokens.trading.infoRowBg};
  border: 1px solid ${tokens.trading.infoBorder};
  border-radius: ${tokens.radius.md};

  strong {
    color: ${tokens.text.onDark};
    font-weight: 600;
  }
`;

const Section = styled("section")`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const SectionTitle = styled("h3")`
  margin: 0;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${tokens.text.secondary};
`;

const CostCard = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.md};
`;

const CostRowRoot = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
`;

const CostRowMain = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
`;

const CostLabel = styled("span")<{ $emphasis: boolean; $muted: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: ${(p) => (p.$emphasis ? "0.9375rem" : p.$muted ? "0.8125rem" : "0.875rem")};
  font-weight: ${(p) => (p.$emphasis ? 600 : 400)};
  color: ${(p) => (p.$emphasis ? tokens.text.onDark : p.$muted ? tokens.text.muted : tokens.text.secondary)};
`;

const CostValue = styled("span")<{ $emphasis: boolean; $muted: boolean }>`
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  font-size: ${(p) => (p.$emphasis ? "1.125rem" : p.$muted ? "0.8125rem" : "0.9375rem")};
  font-weight: ${(p) => (p.$emphasis ? 700 : 500)};
  color: ${(p) => (p.$muted ? tokens.text.secondary : tokens.text.onDark)};
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

const Muted = styled("span")`
  color: ${tokens.text.muted};
  font-weight: 400;
`;

const Arrow = styled("span")`
  color: ${tokens.text.muted};
  font-weight: 400;
`;

const Balance = styled("span")<{ $negative: boolean }>`
  color: ${(p) => (p.$negative ? tokens.trading.short : tokens.text.onDark)};
`;

const CostHint = styled("div")`
  font-size: 0.75rem;
  line-height: 1.4;
  color: ${tokens.text.muted};
  font-variant-numeric: tabular-nums;
`;

const CostDivider = styled("hr")`
  margin: 0.125rem 0;
  border: none;
  border-top: 1px solid ${tokens.border.default};
`;
