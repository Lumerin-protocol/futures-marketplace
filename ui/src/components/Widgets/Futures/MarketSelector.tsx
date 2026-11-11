import { MenuItem, Select } from "../../Select";
import { styled } from "next-yak";
import HpdxLogomark from "../../../images/icons/hpdx-logomark.svg?react";
import { tokens } from "../../../styles/tokens";
import {
  type Instrument,
  PAIR_SYMBOL,
  PERPETUAL_INSTRUMENT,
  formatExpirationShort,
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
              {selected ? (
                <>
                  <TriggerPair>{PAIR_SYMBOL} —</TriggerPair>
                  <TriggerSuffix>
                    {selected.mode === "perpetual" ? "Perp" : formatExpirationShort(selected.expirationAt)}
                  </TriggerSuffix>
                </>
              ) : (
                "Loading markets…"
              )}
            </TriggerLabel>
            <TriggerMeta>{selected ? describe(selected) : "Futures"}</TriggerMeta>
          </TriggerValue>
        </>
      )}
    >
      {options.map((option) => {
        const key = instrumentKey(option);
        return (
          <MenuItem value={key} key={key}>
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
   look like one family. No focus ring: a text input is only focused while you
   type, whereas a select holds focus the whole time its menu is open and after
   a pick, so an accent ring would sit in the header until the user clicked
   elsewhere. */
const MarketSelect = styled(Select)`
  /* One width for Perp and every expiry, sized to the pair plus the longest
     date at the smaller suffix size. Also floors the menu off the trigger so
     its rows do not reflow narrower than the trigger they dropped out of. */
  width: 23.75rem;
  min-width: 23.75rem;
  max-width: 23.75rem;
  flex-shrink: 0;

  .select-trigger {
    gap: 0.55rem;
    padding: 0.4rem 0.85rem;
  }

  /* MOBILE-ONLY (see FuturesMobileLayout): shares its row with the chart toggle,
     so the desktop width is dropped and the padding tightens rather than pushing
     that toggle off the edge — the fixed desktop width would overflow a phone. */
  @media (max-width: 768px) {
    /* min-width alone is not enough while desktop flex-shrink remains disabled.
       Give the selector the flexible part of the row and let its label ellipsize
       before it can displace the fixed chart button. */
    flex: 1 1 0;
    width: 0;
    min-width: 0;
    max-width: 100%;

    .select-trigger {
      padding: 0.3rem 0.5rem;
    }
  }
`;

/* Sized to the two text lines beside it rather than to the header's brand mark,
   which is twice this and would turn the selector into a second logo. */
const TriggerLogo = styled(HpdxLogomark)`
  display: block;
  flex-shrink: 0;
  margin-right: 10px;
  height: 30px;
  width: 30px;

  @media (max-width: 768px) {
    height: 24px;
    width: 24px;
  }
`;

/* The two lines sit tight against each other so they read as one label rather
   than as two stacked stats. */
const TriggerValue = styled.span`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
`;

/* A step above the 1rem/600 the header stats use, so the instrument reads as the
   page's subject and the stats as facts about it. */
const TriggerLabel = styled.span`
  display: flex;
  align-items: baseline;
  gap: 0.35em;
  min-width: 0;
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.01em;
  white-space: nowrap;

  @media (max-width: 768px) {
    font-size: 0.9375rem;
  }
`;

const TriggerPair = styled.span`
  flex-shrink: 0;
`;

/* The expiry is the only part of the label that changes length. A step under
   the pair, so a long date fits the fixed trigger instead of widening it. */
const TriggerSuffix = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.75em;
  font-weight: 600;
  letter-spacing: 0;
`;

const TriggerMeta = styled.span`
  font-size: 0.6rem;
  font-weight: 500;
  line-height: 1.1;
  color: ${tokens.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
`;

const OptionRow = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 1.5rem;
`;

const OptionMeta = styled.span`
  font-size: 0.75rem;
  color: ${tokens.text.secondary};
  flex-shrink: 0;
`;
