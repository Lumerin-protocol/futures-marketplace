import styled from "@mui/material/styles/styled";
import { keyframes, css } from "@emotion/react";
import { SmallWidget } from "../../Cards/Cards.styled";
import { useState, useEffect, useCallback } from "react";
import Slider from "@mui/material/Slider";
import { tokens } from "../../../styles/tokens";

// Pulsing background animation - single blue color for all inputs
const pulseYellow = keyframes`
  0%, 100% {
    background-color: ${tokens.perps.highlightBorder};
  }
  50% {
    background-color: ${tokens.perps.highlightBorderStrong};
  }
`;

const getPulseAnimation = (isHighlighted?: boolean) => {
  if (isHighlighted) {
    return css`${pulseYellow} 1.5s ease-in-out infinite`;
  }
  return "none";
};
import { useGetMarketPrice } from "../../../hooks/data/useGetMarketPrice";
import { Spinner } from "../../Spinner.styled";
import { ModalItem } from "../../Modal";
import { PrimaryButton, SecondaryButton } from "../../Forms/FormButtons/Buttons.styled";
import { PlaceOrderForm } from "../../Forms/PlaceOrderForm";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GetResponse } from "../../../gateway/interfaces";
import type { FuturesContractSpecs } from "../../../hooks/data/useFuturesContractSpecs";
import type { Participant } from "../../../hooks/data/useParticipant";
import type { ContractMode, AccountBalance } from "../../../types/types";
import type { PerpsCollection } from "../../../hooks/data/perps/usePerpsCollection";
import { useAccount } from "wagmi";
import { getMinMarginForPositionManual } from "../../../hooks/data/getMinMarginForPositionManual";
import { handleNumericDecimalInput, handleNumericDecimalInput6Decimals } from "../../Forms/Shared/AmountInputForm";
import { useOrderFee } from "../../../hooks/data/useOrderFee";
import { ModeToggle, ModeButton, type AmountMode } from "./PerpsOrderFormFields";
import { useSimulatePerpsOrder } from "../../../hooks/data/perps/useSimulatePerpsOrder";
import { useGetPerpsInitialMargin } from "../../../hooks/data/perps/useGetPerpsInitialMargin";

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface PlaceOrderWidgetProps {
  externalPrice?: string;
  externalAmount?: number;
  externalDeliveryDate?: number;
  externalIsBuy?: boolean;
  highlightTrigger?: number;
  address?: `0x${string}`;
  contractSpecsQuery: UseQueryResult<GetResponse<FuturesContractSpecs>, Error>;
  participantData?: Participant | null;
  latestPrice: bigint | null;
  highlightMode: "inputs" | "buttons" | undefined;
  onOrderPlaced?: () => void | Promise<void>;
  minMargin?: bigint | null;
  /** Aggregated net quantity across OPEN perps sessions; used with getInitialMargin when adding to the same side. */
  openPositionNetQuantity?: bigint | null;
  contractMode?: ContractMode;
  accountBalance?: AccountBalance;
  balanceQuery: BalanceQueryResult;
  perpsCollection?: PerpsCollection;
  quantityUnit?: string;
}

// Slippage applied to market orders in perpetual mode so the order crosses the spread.
// Buy orders are priced this much above market; sell orders this much below.
const MARKET_SLIPPAGE = 0.05;

/** Locked collateral for max-withdraw style math: initial margin when adding to an existing position on the same side (Bid/long, Ask/short), else maintenance. */
function getPerpsLockedBalanceForSide(
  minMargin: bigint | null | undefined,
  initialMargin: bigint | null | undefined,
  netQty: bigint | null | undefined,
  side: "buy" | "sell",
): bigint {
  const maintenance = minMargin && minMargin > 0n ? minMargin : 0n;
  const initial =
    initialMargin !== null && initialMargin !== undefined && initialMargin > 0n ? initialMargin : maintenance;
  if (!netQty || netQty === 0n) return maintenance;
  const sameSide = (netQty > 0n && side === "buy") || (netQty < 0n && side === "sell");
  return sameSide ? initial : maintenance;
}

