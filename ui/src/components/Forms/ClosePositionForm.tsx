import { type FC, useEffect, useState } from "react";
import { styled } from "next-yak";
import type { Participant } from "../../hooks/data/getUserFuturesOrders";
import type { PerpsCollection } from "../../hooks/data/perps/usePerpsCollection";
import { useSimulateFuturesOrder } from "../../hooks/data/useSimulateFuturesOrder";
import { useSimulatePerpsOrder } from "../../hooks/data/perps/useSimulatePerpsOrder";
import { formatMonthDay } from "../../lib/dates";
import { closingIntent } from "../../lib/exitAll";
import { PAYMENT_TOKEN_SCALE_NUM, QUANTITY_SCALE_NUM } from "../../lib/units";
import { TimeInForce } from "../../types/timeInForce";
import type { ContractMode } from "../../types/types";
import { showAlert } from "../AlertModal";
import { PerpsOrderFormFields, usePerpsOrderForm } from "../Widgets/Futures/PerpsOrderFormFields";
import { PlaceOrderForm } from "./PlaceOrderForm";
import { MultistepFormActions } from "./Shared/MultistepForm";
import { ModeButton, ModeToggle, OrderTypeRow } from "./Shared/OrderFields";
import {
  CostCard,
  CostHint,
  Headline,
  HeadlineAt,
  HeadlineDelivery,
  HeadlineStat,
  HeadlineStats,
  HeadlineTitle,
  HeadlineTop,
  PnlValue,
  Section,
  SectionTitle,
  SideBadge,
} from "./Shared/ReviewPrimitives";

/** How far past the mark a market close may fill before the remainder is dropped. */
export const CLOSE_MARKET_SLIPPAGE = 0.05;

/** One open position as the widgets know it — the same shape "Close all" uses. */
export interface ClosablePosition {
  /** Signed native quantity: long > 0, short < 0. */
  netQuantity: bigint;
  entryPrice: bigint;
  /** Futures only. */
  expirationAt?: bigint;
}

export interface ClosePositionFormProps {
  contractMode: ContractMode;
  position: ClosablePosition;
  /** Native-unit mark; without one, Market is unavailable. */
  marketPrice: bigint | undefined;
  /** Native-unit tick. */
  priceStep: bigint;
  /** Futures: lets the review step catch an opposing resting order at the same price. */
  participantData?: Participant | null;
  /** Perps: fee rates for the review step. */
  perpsCollection?: PerpsCollection;
  closeForm: () => void;
  onConfirmed?: () => void | Promise<void>;
}

/**
 * Closing is placing the opposite order, so this form only owns the part the
 * order widget would: the position being closed, Limit or Market, price and
 * amount. Review, transaction and result are `PlaceOrderForm`, the same
 * screens a Bid/Ask goes through, so the margin, fee and after-trade figures
 * are computed once and read the same everywhere.
 */
