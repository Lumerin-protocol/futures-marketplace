import styled from "@mui/material/styles/styled";
import CloseIcon from "@mui/icons-material/Close";
import { tokens } from "../../../styles/tokens";

export type RiskToastVariant = "warning" | "danger";

export interface RiskToastItem {
  /**
   * Namespaced by producer (`liq:` / `margin:`) so one dismiss handler can route
   * back to whichever hook owns the item.
   */
  id: string;
  message: string;
  variant: RiskToastVariant;
}

interface RiskToastProps {
  items: RiskToastItem[];
  onDismiss: (id: string) => void;
}

/**
 * Lightweight, fixed-position stack of account-risk alerts: forced liquidations
 * that already happened, and margin tiers the account has just crossed into.
 *
 * One surface for both, because they compete for the same corner of the screen
 * and an account in danger is usually about to produce the other kind.
 */
export const RiskToast = ({ items, onDismiss }: RiskToastProps) => {
  if (items.length === 0) return null;

  return (
    <ToastStack>
      {items.map((item) => (
        <Toast
          key={item.id}
          type="button"
          $variant={item.variant}
          onClick={() => onDismiss(item.id)}
          aria-label="Dismiss alert"
        >
          <ToastText>⚠️ {item.message}</ToastText>
          <DismissIcon>
            <CloseIcon fontSize="small" />
          </DismissIcon>
        </Toast>
      ))}
    </ToastStack>
  );
};

const accent = (variant: RiskToastVariant) =>
  variant === "danger" ? tokens.trading.short : tokens.trading.highlight;

const ToastStack = styled("div")`
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 1400;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: min(360px, calc(100vw - 2rem));
`;

const Toast = styled("button")<{ $variant: RiskToastVariant }>`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  background-color: ${tokens.surface.panel};
  border: 1px solid ${(props) => accent(props.$variant)};
  border-radius: 6px;
  color: ${(props) => accent(props.$variant)};
  font-size: 0.8rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  box-shadow: ${tokens.shadow.level3};

  &:hover {
    background-color: ${tokens.surface.inputIslandHover};
  }
`;

const ToastText = styled("span")`
  flex: 1;
`;

const DismissIcon = styled("span")`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.8;

  ${Toast}:hover & {
    opacity: 1;
  }
`;
