import Modal from "@mui/material/Modal";
import styled from "@mui/material/styles/styled";
import type { FC } from "react";
import { useSyncExternalStore } from "react";
import { tokens } from "../styles/tokens";
import { FormButtonsWrapper, PrimaryButton, SecondaryButton } from "./Forms/FormButtons/Buttons.styled";
import { ModalCard } from "./Modal.styled";
import { type AlertVariant, getAlertQueue, resolveCurrentAlert, subscribeAlerts } from "./AlertModal.store";

export { showAlert, showConfirm } from "./AlertModal.store";
export type { AlertOptions, AlertVariant, ConfirmOptions } from "./AlertModal.store";

// Above MUI modals (1300) and the liquidation toast (1400): alerts are raised
// from inside those modals and must stay on top of them.
const ALERT_Z_INDEX = 1500;

/**
 * Single global renderer for `showAlert` / `showConfirm`, mounted once in App.
 * There is no backdrop click, escape key or close icon: the dialog only goes
 * away when a button is pressed, matching native `alert` / `confirm`.
 */
export const AlertModalHost: FC = () => {
  const queue = useSyncExternalStore(subscribeAlerts, getAlertQueue, getAlertQueue);
  const current = queue[0];

  if (!current) {
    return null;
  }

  return (
    <Modal open disableEnforceFocus disableEscapeKeyDown sx={{ zIndex: ALERT_Z_INDEX }}>
      <AlertCard
        role="alertdialog"
        aria-labelledby="alert-modal-title"
        aria-describedby="alert-modal-message"
      >
        <AlertTitle id="alert-modal-title" $variant={current.variant}>
          {current.title}
        </AlertTitle>

        <AlertMessage id="alert-modal-message">{current.message}</AlertMessage>

        <AlertActions>
          {current.cancelText && (
            <SecondaryButton onClick={() => resolveCurrentAlert(false)}>{current.cancelText}</SecondaryButton>
          )}
          <PrimaryButton autoFocus onClick={() => resolveCurrentAlert(true)}>
            {current.confirmText}
          </PrimaryButton>
        </AlertActions>
      </AlertCard>
    </Modal>
  );
};

const TITLE_COLORS: Record<AlertVariant, string> = {
  info: tokens.text.onDark,
  warning: tokens.trading.warning,
  error: tokens.trading.short,
};

const AlertCard = styled(ModalCard)`
  max-width: 460px;
  padding: 2rem 2.5rem;
  gap: 1.25rem;
  outline: none;

  h2 {
    padding-bottom: 0;
    font-weight: 600;
  }

  @media (max-width: 600px) {
    padding: 1.5rem;
  }
`;

const AlertTitle = styled("h2")<{ $variant: AlertVariant }>`
  margin: 0;
  color: ${({ $variant }) => TITLE_COLORS[$variant]};
`;

const AlertMessage = styled("p")`
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.6;
  color: ${tokens.text.secondary};
  white-space: pre-line;
  overflow-wrap: anywhere;
`;

const AlertActions = styled(FormButtonsWrapper)`
  justify-content: flex-end;
`;
