import { css, styled } from "next-yak";
import {
  type CSSProperties,
  type ChangeEvent,
  type ComponentType,
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { tokens } from "../styles/tokens";

export type SliderMarkValue = { value: number; label?: string };

export type SliderMarkSlotProps = {
  "data-index": number;
  style: CSSProperties;
} & Record<string, unknown>;

export type SliderChangeHandler = (event: Event, value: number | number[]) => void;

interface SliderProps {
  value: number;
  onChange?: SliderChangeHandler;
  onChangeCommitted?: SliderChangeHandler;
  min?: number;
  max?: number;
  step?: number;
  marks?: SliderMarkValue[] | boolean;
  disabled?: boolean;
  valueLabelDisplay?: "auto" | "on" | "off";
  valueLabelFormat?: (value: number) => string;
  $lastMarkIndex?: number;
  slots?: { mark?: ComponentType<SliderMarkSlotProps> };
  slotProps?: { mark?: Record<string, unknown> };
  className?: string;
}

/** Room MUI leaves below a marked slider for its tick labels. */
const MARK_GUTTER = "20px";
const MARK_GUTTER_MOBILE = "18px";

/**
 * MUI's hidden range input: it carries the slider's focus, keyboard handling
 * and accessible value, stretched over the thumb so a screen reader's focus
 * ring lands on the thumb rather than on a 1px box.
 */
const HIDDEN_INPUT_STYLE: CSSProperties = {
  border: 0,
  clip: "rect(0 0 0 0)",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "100%",
  height: "100%",
};

export const SliderMark = ({ style, ...rest }: SliderMarkSlotProps) => {
  const { lastIndex: _lastIndex, cap: _cap, markActive, ...dom } = rest;
  return <DefaultMark style={style} $active={Boolean(markActive)} {...dom} />;
};

const snap = (raw: number, min: number, max: number, step: number) => {
  const stepped = Math.round((raw - min) / step) * step + min;
  const rounded = Number(stepped.toFixed(6));
  return Math.min(max, Math.max(min, rounded));
};

export const Slider = ({
  value,
  onChange,
  onChangeCommitted,
  min = 0,
  max = 100,
  step = 1,
  marks,
  disabled = false,
  valueLabelDisplay = "off",
  valueLabelFormat = String,
  $lastMarkIndex,
  slots,
  slotProps,
  className,
}: SliderProps) => {
  const trackRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const span = max - min || 1;
  const pct = ((value - min) / span) * 100;

  const markList: SliderMarkValue[] = Array.isArray(marks)
    ? marks
    : marks === true
      ? Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => ({ value: min + i * step }))
      : [];

  const valueAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return value;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return snap(min + ratio * span, min, max, step);
  };

  const start = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    // The hidden range input covers the thumb, so without this a press on the
    // knob would start the browser's own drag on top of ours. MUI does the same
    // and hands focus to the input by hand afterwards.
    event.preventDefault();
    inputRef.current?.focus();
    dragging.current = true;
    setActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange?.(event.nativeEvent, valueAt(event.clientX));
  };

  const move = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!dragging.current || disabled) return;
    onChange?.(event.nativeEvent, valueAt(event.clientX));
  };

  const end = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    onChangeCommitted?.(event.nativeEvent, valueAt(event.clientX));
  };

  // The native range input already handles arrows, Home/End and Page Up/Down,
  // so keyboard support is whatever the platform does with it.
  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const next = snap(event.target.valueAsNumber, min, max, step);
    onChange?.(event.nativeEvent, next);
    onChangeCommitted?.(event.nativeEvent, next);
  };

  const onInputFocus = (event: FocusEvent<HTMLInputElement>) => {
    // Only a keyboard focus should raise the halo, the same distinction MUI
    // draws with `.Mui-focusVisible`.
    try {
      if (event.target.matches(":focus-visible")) setFocused(true);
    } catch {
      setFocused(true);
    }
  };

  const MarkSlot = slots?.mark ?? SliderMark;
  const showLabel = valueLabelDisplay === "on" || (valueLabelDisplay === "auto" && active);

  return (
    <Root
      className={className}
      ref={trackRef}
      data-disabled={disabled ? "true" : undefined}
      $disabled={disabled}
      $marked={markList.length > 0}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <Rail />
      <Track style={{ width: `${pct}%` }} $dragging={active} $disabled={disabled} />
      {markList.map((mark, index) => {
        const left = `${((mark.value - min) / span) * 100}%`;
        return (
          <MarkSlot
            key={`${mark.value}-${index}`}
            data-index={index}
            markActive={mark.value <= value}
            style={{ left }}
            {...slotProps?.mark}
          />
        );
      })}
      {markList.map((mark, index) =>
        mark.label == null ? null : (
          <MarkLabel
            key={`label-${mark.value}-${index}`}
            data-index={index}
            $align={index === 0 ? "start" : index === $lastMarkIndex ? "end" : "center"}
            style={{ left: `${((mark.value - min) / span) * 100}%` }}
          >
            {mark.label}
          </MarkLabel>
        ),
      )}
      <Thumb style={{ left: `${pct}%` }} $active={active} $focused={focused} $disabled={disabled}>
        <input
          ref={inputRef}
          type="range"
          style={HIDDEN_INPUT_STYLE}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-valuenow={value}
          aria-orientation="horizontal"
          onChange={onInputChange}
          onFocus={onInputFocus}
          onBlur={() => setFocused(false)}
        />
        {valueLabelDisplay !== "off" && (
          <ValueLabel aria-hidden $open={showLabel}>
            {valueLabelFormat(value)}
          </ValueLabel>
        )}
      </Thumb>
    </Root>
  );
};

