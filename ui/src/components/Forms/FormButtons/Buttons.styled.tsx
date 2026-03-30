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
  border-radius: 8px;
  padding: 0.5rem 1rem;
  outline: none;
  display: flex;
  flex-direction: row;
  flex-wrap: no-wrap;
  justify-content: center;
  align-items: center;
  font-weight: 500;
  &:not(:last-child) {
    margin-right: 1rem;
  }
`;

export const DisabledButton = styled(Button)`
  color: ${tokens.text.onLight};
  background: grey;
  box-shadow: none;
  cursor: not-allowed;
`;

export const SecondaryButton = styled(Button)`
  color: ${tokens.text.onDark};
  background: none;
  border: 2px solid ${tokens.text.onDark};
`;

export const CancelButton = styled(Button)`
  color: ${tokens.trading.short};
  border: 2px solid ${tokens.trading.short};
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
  color: ${tokens.text.onDark};
  background-color: ${tokens.surface.tabActive};
  position: relative;
  cursor: pointer;

  &:disabled {
    background-color: ${tokens.formButtons.secondaryBg};
    color: ${tokens.formButtons.secondaryText};
    cursor: not-allowed;
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
    color: ${tokens.text.buttonDisabled};
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
