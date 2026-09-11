import styled from "@emotion/styled";
import { css } from "@emotion/react";
import { tokens } from "../styles/tokens";
import { CloseIcon } from "./icons";
import type { ComponentProps } from "react";

export const ModalBox = styled.div`
  padding: 40px;
  max-width: 450px;
  text-align: left;
  display: flex;
  justify-content: center;
  align-items: center;
`;

export const NetworkBox = styled(ModalBox)`
  max-width: 400px;
  display: block;
  padding: 80px 40px;
  h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  p {
    margin-bottom: 2rem;
  }
`;

const COMPACT_MAX_WIDTH = "460px";
const COMPACT_PADDING = "2rem";
const COMPACT_CLOSE_INSET = "1.25rem";

/** Dialog's Paper: elevation 24, which is the top of Material's ramp. */
export const ModalCard = styled.div<{ $compact?: boolean }>`
  background: ${tokens.modal.bg};
  border: 1px solid ${tokens.border.default};
  color: ${tokens.text.onDark};
  border-radius: ${tokens.radius.md};
  display: flex;
  flex-direction: column;
  margin: 3rem auto;
  max-width: 600px;
  padding: 2rem 4rem 4rem;
  box-shadow: ${tokens.shadow.elevation24};

  /* Compact cards pin the close button to the corner so it does not push the
     title down and the content starts at the same offset on every side. */
  ${(p) =>
    p.$compact &&
    css`
      max-width: ${COMPACT_MAX_WIDTH};
      padding: ${COMPACT_PADDING};
      position: relative;

      .close {
        position: absolute;
        top: ${COMPACT_CLOSE_INSET};
        right: ${COMPACT_CLOSE_INSET};
        margin-left: 0;
      }
    `}

  @media (max-width: 600px) {
    padding: 1rem 2rem 2rem;
    padding-top: 1rem;
    margin-top: 1rem;
    p {
      font-size: 0.9rem;
    }
  }

  .close {
    margin-left: auto;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 500;
    padding-bottom: 1rem;
    @media (max-width: 600px) {
      font-size: 1rem;
    }
  }

  .subtext {
    font-size: 0.8rem;
  }

  @media (max-width: 500px) {
    max-width: 90%;
  }
`;

/**
 * IconButton, medium: a 24px glyph in 8px of padding, so the circle lands on
 * Material's 40px target. The hover and focus washes are `action.hover` and
 * `action.focus` at their dark-mode opacities.
 */
const CloseButtonBase = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  box-sizing: border-box;
  position: relative;
  margin: 0;
  padding: 8px;
  border: 0;
  border-radius: 50%;
  outline: 0;
  background-color: transparent;
  color: #ffffff;
  font-size: 1.5rem;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
  -webkit-appearance: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 150ms ${tokens.motion.easeInOut} 0ms;

  &::-moz-focus-inner {
    border-style: none;
  }

  &:hover {
    background-color: ${tokens.overlay.white08};

    @media (hover: none) {
      background-color: transparent;
    }
  }

  &:focus-visible {
    background-color: ${tokens.overlay.white12};
  }

  &:disabled {
    pointer-events: none;
    color: ${tokens.text.disabled};
  }
`;

export const ModalCloseButton = (props: ComponentProps<typeof CloseButtonBase>) => (
  <CloseButtonBase type="button" aria-label="Close" {...props} />
);

export const ModalCloseIcon = CloseIcon;

export const ContractLink = styled.a`
  font-size: 0.8rem;
  margin-bottom: 1rem;
  color: ${tokens.brand.blue};
  font-weight: 500;
  &:hover {
    color: ${tokens.brand.blueDark};
  }
`;
