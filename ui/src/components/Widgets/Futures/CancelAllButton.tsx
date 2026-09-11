import styled from "@emotion/styled";
import { tokens } from "../../../styles/tokens";

/**
 * Header action for pulling every open order at once. Same treatment as the
 * per-row Modify / Cancel buttons so the table reads as one set of controls.
 */
export const CancelAllButton = styled("button")`
  flex: none;
  padding: 0.5rem 0.875rem;
  background: ${tokens.neutralButton.bg};
  color: ${tokens.text.onDark};
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    transform 0.1s ease;

  &:hover:not(:disabled) {
    background: ${tokens.neutralButton.hover};
    transform: translateY(-1px);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    background: ${tokens.text.muted};
    cursor: not-allowed;
    opacity: 0.6;
  }
`;
