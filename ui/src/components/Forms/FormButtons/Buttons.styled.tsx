import styled from "@mui/material/styles/styled";
import Tooltip from "@mui/material/Tooltip";
import { tokens } from "../../../styles/tokens";
import type { ComponentProps } from "react";

export const FormButtonsWrapper = styled("div")`
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
`;

export const Button = styled("button")`
  border-radius: ${tokens.radius.sm};
  padding: 0.5rem 1rem;
  outline: none;
  display: flex;
  flex-direction: row;
  flex-wrap: no-wrap;
  justify-content: center;
  align-items: center;
  font-weight: 500;
  font-family: "Inter", sans-serif;
  transition: background-color 150ms ease, border-color 150ms ease;
  &:not(:last-child) {
    margin-right: 1rem;
  }
`;

export const DisabledButton = styled(Button)`
  color: ${tokens.text.disabled};
  background: ${tokens.formButtons.secondaryBg};
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.5;
`;

export const SecondaryButton = styled(Button)`
  color: ${tokens.text.onDark};
  background: none;
  border: 1px solid ${tokens.border.default};
  cursor: pointer;
  &:hover {
    background: ${tokens.overlay.white08};
    border-color: ${tokens.text.secondary};
  }
`;

export const CancelButton = styled(Button)`
  color: ${tokens.trading.short};
  background: none;
  border: 2px solid ${tokens.trading.short};
  cursor: pointer;
  &:hover {
    background: rgba(239, 68, 68, 0.1);
  }
`;

export const DangerButton = styled(Button)`
  color: #FFFFFF;
  background: ${tokens.trading.short};
  border: none;
  cursor: pointer;
  &:hover {
    background: ${tokens.trading.shortHover};
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const GhostButton = styled(Button)`
  color: ${tokens.brand.dark};
  background: ${tokens.neutral[100]};
  border: none;
  cursor: pointer;
  &:hover {
    background: ${tokens.neutral[200]};
  }
`;

type PrimaryButtonProps = ComponentProps<typeof PrimaryButtonComponent> & {
  disabledText?: string;
  tooltipText?: string;
};

export const PrimaryButton = ({ disabledText, disabled, tooltipText, ...props }: PrimaryButtonProps) => {
  const button = <PrimaryButtonComponent disabled={disabled} {...props} />;

  if (disabled && disabledText) {
    return <Tooltip title={disabledText}>{button}</Tooltip>;
  }

  if (tooltipText) {
    return <Tooltip title={tooltipText}>{button}</Tooltip>;
  }

  return button;
};

const PrimaryButtonComponent = styled(Button, {
  shouldForwardProp: (prop) => typeof prop === "string" && !prop.startsWith("$"),
})<{ $hoverText?: string }>`
  color: #FFFFFF;
  background-color: ${tokens.brand.green};
  position: relative;
  cursor: pointer;

  &:hover {
    background-color: ${tokens.brand.greenDark};
  }

  &:disabled {
    background-color: ${tokens.formButtons.secondaryBg};
    color: ${tokens.formButtons.secondaryText};
    cursor: not-allowed;
    opacity: 0.5;
  }

  ${({ $hoverText }) =>
    $hoverText &&
    `
      &:hover:after {
        content: "${$hoverText}";
      }
    `}

  &:after {
    position: absolute;
    bottom: calc(100% + 0.5em);
    width: max-content;
    padding: 0.5em;
    border-radius: 0.5em;
    background-color: ${tokens.modal.backdrop};
    color: ${tokens.text.disabled};
    font-size: 0.8rem;
    visibility: hidden;
    transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
    opacity: 0;
  }
  &:hover:after {
    visibility: visible;
    opacity: 1;
  }
`;
