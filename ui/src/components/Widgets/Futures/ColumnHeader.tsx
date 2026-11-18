import { styled } from "next-yak";
import type { ReactNode } from "react";
import { Tooltip } from "../../Tooltip";
import { COLUMN_HINTS, type ColumnHint } from "./columnHints";

interface ColumnHeaderProps {
  hint: ColumnHint;
  children: ReactNode;
}

/** One header for every hinted column. Hover and tap both open the hint. */
export const ColumnHeader = ({ hint, children }: ColumnHeaderProps) => (
  <th>
    <Tooltip title={COLUMN_HINTS[hint]} arrow placement="top" pinOnClick>
      <HintButton type="button">{children}</HintButton>
    </Tooltip>
  </th>
);

const HintButton = styled.button`
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  text-align: inherit;
  color: inherit;
  cursor: help;
  white-space: nowrap;
  text-decoration: underline dotted;
  text-underline-offset: 0.2em;
  text-decoration-thickness: 1px;
`;
