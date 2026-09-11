import { type FC, type ReactNode, useEffect } from "react";
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

const DEFAULT_Z = 1300;
let lockCount = 0;

function lockScroll() {
  lockCount += 1;
  if (lockCount === 1) document.body.style.overflow = "hidden";
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = "";
}

/**
 * Full-screen overlay. Backdrop click and Escape close it unless those are
 * disabled (alerts stay until a button is pressed).
 */
export const Modal = ({
  open,
  onClose,
  children,
  disableEscapeKeyDown = false,
  zIndex = DEFAULT_Z,
}: OverlayProps) => {
  useEffect(() => {
    if (!open) return;
    lockScroll();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disableEscapeKeyDown) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      unlockScroll();
      document.removeEventListener("keydown", onKey);
    };
  }, [open, disableEscapeKeyDown, onClose]);

  if (!open) return null;

  return createPortal(
    <Overlay
      $zIndex={zIndex}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      {children}
    </Overlay>,
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

const Overlay = styled.div<{ $zIndex: number }>`
  position: fixed;
  inset: 0;
  z-index: ${(p) => p.$zIndex};
  overflow: auto;
  background: ${tokens.modal.backdrop};
`;
