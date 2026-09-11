import { styled } from "next-yak";
import {
  type CSSProperties,
  type ComponentType,
  type KeyboardEvent,
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

export const SliderMark = ({ style, ...rest }: SliderMarkSlotProps) => {
  const { lastIndex: _lastIndex, cap: _cap, ...dom } = rest;
  return <DefaultMark style={style} {...dom} />;
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
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [active, setActive] = useState(false);
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

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    setActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange?.(event.nativeEvent, valueAt(event.clientX));
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || disabled) return;
    onChange?.(event.nativeEvent, valueAt(event.clientX));
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    onChangeCommitted?.(event.nativeEvent, valueAt(event.clientX));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next = value;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = snap(value + step, min, max, step);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = snap(value - step, min, max, step);
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    onChange?.(event.nativeEvent, next);
    onChangeCommitted?.(event.nativeEvent, next);
  };

  const MarkSlot = slots?.mark ?? SliderMark;
  const showLabel = valueLabelDisplay === "on" || (valueLabelDisplay === "auto" && active);

  return (
    <Root
      className={className}
      $disabled={disabled}
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    >
      <Rail />
      <Track style={{ width: `${pct}%` }} />
      {markList.map((mark, index) => {
        const left = `${((mark.value - min) / span) * 100}%`;
        return (
          <MarkSlot
            key={`${mark.value}-${index}`}
            data-index={index}
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
      <Thumb style={{ left: `${pct}%` }} $active={active}>
        {showLabel && <ValueLabel>{valueLabelFormat(value)}</ValueLabel>}
      </Thumb>
    </Root>
  );
};

const Root = styled.div<{ $disabled: boolean }>`
  position: relative;
  height: 6px;
  margin: 13px 0 22px;
  touch-action: none;
  user-select: none;
  cursor: ${(p) => (p.$disabled ? "not-allowed" : "pointer")};
  opacity: ${(p) => (p.$disabled ? 0.7 : 1)};
  color: ${tokens.text.primary};

  @media (max-width: 768px) {
    margin-bottom: 18px;
  }
`;

const Rail = styled.span`
  position: absolute;
  inset: 0;
  border-radius: ${tokens.radius.full};
  background: ${tokens.surface.inputIsland};
`;

const Track = styled.span`
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: ${tokens.radius.full};
  background: ${tokens.neutralButton.bg};
  pointer-events: none;
`;

const DefaultMark = styled.span`
  position: absolute;
  top: 50%;
  width: 2px;
  height: 6px;
  transform: translate(-50%, -50%);
  background: ${tokens.overlay.white50};
  pointer-events: none;
`;

const MarkLabel = styled.span<{ $align: "start" | "center" | "end" }>`
  position: absolute;
  top: 26px;
  color: ${tokens.text.secondary};
  font-size: 0.75rem;
  white-space: nowrap;
  transform: ${(p) =>
    p.$align === "start" ? "translateX(0)" : p.$align === "end" ? "translateX(-100%)" : "translateX(-50%)"};
  pointer-events: none;

  @media (max-width: 768px) {
    font-size: 0.6rem;
  }
`;

const Thumb = styled.span<{ $active: boolean }>`
  position: absolute;
  top: 50%;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: ${(p) => (p.$active ? tokens.neutralButton.hover : tokens.neutralButton.bg)};
  transform: translate(-50%, -50%);
  box-shadow: ${(p) => (p.$active ? `0 0 0 7px ${tokens.overlay.white16}` : "none")};
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
  pointer-events: none;

  ${Root}:hover:not([aria-disabled="true"]) & {
    background: ${tokens.neutralButton.hover};
    box-shadow: 0 0 0 5px ${tokens.overlay.white16};
  }

  @media (max-width: 768px) {
    width: 12px;
    height: 12px;
  }
`;

const ValueLabel = styled.span`
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: ${tokens.surface.inputIsland};
  color: #ffffff;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 0.75rem;
  white-space: nowrap;
  pointer-events: none;
`;