export const PlaceOrderWidget = ({
  externalPrice,
  externalAmount,
  externalDeliveryDate,
  externalIsBuy,
  highlightTrigger,
  contractSpecsQuery,
  participantData,
  latestPrice,
  highlightMode,
  onOrderPlaced,
  minMargin,
  openPositionNetQuantity = null,
  contractMode = "futures",
  accountBalance,
  balanceQuery,
  perpsCollection,
  quantityUnit = "BTC",
}: PlaceOrderWidgetProps) => {
  const { data: marketPrice, isLoading: isMarketPriceLoading } = useGetMarketPrice();
  const { address } = useAccount();
  const initialMarginQuery = useGetPerpsInitialMargin(address, {
    enabled: contractMode === "perpetual" && !!address,
  });
  const initialMargin =
    initialMarginQuery.data !== undefined ? (initialMarginQuery.data as bigint) : null;

  const [perpsMarginSide, setPerpsMarginSide] = useState<"buy" | "sell">("buy");
  const accountBalanceQuery = accountBalance ?? { data: undefined, isLoading: false };
  const { data: orderFeeRaw } = useOrderFee(address);

  // Calculate price step from contract specs
  const priceStep = contractSpecsQuery.data?.data?.minimumPriceIncrement
    ? Number(contractSpecsQuery.data.data.minimumPriceIncrement) / 1e6
    : null;

  // Get delivery duration days from contract specs
  const deliveryDurationDays = contractSpecsQuery.data?.data?.deliveryDurationDays ?? 7;
  const marginPercent = contractSpecsQuery.data?.data?.liquidationMarginPercent ?? 20;


  // Get market price for validation and default price
  const newestItemPrice = marketPrice ? Number(marketPrice) / 1e6 : null;

  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState("5.00"); // Will be updated when hashrate data loads
  const [priceInitialized, setPriceInitialized] = useState(false); // Track if price has been initialized from hashrate
  const [amount, setAmount] = useState<number | string>(5); // Can be number or string to support decimals in perpetuals
  const [amountMode, setAmountMode] = useState<AmountMode>("size"); // "size" = USDC notional, "quantity" = raw contracts
  const [sliderValue, setSliderValue] = useState(0); // Slider value 0-100
  const [leverage, setLeverage] = useState(10); // Leverage multiplier (1x to 10x), default 10x
  const [highlightedButton, setHighlightedButton] = useState<"buy" | "sell" | "inputs" | null>(null);
  const [showHighPriceModal, setShowHighPriceModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showLeverageModal, setShowLeverageModal] = useState(false);
  const [bypassConflictCheck, setBypassConflictCheck] = useState(false);
  const [conflictingOrderQuantity, setConflictingOrderQuantity] = useState<number | null>(null);
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
      setAmount(externalAmount);
    }
  }, [externalAmount]);

  // Default margin side for max-size math: align with open position (Bid if long, Ask if short).
  useEffect(() => {
    if (contractMode !== "perpetual") return;
    if (openPositionNetQuantity === null || openPositionNetQuantity === undefined) return;
    if (openPositionNetQuantity > 0n) setPerpsMarginSide("buy");
    else if (openPositionNetQuantity < 0n) setPerpsMarginSide("sell");
  }, [contractMode, openPositionNetQuantity]);

  // Limit/market selection is perps-only; futures orders are always limit.
  useEffect(() => {
    if (contractMode === "futures") {
      setOrderType("limit");
    }
  }, [contractMode]);

  // Update slider when price or balance changes
  useEffect(() => {
    const maxQty = calculateMaxQuantity();
    if (maxQty > 0) {
      const numericAmount = getNumericAmount();
      const percentage = Math.min(100, Math.max(0, (numericAmount / maxQty) * 100));
      setSliderValue(Math.round(percentage));
    } else {
      setSliderValue(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    price,
    balanceQuery.data,
    minMargin,
    latestPrice,
    amount,
    contractMode,
    openPositionNetQuantity,
    perpsMarginSide,
    initialMargin,
  ]);

  // Helper to get numeric amount value for calculations
  const getNumericAmount = (): number => {
    const parsed = typeof amount === "string" ? parseFloat(amount) : amount;
    return isNaN(parsed) || parsed <= 0 ? 0 : parsed;
  };

  // Returns the USDC notional size regardless of amountMode
  const getEffectiveSize = (): number => {
    const numAmt = getNumericAmount();
    if (amountMode === "quantity" && contractMode === "perpetual") {
      return numAmt * (parseFloat(price) || 0);
    }
    return numAmt;
  };

  // Switch between Size (USDC) and Quantity (raw contracts), converting the current amount
  const handleAmountModeChange = (mode: AmountMode) => {
    if (mode === amountMode) return;
    const numAmt = getNumericAmount();
    const priceNum = parseFloat(price) || 0;
    setAmountMode(mode);
    if (mode === "size") {
      setAmount((numAmt * priceNum).toFixed(2));
    } else {
      setAmount(priceNum > 0 ? (numAmt / priceNum).toFixed(6) : "0");
    }
  };

  // Calculate margin percentage from leverage
  // Formula: marginPercent = (1 / leverage) * 100
  // Example: 10x leverage = (1/10) * 100 = 10%
  const getMarginPercentFromLeverage = (): number => {
    return (1 / leverage) * 100;
  };

  // Calculate quantity from the current amount, respecting amountMode.
  // Size mode:     quantity = size / price
  // Quantity mode: quantity = value directly (no conversion needed)
  const calculateQuantityFromAmount = (value: number, priceValue: number): number => {
    if (contractMode !== "perpetual" || priceValue <= 0) return value;
    if (amountMode === "quantity") return value;
    return value / priceValue;
  };

  // Calculate size (notional) from quantity for perps mode (reverse operation)
  const calculateAmountFromQuantity = (quantityValue: number, priceValue: number): number => {
    if (contractMode !== "perpetual" || priceValue <= 0) return quantityValue;
    return quantityValue * priceValue;
  };

  // Get expected quantity for display
  const getExpectedQuantity = (): number => {
    const numericAmount = getNumericAmount();
    const currentPrice = parseFloat(price) || 0;
    if (contractMode === "perpetual") {
      return calculateQuantityFromAmount(numericAmount, currentPrice);
    }
    return numericAmount;
  };

  // Calculate maximum available quantity based on current price
  const calculateMaxQuantity = (): number => {
    const currentPrice = parseFloat(price) || 0;
    if (currentPrice <= 0 || !latestPrice) return 0;

    const priceInWei = BigInt(Math.round(currentPrice * 1e6));
    const totalBalance = balanceQuery.data ?? 0n;
    const lockedBalance =
      contractMode === "perpetual"
        ? getPerpsLockedBalanceForSide(minMargin, initialMargin, openPositionNetQuantity, perpsMarginSide)
        : minMargin ?? 0n;
    const availableBalance = totalBalance > lockedBalance ? totalBalance - lockedBalance : 0n;

    // For perpetual mode, return max size (notional) or max quantity depending on amountMode
    if (contractMode === "perpetual") {
      const buffer = 100_000n; // 0.1 USDC in base units (6 decimals)
      const effectiveBalance = availableBalance > buffer ? availableBalance - buffer : 0n;
      const maxSize = (Number(effectiveBalance) / 1e6) * leverage;
      if (amountMode === "quantity") {
        const priceNum = parseFloat(price) || 0;
        return priceNum > 0 ? maxSize / priceNum : 0;
      }
      return maxSize;
    }

    const orderFee = orderFeeRaw ?? 0n;

    if (availableBalance <= orderFee) return 0;

    const balanceForMargin = availableBalance - orderFee;

    // Binary search to find maximum quantity for futures mode
    let low = 0;
    let high = 50; // High upper bound for search
    let maxQty = 0;

    const precision = 1;

    while (high - low > precision) {
      const mid = (low + high) / 2;
      const requiredMargin = getMinMarginForPositionManual(
        priceInWei,
        mid,
        latestPrice,
        marginPercent,
        deliveryDurationDays,
      );

      if (requiredMargin <= balanceForMargin) {
        maxQty = mid;
        low = mid;
      } else {
        high = mid;
      }
    }

    return maxQty;
  };

  // Highlight button when position is closed and values are substituted
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

  // Simulation hooks for market orders in perps mode.
  // Must be called unconditionally here, before the early loading return below.
  const simMarketPriceDecimal = marketPrice ? Number(marketPrice) / 1e6 : 0;
  const simNumericAmount = (() => {
    const parsed = typeof amount === "string" ? parseFloat(amount) : amount;
    return isNaN(parsed) || parsed <= 0 ? 0 : parsed;
  })();
  const simQuantity =
    orderType === "market" && contractMode === "perpetual" && simMarketPriceDecimal > 0 && simNumericAmount > 0
      ? (amountMode === "quantity" ? simNumericAmount : simNumericAmount / simMarketPriceDecimal)
      : 0;
  // Slippage-adjusted sim prices mirror what getEffectivePrice() produces for each side.
  // Snap a bigint price (1e6 units) to the nearest price-step boundary.
  // priceStep may be null here (before the early return), so fall back to 1 unit = no snap.
  const stepUnits = priceStep ? Math.round(priceStep * 1e6) : 1;
  const snapBigInt = (raw: number) => BigInt(Math.round(raw / stepUnits) * stepUnits);

  const simBuyPriceArg =
    orderType === "market" && contractMode === "perpetual" && marketPrice
      ? snapBigInt(Number(marketPrice) * (1 + MARKET_SLIPPAGE))
      : undefined;
  const simSellPriceArg =
    orderType === "market" && contractMode === "perpetual" && marketPrice
      ? snapBigInt(Number(marketPrice) * (1 - MARKET_SLIPPAGE))
      : undefined;

  // Auto-fetch disabled — refetch() is called manually on Bid/Ask click only.
  const { refetch: refetchSimBuy } = useSimulatePerpsOrder({
    price: simBuyPriceArg,
    quantity: simQuantity > 0 ? simQuantity : undefined,
    enabled: false,
  });
  const { refetch: refetchSimSell } = useSimulatePerpsOrder({
    price: simSellPriceArg,
    quantity: simQuantity > 0 ? -simQuantity : undefined,
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

  // Helper functions for price adjustment
  const snapToStep = (value: number): number => {
    return Math.round(value / priceStep) * priceStep;
  };

  // Returns the effective order price: market price (snapped) for market orders, input price for limit orders.
  // For market orders in perpetual mode, a 5% slippage buffer is applied so the order is
  // guaranteed to cross the spread: buys are priced 5% above market, sells 5% below.
  const getEffectivePrice = (side?: "buy" | "sell"): number => {
    if (orderType === "market" && newestItemPrice) {
      const base = newestItemPrice;
      if (contractMode === "perpetual" && side) {
        const slipped = side === "buy" ? base * (1 + MARKET_SLIPPAGE) : base * (1 - MARKET_SLIPPAGE);
        return snapToStep(slipped);
      }
      return snapToStep(base);
    }
    return parseFloat(price) || 0;
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
      const percentage = Math.min(100, Math.max(0, (numericAmount / maxQty) * 100));
      setSliderValue(Math.round(percentage));
    }
  };

  const handleBuy = async () => {
    if (contractMode === "perpetual") {
      await handleBuyPerps();
    } else {
      await handleBuyFutures();
    }
  };

  const handleSell = async () => {
    if (contractMode === "perpetual") {
      await handleSellPerps();
    } else {
      await handleSellFutures();
    }
  };

  // Perps mode buy handler - uses amount as margin
  const handleBuyPerps = async () => {
    setPerpsMarginSide("buy");
    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) {
      alert("Amount must be greater than 0");
      return;
    }

    if (orderType === "market") {
      try {
        const simResult = await refetchSimBuy();
        const filledQty = simResult.data?.[0];
        const remainingQty = simResult.data?.[2];
        if (remainingQty !== undefined && remainingQty > 0n) {
          if (!filledQty || filledQty === 0n) {
            alert("There is no liquidity in order book");
          } else {
            const filled = (Number(filledQty) / 1e6).toFixed(6);
            const remaining = (Number(remainingQty) / 1e6).toFixed(6);
            const total = ((Number(filledQty) + Number(remainingQty)) / 1e6).toFixed(6);
            alert(
              `Order would only be partially filled.\n\nRequested: ${total}\nWill be filled: ${filled}\nUnfilled: ${remaining}\n\nNot enough liquidity to fill the full order.`,
            );
          }
          return;
        }
      } catch {
        alert("Failed to check order book liquidity");
        return;
      }
    }

    // Validate minimum margin
    const currentPrice = getEffectivePrice("buy");
    const priceInWei = BigInt(Math.round(currentPrice * 1e6));
    const totalBalance = balanceQuery.data ?? 0n;
    const lockedBalance = getPerpsLockedBalanceForSide(
      minMargin,
      initialMargin,
      openPositionNetQuantity,
      "buy",
    );
    const availableBalance = totalBalance > lockedBalance ? totalBalance - lockedBalance : 0n;

    // Required margin = effectiveSize / leverage (effectiveSize accounts for amountMode)
    const effectiveSizeBuy = getEffectiveSize();
    const requiredMargin = effectiveSizeBuy / leverage;
    const marginInWei = BigInt(Math.round(requiredMargin * 1e6));

    if (marginInWei > availableBalance) {
      const marginFormatted = requiredMargin.toFixed(2);
      const totalBalanceFormatted = (Number(totalBalance) / 1e6).toFixed(2);
      const lockedBalanceFormatted = (Number(lockedBalance) / 1e6).toFixed(2);
      const availableBalanceFormatted = (Number(availableBalance) / 1e6).toFixed(2);
      const accountBalance = accountBalanceQuery.data ?? 0n;
      const accountBalanceFormatted = (Number(accountBalance) / 1e6).toFixed(2);
      alert(
        `Insufficient funds. Please deposit futures account.\n\nRequired margin: ${marginFormatted} USDC\nTotal futures balance: ${totalBalanceFormatted} USDC\nLocked balance: ${lockedBalanceFormatted} USDC\nAvailable balance: ${availableBalanceFormatted} USDC\nAvailable account balance: ${accountBalanceFormatted} USDC`,
      );
      return;
    }

    // Calculate quantity from amount (respects amountMode)
    const quantity = calculateQuantityFromAmount(numericAmount, currentPrice);

    // Check for conflicting orders (opposite action, same price)
    if (participantData?.orders) {
      const conflictingOrder = participantData.orders.find(
        (order) =>
          order.isActive &&
          !order.isBuy && // Opposite action (Sell)
          order.pricePerDay === priceInWei,
      );

      if (conflictingOrder) {
        setConflictingOrderQuantity(null);
        setPendingOrder({
          price: currentPrice,
          amount: numericAmount,
          quantity: quantity, // Positive for Buy
        });
        setShowConflictModal(true);
        return;
      }
    }

    openOrderForm(currentPrice, numericAmount, quantity); // Positive quantity for Buy
  };

  // Perps mode sell handler - uses amount as margin
  const handleSellPerps = async () => {
    setPerpsMarginSide("sell");
    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) {
      alert("Amount must be greater than 0");
      return;
    }

    if (orderType === "market") {
      try {
        const simResult = await refetchSimSell();
        const filledQty = simResult.data?.[0];
        const remainingQty = simResult.data?.[2];
        if (remainingQty !== undefined && remainingQty > 0n) {
          if (!filledQty || filledQty === 0n) {
            alert("There is no liquidity in order book");
          } else {
            const filled = (Number(filledQty) / 1e6).toFixed(6);
            const remaining = (Number(remainingQty) / 1e6).toFixed(6);
            const total = ((Number(filledQty) + Number(remainingQty)) / 1e6).toFixed(6);
            alert(
              `Order would only be partially filled.\n\nRequested: ${total}\nWill be filled: ${filled}\nUnfilled: ${remaining}\n\nNot enough liquidity to fill the full order.`,
            );
          }
          return;
        }
      } catch {
        alert("Failed to check order book liquidity");
        return;
      }
    }

    const currentPrice = getEffectivePrice("sell");
    const priceInWei = BigInt(Math.round(currentPrice * 1e6));
    const totalBalance = balanceQuery.data ?? 0n;
    const lockedBalance = getPerpsLockedBalanceForSide(
      minMargin,
      initialMargin,
      openPositionNetQuantity,
      "sell",
    );
    const availableBalance = totalBalance > lockedBalance ? totalBalance - lockedBalance : 0n;

    // Required margin = effectiveSize / leverage (effectiveSize accounts for amountMode)
    const effectiveSizeSell = getEffectiveSize();
    const requiredMargin = effectiveSizeSell / leverage;
    const marginInWei = BigInt(Math.round(requiredMargin * 1e6));

    if (marginInWei > availableBalance) {
      const marginFormatted = requiredMargin.toFixed(2);
      const totalBalanceFormatted = (Number(totalBalance) / 1e6).toFixed(2);
      const lockedBalanceFormatted = (Number(lockedBalance) / 1e6).toFixed(2);
      const availableBalanceFormatted = (Number(availableBalance) / 1e6).toFixed(2);
      const accountBalance = accountBalanceQuery.data ?? 0n;
      const accountBalanceFormatted = (Number(accountBalance) / 1e6).toFixed(2);
      alert(
        `Insufficient funds. Please deposit futures account.\n\nRequired margin: ${marginFormatted} USDC\nTotal futures balance: ${totalBalanceFormatted} USDC\nLocked balance: ${lockedBalanceFormatted} USDC\nAvailable balance: ${availableBalanceFormatted} USDC\nAvailable account balance: ${accountBalanceFormatted} USDC`,
      );
      return;
    }

    // Calculate quantity from amount (respects amountMode)
    const quantity = calculateQuantityFromAmount(numericAmount, currentPrice);

    // Check for conflicting orders (opposite action, same price)
    if (participantData?.orders) {
      const conflictingOrder = participantData.orders.find(
        (order) =>
          order.isActive &&
          order.isBuy && // Opposite action (Buy)
          order.pricePerDay === priceInWei,
      );

      if (conflictingOrder) {
        setConflictingOrderQuantity(null);
        setPendingOrder({
          price: currentPrice,
          amount: numericAmount,
          quantity: -quantity, // Negative for Sell
        });
        setShowConflictModal(true);
        return;
      }
    }

    openOrderForm(currentPrice, numericAmount, -quantity); // Negative quantity for Sell
  };

  // Futures mode buy handler - uses quantity directly
  const handleBuyFutures = async () => {
    if (!externalDeliveryDate && contractMode === "futures") {
      alert("Please select a price from the order book to set delivery date");
      return;
    }

    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) {
      alert("Quantity must be greater than 0");
      return;
    }

    // Validate balance for buy orders using getMinMarginForPositionManual
    const currentPrice = getEffectivePrice("buy");
    const priceInWei = BigInt(Math.round(currentPrice * 1e6));
    const totalBalance = balanceQuery.data ?? 0n;
    const lockedBalance = minMargin ?? 0n;
    const availableBalance = totalBalance > lockedBalance ? totalBalance - lockedBalance : 0n;

    if (!latestPrice) {
      alert("Unable to fetch market price. Please try again.");
      return;
    }

    const requiredMargin = getMinMarginForPositionManual(
      priceInWei,
      numericAmount, // Positive quantity for Buy
      latestPrice,
      marginPercent,
      deliveryDurationDays,
    );

    // Include order fee in the balance check
    const orderFee = orderFeeRaw ?? 0n;
    const totalRequired = requiredMargin + orderFee;

    if (totalRequired > availableBalance) {
      const requiredMarginFormatted = (Number(requiredMargin) / 1e6).toFixed(2);
      const orderFeeFormatted = (Number(orderFee) / 1e6).toFixed(2);
      const totalRequiredFormatted = (Number(totalRequired) / 1e6).toFixed(2);
      const totalBalanceFormatted = (Number(totalBalance) / 1e6).toFixed(2);
      const lockedBalanceFormatted = (Number(lockedBalance) / 1e6).toFixed(2);
      const availableBalanceFormatted = (Number(availableBalance) / 1e6).toFixed(2);
      const accountBalance = accountBalanceQuery.data ?? 0n;
      const accountBalanceFormatted = (Number(accountBalance) / 1e6).toFixed(2);
      alert(
        `Insufficient funds. Please deposit futures account.\n\nRequired margin: ${requiredMarginFormatted} USDC\nOrder fee: ${orderFeeFormatted} USDC\nTotal required: ${totalRequiredFormatted} USDC\nTotal futures balance: ${totalBalanceFormatted} USDC\nLocked balance: ${lockedBalanceFormatted} USDC\nAvailable balance: ${availableBalanceFormatted} USDC\nAvailable account balance: ${accountBalanceFormatted} USDC`,
      );
      return;
    }

    // Check for conflicting orders (opposite action, same price, same delivery date)
    if (participantData?.orders && externalDeliveryDate !== undefined) {
      const deliveryDateValue = externalDeliveryDate ? BigInt(externalDeliveryDate) : 0n;
      const conflictingOrder = participantData.orders.find(
        (order) =>
          order.isActive &&
          !order.isBuy && // Opposite action (Sell)
          order.pricePerDay === priceInWei &&
          order.deliveryAt === deliveryDateValue,
      );

      if (conflictingOrder) {
        // Note: ParticipantOrder doesn't expose quantity, so we can't show it
        setConflictingOrderQuantity(null);
        setPendingOrder({
          price: currentPrice,
          amount: numericAmount,
          quantity: numericAmount, // Positive for Buy
        });
        setShowConflictModal(true);
        return;
      }
    }

    // Check if price exceeds configured percentage of market price (limit orders only)
    if (orderType === "limit") {
      const maxAllowedPrice = newestItemPrice * maxPriceMultiplier;
      if (currentPrice > maxAllowedPrice) {
        setPendingOrder({
          price: currentPrice,
          amount: numericAmount,
          quantity: numericAmount, // Positive for Buy
        });
        setShowHighPriceModal(true);
        return;
      }
    }

    openOrderForm(currentPrice, numericAmount, numericAmount); // Positive quantity for Buy
  };

  // Futures mode sell handler - uses quantity directly
  const handleSellFutures = async () => {
    if (!externalDeliveryDate && contractMode === "futures") {
      alert("Please select a price from the order book to set delivery date");
      return;
    }

    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) {
      alert("Quantity must be greater than 0");
      return;
    }

    // Validate balance for sell orders using getMinMarginForPositionManual
    const currentPrice = getEffectivePrice("sell");
    const priceInWei = BigInt(Math.round(currentPrice * 1e6));
    const totalBalance = balanceQuery.data ?? 0n;
    const lockedBalance = minMargin ?? 0n;
    const availableBalance = totalBalance > lockedBalance ? totalBalance - lockedBalance : 0n;

    if (!latestPrice) {
      alert("Unable to fetch market price. Please try again.");
      return;
    }

    const requiredMargin = getMinMarginForPositionManual(
      priceInWei,
      -numericAmount, // Negative quantity for Sell
      latestPrice,
      marginPercent,
      deliveryDurationDays,
    );

    // Include order fee in the balance check
    const orderFee = orderFeeRaw ?? 0n;
    const totalRequired = requiredMargin + orderFee;

    if (totalRequired > availableBalance) {
      const requiredMarginFormatted = (Number(requiredMargin) / 1e6).toFixed(2);
      const orderFeeFormatted = (Number(orderFee) / 1e6).toFixed(2);
      const totalRequiredFormatted = (Number(totalRequired) / 1e6).toFixed(2);
      const totalBalanceFormatted = (Number(totalBalance) / 1e6).toFixed(2);
      const lockedBalanceFormatted = (Number(lockedBalance) / 1e6).toFixed(2);
      const availableBalanceFormatted = (Number(availableBalance) / 1e6).toFixed(2);
      const accountBalance = accountBalanceQuery.data ?? 0n;
      const accountBalanceFormatted = (Number(accountBalance) / 1e6).toFixed(2);
      alert(
        `Insufficient funds. Please deposit futures account.\n\nRequired margin: ${requiredMarginFormatted} USDC\nOrder fee: ${orderFeeFormatted} USDC\nTotal required: ${totalRequiredFormatted} USDC\nTotal futures balance: ${totalBalanceFormatted} USDC\nLocked balance: ${lockedBalanceFormatted} USDC\nAvailable balance: ${availableBalanceFormatted} USDC\nAvailable account balance: ${accountBalanceFormatted} USDC`,
      );
      return;
    }

    // Check for conflicting orders (opposite action, same price, same delivery date)
    if (participantData?.orders && externalDeliveryDate !== undefined) {
      const deliveryDateValue = externalDeliveryDate ? BigInt(externalDeliveryDate) : 0n;
      const conflictingOrder = participantData.orders.find(
        (order) =>
          order.isActive &&
          order.isBuy && // Opposite action (Buy)
          order.pricePerDay === priceInWei &&
          order.deliveryAt === deliveryDateValue,
      );

      if (conflictingOrder) {
        // Note: ParticipantOrder doesn't expose quantity, so we can't show it
        setConflictingOrderQuantity(null);
        setPendingOrder({
          price: currentPrice,
          amount: numericAmount,
          quantity: -numericAmount, // Negative for Sell
        });
        setShowConflictModal(true);
        return;
      }
    }

    // Check if price exceeds configured percentage of market price (limit orders only)
    if (orderType === "limit") {
      const maxAllowedPrice = newestItemPrice * maxPriceMultiplier;
      if (currentPrice > maxAllowedPrice) {
        setPendingOrder({
          price: currentPrice,
          amount: numericAmount,
          quantity: -numericAmount, // Negative for Sell
        });
        setShowHighPriceModal(true);
        return;
      }
    }

    openOrderForm(currentPrice, numericAmount, -numericAmount); // Negative quantity for Sell
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
      setBypassConflictCheck(true);
      setShowOrderForm(true);
    }
  };

  const handleCancelConflict = () => {
    setShowConflictModal(false);
    setPendingOrder(null);
    setConflictingOrderQuantity(null);
    setBypassConflictCheck(false);
  };

  return (
    <>
      <PlaceOrderContainer>
        {/* <h2>Place Order</h2> */}

        <MainSection>
          <InputSection>
            {contractMode === "perpetual" && (
              <OrderTypeRow>
                <ModeToggle>
                  <ModeButton
                    $active={orderType === "limit"}
                    onClick={() => setOrderType("limit")}
                    disabled={showOrderForm}
                  >
                    Limit
                  </ModeButton>
                  <ModeButton
                    $active={orderType === "market"}
                    onClick={() => setOrderType("market")}
                    disabled={showOrderForm}
                  >
                    Market
                  </ModeButton>
                </ModeToggle>

                <ModeToggle>
                  <ModeButton
                    $active
                    onClick={() => setShowLeverageModal(true)}
                    disabled={showOrderForm}
                  >
                    {leverage}x
                  </ModeButton>
                </ModeToggle>
              </OrderTypeRow>
            )}

            {orderType === "limit" && (
              <InputGroup $isHighlighted={highlightedButton !== null}>
                <label>{contractMode === "futures" ? "Price per day (USDC)" : "Price (USDC)"}</label>
                <PriceInputContainer $isHighlighted={highlightedButton !== null}>
                  <PriceButton
                    onClick={decrementPrice}
                    disabled={showOrderForm}
                    $isHighlighted={highlightedButton !== null}
                  >
                    −
                  </PriceButton>
                  <input
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
                {/* <MinMarginLabel>Min Margin: 10%</MinMarginLabel> */}
              </InputGroup>
            )}

            <InputGroup $isHighlighted={highlightedButton !== null}>
              <label>
                {contractMode === "perpetual" ? (amountMode === "size" ? "Size" : "Quantity") : "Quantity"}
              </label>
              {contractMode === "perpetual" ? (
                <AmountInputWrapper>
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => handleAmountChange(e.target.value.replace("-", ""))}
                    onBeforeInput={handleNumericDecimalInput6Decimals}
                    inputMode="decimal"
                    placeholder="0.00"
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
              ) : (
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => handleAmountChange(Number(e.target.value.replace("-", "")))}
                  min="1"
                  max="50"
                />
              )}
              {/* {contractMode === "perpetual" && getNumericAmount() > 0 && (
                <ExpectedQuantityLabel>
                  Expected Quantity: {getExpectedQuantity().toFixed(6)}
                </ExpectedQuantityLabel>
              )} */}
              <SliderContainer>
                <StyledSlider
                  value={sliderValue}
                  onChange={(_, value) => {
                    const numValue = Array.isArray(value) ? value[0] : value;
                    setSliderValue(numValue);
                    
                    const maxQty = calculateMaxQuantity();
                    const newAmount = (maxQty * numValue) / 100;
                    
                    if (contractMode === "perpetual") {
                      const decimals = amountMode === "quantity" ? 6 : 2;
                      setAmount(newAmount > 0 ? newAmount.toFixed(decimals) : "0");
                    } else {
                      // Round to nearest integer for futures
                      setAmount(Math.floor(newAmount));
                    }
                  }}
                  disabled={showOrderForm}
                  min={0}
                  max={100}
                  marks={[
                    { value: 0, label: '0%' },
                    { value: 25, label: '25%' },
                    { value: 50, label: '50%' },
                    { value: 75, label: '75%' },
                    { value: 100, label: '100%' },
                  ]}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${value}%`}
                />
                {/* <SliderInfoContainer>
                  <SliderInfo>
                    Max: {calculateMaxQuantity().toFixed(contractMode === "perpetual" ? 6 : 0)}
                  </SliderInfo>
                </SliderInfoContainer> */}
              </SliderContainer>
            </InputGroup>
          </InputSection>

          <ButtonSection>
            <BuyButton
              onMouseDown={() => {
                if (contractMode === "perpetual") setPerpsMarginSide("buy");
              }}
              onClick={handleBuy}
              disabled={showOrderForm}
              $isHighlighted={highlightedButton === "buy"}
            >
              Bid
            </BuyButton>
            <SellButton
              onMouseDown={() => {
                if (contractMode === "perpetual") setPerpsMarginSide("sell");
              }}
              onClick={handleSell}
              disabled={showOrderForm}
              $isHighlighted={highlightedButton === "sell"}
            >
              Ask
            </SellButton>
          </ButtonSection>

          {contractMode === "perpetual" && getNumericAmount() > 0 && (
            <OrderSummary>
              <OrderSummaryRow>
                <span>Required Margin</span>
                <span>{(getEffectiveSize() / leverage).toFixed(2)} USDC</span>
              </OrderSummaryRow>
              <OrderSummaryRow>
                <span>Quantity</span>
                <span>{getExpectedQuantity().toFixed(6)}</span>
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
          conflictingOrderQuantity={conflictingOrderQuantity}
          externalDeliveryDate={externalDeliveryDate}
          onConfirm={handleConfirmConflict}
          onCancel={handleCancelConflict}
          contractMode={contractMode}
        />
      </ModalItem>

      {showOrderForm && pendingOrder && externalDeliveryDate && (
        <ModalItem
          open={showOrderForm}
          setOpen={(open) => {
            setShowOrderForm(open);
            if (!open) {
              setPendingOrder(null);
            }
          }}
        >
          <PlaceOrderForm
            price={BigInt(Math.round(pendingOrder.price * 1e6))}
            deliveryDate={BigInt(externalDeliveryDate)}
            quantity={pendingOrder.quantity}
            participantData={participantData}
            latestPrice={latestPrice}
            onOrderPlaced={async () => {
              if (contractMode === "perpetual") {
                await initialMarginQuery.refetch();
              }
              await onOrderPlaced?.();
            }}
            bypassConflictCheck={bypassConflictCheck}
            contractMode={contractMode}
            perpsCollection={perpsCollection}
            leverage={leverage}
            isMarketOrder={orderType === "market"}
            closeForm={() => {
              setShowOrderForm(false);
              setPendingOrder(null);
              setConflictingOrderQuantity(null);
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
          <span className="text-futures-brand-green font-semibold">{getMarginPercent(tempLeverage).toFixed(2)}%</span>
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
  conflictingOrderQuantity,
  externalDeliveryDate,
  onConfirm,
  onCancel,
  contractMode = "futures",
}: {
  pendingOrder: { price: number; amount: number; quantity: number } | null;
  conflictingOrderQuantity: number | null;
  externalDeliveryDate?: number;
  onConfirm: () => void;
  onCancel: () => void;
  contractMode?: ContractMode;
}) => {
  if (!pendingOrder) return null;

  const isBuy = pendingOrder.quantity > 0;
  const oppositeAction = isBuy ? "Ask" : "Bid";
  const deliveryDateFormatted = externalDeliveryDate ? new Date(externalDeliveryDate * 1000).toLocaleString() : "N/A";

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-white mb-6">Conflicting Order Detected</h2>

      <div className="bg-orange-900/20 border border-orange-500/30 rounded-lg p-4">
        <p className="text-gray-300 text-sm mb-3">
          You already have an active <strong className="text-white">{oppositeAction}</strong> order at the same price
          {contractMode === "futures" && " and delivery date"}.
        </p>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-300">Price:</span>
            <span className="text-white font-medium">{pendingOrder.price.toFixed(2)} USDC</span>
          </div>
          {contractMode === "futures" && (
            <div className="flex justify-between">
              <span className="text-gray-300">Delivery Date:</span>
              <span className="text-white font-medium">{deliveryDateFormatted}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white-900/20 border border-white-500/30 rounded-lg p-4">
        <p className="text-white-300 text-sm leading-relaxed">
          <strong>Important:</strong> Your order of{" "}
          <strong>
            {contractMode === "perpetual" ? pendingOrder.amount.toFixed(6) : pendingOrder.amount} units
          </strong>{" "}
          will be placed as specified. However, it will be matched against your existing {oppositeAction} order and
          offset orders will be closed.
        </p>
      </div>

      <div className="flex gap-3 justify-end">
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        <PrimaryButton onClick={onConfirm}>Proceed with Order</PrimaryButton>
      </div>
    </div>
  );
};

const HighPriceConfirmationModal = ({
  pendingOrder,
  newestItemPrice,
  highPricePercentage,
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
  const deliveryDurationDays = contractSpecsQuery.data?.data?.deliveryDurationDays ?? 7;

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
              {(pendingOrder.price * pendingOrder.amount).toFixed(2)} USDC
            </span>
          </div>
          {contractMode === "futures" && (
            <div className="flex justify-between">
              <span className="text-gray-300">Expected Hashrate:</span>
              <span className="text-white">{pendingOrder.amount * 100} Th/s</span>
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

const MainSection = styled("div")`
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

