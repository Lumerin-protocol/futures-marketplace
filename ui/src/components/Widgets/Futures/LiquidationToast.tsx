import styled from "@mui/material/styles/styled";
import CloseIcon from "@mui/icons-material/Close";
import { tokens } from "../../../styles/tokens";
import type { LiquidationNotification } from "../../../hooks/data/useLiquidationNotifications";

interface LiquidationToastProps {
  notifications: LiquidationNotification[];
  onDismiss: (id: string) => void;
}

/**
 * Lightweight, fixed-position stack of liquidation alerts. Reuses the
 * `LiquidationWarning` visual language (highlight bg + warning text) from
 * FuturesBalanceWidget. Driven by `useLiquidationNotifications`.
 */
export const LiquidationToast = ({ notifications, onDismiss }: LiquidationToastProps) => {
  if (notifications.length === 0) return null;

  return (
    <ToastStack>
      {notifications.map((n) => (
        <Toast key={n.id}>
          <ToastText>
            ⚠️ Your {n.product === "perps" ? "perps" : "futures"} position was liquidated.
          </ToastText>
          <DismissButton onClick={() => onDismiss(n.id)} aria-label="Dismiss">
            <CloseIcon fontSize="small" />
          </DismissButton>
        </Toast>
      ))}
    </ToastStack>
  );
};

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

const Toast = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  background-color: ${tokens.perps.highlightBg};
  border: 1px solid ${tokens.status.error};
  border-radius: 6px;
  color: ${tokens.trading.highlight};
  font-size: 0.8rem;
  font-weight: 600;
  box-shadow: 0 6px 20px ${tokens.overlay.white10};
`;

const ToastText = styled("span")`
  flex: 1;
`;

const DismissButton = styled("button")`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  color: ${tokens.trading.highlight};
  cursor: pointer;
  opacity: 0.8;

  &:hover {
    opacity: 1;
  }
`;
