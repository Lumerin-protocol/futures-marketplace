import { useState, useEffect, useCallback, useMemo } from "react";
import styled from "@mui/material/styles/styled";
import Modal from "@mui/material/Modal";
import Slider from "@mui/material/Slider";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import { ModalCard } from "../../Modal.styled";
import type { PositionSession } from "../../../hooks/data/perps/useUserPositionSessions";
import { useCreatePerpsOrder } from "../../../hooks/data/perps/useCreatePerpsOrder";
import { useQueryClient } from "@tanstack/react-query";
import { USER_PERPS_ORDERS_QK } from "../../../hooks/data/perps/useUserPerpsOrders";
import { USER_POSITION_SESSIONS_QK } from "../../../hooks/data/perps/useUserPositionSessions";
import { USER_PERPS_TRADES_QK } from "../../../hooks/data/perps/useUserPerpsTrades";
import { getOrderBookQueryKey } from "../../../hooks/data/orderBookHelpers";
import { handleNumericDecimalInput6Decimals } from "../../Forms/Shared/AmountInputForm";

type AmountMode = "size" | "quantity";

interface ClosePerpsPositionModalProps {
  open: boolean;
  onClose: () => void;
  session: PositionSession | null;
  marketPrice?: bigint;
  participantAddress?: `0x${string}`;
  priceStep?: number;
  onConfirmed?: () => void | Promise<void>;
}

