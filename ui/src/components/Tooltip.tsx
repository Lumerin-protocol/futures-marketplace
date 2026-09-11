import styled from "@emotion/styled";
import { css } from "@emotion/react";
import {
  type ReactElement,
  type ReactNode,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { tokens } from "../styles/tokens";

type Placement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  title: ReactNode;
  children: ReactElement;
  arrow?: boolean;
  placement?: Placement;
  disableHoverListener?: boolean;
}

/** `transitions.duration.shorter`, the timeout MUI's Tooltip hands Grow. */
const TRANSITION_MS = 200;
/** MUI's `enterDelay` default. `leaveDelay` is 0, so there is no leave timer. */
const ENTER_DELAY_MS = 100;
/**
 * The gap MUI puts between anchor and bubble, as `marginTop`/`marginBottom`/
 * `marginLeft`/`marginRight: 14px` on the tooltip. Arrow tooltips reset that
 * margin to 0 and let the arrow's negative margin cover the distance instead.
 */
const GAP_PX = 14;
/**
 * Arrow box, `1em` × `0.71em` (= 1em / √2, the hypotenuse of the square inside
 * it) against the bubble's 11px font, and the pull that lifts it clear of the
 * bubble's edge.
 */
const ARROW_LONG = "1em";
const ARROW_SHORT = "0.71em";
const ARROW_PULL = "-0.71em";
const ARROW_LONG_PX = 11;
const ARROW_SHORT_PX = 7.81;

/** Grow's origin: the bubble expands out of the edge nearest its anchor. */
const ORIGIN_TOP = "center bottom";
const ORIGIN_BOTTOM = "center top";
const ORIGIN_LEFT = "right center";
const ORIGIN_RIGHT = "left center";
/** `options.padding` on Popper's arrow modifier: how close to a corner it may sit. */
const ARROW_PADDING_PX = 4;
/** Popper's `preventOverflow` keeps the bubble this far inside the viewport. */
const VIEWPORT_PADDING_PX = 8;

const isVertical = (placement: Placement) => placement === "top" || placement === "bottom";

/**
 * Hover tooltip. Always wraps the child so a disabled button (no pointer
 * events) can still show a hint — the same reason MUI wraps in a span.
 *
 * Positioning stands in for Popper: the bubble is measured, flipped to the
 * opposite side when the preferred one does not fit, then clamped into the
 * viewport, with the arrow tracking the anchor's centre the way Popper's arrow
 * modifier does.
 */
export const Tooltip = ({
  title,
  children,
  arrow = false,
  placement = "bottom",
  disableHoverListener = false,
}: TooltipProps) => {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tooltipId = useId();

  // `mounted` keeps the bubble in the tree through its exit transition;
  // `entered` is the flag the transition itself runs off.
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [box, setBox] = useState({ top: 0, left: 0, placement, arrowOffset: 0 });

  const empty = title == null || title === false || title === "";

  const show = () => {
    if (disableHoverListener || empty) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMounted(true), ENTER_DELAY_MS);
  };

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setEntered(false);
    timer.current = setTimeout(() => setMounted(false), TRANSITION_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const anchor = wrapRef.current?.getBoundingClientRect();
    if (!mounted || !bubble || !anchor) return;

    // offsetWidth/Height, not the rect: the bubble is still scaled down by the
    // enter transform while it is being measured.
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const gap = arrow ? 0 : GAP_PX;

    // Popper's flip modifier: swap to the opposite side when the preferred one
    // has no room and the opposite one does.
    const room = {
      top: anchor.top - gap - VIEWPORT_PADDING_PX,
      bottom: window.innerHeight - anchor.bottom - gap - VIEWPORT_PADDING_PX,
      left: anchor.left - gap - VIEWPORT_PADDING_PX,
      right: window.innerWidth - anchor.right - gap - VIEWPORT_PADDING_PX,
    };
    const opposite: Record<Placement, Placement> = {
      top: "bottom",
      bottom: "top",
      left: "right",
      right: "left",
    };
    const need = isVertical(placement) ? bh : bw;
    const resolved =
      room[placement] < need && room[opposite[placement]] >= need ? opposite[placement] : placement;

    let top: number;
    let left: number;
    switch (resolved) {
      case "top":
        top = anchor.top - bh - gap;
        left = anchor.left + anchor.width / 2 - bw / 2;
        break;
      case "bottom":
        top = anchor.bottom + gap;
        left = anchor.left + anchor.width / 2 - bw / 2;
        break;
      case "left":
        top = anchor.top + anchor.height / 2 - bh / 2;
        left = anchor.left - bw - gap;
        break;
      default:
        top = anchor.top + anchor.height / 2 - bh / 2;
        left = anchor.right + gap;
    }

    const maxLeft = window.innerWidth - bw - VIEWPORT_PADDING_PX;
    const maxTop = window.innerHeight - bh - VIEWPORT_PADDING_PX;
    const clampedLeft = Math.min(Math.max(VIEWPORT_PADDING_PX, left), Math.max(VIEWPORT_PADDING_PX, maxLeft));
    const clampedTop = Math.min(Math.max(VIEWPORT_PADDING_PX, top), Math.max(VIEWPORT_PADDING_PX, maxTop));

    // The arrow points at the anchor's centre, not at the bubble's, so that a
    // bubble pushed sideways by the clamp still aims at what it describes.
    const along = isVertical(resolved) ? ARROW_LONG_PX : ARROW_SHORT_PX;
    const span = isVertical(resolved) ? bw : bh;
    const centre = isVertical(resolved)
      ? anchor.left + anchor.width / 2 - clampedLeft
      : anchor.top + anchor.height / 2 - clampedTop;
    const limit = Math.max(ARROW_PADDING_PX, span - ARROW_PADDING_PX - along);
    const arrowOffset = Math.min(Math.max(ARROW_PADDING_PX, centre - along / 2), limit);

    setBox({ top: clampedTop, left: clampedLeft, placement: resolved, arrowOffset });
  }, [mounted, placement, arrow]);

  // Kick the enter transition only once the bubble has been placed, so it grows
  // out of the right corner instead of sliding across the screen.
  useEffect(() => {
    if (!mounted) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [mounted, hide]);

  const child = cloneElement(children, {
    "aria-describedby": mounted && !empty ? tooltipId : undefined,
  } as Record<string, unknown>);

  return (
    <>
      <Wrap ref={wrapRef} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
        {child}
      </Wrap>
      {mounted &&
        !empty &&
        createPortal(
          <Bubble
            ref={bubbleRef}
            id={tooltipId}
            role="tooltip"
            $placement={box.placement}
            $entered={entered}
            style={{ top: box.top, left: box.left }}
          >
            {title}
            {arrow && (
              <Arrow
                $placement={box.placement}
                style={
                  isVertical(box.placement) ? { left: box.arrowOffset } : { top: box.arrowOffset }
                }
              />
            )}
          </Bubble>,
          document.body,
        )}
    </>
  );
};

