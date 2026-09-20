import type { ComponentProps } from "react";
import Slider, { SliderMark } from "@mui/material/Slider";
import styled from "@mui/material/styles/styled";
import { tokens } from "../../../styles/tokens";

/**
 * The one slider style for order entry — the widget and every order modal.
 *
 * `$lastMarkIndex` is the index of the final mark: its label is pinned to the
 * right edge (and the first mark's to the left) so the labels stay inside the
 * bar's width instead of hanging off either end.
 */
export const StyledSlider = styled(Slider, {
  shouldForwardProp: (prop) => prop !== "$lastMarkIndex",
})<{ $lastMarkIndex?: number }>`
  color: ${tokens.text.primary};
  height: 6px;
  padding: 13px 0;

  & .MuiSlider-markLabel[data-index="0"] {
    transform: translateX(0);
  }

  ${(p) =>
    p.$lastMarkIndex !== undefined &&
    `
  & .MuiSlider-markLabel[data-index="${p.$lastMarkIndex}"] {
    transform: translateX(-100%);
  }
  `}

  /* Halo sized so thumb + halo at 0% / 100% (9px + 7px) stays within the
     card's 1rem side padding instead of reaching the page edge. */
  & .MuiSlider-thumb {
    width: 18px;
    height: 18px;
    background-color: ${tokens.neutralButton.bg};
    transition: all 0.2s ease;

    &:hover,
    &.Mui-focusVisible {
      box-shadow: 0 0 0 5px ${tokens.overlay.white16};
      background-color: ${tokens.neutralButton.hover};
    }

    &.Mui-active {
      box-shadow: 0 0 0 7px ${tokens.overlay.white16};
    }
  }

  & .MuiSlider-track {
    height: 6px;
    border: none;
    background-color: ${tokens.neutralButton.bg};
  }

  & .MuiSlider-rail {
    height: 6px;
    background-color: ${tokens.surface.inputIsland};
    opacity: 1;
  }

  & .MuiSlider-mark {
    width: 2px;
    height: 6px;
    background-color: ${tokens.overlay.white50};
    opacity: 1;
  }

  & .MuiSlider-markActive {
    background-color: ${tokens.overlay.black30};
  }

  & .MuiSlider-markLabel {
    color: ${tokens.text.secondary};
    font-size: 0.75rem;
    top: 26px;
  }

  & .MuiSlider-valueLabel {
    background-color: ${tokens.surface.inputIsland};
    color: #FFFFFF;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.75rem;
  }

  /* "auto" also pops the value on hover; only show it while the thumb is
     actually being dragged, when the amount field is not yet settled. */
  & .MuiSlider-thumb:not(.Mui-active) .MuiSlider-valueLabel {
    display: none;
  }

  /* MOBILE-ONLY (see MOBILE_TRADING_QUERY): the form only gets half the screen,
     so the thumb and its tick labels shrink to stay proportionate. */
  @media (max-width: 768px) {
    & .MuiSlider-thumb {
      width: 12px;
      height: 12px;

      &:hover,
      &.Mui-focusVisible {
        box-shadow: 0 0 0 4px ${tokens.overlay.white16};
      }

      &.Mui-active {
        box-shadow: 0 0 0 6px ${tokens.overlay.white16};
      }
    }

    & .MuiSlider-markLabel {
      font-size: 0.6rem;
    }
  }

  &.Mui-disabled {
    color: ${tokens.text.muted};

    & .MuiSlider-thumb {
      background-color: ${tokens.surface.tabMuted};
    }

    & .MuiSlider-track {
      background-color: ${tokens.surface.tabMuted};
    }

    & .MuiSlider-mark {
      background-color: ${tokens.slider.thumbMuted};
    }
  }
`;

/** Quarter marks. Only the middle label carries the unit; the rest read as plain numbers. */
export const PERCENT_MARKS: { value: number; label: string }[] = [0, 25, 50, 75, 100].map((value) => ({
  value,
  label: value === 50 ? `${value}%` : `${value}`,
}));

/**
 * Mark slot that draws nothing at `lastIndex` (passed via `slotProps.mark`),
 * since the bar's end already marks 100. The prop must not reach the DOM.
 */
export const LastMarkHidden = (props: Record<string, unknown>) => {
  const { lastIndex, ...rest } = props as { lastIndex?: number } & Record<string, unknown>;
  if (rest["data-index"] === lastIndex) return null;
  return <SliderMark {...(rest as ComponentProps<typeof SliderMark>)} />;
};

/** Everything a 0–100% slider needs beyond `value`/`onChange`. */
export const percentSliderProps = {
  min: 0,
  max: 100,
  marks: PERCENT_MARKS,
  $lastMarkIndex: PERCENT_MARKS.length - 1,
  slots: { mark: LastMarkHidden },
  slotProps: { mark: { lastIndex: PERCENT_MARKS.length - 1 } as Record<string, unknown> },
  valueLabelDisplay: "auto" as const,
  valueLabelFormat: (value: number) => `${value}%`,
};
