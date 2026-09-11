import type { ReactNode } from "react";
import styled from "@emotion/styled";
import { Tooltip } from "../../Tooltip";
import { HelpOutlineIcon } from "../../icons";
import { tokens } from "../../../styles/tokens";

/**
 * Building blocks of the order modals' review and result screens: a headline
 * card that states the order in one glance, then titled sections of
 * label/value rows. Place, close and bulk actions share these so every
 * confirmation reads the same way.
 */

/** Colour a figure by how much risk it carries: none, worth a look, or acting on. */
export type Tone = "neutral" | "caution" | "danger";

export const HelpTip = ({ title }: { title: string }) => (
  <Tooltip title={title} arrow placement="top">
    <HelpOutlineIcon style={{ width: 14, height: 14, cursor: "help", color: tokens.text.muted }} />
  </Tooltip>
);

/** One line of the cost card: label on the left, USDC on the right, optional hint under it. */
export const CostRow = ({
  label,
  tooltip,
  value,
  hint,
  emphasis = false,
  muted = false,
}: {
  label: string;
  tooltip?: string;
  value: ReactNode;
  hint?: ReactNode;
  emphasis?: boolean;
  muted?: boolean;
}) => (
  <CostRowRoot>
    <CostRowMain>
      <CostLabel $emphasis={emphasis} $muted={muted}>
        {label}
        {tooltip && <HelpTip title={tooltip} />}
      </CostLabel>
      <CostValue $emphasis={emphasis} $muted={muted}>
        {value}
      </CostValue>
    </CostRowMain>
    {hint && <CostHint>{hint}</CostHint>}
  </CostRowRoot>
);

/** `before → after`, with the after value carrying the emphasis and the risk colour. */
export const Delta = ({
  before,
  after,
  tone = "neutral",
}: {
  before: string;
  after: string;
  tone?: Tone;
}) => (
  <>
    <Muted>{before}</Muted>
    <Arrow>→</Arrow>
    <Balance $tone={tone}>{after}</Balance>
  </>
);

export const Review = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

export const Headline = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 1rem;
  background: ${tokens.surface.inputIsland};
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.md};
`;

export const HeadlineTop = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
`;

/** Bid/long in green, ask/short in red. */
export const SideBadge = styled("span")<{ $isBuy: boolean }>`
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: ${tokens.radius.sm};
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: ${(p) => (p.$isBuy ? tokens.trading.longHighlightBg : tokens.trading.shortHighlightBg)};
  color: ${(p) => (p.$isBuy ? tokens.trading.long : tokens.trading.short)};
`;

/* Two roles only inside the card: values are 600 in the bright text colour,
   labels and meta are 400 in the secondary one, and everything that is not
   the title shares one size. */
export const HeadlineMeta = styled("span")`
  font-size: 0.8125rem;
  color: ${tokens.text.secondary};
`;

export const HeadlineDelivery = styled("span")`
  margin-left: auto;
  font-size: 0.8125rem;
  color: ${tokens.text.secondary};
  white-space: nowrap;
`;

export const HeadlineTitle = styled("div")`
  font-size: 1.25rem;
  font-weight: 600;
  color: ${tokens.text.onDark};
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
`;

export const HeadlineAt = styled("span")`
  font-weight: 400;
  color: ${tokens.text.secondary};
`;

export const HeadlineDetail = styled("div")`
  font-size: 0.8125rem;
  color: ${tokens.text.secondary};
`;

/** Sits directly under the title as its sub-line: one stat on the left, one on the right. */
export const HeadlineStats = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
`;

export const HeadlineStat = styled("div")`
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;

  span {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: ${tokens.text.secondary};
  }

  strong {
    color: ${tokens.text.onDark};
    font-weight: 600;
  }
`;

export const Section = styled("section")`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

export const SectionTitle = styled("h3")`
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  /* Caps at 12px read a clear step above the 0.8rem lowercase labels below. */
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${tokens.text.secondary};
`;

export const CostCard = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.md};
`;

const CostRowRoot = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
`;

const CostRowMain = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
`;

const CostLabel = styled("span")<{ $emphasis: boolean; $muted: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: ${(p) => (p.$emphasis ? "0.9375rem" : p.$muted ? "0.8125rem" : "0.875rem")};
  font-weight: ${(p) => (p.$emphasis ? 600 : 400)};
  color: ${(p) => (p.$emphasis ? tokens.text.onDark : p.$muted ? tokens.text.muted : tokens.text.secondary)};
`;

const CostValue = styled("span")<{ $emphasis: boolean; $muted: boolean }>`
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: ${(p) => (p.$emphasis ? "1.125rem" : p.$muted ? "0.8125rem" : "0.9375rem")};
  font-weight: ${(p) => (p.$emphasis ? 700 : 500)};
  color: ${(p) => (p.$muted ? tokens.text.secondary : tokens.text.onDark)};
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

/** Full-white for the one figure that is a reward rather than a cost. */
export const Bright = styled("span")`
  color: #fff;
  font-weight: 600;
`;

export const Muted = styled("span")`
  color: ${tokens.text.muted};
  font-weight: 400;
`;

const Arrow = styled("span")`
  color: ${tokens.text.muted};
  font-weight: 400;
`;

const Balance = styled("span")<{ $tone: Tone }>`
  color: ${(p) =>
    p.$tone === "danger"
      ? tokens.trading.short
      : p.$tone === "caution"
        ? tokens.trading.highlight
        : tokens.text.onDark};
`;

/** Signed PnL: gains in the long colour, losses in the short colour. Doubled
 *  selector so it wins over `HeadlineStat strong`. */
export const PnlValue = styled("strong")<{ $positive: boolean }>`
  && {
    color: ${(p) => (p.$positive ? tokens.trading.long : tokens.trading.short)};
  }
`;

export const CostHint = styled("div")`
  font-size: 0.75rem;
  line-height: 1.4;
  color: ${tokens.text.muted};
  font-variant-numeric: tabular-nums;
`;

/** A short explanation in a quiet box; `strong` picks out the one thing to remember. */
export const Note = styled("p")`
  margin: 0;
  padding: 0.75rem 1rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: ${tokens.text.secondary};
  background: ${tokens.trading.infoRowBg};
  border: 1px solid ${tokens.trading.infoBorder};
  border-radius: ${tokens.radius.md};

  strong {
    color: ${tokens.text.onDark};
    font-weight: 600;
  }
`;

/** A rule with its label sitting on the line: `IF FILLED ────────`. */
export const GroupDivider = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin: 0.125rem 0;

  span {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: ${tokens.text.muted};
    white-space: nowrap;
  }

  &::after {
    content: "";
    flex: 1;
    border-top: 1px solid ${tokens.border.default};
  }
`;

export const CostDivider = styled("hr")`
  margin: 0.125rem 0;
  border: none;
  border-top: 1px solid ${tokens.border.default};
`;
