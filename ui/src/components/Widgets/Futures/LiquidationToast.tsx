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
        <Toast
          key={n.id}
          type="button"
          onClick={() => onDismiss(n.id)}
          aria-label="Dismiss liquidation alert"
        >
          <ToastText>
            ⚠️ Your {n.product === "perps" ? "perps" : "futures"} position was liquidated.
          </ToastText>
          <DismissIcon>
            <CloseIcon fontSize="small" />
          </DismissIcon>
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

const Toast = styled("button")`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  background-color: ${tokens.surface.panel};
  border: 1px solid ${tokens.trading.highlight};
  border-radius: 6px;
  color: ${tokens.trading.highlight};
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
  color: ${tokens.trading.highlight};
  opacity: 0.8;

  ${Toast}:hover & {
    opacity: 1;
  }
`;
