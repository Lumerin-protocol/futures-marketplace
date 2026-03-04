import styled from "@mui/material/styles/styled";
import { keyframes, css } from "@emotion/react";
import { SmallWidget } from "../../Cards/Cards.styled";
import { useState, useEffect, useCallback } from "react";
import Slider from "@mui/material/Slider";

// Pulsing background animation - single blue color for all inputs
const pulseYellow = keyframes`
  0%, 100% {
    background-color: rgba(251, 191, 36, 0.15);
  }
  50% {
    background-color: rgba(251, 191, 36, 0.45);
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
  contractMode?: ContractMode;
  accountBalance?: AccountBalance;
  balanceQuery: BalanceQueryResult;
  perpsCollection?: PerpsCollection;
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
  contractMode = "futures",
  accountBalance,
  balanceQuery,
  perpsCollection,
}: PlaceOrderWidgetProps) => {
  const { data: marketPrice, isLoading: isMarketPriceLoading } = useGetMarketPrice();
  const { address } = useAccount();
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

  const [price, setPrice] = useState("5.00"); // Will be updated when hashrate data loads
  const [priceInitialized, setPriceInitialized] = useState(false); // Track if price has been initialized from hashrate
  const [amount, setAmount] = useState<number | string>(5); // Can be number or string to support decimals in perpetuals
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
  }, [price, balanceQuery.data, minMargin, latestPrice, amount]);

  // Helper to get numeric amount value for calculations
  const getNumericAmount = (): number => {
    const parsed = typeof amount === "string" ? parseFloat(amount) : amount;
    return isNaN(parsed) || parsed <= 0 ? 0 : parsed;
  };

  // Calculate margin percentage from leverage
  // Formula: marginPercent = (1 / leverage) * 100
  // Example: 10x leverage = (1/10) * 100 = 10%
  const getMarginPercentFromLeverage = (): number => {
    return (1 / leverage) * 100;
  };

  // Calculate quantity from size (notional) for perps mode
  // Formula: quantity = size / price
  // Example: size=100, price=2, leverage=10x => quantity = 100/2 = 50, required margin = 100/10 = 10 USDC
  const calculateQuantityFromAmount = (sizeValue: number, priceValue: number): number => {
    if (contractMode !== "perpetual" || priceValue <= 0) return sizeValue;
    return sizeValue / priceValue;
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
    const lockedBalance = minMargin ?? 0n;
    const availableBalance = totalBalance > lockedBalance ? totalBalance - lockedBalance : 0n;

    // For perpetual mode, return max size (notional) = (availableBalance - 0.1 USDC) × leverage
    if (contractMode === "perpetual") {
      const buffer = 100_000n; // 0.1 USDC in base units (6 decimals)
      const effectiveBalance = availableBalance > buffer ? availableBalance - buffer : 0n;
      return (Number(effectiveBalance) / 1e6) * leverage;
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

  // Show loading state while minimumPriceIncrement is being fetched
  if (contractSpecsQuery.isLoading || !priceStep || isMarketPriceLoading || !newestItemPrice) {
    return (
      <PlaceOrderContainer>
        {/* <h3>Place Order{contractMode === "perpetual" ? " - PERP" : ""}</h3> */}
        <div style={{ textAlign: "center", padding: "2rem", color: "#6b7280" }}>
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
    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) {
      alert("Amount must be greater than 0");
      return;
    }

    // Validate minimum margin
    const currentPrice = parseFloat(price);
    const priceInWei = BigInt(Math.round(currentPrice * 1e6));
    const totalBalance = balanceQuery.data ?? 0n;
    const lockedBalance = minMargin ?? 0n;
    const availableBalance = totalBalance > lockedBalance ? totalBalance - lockedBalance : 0n;

    // Required margin = size / leverage
    const requiredMargin = numericAmount / leverage;
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

    // Calculate quantity from size
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
    const numericAmount = getNumericAmount();
    if (numericAmount <= 0) {
      alert("Amount must be greater than 0");
      return;
    }

    const currentPrice = parseFloat(price);
    const priceInWei = BigInt(Math.round(currentPrice * 1e6));
    const totalBalance = balanceQuery.data ?? 0n;
    const lockedBalance = minMargin ?? 0n;
    const availableBalance = totalBalance > lockedBalance ? totalBalance - lockedBalance : 0n;

    // Required margin = size / leverage
    const requiredMargin = numericAmount / leverage;
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

    // Calculate quantity from size
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
    const currentPrice = parseFloat(price);
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

    // Check if price exceeds the configured percentage of newest item price
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
    const currentPrice = parseFloat(price);
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

    // Check if price exceeds the configured percentage of newest item price
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
              <LeverageButtonContainer>
                <LeverageButton onClick={() => setShowLeverageModal(true)} disabled={showOrderForm}>
                  <LeverageButtonLabel>Leverage</LeverageButtonLabel>
                  <LeverageButtonValue>{leverage}x</LeverageButtonValue>
                </LeverageButton>
              </LeverageButtonContainer>
            )}
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

            <InputGroup $isHighlighted={highlightedButton !== null}>
              <label>
                {contractMode === "perpetual" ? "Size (USDC)" : "Quantity"}
                {/* {contractMode === "perpetual" && <span style={{ fontSize: "0.7rem", color: "#a7a9b6", marginLeft: "0.5rem" }}>(min: 5)</span>} */}
              </label>
              {contractMode === "perpetual" ? (
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => handleAmountChange(e.target.value.replace("-", ""))}
                  onBeforeInput={handleNumericDecimalInput6Decimals}
                  inputMode="decimal"
                  placeholder="0.00"
                  min="0"
                  style={{ minWidth: "70px" }}
                />
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
                      setAmount(newAmount > 0 ? newAmount.toFixed(2) : "0");
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
            <BuyButton onClick={handleBuy} disabled={showOrderForm} $isHighlighted={highlightedButton === "buy"}>
              Bid
            </BuyButton>
            <SellButton onClick={handleSell} disabled={showOrderForm} $isHighlighted={highlightedButton === "sell"}>
              Ask
            </SellButton>
          </ButtonSection>

          {contractMode === "perpetual" && getNumericAmount() > 0 && (
            <OrderSummary>
              <OrderSummaryRow>
                <span>Required Margin</span>
                <span>{(getNumericAmount() / leverage).toFixed(2)} USDC</span>
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
            onOrderPlaced={onOrderPlaced}
            bypassConflictCheck={bypassConflictCheck}
            contractMode={contractMode}
            perpsCollection={perpsCollection}
            leverage={leverage}
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

      <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
        <div className="flex justify-between items-center mb-4">
          <span className="text-gray-300 text-sm">Current Leverage:</span>
          <span className="text-white font-semibold text-lg">{tempLeverage}x</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-300 text-sm">Margin Required:</span>
          <span className="text-blue-400 font-semibold">{getMarginPercent(tempLeverage).toFixed(2)}%</span>
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
    color: #a7a9b6;
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
    color: #a7a9b6;
  }
  
  input {
    padding: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    color: #fff;
    font-size: 1rem;
    transition: border-color 0.2s ease;
    width: 100%;
    animation: ${(props) => getPulseAnimation(props.$isHighlighted)};
    background: ${(props) => (props.$isHighlighted ? undefined : "rgba(255, 255, 255, 0.05)")};
    
    &:focus {
      outline: none;
      border-color: #509EBA;
      background: rgba(255, 255, 255, 0.08);
    }
    
    &::placeholder {
      color: #6b7280;
    }
  }
`;

