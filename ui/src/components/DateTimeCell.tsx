import type { FC } from "react";
import styled from "@mui/material/styles/styled";
import { tokens } from "../styles/tokens";

interface DateTimeCellProps {
  timestamp: string | bigint | number;
  showSeconds?: boolean;
}

/**
 * Converts a unix-seconds timestamp into a two-line display:
 *   Line 1: date  (e.g. "Apr 15, 2026")
 *   Line 2: time  (e.g. "02:30 PM")
 *
 * Accepts string, bigint, or number values — all treated as unix seconds.
 * Pass `showSeconds` for trade-level precision.
 */
export const DateTimeCell: FC<DateTimeCellProps> = ({ timestamp, showSeconds }) => {
  const ts = Number(timestamp);
  if (!ts) return <span>-</span>;

  const date = new Date(ts * 1000);

  const datePart = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds && { second: "2-digit" }),
  };
  const timePart = date.toLocaleTimeString("en-US", timeOptions);

  return (
    <Wrapper>
      <span>{datePart}</span>
      <span className="time">{timePart}</span>
    </Wrapper>
  );
};

const Wrapper = styled("div")`
  display: flex;
  flex-direction: column;
  line-height: 1.3;
  font-size: 0.75rem;

  .time {
    color: ${tokens.text.secondary};
  }
`;
