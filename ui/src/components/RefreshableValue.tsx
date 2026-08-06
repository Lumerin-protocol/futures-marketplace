import { type FC, type ReactNode, type CSSProperties } from "react";
import { keyframes, css } from "@emotion/react";
import styled from "@mui/material/styles/styled";
import { tokens } from "../styles/tokens";

interface RefreshableValueProps {
  /** Formatted value once data has arrived. */
  children: ReactNode;
  /** No value yet — show skeleton or `fallback` and blink. Never a spinner. */
  isInitialLoading?: boolean;
  /** Background refetch — blink the last known value. */
  isRefreshing?: boolean;
  /**
   * Placeholder when there is no value. If omitted during initial load, a
   * skeleton bar is shown instead.
   */
  fallback?: ReactNode;
  /**
   * Prefer `fallback` text (e.g. `"0.00"`) over the skeleton while initially
   * loading.
   */
  useFallbackWhileLoading?: boolean;
  style?: CSSProperties;
  className?: string;
}

/**
 * Metric display with no spinners: keep the last value (or a placeholder) and
 * blink while loading / refreshing.
 */
export const RefreshableValue: FC<RefreshableValueProps> = ({
  children,
  isInitialLoading = false,
  isRefreshing = false,
  fallback = "—",
  useFallbackWhileLoading = false,
  style,
  className,
}) => {
  const hasValue = children !== null && children !== undefined && children !== "";
  const pending = isInitialLoading || isRefreshing;

  let content: ReactNode;
  if (hasValue) {
    content = children;
  } else if (isInitialLoading && !useFallbackWhileLoading) {
    content = <Skeleton aria-label="Loading" />;
  } else {
    content = fallback;
  }

  return (
    <Value className={className} style={style} $pending={pending} aria-busy={pending}>
      {content}
    </Value>
  );
};

const blink = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const shimmer = keyframes`
  0% { opacity: 0.35; }
  50% { opacity: 0.7; }
  100% { opacity: 0.35; }
`;

const Value = styled("span")<{ $pending?: boolean }>`
  display: inline-block;
  min-height: 1.1em;
  ${({ $pending }) =>
    $pending
      ? css`
          animation: ${blink} 1s ease-in-out infinite;
        `
      : undefined}
`;

const Skeleton = styled("span")`
  display: inline-block;
  width: 3.25rem;
  height: 0.85em;
  margin-top: 0.15em;
  border-radius: 3px;
  background: ${tokens.text.secondary};
  animation: ${shimmer} 1.1s ease-in-out infinite;
  vertical-align: middle;
`;