const MinMarginLabel = styled("div")`
  font-size: 0.75rem;
  color: #a7a9b6;
  margin-top: 0.25rem;
  text-align: center;
`;

const ExpectedQuantityLabel = styled("div")`
  font-size: 0.75rem;
  color: #509EBA;
  margin-top: 0.25rem;
  text-align: center;
  font-weight: 500;
`;

const LeverageButtonContainer = styled("div")`
  margin-top: 0.75rem;
`;

const LeverageButton = styled("button")`
  width: 100%;
  padding: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  font-size: 1rem;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    border-color: #509EBA;
    background: rgba(255, 255, 255, 0.08);
  }

  &:focus {
    outline: none;
    border-color: #509EBA;
    background: rgba(255, 255, 255, 0.08);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const LeverageButtonLabel = styled("span")`
  font-size: 0.875rem;
  font-weight: 500;
  color: #fff;
`;

const LeverageButtonValue = styled("span")`
  font-size: 1rem;
  font-weight: 600;
  color: #fff;
`;

const LeverageHeader = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.75rem;
  margin-bottom: 0.25rem;
  
  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #a7a9b6;
  }
`;

const LeverageValue = styled("span")`
  font-size: 1rem;
  font-weight: 600;
  color: #509EBA;
`;

const LeverageSliderContainer = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 0.5rem;
  margin-top: 0.5rem;
