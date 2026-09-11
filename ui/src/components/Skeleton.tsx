import styled from "@emotion/styled";
import { tokens } from "../styles/tokens";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  className?: string;
}

export const Skeleton = ({ width = "100%", height = "1em", className }: SkeletonProps) => (
  <Pulse
    className={className}
    style={{
      width: typeof width === "number" ? `${width}px` : width,
      height: typeof height === "number" ? `${height}px` : height,
    }}
  />
);

const Pulse = styled("span")`
  display: block;
  border-radius: ${tokens.radius.md};
  background: ${tokens.overlay.white10};
  animation: skeleton-pulse 1.4s ease-in-out infinite;

  @keyframes skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }
`;