/**
 * `box-sizing: content-box` plus vertical padding is what gives a 6px bar a
 * 32px pointer target without the bar itself growing — the app's own override
 * of MUI's 4px default height, on MUI's 13px padding.
 */
const Root = styled.span<{ $disabled: boolean; $marked: boolean }>`
  position: relative;
  display: inline-block;
  box-sizing: content-box;
  width: 100%;
  height: 6px;
  padding: 13px 0;
  border-radius: 12px;
  touch-action: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  color: ${tokens.text.primary};
  cursor: ${(p) => (p.$disabled ? "default" : "pointer")};

  @media print {
    color-adjust: exact;
  }

  ${(p) =>
    p.$marked &&
    css`
      margin-bottom: ${MARK_GUTTER};

      @media (max-width: 768px) {
        margin-bottom: ${MARK_GUTTER_MOBILE};
      }
    `}

  ${(p) =>
    p.$disabled &&
    css`
      pointer-events: none;
      color: ${tokens.text.muted};
    `}
`;

const Rail = styled.span`
  display: block;
  position: absolute;
  top: 50%;
  width: 100%;
  height: inherit;
  border-radius: inherit;
  transform: translateY(-50%);
  background-color: ${tokens.surface.inputIsland};
  opacity: 1;
`;

const Track = styled.span<{ $dragging: boolean; $disabled: boolean }>`
  display: block;
  position: absolute;
  top: 50%;
  left: 0;
  height: inherit;
  border: none;
  border-radius: inherit;
  transform: translateY(-50%);
  background-color: ${tokens.neutralButton.bg};
  pointer-events: none;
  /* Dropped while dragging so the fill tracks the pointer exactly. */
  transition: ${(p) =>
    p.$dragging
      ? "none"
      : `left 150ms ${tokens.motion.easeInOut}, width 150ms ${tokens.motion.easeInOut}`};

  ${(p) =>
    p.$disabled &&
    css`
      background-color: ${tokens.surface.tabMuted};
    `}
`;