`;

const MarginInfo = styled("div")`
  font-size: 0.75rem;
  color: #a7a9b6;
  text-align: center;
  margin-top: 0.25rem;
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
    border-top: 1px solid rgba(255, 255, 255, 0.2);
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    animation: ${(props) => getPulseAnimation(props.$isHighlighted)};
    background: ${(props) => (props.$isHighlighted ? undefined : "rgba(255, 255, 255, 0.05)")};
    
    &:focus {
      border-left: 1px solid #509EBA;
      border-right: 1px solid #509EBA;
    }
  }
`;

const PriceButton = styled("button")<{ $isHighlighted?: boolean }>`
  padding: 0.75rem 1rem;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
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
  background: ${(props) => (props.$isHighlighted ? undefined : "rgba(255, 255, 255, 0.1)")};
  
  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
  }
  
  &:active:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
  }
  
  &:disabled {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
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
  background: #22c55e;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.1s ease;
  min-width: 120px;
  animation: ${(props) => (props.$isHighlighted ? css`${pulseYellow} 1.5s ease-in-out infinite` : "none")};
  
  &:hover:not(:disabled) {
    background: #16a34a;
    transform: translateY(-1px);
  }
  
  &:active:not(:disabled) {
    transform: translateY(0);
  }
  
  &:disabled {
    background: #6b7280;
    cursor: not-allowed;
    opacity: 0.6;
    animation: none;
  }
`;

const SellButton = styled("button")<{ $isHighlighted?: boolean }>`
  width: 100%;
  padding: 0.875rem 1rem;
  background: #ef4444;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.1s ease;
  min-width: 120px;
  animation: ${(props) => (props.$isHighlighted ? css`${pulseYellow} 1.5s ease-in-out infinite` : "none")};
  
  &:hover:not(:disabled) {
    background: #dc2626;
    transform: translateY(-1px);
  }
  
  &:active:not(:disabled) {
    transform: translateY(0);
  }
  
  &:disabled {
    background: #6b7280;
    cursor: not-allowed;
    opacity: 0.6;
    animation: none;
  }
`;

const OrderSummary = styled("div")`
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  background: rgba(255, 255, 255, 0.03);
`;

const OrderSummaryRow = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;

  span:first-child {
    color: #a7a9b6;
  }

  span:last-child {
    color: #fff;
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
  color: #ffffff;
  height: 6px;
  padding: 13px 0;
  
  & .MuiSlider-thumb {
    width: 18px;
    height: 18px;
    background-color: #ffffff;
    transition: all 0.2s ease;
    
    &:hover,
    &.Mui-focusVisible {
      box-shadow: 0 0 0 8px rgba(255, 255, 255, 0.16);
      background-color: #f0f0f0;
    }
    
    &.Mui-active {
      box-shadow: 0 0 0 14px rgba(255, 255, 255, 0.16);
    }
  }
  
  & .MuiSlider-track {
    height: 6px;
    border: none;
    background-color: #ffffff;
  }
  
  & .MuiSlider-rail {
    height: 6px;
    background-color: rgba(255, 255, 255, 0.2);
    opacity: 1;
  }
  
  & .MuiSlider-mark {
    width: 2px;
    height: 6px;
    background-color: rgba(255, 255, 255, 0.5);
    opacity: 1;
  }
  
  & .MuiSlider-markActive {
    background-color: rgba(0, 0, 0, 0.3);
  }
  
  & .MuiSlider-markLabel {
    color: #a7a9b6;
    font-size: 0.75rem;
    top: 26px;
  }
  
  & .MuiSlider-valueLabel {
    background-color: #ffffff;
    color: #000000;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.75rem;
  }
  
  &.Mui-disabled {
    color: #6b7280;
    
    & .MuiSlider-thumb {
      background-color: #6b7280;
    }
    
    & .MuiSlider-track {
      background-color: #6b7280;
    }
    
    & .MuiSlider-mark {
      background-color: rgba(107, 114, 128, 0.5);
    }
  }
`;

const SliderInfoContainer = styled("div")`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 0.25rem;
`;

const SliderInfo = styled("span")`
  color: #ffffff;
  font-weight: 500;
  text-align: center;
  font-size: 0.875rem;
`;
