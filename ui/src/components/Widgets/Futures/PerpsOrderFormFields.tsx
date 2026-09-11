import { type ReactNode, useId, useState } from "react";
import styled from "@mui/material/styles/styled";
import { tokens } from "../../../styles/tokens";
import {
  handleNumericDecimalInput6Decimals,
  handleNumericIntegerInput,
} from "../../Forms/Shared/AmountInputForm";
import {
  AmountInputWrapper,
  AmountModeDropdown,
  InputGroup,
  PriceButton,
  PriceInputContainer,
  SliderContainer,
} from "../../Forms/Shared/OrderFields";
import { percentSliderProps, StyledSlider } from "../../Forms/Shared/StyledSlider";
import { percentForQuantity, quantityAtPercent } from "../../../lib/sliderSnap";
import { ModalCard } from "../../Modal.styled";

export type AmountMode = "size" | "quantity";

// ── Shared form state & logic hook ───────────────────────────────────────────

export function usePerpsOrderForm({
  maxQuantity,
  priceStep = 0.01,
  quantityDecimals = 6,
  initialAmountMode = "size",
  allowAboveMax = false,
}: {
  maxQuantity: number;
  priceStep?: number;
  /** Zero for futures, whose contracts are whole units. */
  quantityDecimals?: number;
  initialAmountMode?: AmountMode;
  /**
   * Let a typed amount exceed `maxQuantity`. Modify raises an order by
   * cancel-and-replace and checks margin for the new size itself, so it opts in.
   * Close must stay capped at the position size, and that cap lives here.
   */
  allowAboveMax?: boolean;
}) {
  const [price, setPrice] = useState("0.00");
  const [amountMode, setAmountMode] = useState<AmountMode>(initialAmountMode);
  const [amount, setAmount] = useState("0");
  const [sliderValue, setSliderValue] = useState(100);
  /**
   * Whether `amount` was last written by the slider. Only then may 100% stand in
   * for the exact `maxQuantity`; otherwise a typed value would be silently
   * replaced by the max, which is what used to make a raised amount look ignored.
   */
  const [amountFromSlider, setAmountFromSlider] = useState(true);

  const currentPrice = parseFloat(price) || 0;
  const maxSize = maxQuantity * currentPrice;

  const roundQuantity = (value: number) =>
    quantityDecimals === 0 ? Math.round(value) : value;

  const getCurrentQuantity = (): number => {
    if (amountFromSlider && sliderValue === 100) return maxQuantity;
    const parsed = parseFloat(amount);
    if (Number.isNaN(parsed) || parsed <= 0) return 0;
    const quantity =
      amountMode === "size"
        ? currentPrice > 0
          ? roundQuantity(parsed / currentPrice)
          : 0
        : roundQuantity(parsed);
    return allowAboveMax ? quantity : Math.min(quantity, maxQuantity);
  };

  const getCurrentSize = (): number => {
    if (amountFromSlider && sliderValue === 100) return maxQuantity * currentPrice;
    const parsed = parseFloat(amount);
    if (Number.isNaN(parsed) || parsed <= 0) return 0;
    const size = amountMode === "quantity" ? parsed * currentPrice : parsed;
    return allowAboveMax ? size : Math.min(size, maxSize);
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
    setAmountFromSlider(false);
    const parsed = parseFloat(newAmount);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      const maxVal = amountMode === "size" ? maxSize : maxQuantity;
      if (maxVal > 0) {
        // The slider only tracks the field for display, so it stays clamped to
        // its own 0–100 range even when the typed amount runs past the max.
        const pct = Math.min(100, Math.max(0, (parsed / maxVal) * 100));
        setSliderValue(Math.round(pct));
      }
    }
  };

  // Same snapping as the order widget's slider (see lib/sliderSnap).
  const handleSliderChange = (_: Event, value: number | number[]) => {
    const pct = Array.isArray(value) ? value[0] : value;
    setSliderValue(pct);
    setAmountFromSlider(true);
    const qty = pct === 100 ? maxQuantity : quantityAtPercent(pct, maxQuantity, quantityDecimals);
    if (amountMode === "size") {
      const size = qty * currentPrice;
      setAmount(size > 0 ? size.toFixed(2) : "0");
    } else {
      setAmount(qty > 0 ? qty.toFixed(quantityDecimals) : "0");
    }
  };

  /**
   * On release, for whole-contract quantities: park the thumb exactly where the
   * quantity in the amount field sits, so the handle and the number agree.
   */
  const handleSliderCommitted = () => {
    if (quantityDecimals !== 0 || maxQuantity <= 0) return;
    setSliderValue(percentForQuantity(getCurrentQuantity(), maxQuantity));
  };

  const handleAmountModeChange = (mode: AmountMode) => {
    if (mode === amountMode) return;
    const currentQty = getCurrentQuantity();
    const currentSz = getCurrentSize();
    setAmountMode(mode);
    if (mode === "size") {
      setAmount(currentSz.toFixed(2));
    } else {
      setAmount(currentQty.toFixed(quantityDecimals));
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
    setAmountFromSlider(true);
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
        setAmount(maxQuantity > 0 ? maxQuantity.toFixed(quantityDecimals) : "0");
      } else {
        const initQty = (maxQuantity * initialSlider) / 100;
        setAmount(initQty > 0 ? initQty.toFixed(quantityDecimals) : "0");
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
    handleSliderCommitted,
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
  /** Market orders have no price to edit; the group is left out, as in the sidebar. */
  hidePriceInput?: boolean;
  priceLabel?: string;
  quantityLabel?: string;
  sizeLabel?: string;
  /** Zero for futures, whose contracts are whole units. */
  quantityDecimals?: number;
  currentQuantity: number;
  currentSize: number;
  realizedPnl?: number | null;
  /**
   * Tighter variant: 0.8rem labels, 40px fields, 6px label-to-input, and no
   * trailing margin — the caller spaces it.
   */
  compact?: boolean;
  /** Replaces the summary card; `null` renders nothing there. */
  summary?: ReactNode;
  onPriceChange: (price: string) => void;
  onAmountChange: (amount: string) => void;
  onAmountModeChange: (mode: AmountMode) => void;
  onSliderChange: (_: Event, value: number | number[]) => void;
  /** Release: lets the form park the thumb on the snapped quantity. */
  onSliderCommitted?: () => void;
  onIncrementPrice: () => void;
  onDecrementPrice: () => void;
}

/**
 * The sidebar's fields, in a modal: price with steppers, amount with the
 * Size/Quantity dropdown inside it, the percent slider. Built from the same
 * primitives as the sidebar (Forms/Shared/OrderFields) so the two feel alike.
 */
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
  quantityDecimals = 6,
  currentQuantity,
  currentSize,
  realizedPnl,
  compact = false,
  summary,
  onPriceChange,
  onAmountChange,
  onAmountModeChange,
  onSliderChange,
  onSliderCommitted,
  onIncrementPrice,
  onDecrementPrice,
}: PerpsOrderFormFieldsProps) => {
  const fieldId = useId();
  return (
    <>
      <InputsSection className={compact ? "compact" : undefined}>
        {!hidePriceInput && (
          <InputGroup>
            <label htmlFor={`${fieldId}-price`}>{priceLabel}</label>
            <PriceInputContainer className="field">
              <PriceButton onClick={onDecrementPrice} disabled={disabled}>
                −
              </PriceButton>
              <input
                id={`${fieldId}-price`}
                type="text"
                value={price}
                onChange={(e) => onPriceChange(e.target.value)}
                onBeforeInput={handleNumericDecimalInput6Decimals}
                inputMode="decimal"
                placeholder="0.00"
                disabled={disabled}
              />
              <PriceButton onClick={onIncrementPrice} disabled={disabled}>
                +
              </PriceButton>
            </PriceInputContainer>
          </InputGroup>
        )}

        <InputGroup>
          <label htmlFor={`${fieldId}-amount`}>{amountMode === "size" ? sizeLabel : quantityLabel}</label>
          <AmountInputWrapper className="field">
            <input
              id={`${fieldId}-amount`}
              type="text"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value.replace("-", ""))}
              onBeforeInput={
                quantityDecimals === 0 && amountMode === "quantity"
                  ? handleNumericIntegerInput
                  : handleNumericDecimalInput6Decimals
              }
              inputMode="decimal"
              placeholder="0.00"
              disabled={disabled}
            />
            <AmountModeDropdown
              value={amountMode}
              onChange={(e) => onAmountModeChange(e.target.value as AmountMode)}
              disabled={disabled}
            >
              <option value="size">Size</option>
              <option value="quantity">Quantity</option>
            </AmountModeDropdown>
          </AmountInputWrapper>
          <SliderContainer>
            <StyledSlider
              value={sliderValue}
              onChange={onSliderChange}
              onChangeCommitted={onSliderCommitted}
              disabled={disabled}
              {...percentSliderProps}
            />
          </SliderContainer>
        </InputGroup>
      </InputsSection>

      {summary !== undefined ? (
        summary
      ) : (
        <OrderSummary>
          <SummaryRow>
            <SummaryLabel>{quantityLabel}</SummaryLabel>
            <SummaryValue>{currentQuantity.toFixed(quantityDecimals)}</SummaryValue>
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
      )}
    </>
  );
};

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

  /* Compact variant (see PerpsOrderFormFields.compact): smaller labels, 40px
     fields, tight label-to-input, and the caller owns the outer spacing. */
  &.compact {
    margin-bottom: 0;

    & > * {
      gap: 0.375rem;
    }

    label {
      font-size: 0.8rem;
    }

    .field {
      height: 40px;
    }

    input {
      font-size: 0.9375rem;
    }

    select {
      font-size: 0.8rem;
    }

    /* MUI reserves 20px under a marked slider for its labels; they need 12. */
    .MuiSlider-marked {
      margin-bottom: 12px;
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
