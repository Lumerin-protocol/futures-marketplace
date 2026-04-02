import { useState } from "react";
import Slider from "@mui/material/Slider";
import styled from "@mui/material/styles/styled";
import { tokens } from "../../../styles/tokens";
import { handleNumericDecimalInput6Decimals } from "../../Forms/Shared/AmountInputForm";
import { ModalCard } from "../../Modal.styled";

export type AmountMode = "size" | "quantity";

// ── Shared form state & logic hook ───────────────────────────────────────────

export function usePerpsOrderForm({
  maxQuantity,
  priceStep = 0.01,
}: {
  maxQuantity: number;
  priceStep?: number;
}) {
  const [price, setPrice] = useState("0.00");
  const [amountMode, setAmountMode] = useState<AmountMode>("size");
  const [amount, setAmount] = useState("0");
  const [sliderValue, setSliderValue] = useState(100);

  const currentPrice = parseFloat(price) || 0;
  const maxSize = maxQuantity * currentPrice;

  const getCurrentQuantity = (): number => {
    if (sliderValue === 100) return maxQuantity;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return 0;
    if (amountMode === "size") return currentPrice > 0 ? parsed / currentPrice : 0;
    return parsed;
  };

  const getCurrentSize = (): number => {
    if (sliderValue === 100) return maxQuantity * currentPrice;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return 0;
    if (amountMode === "quantity") return parsed * currentPrice;
    return parsed;
  };

  const handlePriceChange = (newPrice: string) => {
    setPrice(newPrice);
    const newPriceNum = parseFloat(newPrice) || 0;
    if (amountMode === "size" && newPriceNum > 0) {
      const currentQty = getCurrentQuantity();
      setAmount((currentQty * newPriceNum).toFixed(2));
    }
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
        setAmount(maxSize > 0 ? maxSize.toFixed(2) : "0");
      } else {
        const newSize = (maxSize * pct) / 100;
        setAmount(newSize > 0 ? newSize.toFixed(2) : "0");
      }
    } else {
      if (pct === 100) {
        setAmount(maxQuantity > 0 ? maxQuantity.toFixed(6) : "0");
      } else {
        const newQty = (maxQuantity * pct) / 100;
        setAmount(newQty > 0 ? newQty.toFixed(6) : "0");
      }
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

  const snapToStep = (value: number): number => Math.round(value / priceStep) * priceStep;

  const incrementPrice = () => handlePriceChange(snapToStep(currentPrice + priceStep).toFixed(2));
  const decrementPrice = () =>
    handlePriceChange(snapToStep(Math.max(0.01, currentPrice - priceStep)).toFixed(2));

  // Call this when the modal opens to re-initialize form state.
  // amountMode is intentionally preserved across opens.
  const reset = (initialPriceStr: string, initialSlider = 100) => {
    setPrice(initialPriceStr);
    setSliderValue(initialSlider);
    const initPriceNum = parseFloat(initialPriceStr) || 0;
    if (amountMode === "size") {
      if (initialSlider === 100) {
        const initMaxSize = maxQuantity * initPriceNum;
        setAmount(initMaxSize > 0 ? initMaxSize.toFixed(2) : "0");
      } else {
        const initSize = (maxQuantity * initPriceNum * initialSlider) / 100;
        setAmount(initSize > 0 ? initSize.toFixed(2) : "0");
      }
    } else {
      if (initialSlider === 100) {
        setAmount(maxQuantity > 0 ? maxQuantity.toFixed(6) : "0");
      } else {
        const initQty = (maxQuantity * initialSlider) / 100;
        setAmount(initQty > 0 ? initQty.toFixed(6) : "0");
      }
    }
  };

  return {
    price,
    amount,
    amountMode,
    sliderValue,
    currentPrice,
    maxSize,
    getCurrentQuantity,
    getCurrentSize,
    handlePriceChange,
    handleAmountChange,
    handleSliderChange,
    handleAmountModeChange,
    incrementPrice,
    decrementPrice,
    reset,
  };
}

// ── Shared form fields component ─────────────────────────────────────────────

interface PerpsOrderFormFieldsProps {
  price: string;
  amount: string;
  amountMode: AmountMode;
  sliderValue: number;
  disabled?: boolean;
  hidePriceInput?: boolean;
  priceLabel?: string;
  quantityLabel?: string;
  sizeLabel?: string;
  currentQuantity: number;
  currentSize: number;
  realizedPnl?: number | null;
  onPriceChange: (price: string) => void;
  onAmountChange: (amount: string) => void;
  onAmountModeChange: (mode: AmountMode) => void;
  onSliderChange: (_: Event, value: number | number[]) => void;
  onIncrementPrice: () => void;
  onDecrementPrice: () => void;
}

