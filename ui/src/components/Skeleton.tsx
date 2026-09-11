import styled from "@emotion/styled";
import { css, keyframes } from "@emotion/react";
import { tokens } from "../styles/tokens";

type Variant = "text" | "rectangular" | "rounded" | "circular";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** `text` scales to a line of copy; the rest fill the box they are given. */
  variant?: Variant;
  animation?: "pulse" | "wave" | false;
  className?: string;
  "aria-label"?: string;
}

const size = (value: number | string) => (typeof value === "number" ? `${value}px` : value);

// `rounded` rather than MUI's `text` default: the app's skeletons stand in for
// blocks, and rounded is the variant that picks up `shape.borderRadius`.
export const Skeleton = ({
  width = "100%",
  height,
  variant = "rounded",
  animation = "pulse",
  className,
  ...rest
}: SkeletonProps) => (
  <Root
    className={className}
    $variant={variant}
    $animation={animation}
    style={{ width: size(width), height: height === undefined ? undefined : size(height) }}
    {...rest}
  />
);

/** Material's Skeleton pulse: a 2s ease-in-out dip to 0.4 with a 0.5s lead-in. */
const pulse = keyframes`
  0% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }

  100% {
    opacity: 1;
  }
`;

const wave = keyframes`
  0% {
    transform: translateX(-100%);
  }

  50% {
    transform: translateX(100%);
  }

  100% {
    transform: translateX(100%);
  }
`;

/**
 * An elliptical radius: `shape.borderRadius` across, and the same value divided
 * back out by the 0.6 scale below so the corners still read as round once the
 * text skeleton has been squashed.
 */
const TEXT_RADIUS = "4px / 6.7px";
const TEXT_SCALE = "scale(1, 0.6)";

const Root = styled.span<{ $variant: Variant; $animation: "pulse" | "wave" | false }>`
  display: block;
  height: 1.2em;
  background-color: ${tokens.skeleton.bg};
  border-radius: ${(p) =>
    p.$variant === "circular" ? "50%" : p.$variant === "rounded" ? tokens.radius.md : "0"};

  ${(p) =>
    p.$variant === "text" &&
    css`
      height: auto;
      margin-top: 0;
      margin-bottom: 0;
      border-radius: ${TEXT_RADIUS};
      transform-origin: 0 55%;
      transform: ${TEXT_SCALE};

      &:empty::before {
        content: "\\00a0";
      }
    `}

  ${(p) =>
    p.$animation === "pulse" &&
    css`
      animation: ${pulse} 2s ease-in-out 0.5s infinite;
    `}

  ${(p) =>
    p.$animation === "wave" &&
    css`
      position: relative;
      overflow: hidden;
      -webkit-mask-image: -webkit-radial-gradient(white, black);

      &::after {
        content: "";
        position: absolute;
        inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(90deg, transparent, ${tokens.overlay.white08}, transparent);
        animation: ${wave} 2s linear 0.5s infinite;
      }
    `}
`;
