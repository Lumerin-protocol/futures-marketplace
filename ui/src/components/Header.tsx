import styled from "@mui/material/styles/styled";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { safeLazy } from "../utils/safeLazy";
import LogoIcon from "../images/icons/nav-logo-white.png";

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
      <TitleWrapper>
        <LogoCrop>
          <img src={LogoIcon} alt="Lumerin" />
        </LogoCrop>
        <PageTitle>{props.pageTitle}</PageTitle>
      </TitleWrapper>
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

const TitleWrapper = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.75rem;
`;

const LogoCrop = styled("div")`
  width: 70px;
  height: auto;
  overflow: hidden;
  padding-bottom: 5px;

  img {
    min-width: 200px;
  }
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
