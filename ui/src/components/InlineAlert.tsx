import { css, styled } from "next-yak";
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { tokens } from "../styles/tokens";

type Severity = "warning" | "error" | "info";

interface InlineAlertProps {
  children: ReactNode;
  severity?: Severity;
  className?: string;
}

const ICON: Record<Severity, typeof ExclamationTriangleIcon> = {
  warning: ExclamationTriangleIcon,
  error: XCircleIcon,
  info: InformationCircleIcon,
};

/**
 * Alert, `variant="outlined"`: a severity glyph in its own column beside the
 * message, on Material's 6px/16px padding. The icon column is sized in `em`
 * off a 22px font, so the glyph lines up with the message's first line however
 * long the message runs.
 */
export const InlineAlert = ({ children, severity = "info", className }: InlineAlertProps) => {
  const Glyph = ICON[severity];
  return (
    <Banner className={className} role="alert" $severity={severity}>
      <Icon $severity={severity}>
        <Glyph aria-hidden />
      </Icon>
      <Message>{children}</Message>
    </Banner>
  );
};

const Banner = styled.div<{ $severity: Severity }>`
  display: flex;
  margin: 0 0 1em;
  padding: 6px 16px;
  border: 1px solid;
  border-radius: ${tokens.radius.sm};
  color: ${tokens.text.onDark};
  font-size: 0.875rem;
  line-height: 1.43;
  letter-spacing: 0.01071em;

  ${(p) =>
    p.$severity === "warning" &&
    css`
      background-color: ${tokens.trading.warningRowBg};
      border-color: ${tokens.trading.warning};
    `}

  ${(p) =>
    p.$severity === "error" &&
    css`
      background-color: ${tokens.trading.shortRowBg};
      border-color: ${tokens.trading.short};
    `}

  ${(p) =>
    p.$severity === "info" &&
    css`
      background-color: ${tokens.trading.infoRowBg};
      border-color: ${tokens.trading.infoBorder};
    `}
`;

const Icon = styled.div<{ $severity: Severity }>`
  display: flex;
  flex-shrink: 0;
  margin-right: 12px;
  padding: 7px 0;
  font-size: 22px;
  opacity: 0.9;

  svg {
    width: 1em;
    height: 1em;
  }

  ${(p) =>
    p.$severity === "warning" &&
    css`
      color: ${tokens.trading.warning};
    `}

  ${(p) =>
    p.$severity === "error" &&
    css`
      color: ${tokens.trading.short};
    `}

  ${(p) =>
    p.$severity === "info" &&
    css`
      color: ${tokens.trading.info};
    `}
`;

const Message = styled.div`
  min-width: 0;
  padding: 8px 0;
  overflow: auto;
`;
