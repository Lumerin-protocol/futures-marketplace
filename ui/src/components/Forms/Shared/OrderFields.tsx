/**
 * The order form's field primitives, as the sidebar Place Order widget draws
 * them: label over a 48px island input, ± steppers flanking the price, the
 * Size/Quantity dropdown sitting inside the amount field, the segmented mode
 * toggle. Every form that edits an order — the sidebar, Modify, Close — builds
 * from these, so they all feel like one control set; callers add spacing and
 * size variants on top rather than redrawing the parts.
 */
import { styled, css, keyframes } from "next-yak";
import { tokens } from "../../../styles/tokens";
import { MOBILE_TOGGLE_METRICS } from "../../Widgets/Futures/mobile/mobileTradingLayout";

/** Background pulse the sidebar plays on the fields while a side button is hovered. */
export const pulseHighlight = keyframes`
  0%, 100% {
    background-color: ${tokens.perps.highlightBorder};
  }
  50% {
    background-color: ${tokens.perps.highlightBorderStrong};
  }
`;

export const highlightedPulse = css`
  animation: ${pulseHighlight} 1.5s ease-in-out infinite;
`;

/** A label over a field; the generic `input` styles live here. */
export const InputGroup = styled.div<{ $isHighlighted?: boolean }>`
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
    box-sizing: border-box;
    height: 48px;
    padding: 0 0.75rem;
    line-height: 1;
    border: 1px solid ${tokens.overlay.white20};
    border-radius: 6px;
    color: ${tokens.text.onDark};
    font-size: 1rem;
    transition: border-color 0.2s ease;
    width: 100%;
    ${(props) => props.$isHighlighted && highlightedPulse};
    ${(props) =>
      !props.$isHighlighted &&
      css`
        background: ${tokens.surface.inputIsland};
      `};

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
  }

  @media (max-width: 768px) {
    input {
      height: auto;
    }
  }
`;

/** `[−] price [+]`: the steppers and the input share one 48px row. */
export const PriceInputContainer = styled.div<{ $isHighlighted?: boolean }>`
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
  height: 48px;

  input {
    flex: 1;
    height: 100%;
    min-width: 0;
    border-radius: 0;
    border-left: none;
    border-right: none;
    border-top: 1px solid ${tokens.overlay.white20};
    border-bottom: 1px solid ${tokens.overlay.white20};
    ${(props) => props.$isHighlighted && highlightedPulse};
    ${(props) =>
      !props.$isHighlighted &&
      css`
        background: ${tokens.surface.inputIsland};
      `};

    &:focus {
      border-left: 1px solid ${tokens.accent.main};
      border-right: 1px solid ${tokens.accent.main};
    }
  }

  /* MOBILE-ONLY: drop the fixed height so compact padding from the mobile
     layout can size the row; steppers still stretch with align-items. */
  @media (max-width: 768px) {
    height: auto;
  }
`;

export const PriceButton = styled.button<{ $isHighlighted?: boolean }>`
  box-sizing: border-box;
  padding: 0 1rem;
  color: ${tokens.text.onDark};
  border: 1px solid ${tokens.overlay.white20};
  border-radius: 6px;
  font-size: 1.2rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
  min-width: 44px;
  min-height: 0;
  height: auto;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  ${(props) => props.$isHighlighted && highlightedPulse};
  ${(props) =>
    !props.$isHighlighted &&
    css`
      background: ${tokens.surface.inputIsland};
    `};

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

  &:first-of-type {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  &:last-child {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  /* MOBILE-ONLY (see MOBILE_TRADING_QUERY): drop the fixed 48px height so the
     steppers stretch to exactly the price input's height beside them. */
  @media (max-width: 768px) {
    height: auto;
    padding: 0 0.45rem;
    min-width: 28px;
    font-size: 1rem;
  }
`;

/** The amount field: a bare input with the Size/Quantity dropdown inside its frame. */
export const AmountInputWrapper = styled.div`
  display: flex;
  align-items: stretch;
  box-sizing: border-box;
  height: 48px;
  border: 1px solid ${tokens.overlay.white20};
  border-radius: 6px;
  overflow: hidden;
  background: ${tokens.surface.inputIsland};
  transition: border-color 0.2s ease, background-color 0.2s ease;

  &:focus-within {
    border-color: ${tokens.brand.blue};
    background: ${tokens.surface.inputIsland};
  }

  @media (max-width: 768px) {
    height: auto;
  }

  /* Override InputGroup's generic input styles for the inner input */
  input {
    flex: 1 !important;
    width: auto !important;
    height: 100% !important;
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

export const AmountModeDropdown = styled.select`
  appearance: none;
  padding: 0 0.75rem;
  border: none;
  border-left: 1px solid ${tokens.overlay.white15};
  border-radius: 0;
  background: transparent;
  color: ${tokens.text.onDark};
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  min-width: 56px;
  text-align: center;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394A3B8'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.4rem center;
  padding-right: 1.4rem;
  transition: background-color 0.15s ease;

  &:hover:not(:disabled) {
    background-color: ${tokens.overlay.white08};
  }

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  option {
    background: ${tokens.surface.inputIsland};
    color: ${tokens.text.onDark};
  }
`;

export const SliderContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
`;

/**
 * The row of segmented toggles above the fields: Limit/Market, time in force,
 * leverage. One line on desktop: futures show GTC/IOC/FOK as buttons, perps
 * fold them into `TifDropdown` so the row still fits beside the leverage
 * toggle; wrapping is allowed only in the mobile half-width column.
 */
export const OrderTypeRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 0.5rem;
  padding-top: 0.25rem;

  /* MOBILE-ONLY (see MOBILE_TRADING_QUERY): the Limit/Market, time-in-force and
     leverage toggles take the same metrics as the order book's view switcher
     next to them, so both columns start at the same height. */
  @media (max-width: 768px) {
    flex-wrap: wrap;
    gap: 0.3rem;

    button,
    select {
      ${MOBILE_TOGGLE_METRICS}
    }
  }
`;

/**
 * A native select drawn as a single active segment of `ModeToggle`, for the
 * time-in-force choice on perps, where the row also carries the leverage
 * toggle and three separate GTC/IOC/FOK buttons would not fit on one line.
 */
export const TifDropdown = styled.select`
  appearance: none;
  box-sizing: border-box;
  padding: 0.25rem 1.375rem 0.25rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: normal;
  white-space: nowrap;
  cursor: pointer;
  border: 1px solid ${tokens.overlay.white15};
  border-radius: 6px;
  background-color: ${tokens.surface.tabActive};
  color: #ffffff;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23ffffff'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.5rem center;
  background-size: 8px 5px;
  transition: background-color 0.15s ease;

  &:hover:not(:disabled) {
    background-color: ${tokens.surface.tabHover};
  }

  &:focus {
    outline: none;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  option {
    background: ${tokens.surface.inputIsland};
    color: ${tokens.text.onDark};
  }

  @media (max-width: 768px) {
    padding-right: 1.1rem;
    background-position: right 0.35rem center;
  }
`;

export const ModeToggle = styled.div`
  display: flex;
  border: 1px solid ${tokens.overlay.white15};
  border-radius: 6px;
  overflow: hidden;
`;

export const ModeButton = styled.button<{ $active: boolean }>`
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
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
