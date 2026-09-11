import { styled, css } from "next-yak";
import { SmallWidget } from "../../Cards/Cards.styled";
import { type ComponentProps, type CSSProperties, useState, useEffect, useId, useMemo, useRef } from "react";
import { SliderMark } from "../../Slider";
import { Tooltip } from "../../Tooltip";
import { tokens } from "../../../styles/tokens";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useGetMarketPrice } from "../../../hooks/data/useGetMarketPrice";
import { Spinner } from "../../Spinner.styled";
import { ModalItem } from "../../Modal";
import { showAlert } from "../../AlertModal";
import { PrimaryButton, SecondaryButton } from "../../Forms/FormButtons/Buttons.styled";
import { PlaceOrderForm, type OrderOffsetPlan } from "../../Forms/PlaceOrderForm";
import { PERCENT_MARKS, StyledSlider } from "../../Forms/Shared/StyledSlider";
import { percentForQuantity, quantityAtPercent, snapQuantityDown } from "../../../lib/sliderSnap";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GetResponse } from "../../../gateway/interfaces";
import type { FuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import type { Participant } from "../../../hooks/data/getUserFuturesOrders";
import type { PerpsOrder } from "../../../hooks/data/perps/useUserPerpsOrders";
import type { ContractMode, AccountBalance } from "../../../types/types";
import type { PerpsCollection } from "../../../hooks/data/perps/usePerpsCollection";
import { formatDateTime } from "../../../lib/dates";
import { planOffset, type RestingOrder } from "../../../lib/orderUpdatePlan";
import { useOrderMargin } from "../../../hooks/data/useOrderMargin";
import {
  handleNumericDecimalInput,
  handleNumericDecimalInput6Decimals,
  handleNumericIntegerInput,
} from "../../Forms/Shared/AmountInputForm";
import { feeReserverFor, useMakerTakerFees } from "../../../hooks/data/useMakerTakerFees";
import type { OrderVenue } from "../../../lib/orderMargin";
import type { AmountMode } from "./PerpsOrderFormFields";
import {
  AmountInputWrapper,
  AmountModeDropdown,
  InputGroup,
  ModeButton,
  ModeToggle,
  OrderTypeRow,
  PriceButton,
  PriceInputContainer,
  highlightedPulse,
  SliderContainer,
  TifDropdown,
} from "../../Forms/Shared/OrderFields";
import { useSimulatePerpsOrder } from "../../../hooks/data/perps/useSimulatePerpsOrder";
import { useSimulateFuturesOrder } from "../../../hooks/data/useSimulateFuturesOrder";
import {
  formatHashratePHPS,
  PAYMENT_TOKEN_SCALE_NUM,
  QUANTITY_SCALE,
  QUANTITY_SCALE_NUM,
} from "../../../lib/units";
import { TimeInForce, type TimeInForceValue } from "../../../types/timeInForce";

const TIF_TOOLTIPS = {
  GTC: "Good Till Cancel — fill what you can now; any remainder rests on the book until filled or cancelled.",
  IOC: "Immediate or Cancel — fill what you can right now; cancel anything left. Reverts if nothing fills.",
  FOK: "Fill or Kill — fill the entire size immediately, or cancel the whole order. No partial fills.",
} as const;

const TIF_TOOLTIP_BY_VALUE: Record<TimeInForceValue, string> = {
  [TimeInForce.GTC]: TIF_TOOLTIPS.GTC,
  [TimeInForce.IOC]: TIF_TOOLTIPS.IOC,
  [TimeInForce.FOK]: TIF_TOOLTIPS.FOK,
};

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface PlaceOrderWidgetProps {
  externalPrice?: string;
  externalAmount?: number;
  externalExpirationAt?: number;
  externalIsBuy?: boolean;
  highlightTrigger?: number;
  address?: `0x${string}`;
  contractSpecsQuery: UseQueryResult<GetResponse<FuturesContractSpecs>, Error>;
  participantData?: Participant | null;
  /** The user's own resting perps orders, used for conflict detection in perps mode. */
  perpsOpenOrders?: PerpsOrder[];
  /**
   * Signed net open position in contract units — whole contracts for futures at
   * `externalExpirationAt`, QUANTITY_SCALE units for perps. Lets the widget spot
   * orders that only unwind the position, which the venues accept below margin.
   */
  openPositionNetQuantity?: bigint | null;
  highlightMode: "inputs" | "buttons" | undefined;
  onOrderPlaced?: () => void | Promise<void>;
  minMargin?: bigint | null;
  contractMode?: ContractMode;
  accountBalance?: AccountBalance;
  balanceQuery: BalanceQueryResult;
  perpsCollection?: PerpsCollection;
  quantityUnit?: string;
}

// Slippage applied to market orders so the order crosses the spread.
// Buy orders are priced this much above market; sell orders this much below.
const MARKET_SLIPPAGE = 0.05;

export const PlaceOrderWidget = ({
  externalPrice,
  externalAmount,
  externalExpirationAt,
  externalIsBuy,
  highlightTrigger,
  contractSpecsQuery,
  participantData,
  perpsOpenOrders,
  openPositionNetQuantity,
  highlightMode,
  onOrderPlaced,
  minMargin,
  contractMode = "futures",
  accountBalance,
  balanceQuery,
  perpsCollection,
}: PlaceOrderWidgetProps) => {
  const fieldId = useId();
  const { data: marketPrice, isLoading: isMarketPriceLoading } = useGetMarketPrice();
  const accountBalanceQuery = accountBalance ?? { data: undefined, isLoading: false };
  const { feeFor: futuresFeeFor } = useMakerTakerFees();
  const { isConnected, isConnecting, isReconnecting } = useAccount();
  const { open: openWalletModal } = useAppKit();

  // Fee rates are per venue — futures publish theirs on the contract, perps on
  // the collection — so the reserve has to follow the order, not the widget.
  // A rebate is not spendable headroom; `feeReserverFor` already floors at zero.
  const perpsFeeFor = useMemo(
    () => feeReserverFor(perpsCollection?.makerFeeBps, perpsCollection?.takerFeeBps),
    [perpsCollection?.makerFeeBps, perpsCollection?.takerFeeBps],
  );
  const reserveFee = contractMode === "perpetual" ? perpsFeeFor : futuresFeeFor;
  const orderVenue: OrderVenue = contractMode === "perpetual" ? "perps" : "futures";

  // Calculate price step from contract specs
  const priceStep = contractSpecsQuery.data?.data?.minimumPriceIncrement
    ? Number(contractSpecsQuery.data.data.minimumPriceIncrement) / PAYMENT_TOKEN_SCALE_NUM
    : null;

  // The venue's own margin gate: portfolio initial margin for the whole account
  // with the prospective order added. Both the slider ceiling and the Bid/Ask
  // checks below go through this so they cannot disagree with `createOrder`.
  const orderMargin = useOrderMargin();

  // Get market price for validation and default price
  const newestItemPrice = marketPrice ? Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM : null;

  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [timeInForce, setTimeInForce] = useState<TimeInForceValue>(TimeInForce.GTC);
  const [price, setPrice] = useState("5.00"); // Will be updated when hashrate data loads
  const [priceInitialized, setPriceInitialized] = useState(false); // Track if price has been initialized from hashrate
  const [amount, setAmount] = useState<number | string>(5); // Can be number or string to support decimals in perpetuals
  const [amountMode, setAmountMode] = useState<AmountMode>(
    contractMode === "perpetual" ? "size" : "quantity",
  ); // "size" = USDC notional, "quantity" = raw contracts
  const [sliderValue, setSliderValue] = useState(0); // Slider value 0-100
  // Set when the slider writes `amount`, so the amount→slider effect skips one run.
  const sliderWroteAmountRef = useRef(false);
  const [leverage, setLeverage] = useState(10); // Leverage multiplier (1x to 10x), default 10x
  const [highlightedButton, setHighlightedButton] = useState<"buy" | "sell" | "inputs" | null>(null);
  const [showHighPriceModal, setShowHighPriceModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showLeverageModal, setShowLeverageModal] = useState(false);
  const [bypassConflictCheck, setBypassConflictCheck] = useState(false);
  // Offered while the conflict modal is open, unless the order cannot be offset
  // (market / IOC / FOK). Cleared when the user declines it, so the order form
  // submits an offset exactly when this is set.
  const [offsetPlan, setOffsetPlan] = useState<OrderOffsetPlan | null>(null);

  // Price helpers live above the loading return below: the slider-sync effect
  // runs after that early render too, and everything it reaches must already
  // be initialised.
  const snapToStep = (value: number): number =>
    priceStep ? Math.round(value / priceStep) * priceStep : value;

  // Returns the effective order price: market price (snapped) for market orders, input price for limit orders.
  // For market orders, a 5% slippage buffer is applied so the order is
  // guaranteed to cross the spread: buys are priced 5% above market, sells 5% below.
  const getEffectivePrice = (side?: "buy" | "sell"): number => {
    if (orderType === "market" && newestItemPrice) {
      const base = newestItemPrice;
      if (side) {
        const slipped = side === "buy" ? base * (1 + MARKET_SLIPPAGE) : base * (1 - MARKET_SLIPPAGE);
        return snapToStep(slipped);
      }
      return snapToStep(base);
    }
    return parseFloat(price) || 0;
  };
  const [pendingOrder, setPendingOrder] = useState<{
    price: number;
    amount: number;
    quantity: number; // Positive for Buy, Negative for Sell
  } | null>(null);

  // Get high price percentage from environment variable (default 60 for 160%)
  const highPricePercentage = Number(process.env.REACT_APP_FUTURES_HIGH_PRICE_PERCENTAGE || "60");
  const maxPriceMultiplier = 1 + highPricePercentage / 100; // Convert percentage to multiplier

  // Set default price from newest hashprice when data loads (if no external price set)
  useEffect(() => {
    if (!externalPrice && !priceInitialized && newestItemPrice && priceStep) {
      // Only update if we haven't initialized yet and no external price is set
      const snappedPrice = Math.round(newestItemPrice / priceStep) * priceStep;
      setPrice(snappedPrice.toFixed(2));
      setPriceInitialized(true);
    }
  }, [newestItemPrice, priceStep, externalPrice, priceInitialized]);

  // Update values when external props change
  useEffect(() => {
    if (externalPrice !== undefined) {
      setPrice(externalPrice);
      setPriceInitialized(true); // Mark as initialized when external price is set
    }
  }, [externalPrice]);

  useEffect(() => {
    if (externalAmount !== undefined) {
      // Close-position prefills whole contracts.
      setAmountMode("quantity");
      setAmount(externalAmount);
    }
  }, [externalAmount]);

  useEffect(() => {
    setAmountMode(contractMode === "perpetual" ? "size" : "quantity");
  }, [contractMode]);

  const handleOrderTypeChange = (type: "limit" | "market") => {
    setOrderType(type);
    // Market orders should not rest: default IOC. Limit defaults to GTC.
    setTimeInForce(type === "market" ? TimeInForce.IOC : TimeInForce.GTC);
  };

  // Update slider when price or balance changes.
  // The dependency list enumerates the values `calculateMaxQuantity` and
  // `getNumericAmount` read; both are plain functions redefined on every render,
  // so listing them would rerun this effect on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    // An amount the slider itself just wrote must not be fed back into it: the
    // thumb is at the pointer, and re-deriving it from the snapped quantity
    // would yank it to the integer's position mid-drag. Release parks it there.
    if (sliderWroteAmountRef.current) {
      sliderWroteAmountRef.current = false;
      return;
    }
    setSliderValue(sliderPercentFor(qtyFromAmount(getNumericAmount()), calculateMaxQuantity()));
  }, [
    price,
    balanceQuery.data,
    minMargin,
    // Rebinds when the account snapshot, the engine shocks or the mark move, so
    // the slider follows the same figures the gate will read.
    orderMargin.maxQuantity,
    amount,
    amountMode,
    contractMode,
    leverage,
    orderType,
    openPositionNetQuantity,
  ]);

  // Helper to get numeric amount value for calculations
  const getNumericAmount = (): number => {
    const parsed = typeof amount === "string" ? parseFloat(amount) : amount;
    return Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed;
  };

  // Returns the USDC notional size regardless of amountMode
  const getEffectiveSize = (): number => {
    const numAmt = getNumericAmount();
    if (amountMode === "quantity") {
      return numAmt * (parseFloat(price) || 0);
    }
    return numAmt;
  };

  const isFuturesIntegerQty = contractMode !== "perpetual" && amountMode === "quantity";

  // Switch between Size (USDC) and Quantity (raw contracts), converting the current amount
  const handleAmountModeChange = (mode: AmountMode) => {
    if (mode === amountMode) return;
    const numAmt = getNumericAmount();
    const priceNum = parseFloat(price) || 0;
    setAmountMode(mode);
    if (mode === "size") {
      setAmount((numAmt * priceNum).toFixed(2));
    } else if (contractMode === "perpetual") {
      setAmount(priceNum > 0 ? (numAmt / priceNum).toFixed(6) : "0");
    } else {
      setAmount(priceNum > 0 ? String(Math.round(numAmt / priceNum)) : "0");
    }
  };

  // Calculate margin percentage from leverage
  // Formula: marginPercent = (1 / leverage) * 100
  // Example: 10x leverage = (1/10) * 100 = 10%
  const _getMarginPercentFromLeverage = (): number => {
    return (1 / leverage) * 100;
  };

  // Calculate quantity from the current amount, respecting amountMode.
  // Size mode:     quantity = size / price
  // Quantity mode: quantity = value directly (no conversion needed)
  // Futures contracts are whole units, so size→qty is rounded to the nearest integer.
  const calculateQuantityFromAmount = (value: number, priceValue: number): number => {
    const raw = amountMode === "quantity" || priceValue <= 0 ? value : value / priceValue;
    if (contractMode !== "perpetual") return Math.round(raw);
    return raw;
  };

  // Calculate size (notional) from quantity (reverse operation)
  const _calculateAmountFromQuantity = (quantityValue: number, priceValue: number): number => {
    if (priceValue <= 0) return quantityValue;
    return quantityValue * priceValue;
  };

  // Get expected quantity for display
  const getExpectedQuantity = (): number => {
    const numericAmount = getNumericAmount();
    const currentPrice = parseFloat(price) || 0;
    return calculateQuantityFromAmount(numericAmount, currentPrice);
  };

  /** Contract units the user already has resting on `isBuy`'s side of this book. */
  const restingQuantityOnSide = (isBuy: boolean): bigint => {
    if (contractMode === "perpetual") {
      return (perpsOpenOrders ?? [])
        .filter(
          (order) =>
            (order.status === "ACTIVE" || order.status === "PARTIALLY_FILLED") && order.isBuy === isBuy,
        )
        .reduce((total, order) => total + order.quantity, 0n);
    }

    const expirationAtValue = externalExpirationAt ? BigInt(externalExpirationAt) : 0n;
    return (participantData?.orders ?? [])
      .filter(
        (order) =>
          order.isActive && order.isBuy === isBuy && order.expirationAt === expirationAtValue,
      )
      .reduce((total, order) => total + BigInt(order.quantity), 0n);
  };

  /**
   * Largest order, in contract units, that can still only unwind the open
   * position: the position itself less whatever already rests on the reducing
   * side. Mirrors `_isLocallyReducing` / `_restingReduceAbs` on the venue
   * contracts. Zero while the user is flat.
   */
  const reduceOnlyCapacity = (): bigint => {
    const position = openPositionNetQuantity ?? 0n;
    if (position === 0n) return 0n;
    const absPosition = position > 0n ? position : -position;
    const resting = restingQuantityOnSide(position < 0n);
    return resting >= absPosition ? 0n : absPosition - resting;
  };

  /**
   * Orders that only unwind the position cannot raise the account's margin, so
   * both venues accept them below initial margin and the balance checks below
   * must let them through — otherwise a fully margined account could never close
   * out. The contract still decides: cross-venue exposure can make a locally
   * reducing order raise portfolio margin, and the simulate preceding every
   * write reverts on that.
   */
  const isReduceOnlyOrder = (quantity: number, isBuy: boolean): boolean => {
    const position = openPositionNetQuantity ?? 0n;
    if (position === 0n || (position > 0n) === isBuy) return false;
    const scale = contractMode === "perpetual" ? QUANTITY_SCALE_NUM : 1;
    return BigInt(Math.round(quantity * scale)) <= reduceOnlyCapacity();
  };

  const usdc = (value: bigint) => (Number(value) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);

  /**
   * Pre-flight the venue's margin gate. `createOrder` admits an order only when
   * the balance covers portfolio IM *with that order on the book*, or when the
   * order reduces locally and IM does not rise. Returns false, having explained
   * the shortfall, when the gate would revert. Same predicate for both venues:
   * they share one portfolio IM.
   */
  /** The gate's verdict on one order, `undefined` while its inputs are loading. */
  const quoteOrder = (priceInWei: bigint, quantity: number, isBuy: boolean) => {
    const scale = contractMode === "perpetual" ? QUANTITY_SCALE_NUM : 1;
    const absQuantity = BigInt(Math.round(Math.abs(quantity) * scale));
    const reservedFee = reserveFee(
      contractMode === "perpetual"
        ? (priceInWei * absQuantity) / QUANTITY_SCALE
        : priceInWei * absQuantity,
    );
    return orderMargin.quote(
      {
        place: [
          {
            venue: orderVenue,
            price: priceInWei,
            quantity: isBuy ? absQuantity : -absQuantity,
          },
        ],
      },
      { reservedFee, locallyReducing: isReduceOnlyOrder(quantity, isBuy) },
    );
  };

  const checkOrderMargin = async (
    priceInWei: bigint,
    quantity: number,
    isBuy: boolean,
  ): Promise<boolean> => {
    const quote = quoteOrder(priceInWei, quantity, isBuy);

    if (!quote) {
      await showAlert({
        message: "Unable to fetch margin data. Please try again.",
        variant: "error",
      });
      return false;
    }
    if (quote.affordable) return true;

    // The other side may take this size for free when it unwinds the position;
    // say so rather than sending the user to deposit.
    const otherSideCapacity = sideCapacity(!isBuy);
    const otherSideFits = otherSideCapacity !== undefined && otherSideCapacity >= Math.abs(quantity);
    const walletBalance = accountBalanceQuery.data ?? 0n;
    await showAlert(
      `Insufficient funds for this ${isBuy ? "bid" : "ask"}.\n\n` +
        `Margin for this order: ${usdc(quote.imIncrease)} USDC\n` +
        `Reserved trading fee (max of maker/taker): ${usdc(quote.reservedFee)} USDC\n` +
        `Already committed to open orders and positions: ${usdc(quote.imBefore)} USDC\n` +
        `Total margin required: ${usdc(quote.imAfter + quote.reservedFee)} USDC\n` +
        `Futures account balance: ${usdc(balanceQuery.data ?? 0n)} USDC\n` +
        `Short by: ${usdc(-quote.headroom)} USDC\n\n` +
        (otherSideFits
          ? `An ${isBuy ? "ask" : "bid"} of this size would go through: it reduces your position, so it needs no extra margin. `
          : "") +
        `To place this ${isBuy ? "bid" : "ask"}, deposit at least ${usdc(-quote.headroom)} USDC ` +
        `(wallet USDC, not yet deposited: ${usdc(walletBalance)}).`,
    );
    return false;
  };

  /**
   * Largest quantity (contract units) `isBuy` can place at its own submit price:
   * the funded max for that side, plus the reduce-only capacity when that side
   * unwinds the position. `undefined` while the reads are in flight.
   *
   * The slider cannot know the side — it is set before Bid or Ask is pressed —
   * so its range is a union of both. The buttons and the hint under the slider
   * use this per-side figure, so the user sees which side the range belongs to
   * before the gate has to tell them.
   */
  const sideCapacity = (isBuy: boolean): number | undefined => {
    const px = getEffectivePrice(isBuy ? "buy" : "sell");
    if (px <= 0) return undefined;
    const funded = orderMargin.maxQuantity({
      venue: orderVenue,
      price: BigInt(Math.round(px * PAYMENT_TOKEN_SCALE_NUM)),
      isBuy,
      reserveFee,
    });
    if (funded === undefined) return undefined;

    const qtyScale = contractMode === "perpetual" ? QUANTITY_SCALE_NUM : 1;
    const position = openPositionNetQuantity ?? 0n;
    const reduces = position !== 0n && (position > 0n) !== isBuy;
    const reduceQty = reduces ? Number(reduceOnlyCapacity()) / qtyScale : 0;
    let qty = Math.max(Number(funded) / qtyScale, reduceQty);

    // Same user-chosen leverage cap the slider applies.
    if (contractMode === "perpetual" && leverage > 0) {
      const totalBalance = balanceQuery.data ?? 0n;
      const lockedBalance = minMargin ?? 0n;
      const available = totalBalance > lockedBalance ? totalBalance - lockedBalance : 0n;
      const leverageQty = ((Number(available) / PAYMENT_TOKEN_SCALE_NUM) * leverage) / px;
      qty = Math.max(Math.min(qty, leverageQty), reduceQty);
    }
    return qty;
  };

  /**
   * Slider marks: the usual quarters, plus an unlabelled dot at the smaller
   * side's ceiling when the two sides differ — green for Bid, red for Ask — so
   * the user can see where that side stops being placeable while the track runs
   * on to the other side's max. Hovering the dot says which side and how much.
   */
  const sliderMarks = (): { marks: { value: number; label?: string }[]; cap: CapMarkInfo | undefined } => {
    const quarters = PERCENT_MARKS;
    const max = calculateMaxQuantity();
    const buyCap = sideCapacity(true);
    const sellCap = sideCapacity(false);
    if (max <= 0 || buyCap === undefined || sellCap === undefined || buyCap === sellCap) {
      return { marks: quarters, cap: undefined };
    }
    const smallerIsBuy = buyCap < sellCap;
    const pct = sliderPercentFor(snapQty(smallerIsBuy ? buyCap : sellCap), max);
    if (pct <= 0 || pct >= 100) return { marks: quarters, cap: undefined };

    const marks: { value: number; label?: string }[] = [...quarters, { value: pct }].sort(
      (a, b) => a.value - b.value,
    );
    return {
      marks,
      cap: {
        index: marks.findIndex((mark) => mark.value === pct && mark.label === undefined),
        value: pct,
        isBuy: smallerIsBuy,
        color: smallerIsBuy ? tokens.trading.long : tokens.trading.short,
        title: `Max ${smallerIsBuy ? "bid" : "ask"} at this price: ${sideCapacityLabel(smallerIsBuy)}${
          amountMode === "size" ? "" : " contracts"
        }. Beyond this point the slider is ${smallerIsBuy ? "ask" : "bid"} only.`,
      },
    };
  };

  /** `sideCapacity` in the units the amount field is in, formatted for the hint. */
  const sideCapacityLabel = (isBuy: boolean): string => {
    const qty = sideCapacity(isBuy);
    if (qty === undefined) return "…";
    if (amountMode === "size") return `${(qty * getEffectivePrice(isBuy ? "buy" : "sell")).toFixed(2)} USDC`;
    return contractMode === "perpetual" ? String(Number(qty.toFixed(6))) : Math.floor(qty).toFixed(0);
  };

  /**
   * Why `isBuy` cannot take the current amount, or `undefined` when it can (or
   * when the answer is not known yet — a loading read must not grey the button).
   */
  const sideBlocker = (isBuy: boolean): string | undefined => {
    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) return undefined;
    const px = getEffectivePrice(isBuy ? "buy" : "sell");
    if (px <= 0) return undefined;
    const quantity = calculateQuantityFromAmount(numericAmount, px);
    if (quantity <= 0) return undefined;
    const quote = quoteOrder(BigInt(Math.round(px * PAYMENT_TOKEN_SCALE_NUM)), quantity, isBuy);
    if (!quote || quote.affordable) return undefined;
    const side = isBuy ? "bid" : "ask";
    const other = isBuy ? "ask" : "bid";
    const cap = sideCapacity(isBuy);
    const capQty = cap === undefined ? 0 : contractMode === "perpetual" ? cap : Math.floor(cap);
    const otherCapacity = sideCapacity(!isBuy);
    const otherFits = otherCapacity !== undefined && otherCapacity >= quantity;
    return (
      `This ${side} needs ${usdc(-quote.headroom)} USDC more than your available balance. ` +
      (capQty > 0
        ? `Click ${isBuy ? "Bid" : "Ask"} to set the size to the max ${side} at this price (${sideCapacityLabel(isBuy)}), then click again to place.`
        : "Nothing can be placed on this side at this price.") +
      (otherFits ? ` An ${other} of this size reduces your position and would go through.` : "")
    );
  };

  /**
   * The slider's 100%, in the amount field's units.
   *
   * The slider is set before the user picks a side, and the two sides rarely
   * share a ceiling — one may be unwinding a position while the other extends
   * it. It reaches the *larger* side so that side is fully usable; the smaller
   * side's button says what it can take and clamps to it on click
   * (`clampToSide`). Zero until the reads the gate needs have landed.
   */
  const calculateMaxQuantity = (): number => {
    const buyCap = sideCapacity(true);
    const sellCap = sideCapacity(false);
    if (buyCap === undefined || sellCap === undefined) return 0;
    return Math.max(buyCap, sellCap);
  };

  // ---- The slider works in contracts; the amount field is a view of that ----
  // Futures trade whole contracts, so a size in USDC is only ever a whole
  // number of contracts times the price. Everything the slider does is done in
  // quantity and converted for display at the very end, so "Size" mode cannot
  // produce a size no order can have.

  /**
   * Round a quantity *down* to what the venue can place: whole contracts for
   * futures, six decimals for perps. Down, never nearest — a ceiling rounded up
   * by a millionth is a ceiling the gate rejects.
   */
  const qtyDecimals = contractMode === "perpetual" ? 6 : 0;
  const snapQty = (qty: number): number => snapQuantityDown(qty, qtyDecimals);

  /** The amount field's value for `qty`, in the field's current unit. */
  const amountFromQty = (qty: number): number | string => {
    // Size is floored to the cent for the same reason: the quantity it implies
    // must not exceed the one it was made from.
    if (amountMode === "size") return (Math.floor(qty * getEffectivePrice() * 100 + 1e-6) / 100).toFixed(2);
    return contractMode === "perpetual" ? qty.toFixed(6) : qty;
  };

  /** The quantity the amount field currently describes. */
  const qtyFromAmount = (value: number): number => {
    if (amountMode !== "size") return value;
    const px = getEffectivePrice();
    return px > 0 ? value / px : 0;
  };

  /** Where `qty` sits on the 0–100 track, for a given ceiling. */
  const sliderPercentFor = percentForQuantity;

  // Highlight price/amount inputs when the user clicks the order book
  // (`highlightMode === "inputs"`). `highlightMode === "buttons"` pulses Bid/Ask
  // and is unused in the live close-position flow (kept so the legacy
  // ClosePositionModal prefill path can be restored).
  useEffect(() => {
    if (
      externalPrice !== undefined &&
      externalAmount !== undefined &&
      highlightTrigger !== undefined &&
      highlightMode !== undefined &&
      highlightTrigger > 0
    ) {
      // Reset highlight first to ensure visual feedback
      setHighlightedButton(null);

      const mode = highlightMode === "buttons" ? (externalIsBuy ? "buy" : "sell") : "inputs";
      // Set highlight in next tick to ensure visual change
      const highlightTimeout = setTimeout(() => {
        setHighlightedButton(mode);
      }, 10);

      // Clear highlight after 3 seconds
      const clearTimeoutId = setTimeout(() => {
        setHighlightedButton(null);
      }, 3000);

      return () => {
        clearTimeout(highlightTimeout);
        clearTimeout(clearTimeoutId);
      };
    }
  }, [highlightMode, externalIsBuy, externalPrice, externalAmount, highlightTrigger]);

  // Simulation hooks for market / FOK orders.
  // Must be called unconditionally here, before the early loading return below.
  const simMarketPriceDecimal = marketPrice ? Number(marketPrice) / PAYMENT_TOKEN_SCALE_NUM : 0;
  const simNumericAmount = (() => {
    const parsed = typeof amount === "string" ? parseFloat(amount) : amount;
    return Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed;
  })();
  const simNeedsLiquidityCheck =
    orderType === "market" || timeInForce === TimeInForce.FOK || timeInForce === TimeInForce.IOC;
  const simPerpsQuantity =
    simNeedsLiquidityCheck &&
    contractMode === "perpetual" &&
    simMarketPriceDecimal > 0 &&
    simNumericAmount > 0
      ? amountMode === "quantity"
        ? simNumericAmount
        : simNumericAmount / simMarketPriceDecimal
      : 0;
  const simFuturesQuantity =
    simNeedsLiquidityCheck && contractMode === "futures" && simNumericAmount > 0
      ? calculateQuantityFromAmount(
          simNumericAmount,
          orderType === "market" ? simMarketPriceDecimal : parseFloat(price) || simMarketPriceDecimal,
        )
      : 0;
  // Slippage-adjusted sim prices mirror what getEffectivePrice() produces for each side.
  // Snap a bigint price (PAYMENT_TOKEN_SCALE units) to the nearest price-step boundary.
  // priceStep may be null here (before the early return), so fall back to 1 unit = no snap.
  const stepUnits = priceStep ? Math.round(priceStep * PAYMENT_TOKEN_SCALE_NUM) : 1;
  const snapBigInt = (raw: number) => BigInt(Math.round(raw / stepUnits) * stepUnits);

  const simBuyPriceArg = (() => {
    if (!simNeedsLiquidityCheck) return undefined;
    if (orderType === "market") {
      if (!marketPrice) return undefined;
      return snapBigInt(Number(marketPrice) * (1 + MARKET_SLIPPAGE));
    }
    const limitPx = parseFloat(price) || 0;
    return limitPx > 0 ? snapBigInt(limitPx * PAYMENT_TOKEN_SCALE_NUM) : undefined;
  })();
  const simSellPriceArg = (() => {
    if (!simNeedsLiquidityCheck) return undefined;
    if (orderType === "market") {
      if (!marketPrice) return undefined;
      return snapBigInt(Number(marketPrice) * (1 - MARKET_SLIPPAGE));
    }
    const limitPx = parseFloat(price) || 0;
    return limitPx > 0 ? snapBigInt(limitPx * PAYMENT_TOKEN_SCALE_NUM) : undefined;
  })();

  // Auto-fetch disabled — refetch() is called manually on Bid/Ask click only.
  const { refetch: refetchSimBuyPerps } = useSimulatePerpsOrder({
    price: simBuyPriceArg,
    quantity: simPerpsQuantity > 0 ? simPerpsQuantity : undefined,
    enabled: false,
  });
  const { refetch: refetchSimSellPerps } = useSimulatePerpsOrder({
    price: simSellPriceArg,
    quantity: simPerpsQuantity > 0 ? -simPerpsQuantity : undefined,
    enabled: false,
  });
  const futuresExpirationAt =
    externalExpirationAt !== undefined ? BigInt(externalExpirationAt) : undefined;
  const { refetch: refetchSimBuyFutures } = useSimulateFuturesOrder({
    expirationAt: futuresExpirationAt,
    price: simBuyPriceArg,
    quantity: simFuturesQuantity > 0 ? simFuturesQuantity : undefined,
    enabled: false,
  });
  const { refetch: refetchSimSellFutures } = useSimulateFuturesOrder({
    expirationAt: futuresExpirationAt,
    price: simSellPriceArg,
    quantity: simFuturesQuantity > 0 ? -simFuturesQuantity : undefined,
    enabled: false,
  });

  // Show loading state while minimumPriceIncrement is being fetched
  if (contractSpecsQuery.isLoading || !priceStep || isMarketPriceLoading || !newestItemPrice) {
    return (
      <PlaceOrderContainer>
        {/* <h3>Place Order{contractMode === "perpetual" ? " - PERP" : ""}</h3> */}
        <div style={{ textAlign: "center", padding: "2rem", color: tokens.text.muted }}>
          <Spinner fontSize="0.3em" />
          <p style={{ marginTop: "1rem", margin: 0 }}>Loading contract specifications...</p>
        </div>
      </PlaceOrderContainer>
    );
  }

  /** Pre-flight liquidity check for market / FOK. Returns false if the user should abort. */
  const checkLiquidity = async (side: "buy" | "sell"): Promise<boolean> => {
    const needsCheck = orderType === "market" || timeInForce === TimeInForce.FOK || timeInForce === TimeInForce.IOC;
    if (!needsCheck) return true;

    try {
      const refetch =
        contractMode === "perpetual"
          ? side === "buy"
            ? refetchSimBuyPerps
            : refetchSimSellPerps
          : side === "buy"
            ? refetchSimBuyFutures
            : refetchSimSellFutures;

      const simResult = await refetch();
      const filledQty = simResult.data?.[0];
      const remainingQty = simResult.data?.[2];

      if (filledQty === undefined || remainingQty === undefined) {
        await showAlert({ message: "Failed to check order book liquidity", variant: "error" });
        return false;
      }

      const remainingAbs = remainingQty < 0n ? -remainingQty : remainingQty;
      const filledAbs = filledQty < 0n ? -filledQty : filledQty;

      if (filledAbs === 0n) {
        await showAlert("There is no liquidity in order book");
        return false;
      }

      // FOK (and market+FOK): require full fill. IOC may partially fill.
      if (timeInForce === TimeInForce.FOK && remainingAbs > 0n) {
        const scale = contractMode === "perpetual" ? QUANTITY_SCALE_NUM : 1;
        const filled = (Number(filledAbs) / scale).toFixed(contractMode === "perpetual" ? 6 : 0);
        const remaining = (Number(remainingAbs) / scale).toFixed(contractMode === "perpetual" ? 6 : 0);
        const total = ((Number(filledAbs) + Number(remainingAbs)) / scale).toFixed(
          contractMode === "perpetual" ? 6 : 0,
        );
        await showAlert(
          `Order would only be partially filled.\n\nRequested: ${total}\nWill be filled: ${filled}\nUnfilled: ${remaining}\n\nNot enough liquidity to fill the full order (FOK).`,
        );
        return false;
      }

      return true;
    } catch {
      await showAlert({ message: "Failed to check order book liquidity", variant: "error" });
      return false;
    }
  };

  const incrementPrice = () => {
    const currentPrice = parseFloat(price) || 0;
    const newPrice = snapToStep(currentPrice + priceStep);
    setPrice(newPrice.toFixed(2));
  };

  const decrementPrice = () => {
    const currentPrice = parseFloat(price) || 0;
    const newPrice = snapToStep(Math.max(0.01, currentPrice - priceStep));
    setPrice(newPrice.toFixed(2));
  };

  const handleAmountChange = (newAmount: number | string) => {
    setAmount(newAmount);

    // Update slider to reflect the amount as a percentage of max
    const maxQty = calculateMaxQuantity();
    if (maxQty > 0) {
      const numericAmount = typeof newAmount === "string" ? parseFloat(newAmount) : newAmount;
      setSliderValue(sliderPercentFor(qtyFromAmount(Number.isNaN(numericAmount) ? 0 : numericAmount), maxQty));
    }
  };

  /**
   * The user's own resting orders an incoming order would self-cross against:
   * opposite side, same price (and same delivery date for futures), oldest first.
   */
  const findOffsettingOrders = (priceInWei: bigint, isBuy: boolean): RestingOrder[] => {
    if (contractMode === "perpetual") {
      return (perpsOpenOrders ?? [])
        .filter(
          (order) =>
            (order.status === "ACTIVE" || order.status === "PARTIALLY_FILLED") &&
            order.isBuy !== isBuy &&
            order.price === priceInWei &&
            order.quantity > 0n,
        )
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
        .map((order) => ({ id: order.id as `0x${string}`, restingQty: order.quantity }));
    }

    const expirationAtValue = externalExpirationAt ? BigInt(externalExpirationAt) : 0n;
    return (participantData?.orders ?? [])
      .filter(
        (order) =>
          order.isActive &&
          order.isBuy !== isBuy &&
          order.pricePerDay === priceInWei &&
          order.expirationAt === expirationAtValue &&
          order.quantity > 0,
      )
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
      .map((order) => ({ id: order.id as `0x${string}`, restingQty: BigInt(order.quantity) }));
  };

  /**
   * Net `quantity` against those resting orders instead of placing it.
   *
   * Only offered for resting limit orders: a reduce cannot express IOC or FOK,
   * and a market order is a deliberate instruction to take the book.
   */
  const buildOffsetPlan = (
    offsetting: RestingOrder[],
    quantity: number,
    isBuy: boolean,
  ): OrderOffsetPlan | null => {
    if (orderType !== "limit" || timeInForce !== TimeInForce.GTC) return null;

    const scale = contractMode === "perpetual" ? QUANTITY_SCALE_NUM : 1;
    const plan = planOffset(offsetting, BigInt(Math.round(quantity * scale)), !isBuy);
    const leftoverQty = Number(plan.leftoverQty) / scale;

    return {
      cancelIds: plan.cancelIds,
      reduces: plan.reduces,
      offsetQty: quantity - leftoverQty,
      leftoverQty,
    };
  };

  /** Route an order that collides with the user's own book to the conflict modal. */
  const promptConflict = (
    offsetting: RestingOrder[],
    order: { price: number; amount: number; quantity: number },
  ) => {
    setOffsetPlan(buildOffsetPlan(offsetting, Math.abs(order.quantity), order.quantity > 0));
    setPendingOrder(order);
    setShowConflictModal(true);
  };

  /**
   * Open the wallet modal rather than validating an order the user cannot sign:
   * without an account every balance reads as zero, so the checks below would
   * otherwise reject the order as underfunded.
   */
  const hasWallet = (): boolean => {
    if (isConnected) return true;
    // wagmi reports disconnected while it restores a session, and opening the
    // modal then would compete with the reconnect already in flight.
    if (!isConnecting && !isReconnecting) {
      openWalletModal({ view: "Connect" });
    }
    return false;
  };

  /**
   * The slider reaches the larger side's ceiling, so the smaller side can be
   * asked for more than it can take. Its button is greyed while that is so; the
   * first click brings the amount and slider down to that side's max instead of
   * trading, the button lights up, and the next click places. Returns true when
   * it clamped (so the caller stops there); false when the amount already fits
   * or nothing at all can be placed on that side (the gate's alert then explains).
   */
  const clampToSide = (isBuy: boolean): boolean => {
    const cap = sideCapacity(isBuy);
    if (cap === undefined) return false;
    const px = getEffectivePrice(isBuy ? "buy" : "sell");
    const numericAmount = getNumericAmount();
    if (numericAmount <= 0 || px <= 0) return false;
    const quantity = calculateQuantityFromAmount(numericAmount, px);
    // Tolerance for the float round-trip through the amount field.
    if (quantity <= cap + 1e-9) return false;

    return setAmountToSideMax(isBuy);
  };

  /** Write `isBuy`'s ceiling into the amount field (and slider). False when that ceiling is zero. */
  const setAmountToSideMax = (isBuy: boolean): boolean => {
    const cap = sideCapacity(isBuy);
    if (cap === undefined) return false;
    const capQty = snapQty(cap);
    if (capQty <= 0) return false;
    handleAmountChange(amountFromQty(capQty));
    return true;
  };

  /** How close (in slider points) the thumb has to come to the dot to be pulled onto it. */
  const DOT_SNAP_POINTS = 3;

  /** The quantity a slider position stands for, snapped to what the venue can place. */
  const qtyAtSliderValue = (value: number, maxQty: number): number => quantityAtPercent(value, maxQty, qtyDecimals);

  /**
   * Thumb moving: pull it onto the dot when near, otherwise convert the position
   * to a placeable quantity and show that (as contracts or as USDC).
   */
  const handleSliderChange = (value: number) => {
    const { cap } = sliderMarks();
    if (cap && Math.abs(value - cap.value) <= DOT_SNAP_POINTS) {
      if (setAmountToSideMax(cap.isBuy)) return;
    }
    setSliderValue(value);
    const maxQty = calculateMaxQuantity();
    if (maxQty <= 0) return;
    const next = amountFromQty(qtyAtSliderValue(value, maxQty));
    // Only flag when the amount really changes; an unchanged amount does not
    // re-run the effect, and a stale flag would swallow a later legitimate sync.
    if (next !== amount) {
      sliderWroteAmountRef.current = true;
      setAmount(next);
    }
  };

  /**
   * On release, for whole-contract futures: park the thumb exactly where the
   * quantity in the amount field sits, so the handle and the number agree.
   *
   * Deliberately reads the amount rather than the pointer position MUI hands
   * over: while the dot held the thumb, the pointer may have drifted a little
   * past it, and re-deriving from the pointer would drop a contract the user
   * never saw.
   */
  const handleSliderCommitted = () => {
    if (contractMode === "perpetual") return;
    const maxQty = calculateMaxQuantity();
    if (maxQty <= 0) return;
    setSliderValue(sliderPercentFor(qtyFromAmount(getNumericAmount()), maxQty));
  };

  const handleBuy = async () => {
    if (!hasWallet()) return;
    if (clampToSide(true)) return;

    if (contractMode === "perpetual") {
      await handleBuyPerps();
    } else {
      await handleBuyFutures();
    }
  };

  const handleSell = async () => {
    if (!hasWallet()) return;
    if (clampToSide(false)) return;

    if (contractMode === "perpetual") {
      await handleSellPerps();
    } else {
      await handleSellFutures();
    }
  };

  // Perps mode buy handler
  const handleBuyPerps = async () => {
    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) {
      await showAlert("Amount must be greater than 0");
      return;
    }

    if (!(await checkLiquidity("buy"))) return;

    const currentPrice = getEffectivePrice("buy");
    const priceInWei = BigInt(Math.round(currentPrice * PAYMENT_TOKEN_SCALE_NUM));
    const quantity = calculateQuantityFromAmount(numericAmount, currentPrice);
    if (quantity <= 0) {
      await showAlert("Quantity must be greater than 0");
      return;
    }
    if (!(await checkOrderMargin(priceInWei, quantity, true))) return;

    // Check for conflicting orders (opposite action, same price)
    const offsetting = findOffsettingOrders(priceInWei, true);
    if (offsetting.length > 0) {
      promptConflict(offsetting, {
        price: currentPrice,
        amount: numericAmount,
        quantity: quantity, // Positive for Buy
      });
      return;
    }

    openOrderForm(currentPrice, numericAmount, quantity); // Positive quantity for Buy
  };

  // Perps mode sell handler
  const handleSellPerps = async () => {
    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) {
      await showAlert("Amount must be greater than 0");
      return;
    }

    if (!(await checkLiquidity("sell"))) return;

    const currentPrice = getEffectivePrice("sell");
    const priceInWei = BigInt(Math.round(currentPrice * PAYMENT_TOKEN_SCALE_NUM));
    const quantity = calculateQuantityFromAmount(numericAmount, currentPrice);
    if (quantity <= 0) {
      await showAlert("Quantity must be greater than 0");
      return;
    }
    if (!(await checkOrderMargin(priceInWei, quantity, false))) return;

    // Check for conflicting orders (opposite action, same price)
    const offsetting = findOffsettingOrders(priceInWei, false);
    if (offsetting.length > 0) {
      promptConflict(offsetting, {
        price: currentPrice,
        amount: numericAmount,
        quantity: -quantity, // Negative for Sell
      });
      return;
    }

    openOrderForm(currentPrice, numericAmount, -quantity); // Negative quantity for Sell
  };

  // Futures mode buy handler - uses quantity directly
  const handleBuyFutures = async () => {
    if (!externalExpirationAt && contractMode === "futures") {
      await showAlert("Please select a price from the order book to set expiration date");
      return;
    }

    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) {
      await showAlert(amountMode === "size" ? "Size must be greater than 0" : "Quantity must be greater than 0");
      return;
    }

    if (!(await checkLiquidity("buy"))) return;

    // Validate balance against portfolio IM, the figure `createOrder` gates on
    const currentPrice = getEffectivePrice("buy");
    const quantity = calculateQuantityFromAmount(numericAmount, currentPrice);
    if (quantity <= 0) {
      await showAlert("Quantity must be at least 1 contract");
      return;
    }
    const priceInWei = BigInt(Math.round(currentPrice * PAYMENT_TOKEN_SCALE_NUM));

    if (!(await checkOrderMargin(priceInWei, quantity, true))) return;

    // Check for conflicting orders (opposite action, same price, same expiration date)
    const offsetting = findOffsettingOrders(priceInWei, true);
    if (offsetting.length > 0) {
      promptConflict(offsetting, {
        price: currentPrice,
        amount: numericAmount,
        quantity: quantity, // Positive for Buy
      });
      return;
    }

    // Check if price exceeds configured percentage of market price (limit orders only)
    if (orderType === "limit") {
      const maxAllowedPrice = newestItemPrice * maxPriceMultiplier;
      if (currentPrice > maxAllowedPrice) {
        setPendingOrder({
          price: currentPrice,
          amount: numericAmount,
          quantity: quantity, // Positive for Buy
        });
        setShowHighPriceModal(true);
        return;
      }
    }

    openOrderForm(currentPrice, numericAmount, quantity); // Positive quantity for Buy
  };

  // Futures mode sell handler - uses quantity directly
  const handleSellFutures = async () => {
    if (!externalExpirationAt && contractMode === "futures") {
      await showAlert("Please select a price from the order book to set expiration date");
      return;
    }

    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) {
      await showAlert(amountMode === "size" ? "Size must be greater than 0" : "Quantity must be greater than 0");
      return;
    }

    if (!(await checkLiquidity("sell"))) return;

    // Validate balance against portfolio IM, the figure `createOrder` gates on
    const currentPrice = getEffectivePrice("sell");
    const quantity = calculateQuantityFromAmount(numericAmount, currentPrice);
    if (quantity <= 0) {
      await showAlert("Quantity must be at least 1 contract");
      return;
    }
    const priceInWei = BigInt(Math.round(currentPrice * PAYMENT_TOKEN_SCALE_NUM));

    if (!(await checkOrderMargin(priceInWei, quantity, false))) return;

    // Check for conflicting orders (opposite action, same price, same expiration date)
    const offsetting = findOffsettingOrders(priceInWei, false);
    if (offsetting.length > 0) {
      promptConflict(offsetting, {
        price: currentPrice,
        amount: numericAmount,
        quantity: -quantity, // Negative for Sell
      });
      return;
    }

    // Check if price exceeds configured percentage of market price (limit orders only)
    if (orderType === "limit") {
      const maxAllowedPrice = newestItemPrice * maxPriceMultiplier;
      if (currentPrice > maxAllowedPrice) {
        setPendingOrder({
          price: currentPrice,
          amount: numericAmount,
          quantity: -quantity, // Negative for Sell
        });
        setShowHighPriceModal(true);
        return;
      }
    }

    openOrderForm(currentPrice, numericAmount, -quantity); // Negative quantity for Sell
  };


  const openOrderForm = (orderPrice: number, orderAmount: number, quantity: number) => {
    setPendingOrder({
      price: orderPrice,
      amount: orderAmount,
      quantity: quantity,
    });
    setShowOrderForm(true);
  };

  const handleConfirmHighPrice = () => {
    if (pendingOrder) {
      setShowHighPriceModal(false);
      setShowOrderForm(true);
    }
  };

  const handleCancelHighPrice = () => {
    setShowHighPriceModal(false);
    setPendingOrder(null);
    setBypassConflictCheck(false);
  };

  const handleConfirmConflict = () => {
    if (pendingOrder) {
      setShowConflictModal(false);
      setOffsetPlan(null);
      setBypassConflictCheck(true);
      setShowOrderForm(true);
    }
  };

  const handleOffsetConflict = () => {
    if (pendingOrder && offsetPlan) {
      setShowConflictModal(false);
      setShowOrderForm(true);
    }
  };

  const handleCancelConflict = () => {
    setShowConflictModal(false);
    setPendingOrder(null);
    setOffsetPlan(null);
    setBypassConflictCheck(false);
  };

  const previewQuantity = getExpectedQuantity();
  // Margin this order would add to the portfolio's initial margin, quoted
  // through the same `quoteOrder` the Bid/Ask buttons and the slider ceiling
  // use — per-side submit price, reduce-only credit — so it agrees with the
  // review modal's "Margin required" row. The fee reserve is shown there
  // separately, not folded in here. The side is still unknown at this point,
  // so show the dearer of the two.
  const previewRequiredMargin = (() => {
    if (previewQuantity <= 0) return undefined;
    const forSide = (isBuy: boolean) => {
      const px = getEffectivePrice(isBuy ? "buy" : "sell");
      if (px <= 0) return undefined;
      const quote = quoteOrder(BigInt(Math.round(px * PAYMENT_TOKEN_SCALE_NUM)), previewQuantity, isBuy);
      if (!quote) return undefined;
      return quote.imIncrease > 0n ? quote.imIncrease : 0n;
    };
    const asBid = forSide(true);
    const asAsk = forSide(false);
    if (asBid === undefined || asAsk === undefined) return undefined;
    return asBid > asAsk ? asBid : asAsk;
  })();
  const requiredMarginLabel =
    previewRequiredMargin !== undefined ? `${usdc(previewRequiredMargin)} USDC` : "—";
  // Show the converted counterpart of the input: Size mode → Quantity, Quantity mode → Size.
  const summaryCounterpartLabel = amountMode === "size" ? "Quantity" : "Size";
  const summaryCounterpartValue =
    amountMode === "size"
      ? contractMode === "perpetual"
        ? previewQuantity.toFixed(6)
        : String(previewQuantity)
      : `${getEffectiveSize().toFixed(2)} USDC`;

  return (
    <>
      <PlaceOrderContainer>
        {/* <h2>Place Order</h2> */}

        <MainSection>
          <InputSection>
            <OrderTypeRow>
              <ModeToggle>
                <ModeButton
                  $active={orderType === "limit"}
                  onClick={() => handleOrderTypeChange("limit")}
                  disabled={showOrderForm}
                >
                  Limit
                </ModeButton>
                <ModeButton
                  $active={orderType === "market"}
                  onClick={() => handleOrderTypeChange("market")}
                  disabled={showOrderForm}
                >
                  Market
                </ModeButton>
              </ModeToggle>

              {contractMode === "perpetual" ? (
                // Perps also carry the leverage toggle on this row, so the
                // three TIF buttons collapse into one dropdown to stay on a line.
                <Tooltip title={TIF_TOOLTIP_BY_VALUE[timeInForce]} arrow>
                  <TifDropdown
                    aria-label="Time in force"
                    value={timeInForce}
                    onChange={(e) => setTimeInForce(Number(e.target.value) as TimeInForceValue)}
                    disabled={showOrderForm}
                  >
                    {orderType === "limit" && <option value={TimeInForce.GTC}>GTC</option>}
                    <option value={TimeInForce.IOC}>IOC</option>
                    <option value={TimeInForce.FOK}>FOK</option>
                  </TifDropdown>
                </Tooltip>
              ) : (
                <ModeToggle>
                  {orderType === "limit" && (
                    <Tooltip title={TIF_TOOLTIPS.GTC} arrow>
                      <span style={{ display: "inline-flex" }}>
                        <ModeButton
                          $active={timeInForce === TimeInForce.GTC}
                          onClick={() => setTimeInForce(TimeInForce.GTC)}
                          disabled={showOrderForm}
                        >
                          GTC
                        </ModeButton>
                      </span>
                    </Tooltip>
                  )}
                  <Tooltip title={TIF_TOOLTIPS.IOC} arrow>
                    <span style={{ display: "inline-flex" }}>
                      <ModeButton
                        $active={timeInForce === TimeInForce.IOC}
                        onClick={() => setTimeInForce(TimeInForce.IOC)}
                        disabled={showOrderForm}
                      >
                        IOC
                      </ModeButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={TIF_TOOLTIPS.FOK} arrow>
                    <span style={{ display: "inline-flex" }}>
                      <ModeButton
                        $active={timeInForce === TimeInForce.FOK}
                        onClick={() => setTimeInForce(TimeInForce.FOK)}
                        disabled={showOrderForm}
                      >
                        FOK
                      </ModeButton>
                    </span>
                  </Tooltip>
                </ModeToggle>
              )}

              {contractMode === "perpetual" && (
                <ModeToggle>
                  <ModeButton
                    $active
                    onClick={() => setShowLeverageModal(true)}
                    disabled={showOrderForm}
                  >
                    {leverage}x
                  </ModeButton>
                </ModeToggle>
              )}
            </OrderTypeRow>

            {orderType === "limit" && (
              <InputGroup $isHighlighted={highlightedButton !== null}>
                <label htmlFor={`${fieldId}-price`}>Price (USDC)</label>
                <PriceInputContainer $isHighlighted={highlightedButton !== null}>
                  <PriceButton
                    onClick={decrementPrice}
                    disabled={showOrderForm}
                    $isHighlighted={highlightedButton !== null}
                  >
                    −
                  </PriceButton>
                  <input
                    id={`${fieldId}-price`}
                    type="text"
                    value={price}
                    onChange={(e) => {
                      setPrice(e.target.value);
                    }}
                    onBeforeInput={handleNumericDecimalInput}
                    step={priceStep}
                    min="0.01"
                    inputMode={"numeric"}
                    style={{ minWidth: "70px" }}
                  />
                  <PriceButton
                    onClick={incrementPrice}
                    disabled={showOrderForm}
                    $isHighlighted={highlightedButton !== null}
                  >
                    +
                  </PriceButton>
                </PriceInputContainer>
              </InputGroup>
            )}

            <InputGroup $isHighlighted={highlightedButton !== null}>
              <label htmlFor={`${fieldId}-amount`}>
                {amountMode === "size" ? "Size" : "Quantity"}
              </label>
              <AmountInputWrapper>
                <input
                  id={`${fieldId}-amount`}
                  type="text"
                  value={amount}
                  onChange={(e) => {
                    const raw = e.target.value.replace("-", "");
                    if (isFuturesIntegerQty) {
                      const digits = raw.replace(/[^0-9]/g, "");
                      handleAmountChange(digits === "" ? "" : Number(digits));
                    } else {
                      handleAmountChange(raw);
                    }
                  }}
                  onBeforeInput={
                    isFuturesIntegerQty
                      ? handleNumericIntegerInput
                      : contractMode !== "perpetual"
                        ? handleNumericDecimalInput
                        : handleNumericDecimalInput6Decimals
                  }
                  inputMode={isFuturesIntegerQty ? "numeric" : "decimal"}
                  placeholder={isFuturesIntegerQty ? "1" : "0.00"}
                  min="0"
                  disabled={showOrderForm}
                />
                <AmountModeDropdown
                  value={amountMode}
                  onChange={(e) => handleAmountModeChange(e.target.value as AmountMode)}
                  disabled={showOrderForm}
                >
                  <option value="size">Size</option>
                  <option value="quantity">Quantity</option>
                </AmountModeDropdown>
              </AmountInputWrapper>
              {/* {contractMode === "perpetual" && getNumericAmount() > 0 && (
                <ExpectedQuantityLabel>
                  Expected Quantity: {getExpectedQuantity().toFixed(6)}
                </ExpectedQuantityLabel>
              )} */}
              <SliderContainer>
                <StyledSlider
                  value={sliderValue}
                  onChange={(_, value) => handleSliderChange(Array.isArray(value) ? value[0] : value)}
                  onChangeCommitted={() => handleSliderCommitted()}
                  disabled={showOrderForm}
                  min={0}
                  max={100}
                  {...(() => {
                    const { marks, cap } = sliderMarks();
                    return {
                      marks,
                      $lastMarkIndex: marks.length - 1,
                      slots: { mark: CapAwareMark },
                      slotProps: { mark: { cap, lastIndex: marks.length - 1 } as Record<string, unknown> },
                    };
                  })()}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${value}%`}
                />
              </SliderContainer>
            </InputGroup>
          </InputSection>

          <ButtonSection>
            {(() => {
              const buyBlocker = sideBlocker(true);
              const sellBlocker = sideBlocker(false);
              return (
                <>
                  <Tooltip title={buyBlocker ?? ""} arrow disableHoverListener={!buyBlocker}>
                    <ButtonSlot>
                      <BuyButton
                        onClick={handleBuy}
                        disabled={showOrderForm}
                        $isHighlighted={highlightedButton === "buy"}
                        $isCapped={buyBlocker !== undefined}
                      >
                        Bid
                      </BuyButton>
                    </ButtonSlot>
                  </Tooltip>
                  <Tooltip title={sellBlocker ?? ""} arrow disableHoverListener={!sellBlocker}>
                    <ButtonSlot>
                      <SellButton
                        onClick={handleSell}
                        disabled={showOrderForm}
                        $isHighlighted={highlightedButton === "sell"}
                        $isCapped={sellBlocker !== undefined}
                      >
                        Ask
                      </SellButton>
                    </ButtonSlot>
                  </Tooltip>
                </>
              );
            })()}
          </ButtonSection>

          {getNumericAmount() > 0 && (
            <OrderSummary>
              <OrderSummaryRow>
                <span>Required Margin</span>
                <span>{requiredMarginLabel}</span>
              </OrderSummaryRow>
              <OrderSummaryRow>
                <span>{summaryCounterpartLabel}</span>
                <span>{summaryCounterpartValue}</span>
              </OrderSummaryRow>
            </OrderSummary>
          )}
        </MainSection>
      </PlaceOrderContainer>

      <ModalItem open={showHighPriceModal} setOpen={setShowHighPriceModal}>
        <HighPriceConfirmationModal
          pendingOrder={pendingOrder}
          newestItemPrice={newestItemPrice}
          highPricePercentage={highPricePercentage}
          contractSpecsQuery={contractSpecsQuery}
          onConfirm={handleConfirmHighPrice}
          onCancel={handleCancelHighPrice}
          contractMode={contractMode}
        />
      </ModalItem>

      <ModalItem open={showConflictModal} setOpen={setShowConflictModal}>
        <ConflictingOrderModal
          pendingOrder={pendingOrder}
          offsetPlan={offsetPlan}
          externalExpirationAt={externalExpirationAt}
          onConfirm={handleConfirmConflict}
          onOffset={handleOffsetConflict}
          onCancel={handleCancelConflict}
          contractMode={contractMode}
        />
      </ModalItem>

      {/* Perps have no expiration to wait on. This used to require one in both
          modes and got away with it because the page left the futures expiry set
          while in perps mode; the market selector now clears it. */}
      {showOrderForm && pendingOrder && (contractMode === "perpetual" || externalExpirationAt !== undefined) && (
        <ModalItem
          compact
          open={showOrderForm}
          setOpen={(open) => {
            setShowOrderForm(open);
            if (!open) {
              setPendingOrder(null);
              setOffsetPlan(null);
            }
          }}
        >
          <PlaceOrderForm
            price={BigInt(Math.round(pendingOrder.price * PAYMENT_TOKEN_SCALE_NUM))}
            expirationAt={externalExpirationAt !== undefined ? BigInt(externalExpirationAt) : 0n}
            quantity={pendingOrder.quantity}
            participantData={participantData}
            onOrderPlaced={async () => {
              await onOrderPlaced?.();
            }}
            bypassConflictCheck={bypassConflictCheck}
            offsetPlan={offsetPlan}
            contractMode={contractMode}
            perpsCollection={perpsCollection}
            isMarketOrder={orderType === "market"}
            marketSlippage={MARKET_SLIPPAGE}
            timeInForce={timeInForce}
            closeForm={() => {
              setShowOrderForm(false);
              setPendingOrder(null);
              setOffsetPlan(null);
              setBypassConflictCheck(false);
            }}
          />
        </ModalItem>
      )}

      <ModalItem open={showLeverageModal} setOpen={setShowLeverageModal}>
        <LeverageModal
          currentLeverage={leverage}
          onConfirm={(newLeverage) => {
            const currentAmount = getNumericAmount();
            if (currentAmount > 0 && contractMode === "perpetual") {
              if (amountMode === "quantity") {
                // Quantity scales proportionally with leverage: qty * (newLev / oldLev)
                const newQty = currentAmount * (newLeverage / leverage);
                setAmount(newQty.toFixed(6));
              } else {
                const currentMargin = currentAmount / leverage;
                const newAmount = currentMargin * newLeverage;
                setAmount(newAmount.toFixed(2));
              }
            }
            setLeverage(newLeverage);
            setShowLeverageModal(false);
          }}
          onCancel={() => setShowLeverageModal(false)}
        />
      </ModalItem>
    </>
  );
};

const LeverageModal = ({
  currentLeverage,
  onConfirm,
  onCancel,
}: {
  currentLeverage: number;
  onConfirm: (leverage: number) => void;
  onCancel: () => void;
}) => {
  const [tempLeverage, setTempLeverage] = useState(currentLeverage);

  const getMarginPercent = (lev: number): number => {
    return (1 / lev) * 100;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-white mb-6">Adjust Leverage</h2>

      <div style={{ background: tokens.surface.inputIsland, border: `1px solid ${tokens.border.default}`, borderRadius: tokens.radius.md, padding: '1rem' }}>
        <div className="flex justify-between items-center mb-4">
          <span className="text-gray-300 text-sm">Current Leverage:</span>
          <span className="text-white font-semibold text-lg">{tempLeverage}x</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-300 text-sm">Margin Required:</span>
          <span className="text-futures-brand-blue font-semibold">{getMarginPercent(tempLeverage).toFixed(2)}%</span>
        </div>
      </div>

      <div className="px-2">
        <StyledSlider
          value={tempLeverage}
          onChange={(_, value) => {
            const numValue = Array.isArray(value) ? value[0] : value;
            setTempLeverage(numValue);
          }}
          min={1}
          max={10}
          $lastMarkIndex={3}
          marks={[
            { value: 1, label: '1x' },
            { value: 3, label: '3x' },
            { value: 5, label: '5x' },
            { value: 10, label: '10x' },
          ]}
          valueLabelDisplay="auto"
          valueLabelFormat={(value) => `${value}x`}
        />
      </div>

      <div className="flex gap-3 justify-end">
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        <PrimaryButton onClick={() => onConfirm(tempLeverage)}>Apply {tempLeverage}x Leverage</PrimaryButton>
      </div>
    </div>
  );
};

const ConflictingOrderModal = ({
  pendingOrder,
  offsetPlan,
  externalExpirationAt,
  onConfirm,
  onOffset,
  onCancel,
  contractMode = "futures",
}: {
  pendingOrder: { price: number; amount: number; quantity: number } | null;
  offsetPlan: OrderOffsetPlan | null;
  externalExpirationAt?: number;
  onConfirm: () => void;
  onOffset: () => void;
  onCancel: () => void;
  contractMode?: ContractMode;
}) => {
  if (!pendingOrder) return null;

  const isBuy = pendingOrder.quantity > 0;
  const oppositeAction = isBuy ? "Ask" : "Bid";
  const expirationAtFormatted = externalExpirationAt ? formatDateTime(externalExpirationAt) : "N/A";
  const formatQty = (value: number) => value.toFixed(contractMode === "perpetual" ? 6 : 0);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-white mb-6">Conflicting Order Detected</h2>

      <div className="bg-orange-900/20 border border-orange-500/30 rounded-lg p-4">
        <p className="text-gray-300 text-sm mb-3">
          You already have an active <strong className="text-white">{oppositeAction}</strong> order at the same price
          {contractMode === "futures" && " and expiration date"}.
        </p>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-300">Price:</span>
            <span className="text-white font-medium">{pendingOrder.price.toFixed(2)} USDC</span>
          </div>
          {contractMode === "futures" && (
            <div className="flex justify-between">
              <span className="text-gray-300">Delivery Date:</span>
              <span className="text-white font-medium">{expirationAtFormatted}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white-900/20 border border-white-500/30 rounded-lg p-4">
        <p className="text-white-300 text-sm leading-relaxed">
          <strong>Important:</strong> Your order of{" "}
          <strong>{formatQty(Math.abs(pendingOrder.quantity))} units</strong> will be placed as specified. However, it
          will be matched against your existing {oppositeAction} order and offset orders will be closed.
        </p>
      </div>

      {offsetPlan && (
        <div className="bg-white-900/20 border border-white-500/30 rounded-lg p-4">
          <p className="text-white-300 text-sm leading-relaxed">
            Offsetting instead takes <strong>{formatQty(offsetPlan.offsetQty)} units</strong> off your resting{" "}
            {oppositeAction} in a single transaction
            {offsetPlan.leftoverQty > 0
              ? ` and places the remaining ${formatQty(offsetPlan.leftoverQty)} units.`
              : ", and places nothing new."}{" "}
            Nothing is sent to the market, so no other order can fill first.
          </p>
        </div>
      )}

      <div className="flex gap-3 justify-end">
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        <SecondaryButton onClick={onConfirm}>Place Order Anyway</SecondaryButton>
        {offsetPlan && <PrimaryButton onClick={onOffset}>Offset Existing Order</PrimaryButton>}
      </div>
    </div>
  );
};

const HighPriceConfirmationModal = ({
  pendingOrder,
  newestItemPrice,
  contractSpecsQuery,
  onConfirm,
  onCancel,
  contractMode = "futures",
}: {
  pendingOrder: { price: number; amount: number; quantity: number } | null;
  newestItemPrice: number;
  highPricePercentage: number;
  contractSpecsQuery: UseQueryResult<GetResponse<FuturesContractSpecs>, Error>;
  onConfirm: () => void;
  onCancel: () => void;
  contractMode?: ContractMode;
}) => {
  if (!pendingOrder) return null;

  const percentageOver = ((pendingOrder.price / newestItemPrice) * 100).toFixed(1);
  const isBuy = pendingOrder.quantity > 0;

  // Expected hashrate = order quantity × on-chain contract size (hashes/s·day),
  // formatted as PH/s. One unit settles the value of `contractSizeHpsDay`.
  const contractSizeHpsDay = contractSpecsQuery.data?.data?.contractSizeHpsDay;
  const expectedHashrate =
    contractSizeHpsDay !== undefined
      ? formatHashratePHPS(
          (contractSizeHpsDay * BigInt(Math.round(Math.abs(pendingOrder.quantity) * QUANTITY_SCALE_NUM))) /
            QUANTITY_SCALE,
        ).full
      : null;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-white mb-6">High Price Warning</h2>

      <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
        <div className="flex items-center mb-3">
          <span className="text-yellow-400 text-2xl mr-3">⚠️</span>
          <h3 className="text-lg font-semibold text-yellow-400">Price Exceeds Market</h3>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-300">Your Price:</span>
            <span className="text-white font-medium">{pendingOrder.price.toFixed(2)} USDC</span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-300">Market Price:</span>
            <span className="text-white font-medium">{newestItemPrice.toFixed(2)} USDC</span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-300">Percentage of Market:</span>
            <span className="text-red-400 font-medium">{percentageOver}%</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg p-4">
        <h4 className="text-white font-semibold mb-2">Order Details:</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-300">Type:</span>
            <span className="text-white">{isBuy ? "Bid" : "Ask"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-300">Size:</span>
            <span className="text-white">
              {(pendingOrder.price * Math.abs(pendingOrder.quantity)).toFixed(2)} USDC
            </span>
          </div>
          {contractMode === "futures" && (
            <div className="flex justify-between">
              <span className="text-gray-300">Expected Hashrate:</span>
              <span className="text-white">{expectedHashrate ?? "—"}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
        <p className="text-red-300 text-sm">
          <strong>Warning:</strong> This price is significantly above the current market rate. You may experience
          difficulty finding a counterparty or may face higher slippage.
        </p>
      </div>

      <div className="flex gap-3 justify-end">
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        <PrimaryButton onClick={onConfirm} className="bg-red-600 hover:bg-red-700">
          Proceed Anyway
        </PrimaryButton>
      </div>
    </div>
  );
};

const PlaceOrderContainer = styled(SmallWidget)`
  width: 100%;
  height: 100%;
  padding: 1.5rem 1rem;
  padding-top: 0.5rem;
  margin-bottom: 0px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 1rem;

  h2, h3 {
    margin: 0;
    margin-bottom: 0.3rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
`;

const MainSection = styled.div`
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 1.5rem;
  align-items: center;
  
  @media (max-width: 1400px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const InputSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex: 1;
  width: 100%;
`;

const _MinMarginLabel = styled.div`
  font-size: 0.75rem;
  color: ${tokens.text.secondary};
  margin-top: 0.25rem;
  text-align: center;
`;

const _ExpectedQuantityLabel = styled.div`
  font-size: 0.75rem;
  color: ${tokens.accent.main};
  margin-top: 0.25rem;
  text-align: center;
  font-weight: 500;
`;


/** Tooltip anchor: a disabled button fires no pointer events, so the wrapper takes them. */
const ButtonSlot = styled.span`
  display: flex;
  flex: 1;
  min-width: 0;
`;

const ButtonSection = styled.div`
  gap: 0.75rem;
  flex-shrink: 0;
  align-self: end;
  display: flex;
  flex-direction: row;
  width: 100%;
  
  @media (max-width: 1400px) {
    flex-direction: row;
    justify-content: center;
    align-self: stretch;
    width: 100%;
    
    button {
      flex: 1;
    }
  }

  /* MOBILE-ONLY (see MOBILE_TRADING_QUERY): Bid/Ask share half a phone screen. */
  @media (max-width: 768px) {
    gap: 0.4rem;

    button {
      padding: 0.6rem 0.4rem;
      font-size: 0.8rem;
    }
  }
`;

const BuyButton = styled.button<{ $isHighlighted?: boolean; $isCapped?: boolean }>`
  width: 100%;
  padding: 0.875rem 1rem;
  background: ${tokens.trading.long};
  color: ${tokens.text.onDark};
  border: none;
  border-radius: ${tokens.radius.sm};
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.1s ease;
  min-width: 120px;
  ${(props) => props.$isHighlighted && highlightedPulse};
  &:hover:not(:disabled) {
    background: ${tokens.trading.longHover};
    transform: translateY(-1px);
  }
  
  &:active:not(:disabled) {
    transform: translateY(0);
  }
  
  &:disabled {
    background: ${tokens.surface.tabMuted};
    cursor: not-allowed;
    opacity: 0.6;
    animation: none;
  }

  /* Looks disabled but stays clickable: the click sets the size to this side's max. */
  ${(props) =>
    props.$isCapped &&
    css`
      background: ${tokens.surface.tabMuted};
      opacity: 0.6;
      &:hover:not(:disabled) {
        background: ${tokens.surface.tabMuted};
        transform: none;
      }
    `}
`;

const SellButton = styled.button<{ $isHighlighted?: boolean; $isCapped?: boolean }>`
  width: 100%;
  padding: 0.875rem 1rem;
  background: ${tokens.trading.short};
  color: ${tokens.text.onDark};
  border: none;
  border-radius: ${tokens.radius.sm};
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.1s ease;
  min-width: 120px;
  ${(props) => props.$isHighlighted && highlightedPulse};
  &:hover:not(:disabled) {
    background: ${tokens.trading.shortHover};
    transform: translateY(-1px);
  }
  
  &:active:not(:disabled) {
    transform: translateY(0);
  }
  
  &:disabled {
    background: ${tokens.surface.tabMuted};
    cursor: not-allowed;
    opacity: 0.6;
    animation: none;
  }

  /* Looks disabled but stays clickable: the click sets the size to this side's max. */
  ${(props) =>
    props.$isCapped &&
    css`
      background: ${tokens.surface.tabMuted};
      opacity: 0.6;
      &:hover:not(:disabled) {
        background: ${tokens.surface.tabMuted};
        transform: none;
      }
    `}
`;

const OrderSummary = styled.div`
  width: 100%;
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.md};
  padding: 0.625rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  background: ${tokens.surface.inputIsland};
`;

const OrderSummaryRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;

  span:first-of-type {
    color: ${tokens.text.secondary};
  }

  span:last-child {
    color: ${tokens.text.onDark};
    font-weight: 500;
  }
`;

/** Where the smaller side's capacity ends on the slider, and what to say about it. */
interface CapMarkInfo {
  /** Position in the `marks` array, which is what MUI stamps on `data-index`. */
  index: number;
  /** Slider value (0–100) the dot sits at. */
  value: number;
  /** Which side's ceiling it is. */
  isBuy: boolean;
  color: string;
  title: string;
}

/**
 * Slider mark slot: the default tick everywhere except at `cap.index`, which
 * becomes a coloured tick with a tooltip, and at `lastIndex`, which draws
 * nothing since the bar's end already marks 100. Both arrive via
 * `slotProps.mark` and must not reach the DOM.
 */
const CapAwareMark = (props: Record<string, unknown>) => {
  const { cap, lastIndex, ...rest } = props as { cap?: CapMarkInfo; lastIndex?: number } & Record<
    string,
    unknown
  >;
  const index = rest["data-index"];
  if (index === lastIndex) return null;
  if (cap && index === cap.index) {
    return (
      <Tooltip title={cap.title} arrow placement="top">
        <CapMark style={rest.style as CSSProperties} $color={cap.color} />
      </Tooltip>
    );
  }
  return <SliderMark {...(rest as ComponentProps<typeof SliderMark>)} />;
};

/** Same tick as the quarter marks, just coloured for the side it caps. */
const CapMark = styled.span<{ $color: string }>`
  position: absolute;
  top: 50%;
  /* Wider than the visible tick so it can actually be hovered for the tooltip. */
  width: 12px;
  height: 12px;
  transform: translate(-50%, -50%);
  cursor: help;
  /* Marks render after the rail and track but before the thumb, so with no
     z-index of its own the tick sits above the bar and under the handle. */

  &::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 2px;
    height: 6px;
    transform: translate(-50%, -50%);
    background-color: ${(p) => p.$color};
  }
`;

const _SliderInfoContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 0.25rem;
`;

const _SliderInfo = styled.span`
  color: ${tokens.text.primary};
  font-weight: 500;
  text-align: center;
  font-size: 0.875rem;
`;