const InputSection = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex: 1;
  width: 100%;
`;

const InputGroup = styled("div")<{ $isHighlighted?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
  
  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: ${tokens.text.secondary};
  }
  
  input {
    padding: 0.75rem;
    border: 1px solid ${tokens.overlay.white20};
    border-radius: 6px;
    color: ${tokens.text.onDark};
    font-size: 1rem;
    transition: border-color 0.2s ease;
    width: 100%;
    animation: ${(props) => getPulseAnimation(props.$isHighlighted)};
    background: ${(props) => (props.$isHighlighted ? undefined : tokens.surface.inputIsland)};
    
    &:focus {
      outline: none;
      border-color: ${tokens.accent.main};
      background: ${tokens.surface.inputIsland};
    }
    
    &::placeholder {
      color: ${tokens.text.muted};
    }
  }
`;

const MinMarginLabel = styled("div")`
  font-size: 0.75rem;
  color: ${tokens.text.secondary};
  margin-top: 0.25rem;
  text-align: center;
`;

const ExpectedQuantityLabel = styled("div")`
  font-size: 0.75rem;
  color: ${tokens.accent.main};
  margin-top: 0.25rem;
  text-align: center;
  font-weight: 500;
`;


const PriceInputContainer = styled("div")<{ $isHighlighted?: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  
  input {
    flex: 1;
    border-radius: 0;
    border-left: none;
    border-right: none;
    border-top: 1px solid ${tokens.overlay.white20};
    border-bottom: 1px solid ${tokens.overlay.white20};
    animation: ${(props) => getPulseAnimation(props.$isHighlighted)};
    background: ${(props) => (props.$isHighlighted ? undefined : tokens.surface.inputIsland)};

    &:focus {
      border-left: 1px solid ${tokens.accent.main};
      border-right: 1px solid ${tokens.accent.main};
    }
  }
`;

const PriceButton = styled("button")<{ $isHighlighted?: boolean }>`
  padding: 0.75rem 1rem;
  color: ${tokens.text.onDark};
  border: 1px solid ${tokens.overlay.white20};
  border-radius: 6px;
  font-size: 1.2rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 44px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${(props) => getPulseAnimation(props.$isHighlighted)};
  background: ${(props) => (props.$isHighlighted ? undefined : tokens.surface.inputIsland)};
  
  &:hover:not(:disabled) {
    background: ${tokens.surface.inputIslandHover};
    border-color: ${tokens.overlay.white30};
  }
  
  &:active:not(:disabled) {
    background: ${tokens.scrollbar.hover};
  }
  
  &:disabled {
    background: ${tokens.surface.card};
    border-color: ${tokens.overlay.white10};
    cursor: not-allowed;
    opacity: 0.5;
  }
  
  &:first-child {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  
  &:last-child {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
`;

const ButtonSection = styled("div")`
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
`;

const BuyButton = styled("button")<{ $isHighlighted?: boolean }>`
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
  animation: ${(props) => (props.$isHighlighted ? css`${pulseYellow} 1.5s ease-in-out infinite` : "none")};
  
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
`;

const SellButton = styled("button")<{ $isHighlighted?: boolean }>`
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
  animation: ${(props) => (props.$isHighlighted ? css`${pulseYellow} 1.5s ease-in-out infinite` : "none")};
  
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
`;

const OrderSummary = styled("div")`
  width: 100%;
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.md};
  padding: 0.625rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  background: ${tokens.surface.inputIsland};
`;

const OrderSummaryRow = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;

  span:first-child {
    color: ${tokens.text.secondary};
  }

  span:last-child {
    color: ${tokens.text.onDark};
    font-weight: 500;
  }
`;

const SliderContainer = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding: 0 1rem;
`;

const StyledSlider = styled(Slider)`
  color: ${tokens.text.primary};
  height: 6px;
  padding: 13px 0;
  
  & .MuiSlider-thumb {
    width: 18px;
    height: 18px;
    background-color: ${tokens.brand.green};
    transition: all 0.2s ease;

    &:hover,
    &.Mui-focusVisible {
      box-shadow: 0 0 0 8px ${tokens.overlay.white16};
      background-color: ${tokens.brand.greenDark};
    }
    
    &.Mui-active {
      box-shadow: 0 0 0 14px ${tokens.overlay.white16};
    }
  }
  
  & .MuiSlider-track {
    height: 6px;
    border: none;
    background-color: ${tokens.surface.inputIsland};
  }
  
  & .MuiSlider-rail {
    height: 6px;
    background-color: ${tokens.overlay.white20};
    opacity: 1;
  }
  
  & .MuiSlider-mark {
    width: 2px;
    height: 6px;
    background-color: ${tokens.overlay.white50};
    opacity: 1;
  }
  
  & .MuiSlider-markActive {
    background-color: ${tokens.overlay.black30};
  }
  
  & .MuiSlider-markLabel {
    color: ${tokens.text.secondary};
    font-size: 0.75rem;
    top: 26px;
  }
  
  & .MuiSlider-valueLabel {
    background-color: ${tokens.surface.inputIsland};
    color: #FFFFFF;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.75rem;
  }
  
  &.Mui-disabled {
    color: ${tokens.text.muted};
    
    & .MuiSlider-thumb {
      background-color: ${tokens.surface.tabMuted};
    }
    
    & .MuiSlider-track {
      background-color: ${tokens.surface.tabMuted};
    }
    
    & .MuiSlider-mark {
      background-color: ${tokens.slider.thumbMuted};
    }
  }
`;

const OrderTypeRow = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 0.25rem;
`;

const SliderInfoContainer = styled("div")`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 0.25rem;
`;

const SliderInfo = styled("span")`
  color: ${tokens.text.primary};
  font-weight: 500;
  text-align: center;
  font-size: 0.875rem;
`;

const AmountInputWrapper = styled("div")`
  display: flex;
  align-items: stretch;
  border: 1px solid ${tokens.overlay.white20};
  border-radius: 6px;
  overflow: hidden;
  background: ${tokens.surface.inputIsland};
  transition: border-color 0.2s ease, background-color 0.2s ease;

  &:focus-within {
    border-color: ${tokens.brand.blue};
    background: ${tokens.surface.inputIsland};
  }

  /* Override InputGroup's generic input styles for the inner input */
  input {
    flex: 1 !important;
    width: auto !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    animation: none !important;
    min-width: 0;

    &:focus {
      outline: none;
      border-color: transparent !important;
      background: transparent !important;
    }

    &::placeholder {
      color: ${tokens.text.muted};
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
`;

const AmountModeDropdown = styled("select")`
  appearance: none;
  padding: 0 0.75rem;
  border: none;
  border-left: 1px solid ${tokens.overlay.white15};
  border-radius: 0;
  background: ${tokens.overlay.white08};
  color: ${tokens.text.onDark};
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  min-width: 56px;
  text-align: center;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23${tokens.text.secondary.slice(1)}'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.4rem center;
  padding-right: 1.4rem;
  transition: background-color 0.15s ease;

  &:hover:not(:disabled) {
    background-color: ${tokens.overlay.white14};
  }

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  option {
    background: ${tokens.surface.footer};
    color: ${tokens.text.onDark};
  }
`;