export const ClosePerpsPositionModal = ({
  open,
  onClose,
  session,
  marketPrice,
  participantAddress,
  priceStep = 0.01,
  onConfirmed,
}: ClosePerpsPositionModalProps) => {
  const [price, setPrice] = useState("0.00");
  const [amountMode, setAmountMode] = useState<AmountMode>("size");
  const [amount, setAmount] = useState("0");
  const [sliderValue, setSliderValue] = useState(100);
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const { createOrderAsync } = useCreatePerpsOrder();
  const queryClient = useQueryClient();

  const netQty = session?.user.netQuantity ?? 0n;
  const isLong = netQty > 0n;
  const absNetQty = netQty < 0n ? -netQty : netQty;

  // The closing order is always the opposite side of the open position
  const closeSide = isLong ? "Short" : "Long";

  // Max quantity in decimal (6 decimals in bigint → float)
  const maxQuantity = Number(absNetQty) / 1e6;

  const currentPrice = parseFloat(price) || 0;
  const maxSize = maxQuantity * currentPrice;

  // Initialize price and amount when modal opens with position data
  useEffect(() => {
    if (!open || !session) return;

    const initPrice = marketPrice
      ? (Number(marketPrice) / 1e6).toFixed(2)
      : (Number(session.entryPrice) / 1e6).toFixed(2);

    setPrice(initPrice);

    const initPriceNum = parseFloat(initPrice) || 0;
    if (amountMode === "size") {
      setAmount((maxQuantity * initPriceNum).toFixed(2));
    } else {
      setAmount(maxQuantity.toFixed(6));
    }
    setSliderValue(100);
    setCloseError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  // When price changes, recalculate size if in size mode (keep quantity constant)
  const handlePriceChange = (newPrice: string) => {
    setPrice(newPrice);
    const newPriceNum = parseFloat(newPrice) || 0;

    if (amountMode === "size" && newPriceNum > 0) {
      const currentQty = getCurrentQuantity();
      setAmount((currentQty * newPriceNum).toFixed(2));
    }
    // In quantity mode, price change doesn't affect the amount field
  };

  // When slider is at 100% in size mode, the amount field holds the net quantity
  // directly (not a USDC size), so we bypass the price division to avoid float precision loss.
  const isNetQuantityInField = amountMode === "size" && sliderValue === 100;

  const getCurrentQuantity = (): number => {
    if (isNetQuantityInField) return maxQuantity;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return 0;
    if (amountMode === "size") {
      return currentPrice > 0 ? parsed / currentPrice : 0;
    }
    return parsed;
  };

  const getCurrentSize = (): number => {
    if (isNetQuantityInField) return maxQuantity * currentPrice;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return 0;
    if (amountMode === "quantity") {
      return parsed * currentPrice;
    }
    return parsed;
  };

  const handleAmountChange = (newAmount: string) => {
    setAmount(newAmount);
    const parsed = parseFloat(newAmount);
    if (!isNaN(parsed) && parsed >= 0) {
      const maxVal = amountMode === "size" ? maxSize : maxQuantity;
      if (maxVal > 0) {
        const pct = Math.min(100, Math.max(0, (parsed / maxVal) * 100));
        setSliderValue(Math.round(pct));
      }
    }
  };

  const handleSliderChange = (_: Event, value: number | number[]) => {
    const pct = Array.isArray(value) ? value[0] : value;
    setSliderValue(pct);

    if (amountMode === "size") {
      if (pct === 100) {
        setAmount(maxQuantity > 0 ? maxQuantity.toFixed(6) : "0");
      } else {
        const newSize = (maxSize * pct) / 100;
        setAmount(newSize > 0 ? newSize.toFixed(2) : "0");
      }
    } else {
      const newQty = (maxQuantity * pct) / 100;
      setAmount(newQty > 0 ? newQty.toFixed(6) : "0");
    }
  };

  const handleAmountModeChange = (mode: AmountMode) => {
    if (mode === amountMode) return;
    const currentQty = getCurrentQuantity();
    const currentSz = getCurrentSize();
    setAmountMode(mode);
    if (mode === "size") {
      setAmount(currentSz.toFixed(2));
    } else {
      setAmount(currentQty.toFixed(6));
    }
  };

  const incrementPrice = () => {
    const newPrice = snapToStep(currentPrice + priceStep);
    handlePriceChange(newPrice.toFixed(2));
  };

  const decrementPrice = () => {
    const newPrice = snapToStep(Math.max(0.01, currentPrice - priceStep));
    handlePriceChange(newPrice.toFixed(2));
  };

  const snapToStep = (value: number): number => {
    return Math.round(value / priceStep) * priceStep;
  };

  const unrealizedPnl = useMemo(() => {
    if (!session || !marketPrice || netQty === 0n) return 0n;
    const priceDiff = marketPrice - session.entryPrice;
    return (priceDiff * netQty) / 1_000_000n;
  }, [session, marketPrice, netQty]);

  const unrealizedPnlValue = Number(unrealizedPnl) / 1e6;

  const handleClose = useCallback(() => {
    setCloseError(null);
    setIsClosing(false);
    onClose();
  }, [onClose]);

  const handleConfirm = useCallback(async () => {
    if (!session || netQty === 0n) return;
    const closeQty = getCurrentQuantity();
    if (closeQty <= 0) return;

    setIsClosing(true);
    setCloseError(null);

    try {
      const closePriceBig = BigInt(Math.round(currentPrice * 1e6));
      // Selling to close long → negative quantity; buying to close short → positive quantity
      const signedQty = isLong ? -closeQty : closeQty;

      await createOrderAsync({
        price: closePriceBig,
        quantity: signedQty,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [getOrderBookQueryKey("perpetual")] }),
        queryClient.invalidateQueries({ queryKey: [USER_PERPS_ORDERS_QK, participantAddress] }),
        queryClient.invalidateQueries({ queryKey: [USER_POSITION_SESSIONS_QK, participantAddress] }),
        queryClient.invalidateQueries({ queryKey: [USER_PERPS_TRADES_QK, participantAddress] }),
      ]);

      if (onConfirmed) {
        await onConfirmed();
      }

      handleClose();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : "Failed to close position");
    } finally {
      setIsClosing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, netQty, currentPrice, isLong, createOrderAsync, queryClient, participantAddress, handleClose, amount, amountMode, onConfirmed]);

  if (!session) return null;

  const formatPrice = (p: bigint) => (Number(p) / 1e6).toFixed(2);
  const closeQtyDisplay = getCurrentQuantity();
  const closeSizeDisplay = getCurrentSize();

  return (
    <Modal open={open} onClose={handleClose}>
      <ClosePositionModalCard>
        <IconButton className="close" sx={{ color: "white" }} onClick={handleClose}>
          <CloseIcon />
        </IconButton>

        <h2>Close Position</h2>

        <PositionInfoSection>
          <InfoRow>
            <InfoLabel>Close Order Side</InfoLabel>
            <InfoValue>
              <TypeBadge $type={closeSide}>
                {closeSide}
              </TypeBadge>
            </InfoValue>
          </InfoRow>
          <InfoRow>
            <InfoLabel>Entry Price</InfoLabel>
            <InfoValue>{formatPrice(session.entryPrice)} USDC</InfoValue>
          </InfoRow>
          {marketPrice !== undefined && (
            <InfoRow>
              <InfoLabel>Market Price</InfoLabel>
              <InfoValue>{formatPrice(marketPrice)} USDC</InfoValue>
            </InfoRow>
          )}
          <InfoRow>
            <InfoLabel>Unrealized PnL</InfoLabel>
            <InfoValue>
              <PnLText $isPositive={unrealizedPnlValue >= 0}>
                {unrealizedPnlValue >= 0 ? "+" : ""}{unrealizedPnlValue.toFixed(2)} USDC
              </PnLText>
            </InfoValue>
          </InfoRow>
        </PositionInfoSection>

        <InputsSection>
          <InputGroup>
            <InputLabel>Close Price (USDC)</InputLabel>
            <PriceInputContainer>
              <PriceStepButton onClick={decrementPrice} disabled={isClosing}>−</PriceStepButton>
              <PriceInput
                type="text"
                value={price}
                onChange={(e) => handlePriceChange(e.target.value)}
                onBeforeInput={handleNumericDecimalInput6Decimals}
                inputMode="decimal"
                placeholder="0.00"
              />
              <PriceStepButton onClick={incrementPrice} disabled={isClosing}>+</PriceStepButton>
            </PriceInputContainer>
          </InputGroup>

          <InputGroup>
            <AmountLabelRow>
              <InputLabel>Amount</InputLabel>
              <ModeToggle>
                <ModeButton
                  $active={amountMode === "size"}
                  onClick={() => handleAmountModeChange("size")}
                  disabled={isClosing}
                >
                  Size (USDC)
                </ModeButton>
                <ModeButton
                  $active={amountMode === "quantity"}
                  onClick={() => handleAmountModeChange("quantity")}
                  disabled={isClosing}
                >
                  Quantity
                </ModeButton>
              </ModeToggle>
            </AmountLabelRow>
            <AmountInput
              type="text"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value.replace("-", ""))}
              onBeforeInput={handleNumericDecimalInput6Decimals}
              inputMode="decimal"
              placeholder="0.00"
              disabled={isClosing}
            />
            <SliderContainer>
              <StyledSlider
                value={sliderValue}
                onChange={handleSliderChange}
                disabled={isClosing}
                min={0}
                max={100}
                marks={[
                  { value: 0, label: "0%" },
                  { value: 25, label: "25%" },
                  { value: 50, label: "50%" },
                  { value: 75, label: "75%" },
                  { value: 100, label: "100%" },
                ]}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${v}%`}
              />
            </SliderContainer>
          </InputGroup>
        </InputsSection>

        <OrderSummary>
          <SummaryRow>
            <SummaryLabel>Close Quantity</SummaryLabel>
            <SummaryValue>{closeQtyDisplay.toFixed(6)}</SummaryValue>
          </SummaryRow>
          <SummaryRow>
            <SummaryLabel>Close Size (USDC)</SummaryLabel>
            <SummaryValue>{closeSizeDisplay.toFixed(2)}</SummaryValue>
          </SummaryRow>
        </OrderSummary>

        {closeError && <ErrorText>{closeError}</ErrorText>}

        <Actions>
          <CancelButton onClick={handleClose} disabled={isClosing}>Cancel</CancelButton>
          <ConfirmButton
            onClick={handleConfirm}
            disabled={isClosing || closeQtyDisplay <= 0 || currentPrice <= 0}
          >
            {isClosing ? "Closing..." : "Confirm Close"}
          </ConfirmButton>
        </Actions>
      </ClosePositionModalCard>
    </Modal>
  );
};

// ─── Styled Components ───────────────────────────────────────────────────────

const ClosePositionModalCard = styled(ModalCard)`
  max-width: 520px;

  h2 {
    font-size: 1.5rem;
    font-weight: 500;
    padding-bottom: 0.5rem;
    margin-bottom: 0.5rem;
  }
