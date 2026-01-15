import styled from "@mui/material/styles/styled";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { safeLazy } from "../utils/safeLazy";

type Props = {
  pageTitle: string;
};

const HeaderConnectLazy = safeLazy(() =>
  import("./HeaderConnect").then((module) => ({ default: module.HeaderConnect })),
);

const Web3ProviderLazy = safeLazy(() => import("../Web3Provider").then((module) => ({ default: module.Web3Provider })));

export const Header = (props: Props) => {
  return (
    <StyledToolbar>
      <PageTitle>{props.pageTitle}</PageTitle>
      <Web3ProviderLazy>
        <HeaderConnectLazy />
      </Web3ProviderLazy>
    </StyledToolbar>
  );
};

const StyledToolbar = styled(Toolbar)`
  display: flex;
  justify-content: space-between;
  padding: 0 !important;
`;

const PageTitle = styled(Typography)`
  color: #fff;
  font-weight: 600;
  font-family: Raleway, sans-serif;
  font-size: 2rem;

  @media (max-width: 768px) {
    font-size: 1.4rem;
  }
`;