export const PerpsOrderFormFields = ({
  price,
  amount,
  amountMode,
  sliderValue,
  disabled,
  hidePriceInput,
  priceLabel = "Price (USDC)",
  quantityLabel = "Quantity",
  sizeLabel = "Size (USDC)",
  currentQuantity,
  currentSize,
  realizedPnl,
  onPriceChange,
  onAmountChange,
  onAmountModeChange,
  onSliderChange,
  onIncrementPrice,
  onDecrementPrice,
}: PerpsOrderFormFieldsProps) => (
  <>
    <InputsSection>
      {!hidePriceInput && (
        <InputGroup>
          <InputLabel>{priceLabel}</InputLabel>
          <PriceInputContainer>
            <PriceStepButton onClick={onDecrementPrice} disabled={disabled}>−</PriceStepButton>
            <PriceInput
              type="text"
              value={price}
              onChange={(e) => onPriceChange(e.target.value)}
              onBeforeInput={handleNumericDecimalInput6Decimals}
              inputMode="decimal"
              placeholder="0.00"
              disabled={disabled}
            />
            <PriceStepButton onClick={onIncrementPrice} disabled={disabled}>+</PriceStepButton>
          </PriceInputContainer>
        </InputGroup>
      )}

      <InputGroup>
        <AmountLabelRow>
          <InputLabel>Amount</InputLabel>
          <ModeToggle>
            <ModeButton
              $active={amountMode === "size"}
              onClick={() => onAmountModeChange("size")}
              disabled={disabled}
            >
              Size (USDC)
            </ModeButton>
            <ModeButton
              $active={amountMode === "quantity"}
              onClick={() => onAmountModeChange("quantity")}
              disabled={disabled}
            >
              Quantity
            </ModeButton>
          </ModeToggle>
        </AmountLabelRow>
        <AmountInput
          type="text"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value.replace("-", ""))}
          onBeforeInput={handleNumericDecimalInput6Decimals}
          inputMode="decimal"
          placeholder="0.00"
          disabled={disabled}
        />
        <SliderContainer>
          <StyledSlider
            value={sliderValue}
            onChange={onSliderChange}
            disabled={disabled}
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
        <SummaryLabel>{quantityLabel}</SummaryLabel>
        <SummaryValue>{currentQuantity.toFixed(6)}</SummaryValue>
      </SummaryRow>
      <SummaryRow>
        <SummaryLabel>{sizeLabel}</SummaryLabel>
        <SummaryValue>{currentSize.toFixed(2)}</SummaryValue>
      </SummaryRow>
      {realizedPnl != null && (
        <SummaryRow>
          <SummaryLabel>Expected Realized PnL</SummaryLabel>
          <SummaryPnLValue $isPositive={realizedPnl >= 0}>
            {realizedPnl >= 0 ? "+" : ""}{realizedPnl.toFixed(2)} USDC
          </SummaryPnLValue>
        </SummaryRow>
      )}
    </OrderSummary>
  </>
);

// ── Shared styled components ──────────────────────────────────────────────────

export const PerpsModalCard = styled(ModalCard)`
  max-width: 520px;

  h2 {
    font-size: 1.5rem;
    font-weight: 500;
    padding-bottom: 0.5rem;
    margin-bottom: 0.5rem;
  }
`;

export const PositionInfoSection = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  background: ${tokens.surface.inputIsland};
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.md};
  margin-bottom: 1.25rem;
`;

export const InfoRow = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

export const InfoLabel = styled("span")`
  color: ${tokens.text.secondary};
  font-size: 0.875rem;
`;

export const InfoValue = styled("span")`
  color: ${tokens.text.onDark};
  font-size: 0.875rem;
  font-weight: 600;
`;

export const TypeBadge = styled("span")<{ $type: string }>`
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) =>
    props.$type === "Long" ? tokens.trading.longRowBg : tokens.trading.shortRowBg};
  color: ${(props) => (props.$type === "Long" ? tokens.trading.long : tokens.trading.short)};
`;

export const PnLText = styled("span")<{ $isPositive: boolean }>`
  color: ${(props) => (props.$isPositive ? tokens.trading.long : tokens.trading.short)};
  font-weight: 600;