`;

const PositionInfoSection = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  margin-bottom: 1.25rem;
`;

const InfoRow = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const InfoLabel = styled("span")`
  color: #a7a9b6;
  font-size: 0.875rem;
`;

const InfoValue = styled("span")`
  color: #fff;
  font-size: 0.875rem;
  font-weight: 600;
`;

const TypeBadge = styled("span")<{ $type: string }>`
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) => (props.$type === "Long" ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)")};
  color: ${(props) => (props.$type === "Long" ? "#22c55e" : "#ef4444")};
`;

const PnLText = styled("span")<{ $isPositive: boolean }>`
  color: ${(props) => (props.$isPositive ? "#22c55e" : "#ef4444")};
  font-weight: 600;
`;

const InputsSection = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.25rem;
`;

const InputGroup = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const InputLabel = styled("label")`
  font-size: 0.875rem;
  font-weight: 500;
  color: #a7a9b6;
`;

const AmountLabelRow = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
`;

const ModeToggle = styled("div")`
  display: flex;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  overflow: hidden;
`;

const ModeButton = styled("button")<{ $active: boolean }>`
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: background 0.15s ease, color 0.15s ease;
  background: ${(props) => (props.$active ? "#509EBA" : "transparent")};
  color: ${(props) => (props.$active ? "#fff" : "#a7a9b6")};

  &:hover:not(:disabled) {
    background: ${(props) => (props.$active ? "#509EBA" : "rgba(255,255,255,0.08)")};
    color: #fff;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const PriceInputContainer = styled("div")`
  display: flex;
  align-items: center;
  gap: 0;
