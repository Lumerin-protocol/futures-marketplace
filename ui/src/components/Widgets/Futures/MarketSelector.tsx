import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import styled from "@mui/material/styles/styled";
import HpdxLogomark from "../../../images/icons/hpdx-logomark.svg?react";
import { tokens } from "../../../styles/tokens";
import {
  type Instrument,
  PERPETUAL_INSTRUMENT,
  formatInstrumentLabel,
  formatTimeToExpiry,
  instrumentKey,
  instrumentKindLabel,
  parseInstrumentKey,
} from "../../../lib/instruments";
import type { ContractMode } from "../../../types/types";

interface MarketSelectorProps {
  contractMode: ContractMode;
  /// Expiration backing the futures instrument, unix seconds. Undefined in perps
  /// mode, and briefly in futures mode while the expiration list is still loading.
  selectedExpirationAt?: number;
  /// Tradable futures expirations, unix seconds ascending. One row each.
  expirations: readonly number[];
  onChange: (instrument: Instrument) => void;
}

/**
 * Picks the market being traded: the perp, or one of the futures expirations.
 *
 * Every expiration gets its own row because that is what it is on-chain — a
 * separate order book, position and settlement price (see `lib/instruments.ts`).
 * This replaced a Futures/Perpetuals toggle here plus a date carousel buried in
 * the order book header, which between them never said what was being traded.
 */
export const MarketSelector = ({
  contractMode,
  selectedExpirationAt,
  expirations,
  onChange,
}: MarketSelectorProps) => {
  const options: Instrument[] = [
    PERPETUAL_INSTRUMENT,
    ...expirations.map((expirationAt) => ({ mode: "futures" as const, expirationAt })),
  ];

  const selected: Instrument | undefined =
    contractMode === "perpetual"
      ? PERPETUAL_INSTRUMENT
      : selectedExpirationAt !== undefined
        ? { mode: "futures", expirationAt: selectedExpirationAt }
        : undefined;

  // An expiration can roll off the list between the page resolving it and this
  // render. Falling back to the empty value keeps MUI from warning about a value
  // with no matching row; the parent re-resolves to the front of the list.
  const selectedKey = selected ? instrumentKey(selected) : "";
  const value = options.some((option) => instrumentKey(option) === selectedKey) ? selectedKey : "";

  const describe = (instrument: Instrument) =>
    instrument.mode === "perpetual"
      ? instrumentKindLabel(instrument)
      : `${instrumentKindLabel(instrument)} · ${formatTimeToExpiry(instrument.expirationAt)}`;

  return (
    <MarketSelect
      value={value}
      displayEmpty
      onChange={(e) => onChange(parseInstrumentKey(e.target.value))}
      renderValue={() => (
        <>
          {/* Decorative: the label spells the pair out, so the mark is not read. */}
          <TriggerLogo aria-hidden />
          <TriggerValue>
            <TriggerLabel>
              {selected ? formatInstrumentLabel(selected) : "Loading markets…"}
            </TriggerLabel>
            <TriggerMeta>{selected ? describe(selected) : "Futures"}</TriggerMeta>
          </TriggerValue>
        </>
      )}
      MenuProps={{
        PaperProps: {
          sx: {
            bgcolor: tokens.surface.card,
            color: tokens.text.onDark,
            border: `1px solid ${tokens.border.default}`,
            borderRadius: tokens.radius.md,
            maxHeight: 360,
            marginTop: "0.25rem",
          },
        },
      }}
    >
      {options.map((option) => {
        const key = instrumentKey(option);
        return (
          <MenuItem value={key} key={key} sx={{ fontSize: "0.875rem" }}>
            <OptionRow>
              <span>{formatInstrumentLabel(option)}</span>
              <OptionMeta>
                {option.mode === "perpetual"
                  ? instrumentKindLabel(option)
                  : formatTimeToExpiry(option.expirationAt)}
              </OptionMeta>
            </OptionRow>
          </MenuItem>
        );
      })}
    </MarketSelect>
  );
};

/* Wears the place-order inputs' skin — inputIsland fill over a white20 border,
   lifting to inputIslandHover — so the two controls a trader actually operates
   look like one family. The theme's MuiOutlinedInput override supplies a darker
   slate border and a blue focus ring; both are replaced here. The ring in
   particular does not translate: a text input is only focused while you type,
   whereas a select holds focus the whole time its menu is open and after a pick,
   so the accent would sit in the header until the user clicked elsewhere. */
const MarketSelect = styled(Select<string>)`
  /* Also floors the menu, which MUI sizes off the anchor — so the rows do not
     reflow narrower than the trigger they dropped out of. */
  min-width: 350px;
  flex-shrink: 0;
  background-color: ${tokens.surface.inputIsland};
  transition: background-color 0.2s ease;

  &:hover {
    background-color: ${tokens.surface.inputIslandHover};
  }

  & .MuiOutlinedInput-notchedOutline,
  &:hover .MuiOutlinedInput-notchedOutline,
  &.Mui-focused .MuiOutlinedInput-notchedOutline {
    border-color: ${tokens.overlay.white20};
    border-width: 1px;
  }

  /* The row itself: logomark beside the two stacked lines, all centred on each
     other. renderValue returns both as siblings so this is their only container. */
  & .MuiSelect-select {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.85rem;
    color: ${tokens.text.onDark};
  }

  /* Full contrast rather than muted — the chevron is what says "this opens". */
  & .MuiSvgIcon-root {
    color: ${tokens.text.onDark};
  }

  /* MOBILE-ONLY (see FuturesMobileLayout): shares its row with the chart toggle,
     so the desktop floor is dropped and the padding tightens rather than pushing
     that toggle off the edge — 350px alone would overflow a phone. */
  @media (max-width: 768px) {
    min-width: 0;

    & .MuiSelect-select {
      padding: 0.3rem 0.5rem;
    }
  }
`;

/* Sized to the two text lines beside it rather than to the header's brand mark,
   which is twice this and would turn the selector into a second logo. */
const TriggerLogo = styled(HpdxLogomark)`
  display: block;
  flex-shrink: 0;
  height: 30px;
  width: 30px;

  @media (max-width: 768px) {
    height: 24px;
    width: 24px;
  }
`;

/* The two lines sit tight against each other so they read as one label rather
   than as two stacked stats. */
const TriggerValue = styled("span")`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

/* A step above the 1rem/600 the header stats use, so the instrument reads as the
   page's subject and the stats as facts about it. */
const TriggerLabel = styled("span")`
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.01em;
  white-space: nowrap;

  @media (max-width: 768px) {
    font-size: 0.9375rem;
  }
`;

const TriggerMeta = styled("span")`
  font-size: 0.6rem;
  font-weight: 500;
  line-height: 1.1;
  color: ${tokens.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
`;

const OptionRow = styled("span")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 1.5rem;
`;

const OptionMeta = styled("span")`
  font-size: 0.75rem;
  color: ${tokens.text.secondary};
  flex-shrink: 0;
`;
