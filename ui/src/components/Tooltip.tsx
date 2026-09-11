import styled from "@emotion/styled";
import {
  type ReactElement,
  type ReactNode,
  cloneElement,
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

const OFFSET = 8;

/**
 * Hover tooltip. Always wraps the child so a disabled button (no pointer
 * events) can still show a hint — the same reason MUI wraps in a span.
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
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const empty = title == null || title === false || title === "";

  const show = () => {
    if (disableHoverListener || empty) return;
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = wrapRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const bw = bubble?.width ?? 0;
    const bh = bubble?.height ?? 0;
    let top = 0;
    let left = 0;
    switch (placement) {
      case "bottom":
        top = anchor.bottom + OFFSET;
        left = anchor.left + anchor.width / 2 - bw / 2;
        break;
      case "left":
        top = anchor.top + anchor.height / 2 - bh / 2;
        left = anchor.left - bw - OFFSET;
        break;
      case "right":
        top = anchor.top + anchor.height / 2 - bh / 2;
        left = anchor.right + OFFSET;
        break;
      default:
        top = anchor.top - bh - OFFSET;
        left = anchor.left + anchor.width / 2 - bw / 2;
    }
    const pad = 8;
    left = Math.min(Math.max(pad, left), window.innerWidth - bw - pad);
    top = Math.min(Math.max(pad, top), window.innerHeight - bh - pad);
    setCoords({ top, left });
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onReposition = () => setOpen(false);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]);

  const child = cloneElement(children, {
    "aria-describedby": open && !empty ? tooltipId : undefined,
  } as Record<string, unknown>);

  return (
    <>
      <Wrap
        ref={wrapRef}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
      >
        {child}
      </Wrap>
      {open &&
        !empty &&
        createPortal(
          <Bubble
            ref={bubbleRef}
            id={tooltipId}
            role="tooltip"
            $placement={placement}
            $arrow={arrow}
            style={{ top: coords.top, left: coords.left, visibility: coords.top === 0 && coords.left === 0 ? "hidden" : "visible" }}
          >
            {title}
          </Bubble>,
          document.body,
        )}
    </>
  );
};

const Wrap = styled("span")`
  display: inline-flex;
  max-width: 100%;
`;

const Bubble = styled("div")<{ $placement: Placement; $arrow: boolean }>`
  position: fixed;
  z-index: 1600;
  max-width: 280px;
  padding: 0.4rem 0.65rem;
  border-radius: ${tokens.radius.sm};
  background: ${tokens.overlay.black90};
  color: ${tokens.text.onDark};
  font-size: 0.75rem;
  line-height: 1.4;
  pointer-events: none;
  box-shadow: ${tokens.shadow.level2};

  ${(p) =>
    p.$arrow &&
    `
    &::after {
      content: "";
      position: absolute;
      width: 0;
      height: 0;
      border: 5px solid transparent;
      ${
        p.$placement === "top"
          ? `top: 100%; left: 50%; transform: translateX(-50%); border-top-color: ${tokens.overlay.black90};`
          : p.$placement === "bottom"
            ? `bottom: 100%; left: 50%; transform: translateX(-50%); border-bottom-color: ${tokens.overlay.black90};`
            : p.$placement === "left"
              ? `left: 100%; top: 50%; transform: translateY(-50%); border-left-color: ${tokens.overlay.black90};`
              : `right: 100%; top: 50%; transform: translateY(-50%); border-right-color: ${tokens.overlay.black90};`
      }
    }
  `}
`;
