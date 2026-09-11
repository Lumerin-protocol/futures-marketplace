import { styled } from "next-yak";
import type { ReactNode } from "react";
import { tokens } from "../styles/tokens";

interface InlineAlertProps {
  children: ReactNode;
  severity?: "warning" | "error" | "info";
  className?: string;
}

export const InlineAlert = ({ children, severity = "info", className }: InlineAlertProps) => (
  <Banner className={className} $severity={severity}>
    {children}
  </Banner>
);

const Banner = styled.div<{ $severity: NonNullable<InlineAlertProps["severity"]> }>`
  margin: 0 0 1em;
  padding: 0.75rem 1rem;
  border-radius: ${tokens.radius.sm};
  font-size: 0.875rem;
  line-height: 1.4;
  background: ${(p) =>
    p.$severity === "warning"
      ? tokens.trading.infoRowBg
      : p.$severity === "error"
        ? tokens.trading.shortRowBg
        : tokens.trading.infoRowBg};
  border: 1px solid
    ${(p) =>
      p.$severity === "warning"
        ? tokens.trading.warning
        : p.$severity === "error"
          ? tokens.trading.short
          : tokens.trading.infoBorder};
  color: ${tokens.text.onDark};
`;