const DefaultMark = styled.span<{ $active: boolean }>`
  position: absolute;
  top: 50%;
  width: 2px;
  height: 6px;
  border-radius: 1px;
  transform: translate(-1px, -50%);
  background-color: ${(p) => (p.$active ? tokens.overlay.black30 : tokens.overlay.white50)};
  opacity: 1;
  pointer-events: none;

  /* The mark slot can be swapped out by callers, so the disabled colour comes
     down from the root rather than through a prop the slot might drop. */
  [data-disabled="true"] & {
    background-color: ${tokens.slider.thumbMuted};
  }
`;

const MarkLabel = styled.span<{ $align: "start" | "center" | "end" }>`
  position: absolute;
  top: 26px;
  color: ${tokens.text.secondary};
  font-size: 0.75rem;
  white-space: nowrap;
  transform: ${(p) =>
    p.$align === "start"
      ? "translateX(0)"
      : p.$align === "end"
        ? "translateX(-100%)"
        : "translateX(-50%)"};
  pointer-events: none;

  @media (max-width: 768px) {
    font-size: 0.6rem;
  }
`;

/**
 * `::before` is the elevation under the knob, `::after` the 42px hit target
 * Material asks for around it. Halo sized (9px + 7px) so the thumb at 0% or
 * 100% still clears the card's 1rem side padding.
 */
const Thumb = styled.span<{ $active: boolean; $focused: boolean; $disabled: boolean }>`
  position: absolute;
  top: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  outline: 0;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background-color: ${tokens.neutralButton.bg};
  transition: box-shadow 150ms ${tokens.motion.easeInOut}, left 150ms ${tokens.motion.easeInOut},
    background-color 150ms ${tokens.motion.easeInOut};

  &::before {
    content: "";
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    box-shadow: ${tokens.shadow.elevation2};
  }

  &::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }

  &:hover {
    background-color: ${tokens.neutralButton.hover};
    box-shadow: 0 0 0 5px ${tokens.overlay.white16};

    @media (hover: none) {
      box-shadow: none;
    }

    @media (max-width: 768px) {
      box-shadow: 0 0 0 4px ${tokens.overlay.white16};
    }
  }

  ${(p) =>
    p.$focused &&
    css`
      background-color: ${tokens.neutralButton.hover};
      box-shadow: 0 0 0 5px ${tokens.overlay.white16};

      @media (max-width: 768px) {
        box-shadow: 0 0 0 4px ${tokens.overlay.white16};
      }
    `}

  /* Dragging drops the thumb's transitions so it tracks the pointer exactly. */
  ${(p) =>
    p.$active &&
    css`
      box-shadow: 0 0 0 7px ${tokens.overlay.white16};
      transition: none;

      @media (max-width: 768px) {
        box-shadow: 0 0 0 6px ${tokens.overlay.white16};
      }
    `}

  ${(p) =>
    p.$disabled &&
    css`
      background-color: ${tokens.surface.tabMuted};

      &::before {
        box-shadow: none;
      }

      &:hover {
        box-shadow: none;
      }
    `}

  @media (max-width: 768px) {
    width: 12px;
    height: 12px;
  }
`;

/**
 * Absolute inside the flex-centred thumb, so the thumb's `justify-content`
 * centres it without a translate of its own — MUI's trick. `::before` is the
 * little pointer under the bubble.
 */
const ValueLabel = styled.span<{ $open: boolean }>`
  position: absolute;
  top: -10px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border-radius: 4px;
  background-color: ${tokens.surface.inputIsland};
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  transform-origin: bottom center;
  transform: ${(p) => (p.$open ? "translateY(-100%) scale(1)" : "translateY(-100%) scale(0)")};
  transition: transform 150ms ${tokens.motion.easeInOut};
  pointer-events: none;

  &::before {
    content: "";
    position: absolute;
    bottom: 0;
    left: 50%;
    width: 8px;
    height: 8px;
    background-color: inherit;
    transform: translate(-50%, 50%) rotate(45deg);
  }
`;
