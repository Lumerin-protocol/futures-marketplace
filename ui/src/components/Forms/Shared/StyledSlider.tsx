import type { ComponentProps } from "react";
import { Slider, SliderMark } from "../../Slider";

export { Slider as StyledSlider };

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