`;

const PriceStepButton = styled("button")`
  padding: 0.75rem 1rem;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  font-size: 1.2rem;
  font-weight: 600;
  cursor: pointer;
  min-width: 44px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease;

  &:first-of-type {
    border-radius: 6px 0 0 6px;
  }

  &:last-of-type {
    border-radius: 0 6px 6px 0;
  }

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.18);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const sharedInputStyles = `
  padding: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0;
  color: #fff;
  font-size: 1rem;
  width: 100%;
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  transition: border-color 0.2s ease;

  &:focus {
    outline: none;
    border-color: #509EBA;
    background: rgba(255, 255, 255, 0.08);
  }

  &::placeholder {
    color: #6b7280;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const PriceInput = styled("input")`
  ${sharedInputStyles}
`;

const AmountInput = styled("input")`
  ${sharedInputStyles}
  border-radius: 6px;
`;

const SliderContainer = styled("div")`
  padding: 0 1rem;
  margin-top: 0.5rem;
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

const OrderSummary = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  margin-bottom: 1.25rem;
`;

const SummaryRow = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SummaryLabel = styled("span")`
  color: #a7a9b6;
  font-size: 0.8rem;
`;

const SummaryValue = styled("span")`
  color: #fff;
  font-size: 0.8rem;
  font-weight: 500;
`;

const ErrorText = styled("p")`
  color: #ef4444;
  font-size: 0.8125rem;
  margin: 0 0 1rem 0;
`;

const Actions = styled("div")`
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
`;

const CancelButton = styled("button")`
  padding: 0.5rem 1rem;
  background: #4c5a5f;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover:not(:disabled) {
    background: #5a6b70;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ConfirmButton = styled("button")`
  padding: 0.5rem 1rem;
  background: #ef4444;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover:not(:disabled) {
    background: #dc2626;
  }

  &:disabled {
    background: #6b7280;
    cursor: not-allowed;
    opacity: 0.6;
  }
`;
