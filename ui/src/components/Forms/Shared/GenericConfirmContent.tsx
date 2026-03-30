import type { FC } from "react";
import styled from "@mui/material/styles/styled";
import { tokens } from "../../../styles/tokens";

interface GenericConfirmContentProps {
  data: Record<string, string | number | bigint>;
}

export const GenericConfirmContent: FC<GenericConfirmContentProps> = ({ data }) => {
  return (
    <ReviewItems>
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <h3>{key}</h3>
          <p>{typeof value === "bigint" ? value.toString() : value}</p>
        </div>
      ))}
    </ReviewItems>
  );
};

const ReviewItems = styled("div")`
  div {
    display: flex;
    justify-content: space-between;
    margin: 1.25rem 0;
    padding-bottom: 1rem;
    border-bottom: 1px solid ${tokens.card.dividerLight};
    &:last-child {
      border-bottom: none;
    }
    h3 {
      font-size: 0.85rem;
      align-self: center;
    }
    p {
      color: ${tokens.text.onDark};
      font-weight: 500;
    }
  }

  .total-cost {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    .price {
      font-size: 2rem;
    }
  }
`;
