import { useMediaQuery } from "../hooks/useMediaQuery";
import { AccountButton, ChainButton, ConnectorButton } from "./Widgets/ConnectWidget";
import { AddressLength } from "../types/types";
import styled from "@emotion/styled";

export const HeaderConnect = () => {
  const isMobile = useMediaQuery("(max-width: 768px)");

  return (
    <ConnectGroup>
      <AccountButton addressLength={isMobile ? AddressLength.SHORT : AddressLength.MEDIUM} />
      {!isMobile && (
        <>
          <ChainButton />
          <ConnectorButton />
        </>
      )}
    </ConnectGroup>
  );
};

const ConnectGroup = styled("div")`
  display: flex;
  gap: 1rem;
`;