export const ClosePositionForm: FC<ClosePositionFormProps> = ({
  contractMode,
  position,
  marketPrice,
  priceStep,
  participantData,
  perpsCollection,
  closeForm,
  onConfirmed,
}) => {
  const isPerps = contractMode === "perpetual";
  const scale = isPerps ? QUANTITY_SCALE_NUM : 1;
  const isLong = position.netQuantity > 0n;
  const maxQuantity = Number(position.netQuantity < 0n ? -position.netQuantity : position.netQuantity) / scale;
  const entryPrice = Number(position.entryPrice) / PAYMENT_TOKEN_SCALE_NUM;
  const mark = marketPrice !== undefined ? Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM : undefined;

  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [phase, setPhase] = useState<"edit" | "review">("edit");

  const form = usePerpsOrderForm({
    maxQuantity,
    priceStep: Number(priceStep) / PAYMENT_TOKEN_SCALE_NUM,
    quantityDecimals: isPerps ? 6 : 0,
    initialAmountMode: "quantity",
  });

  // Mounted fresh each time the modal opens, so seed once: the whole position
  // at the mark (or entry, when there is no mark yet).
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed on mount only.
  useEffect(() => {
    form.reset((mark ?? entryPrice).toFixed(2), 100);
  }, []);

  const closeQty = form.getCurrentQuantity();
  const marketIntent =
    marketPrice !== undefined ? closingIntent(position, marketPrice, CLOSE_MARKET_SLIPPAGE, priceStep) : undefined;

  /** Native-unit submit price: the typed limit snapped to the tick, or the slippage-capped market price. */
  const submitPrice = (() => {
    if (orderType === "market") return marketIntent?.price;
    const raw = BigInt(Math.round(form.currentPrice * PAYMENT_TOKEN_SCALE_NUM));
    const step = priceStep > 0n ? priceStep : 1n;
    return ((raw + step / 2n) / step) * step;
  })();
  // Closing a long sells, closing a short buys.
  const signedCloseQty = isLong ? -closeQty : closeQty;
  const unrealizedPnl = mark !== undefined ? (mark - entryPrice) * maxQuantity * (isLong ? 1 : -1) : undefined;

  // Market closes are IOC: whatever the book cannot fill within the cap is
  // dropped, so check there is something to fill before going to review.
  const simQty = orderType === "market" && closeQty > 0 ? signedCloseQty : undefined;
  const { refetch: refetchSimFutures } = useSimulateFuturesOrder({
    expirationAt: position.expirationAt,
    price: isPerps ? undefined : marketIntent?.price,
    quantity: isPerps ? undefined : simQty,
    enabled: false,
  });
  const { refetch: refetchSimPerps } = useSimulatePerpsOrder({
    price: isPerps ? marketIntent?.price : undefined,
    quantity: isPerps ? simQty : undefined,
    enabled: false,
  });

  const hasLiquidity = async (): Promise<boolean> => {
    if (orderType !== "market") return true;
    try {
      const sim = await (isPerps ? refetchSimPerps() : refetchSimFutures());
      const filled = sim.data?.[0];
      if (filled === undefined) {
        await showAlert({ message: "Failed to check order book liquidity", variant: "error" });
        return false;
      }
      if (filled === 0n) {
        await showAlert("There is no liquidity in order book");
        return false;
      }
      return true;
    } catch {
      await showAlert({ message: "Failed to check order book liquidity", variant: "error" });
      return false;
    }
  };

  const review = async () => {
    if (closeQty <= 0 || submitPrice === undefined || submitPrice <= 0n) {
      await showAlert("Please enter a valid close quantity and price");
      return;
    }
    if (!(await hasLiquidity())) return;
    setPhase("review");
  };

  const qtyLabel = (value: number) =>
    `${isPerps ? String(Number(value.toFixed(6))) : value.toFixed(0)} ${value === 1 ? "contract" : "contracts"}`;
  const usdc = (value: number) => `${value.toFixed(2)} USDC`;
  const signed = (value: number) => `${value >= 0 ? "+" : "−"}${usdc(Math.abs(value))}`;

  if (phase === "review" && submitPrice !== undefined) {
    return (
      <PlaceOrderForm
        title="Close Position"
        executeLabel="Close Position"
        orderCaption="Closing order"
        price={submitPrice}
        expirationAt={position.expirationAt ?? 0n}
        quantity={signedCloseQty}
        participantData={participantData}
        contractMode={contractMode}
        perpsCollection={perpsCollection}
        isMarketOrder={orderType === "market"}
        marketSlippage={CLOSE_MARKET_SLIPPAGE}
        timeInForce={orderType === "market" ? TimeInForce.IOC : TimeInForce.GTC}
        onOrderPlaced={onConfirmed}
        onBack={() => setPhase("edit")}
        closeForm={closeForm}
      />
    );
  }

  return (
    <>
      <h2>Close Position</h2>
      <Edit>
        {/* What is held, stated the way the review states an order. */}
        <Section>
          <SectionTitle>Your position</SectionTitle>
          <PositionCard>
          <HeadlineTop>
            <SideBadge $isBuy={isLong}>{isLong ? "Long" : "Short"}</SideBadge>
            {position.expirationAt !== undefined && (
              <HeadlineDelivery>
                <span>Expires</span> {formatMonthDay(position.expirationAt)}
              </HeadlineDelivery>
            )}
          </HeadlineTop>
          <HeadlineTitle className="title">
            {qtyLabel(maxQuantity)}
            <HeadlineAt> @ {usdc(entryPrice)}</HeadlineAt>
          </HeadlineTitle>
          <HeadlineStats>
            <HeadlineStat>
              <span>Mark</span>
              <strong>{mark !== undefined ? usdc(mark) : "—"}</strong>
            </HeadlineStat>
            {unrealizedPnl !== undefined && (
              <HeadlineStat>
                <span>Unrealized PnL</span>
                <PnlValue $positive={unrealizedPnl >= 0}>{signed(unrealizedPnl)}</PnlValue>
              </HeadlineStat>
            )}
          </HeadlineStats>
          </PositionCard>
        </Section>

        {/* The order that closes it, laid out as the sidebar lays out a new one:
            Limit/Market on top, then price, then amount with its slider. */}
        <Section>
          <SectionTitle>Closing order</SectionTitle>
          <OrderCard>
            <OrderTypeRow>
              <ModeToggle>
                <ModeButton $active={orderType === "limit"} onClick={() => setOrderType("limit")}>
                  Limit
                </ModeButton>
                <ModeButton
                  $active={orderType === "market"}
                  disabled={mark === undefined}
                  onClick={() => {
                    setOrderType("market");
                    if (mark !== undefined) form.handlePriceChange(mark.toFixed(2));
                  }}
                >
                  Market
                </ModeButton>
              </ModeToggle>
              {orderType === "market" && (
                <CostHint>Fills now, up to {CLOSE_MARKET_SLIPPAGE * 100}% from mark</CostHint>
              )}
            </OrderTypeRow>
            <PerpsOrderFormFields
              compact
              price={form.price}
              amount={form.amount}
              amountMode={form.amountMode}
              sliderValue={form.sliderValue}
              hidePriceInput={orderType === "market"}
              quantityDecimals={isPerps ? 6 : 0}
              currentQuantity={closeQty}
              currentSize={form.getCurrentSize()}
              summary={null}
              onPriceChange={form.handlePriceChange}
              onAmountChange={form.handleAmountChange}
              onAmountModeChange={form.handleAmountModeChange}
              onSliderChange={form.handleSliderChange}
              onSliderCommitted={form.handleSliderCommitted}
              onIncrementPrice={form.incrementPrice}
              onDecrementPrice={form.decrementPrice}
            />
          </OrderCard>
        </Section>
      </Edit>

      <Actions>
        <MultistepFormActions
          primary={{ label: "Review", onClick: review, disabled: closeQty <= 0 || !submitPrice }}
          secondary={{ label: "Cancel", onClick: closeForm }}
        />
      </Actions>
    </>
  );
};

/* Two titled sections, then buttons: one rhythm. */
const Edit = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`;

/* The review headline, one step down in size: here it is context, not the headline. */
const PositionCard = styled(Headline)`
  .title {
    font-size: 1.125rem;
  }
`;

/* The review pairs a filled headline card with an outlined cost card; the edit
   phase mirrors it — filled position, outlined order — so the inputs, which are
   filled themselves, still stand out inside their group. */
const OrderCard = styled(CostCard)`
  gap: 1rem;
`;

const Actions = styled.div`
  && > div {
    margin-top: 1.5rem;
  }
`;
