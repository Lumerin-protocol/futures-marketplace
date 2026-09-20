import styled from "@mui/material/styles/styled";
import { tokens } from "../styles/tokens";

interface LoadMoreButtonProps {
  /// Whether more records are available. When false the button renders nothing.
  hasMore: boolean;
  /// True while the next page is loading.
  isLoading?: boolean;
  onClick: () => void;
}

/// Shared centered "Load More" control used by every Futures/Perps history
/// table. Renders nothing when there are no more records to load.
export const LoadMoreButton = ({ hasMore, isLoading, onClick }: LoadMoreButtonProps) => {
  if (!hasMore) return null;

  return (
    <Wrapper>
      <Button type="button" onClick={onClick} disabled={isLoading}>
        {isLoading ? "Loading..." : "Load More"}
      </Button>
    </Wrapper>
  );
};

const Wrapper = styled("div")`
  display: flex;
  justify-content: center;
  width: 100%;
  margin-top: 0.5rem;
`;

const Button = styled("button")`
  padding: 0.5rem 1.25rem;
  background: transparent;
  color: ${tokens.text.secondary};
  border: 1px solid ${tokens.border.muted04};
  border-radius: 6px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: color 0.2s ease, border-color 0.2s ease;

  &:hover:not(:disabled) {
    color: ${tokens.text.onDark};
    border-color: ${tokens.overlay.white30};
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`;