`;

export const InputsSection = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.25rem;
`;

export const InputGroup = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

export const InputLabel = styled("label")`
  font-size: 0.875rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
`;

export const AmountLabelRow = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
`;

export const ModeToggle = styled("div")`
  display: flex;
  border: 1px solid ${tokens.overlay.white15};
  border-radius: 6px;
  overflow: hidden;
`;

export const ModeButton = styled("button")<{ $active: boolean }>`
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: background 0.15s ease, color 0.15s ease;
  background: ${(props) => (props.$active ? tokens.surface.tabActive : "transparent")};
  color: ${(props) => (props.$active ? "#FFFFFF" : tokens.text.secondary)};

  &:hover:not(:disabled) {
    background: ${(props) => (props.$active ? tokens.surface.tabHover : tokens.overlay.white08)};
    color: #FFFFFF;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

export const PriceInputContainer = styled("div")`
  display: flex;
  align-items: center;
  gap: 0;
`;

export const PriceStepButton = styled("button")`
  padding: 0.75rem 1rem;
  color: ${tokens.text.onDark};
  border: 1px solid ${tokens.overlay.white20};
  background: ${tokens.surface.inputIsland};
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
    background: ${tokens.surface.inputIslandHover};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const sharedInputStyles = `
  padding: 0.75rem;
  border: 1px solid ${tokens.overlay.white20};
  border-radius: 0;
  color: ${tokens.text.onDark};
  font-size: 1rem;
  width: 100%;
  flex: 1;
  background: ${tokens.surface.inputIsland};
  transition: border-color 0.2s ease;

  &:focus {
    outline: none;
    border-color: ${tokens.accent.main};
    background: ${tokens.surface.inputIsland};
  }

  &::placeholder {
    color: ${tokens.text.muted};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const PriceInput = styled("input")`
  ${sharedInputStyles}
`;

export const AmountInput = styled("input")`
  ${sharedInputStyles}
  border-radius: 6px;
`;

export const SliderContainer = styled("div")`
  padding: 0 1rem;
  margin-top: 0.5rem;
`;

export const StyledSlider = styled(Slider)`
  color: ${tokens.text.primary};
  height: 6px;
  padding: 13px 0;

  & .MuiSlider-thumb {
    width: 18px;
    height: 18px;
    background-color: ${tokens.neutralButton.bg};
    transition: all 0.2s ease;

    &:hover,
    &.Mui-focusVisible {
      box-shadow: 0 0 0 8px ${tokens.overlay.white16};
      background-color: ${tokens.neutralButton.hover};
    }

    &.Mui-active {
      box-shadow: 0 0 0 14px ${tokens.overlay.white16};
    }
  }

  & .MuiSlider-track {
    height: 6px;
    border: none;
    background-color: ${tokens.neutralButton.bg};
  }

  & .MuiSlider-rail {
    height: 6px;
    background-color: ${tokens.surface.inputIsland};
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

export const OrderSummary = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: ${tokens.surface.inputIsland};
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.md};
  margin-bottom: 1.25rem;
`;

export const SummaryRow = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

export const SummaryLabel = styled("span")`
  color: ${tokens.text.secondary};
  font-size: 0.8rem;
`;

export const SummaryValue = styled("span")`
  color: ${tokens.text.onDark};
  font-size: 0.8rem;
  font-weight: 500;
`;

export const SummaryPnLValue = styled("span")<{ $isPositive: boolean }>`
  font-size: 0.8rem;
  font-weight: 600;
  color: ${(props) => (props.$isPositive ? tokens.trading.long : tokens.trading.short)};
`;

export const ErrorText = styled("p")`
  color: ${tokens.trading.short};
  font-size: 0.8125rem;
  margin: 0 0 1rem 0;
`;

export const ModalActions = styled("div")`
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
`;

export const ModalCancelButton = styled("button")`
  padding: 0.5rem 1rem;
  background: transparent;
  color: ${tokens.text.onDark};
  border: 1px solid ${tokens.border.default};
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;

  &:hover:not(:disabled) {
    background: ${tokens.overlay.white08};
    border-color: ${tokens.text.secondary};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const ModalConfirmButton = styled(ModalCancelButton)`
  background: ${tokens.neutralButton.bg};
  border: none;

  &:hover:not(:disabled) {
    background: ${tokens.neutralButton.hover};
    border-color: transparent;
  }
`;
