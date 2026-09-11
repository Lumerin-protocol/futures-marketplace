import { type FC, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { styled } from "next-yak";
import { tokens } from "../styles/tokens";
import { ModalCard, ModalCloseButton, ModalCloseIcon } from "./Modal.styled";

interface OverlayProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  disableEscapeKeyDown?: boolean;
  zIndex?: number;
}

/** `theme.zIndex.modal`. */
const DEFAULT_Z = 1300;
/** Fade's `leavingScreen` duration; `enteringScreen` is the 225ms in the CSS below. */
const EXIT_MS = 195;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let lockCount = 0;
let restoreOverflow = "";
let restorePaddingRight = "";

/**
 * Hiding the page's scrollbar widens the viewport, which would shove the whole
 * layout sideways behind the backdrop. MUI pads the body by the width it just
 * took away; so do we.
 */
function lockScroll() {
  lockCount += 1;
  if (lockCount > 1) return;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  restoreOverflow = document.body.style.overflow;
  restorePaddingRight = document.body.style.paddingRight;
  document.body.style.overflow = "hidden";
  if (gap > 0) {
    const current = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.paddingRight = `${current + gap}px`;
  }
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;
  document.body.style.overflow = restoreOverflow;
  document.body.style.paddingRight = restorePaddingRight;
}

/**
 * Full-screen overlay. Backdrop click and Escape close it unless those are
 * disabled (alerts stay until a button is pressed).
 *
 * Focus moves into the overlay on open, Tab cycles inside it, and whatever was
 * focused before gets it back on close. Tab is only caught when it comes from
 * inside, so a wallet dialog opening on top of this one is left alone.
 */
export const Modal = ({
  open,
  onClose,
  children,
  disableEscapeKeyDown = false,
  zIndex = DEFAULT_Z,
}: OverlayProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // `mounted` keeps the overlay in the tree through its fade out.
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    clearTimeout(exitTimer.current);
    if (open) {
      setMounted(true);
      return;
    }
    setEntered(false);
    exitTimer.current = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(exitTimer.current);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    lockScroll();
    return unlockScroll;
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !disableEscapeKeyDown) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, disableEscapeKeyDown, onClose]);

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      setEntered(true);
      const container = containerRef.current;
      if (!container || container.contains(document.activeElement)) return;
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? container).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      restoreFocusTo.current?.focus?.();
    };
  }, [open]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const container = containerRef.current;
    if (!container) return;
    const stops = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (stops.length === 0) {
      event.preventDefault();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === container)) {
      event.preventDefault();
      last.focus();
    }
  };

  if (!mounted) return null;

  return createPortal(
    <Root $zIndex={zIndex}>
      <Backdrop $entered={entered} aria-hidden />
      <Container
        ref={containerRef}
        tabIndex={-1}
        $entered={entered}
        onKeyDown={onTabKeyDown}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose?.();
        }}
      >
        {children}
      </Container>
    </Root>,
    document.body,
  );
};

interface ModalItemProps {
  open: boolean;
  setOpen: (isOpen: boolean) => void;
  content?: ReactNode;
  children?: ReactNode;
  /** Narrower card with tighter padding, for short confirmation dialogs. */
  compact?: boolean;
}

export const ModalItem: FC<ModalItemProps> = ({ open, setOpen, content, children, compact = false }) => {
  return (
    <Modal open={open} onClose={() => setOpen(false)}>
      <ModalCard $compact={compact}>
        <ModalCloseButton className="close" onClick={() => setOpen(false)}>
          <ModalCloseIcon />
        </ModalCloseButton>
        {children || content}
      </ModalCard>
    </Modal>
  );
};

const Root = styled.div<{ $zIndex: number }>`
  position: fixed;
  inset: 0;
  z-index: ${(p) => p.$zIndex};
`;

const Backdrop = styled.div<{ $entered: boolean }>`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: ${tokens.modal.backdrop};
  -webkit-tap-highlight-color: transparent;
  opacity: ${(p) => (p.$entered ? 1 : 0)};
  transition: opacity ${(p) => (p.$entered ? "225ms" : "195ms")} ${tokens.motion.easeInOut} 0ms;
`;

/**
 * The scrolling half of a Dialog with `scroll="body"`: the card sits in normal
 * flow so a tall one scrolls the overlay rather than clipping.
 */
const Container = styled.div<{ $entered: boolean }>`
  position: absolute;
  inset: 0;
  overflow: auto;
  outline: 0;
  opacity: ${(p) => (p.$entered ? 1 : 0)};
  transition: opacity ${(p) => (p.$entered ? "225ms" : "195ms")} ${tokens.motion.easeInOut} 0ms;
`;