const Wrap = styled.span`
  display: inline-flex;
  max-width: 100%;
`;

/**
 * Grow, as two interpolated values rather than a transition group: opacity over
 * the full 200ms and the scale over two thirds of it, which is what makes the
 * bubble settle before it has finished fading in.
 */
const Bubble = styled.div<{ $placement: Placement; $entered: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1500;
  box-sizing: border-box;
  max-width: 300px;
  padding: 4px 8px;
  border-radius: ${tokens.radius.sm};
  background-color: ${tokens.tooltip.bg};
  color: ${tokens.text.onDark};
  font-size: 0.6875rem;
  font-weight: 500;
  word-wrap: break-word;
  pointer-events: none;
  opacity: ${(p) => (p.$entered ? 1 : 0)};
  transform: ${(p) => (p.$entered ? "none" : "scale(0.75, 0.5625)")};
  transition: opacity 200ms ${tokens.motion.easeInOut} 0ms,
    transform 133ms ${tokens.motion.easeInOut} 0ms;

  ${(p) =>
    p.$placement === "top" &&
    css`
      transform-origin: ${ORIGIN_TOP};
    `}
  ${(p) =>
    p.$placement === "bottom" &&
    css`
      transform-origin: ${ORIGIN_BOTTOM};
    `}
  ${(p) =>
    p.$placement === "left" &&
    css`
      transform-origin: ${ORIGIN_LEFT};
    `}
  ${(p) =>
    p.$placement === "right" &&
    css`
      transform-origin: ${ORIGIN_RIGHT};
    `}
`;

/**
 * A square rotated 45° inside an `overflow: hidden` box, so only the half that
 * points away from the bubble shows. The negative margin pulls it clear of the
 * bubble's edge; the per-placement transform origins keep the visible half
 * filling the box after the rotation.
 */
const Arrow = styled.span<{ $placement: Placement }>`
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
  width: ${ARROW_LONG};
  height: ${ARROW_SHORT};
  color: ${tokens.tooltip.bg};

  &::before {
    content: "";
    display: block;
    margin: auto;
    width: 100%;
    height: 100%;
    background-color: currentColor;
    transform: rotate(45deg);
  }

  ${(p) =>
    p.$placement === "top" &&
    css`
      bottom: 0;
      margin-bottom: ${ARROW_PULL};

      &::before {
        transform-origin: 100% 0;
      }
    `}
  ${(p) =>
    p.$placement === "bottom" &&
    css`
      top: 0;
      margin-top: ${ARROW_PULL};

      &::before {
        transform-origin: 0 100%;
      }
    `}
  ${(p) =>
    p.$placement === "left" &&
    css`
      right: 0;
      width: ${ARROW_SHORT};
      height: ${ARROW_LONG};
      margin-right: ${ARROW_PULL};

      &::before {
        transform-origin: 0 0;
      }
    `}
  ${(p) =>
    p.$placement === "right" &&
    css`
      left: 0;
      width: ${ARROW_SHORT};
      height: ${ARROW_LONG};
      margin-left: ${ARROW_PULL};

      &::before {
        transform-origin: 100% 100%;
      }
    `}
`;
