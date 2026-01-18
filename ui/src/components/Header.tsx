import styled from "@mui/material/styles/styled";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { safeLazy } from "../utils/safeLazy";
import LogoIcon from "../images/icons/nav-logo-white-cropped.png";

type Props = {
  pageTitle: string;
};

const HeaderConnectLazy = safeLazy(() =>
  import("./HeaderConnect").then((module) => ({ default: module.HeaderConnect })),
);

const Web3ProviderLazy = safeLazy(() => import("../Web3Provider").then((module) => ({ default: module.Web3Provider })));

export const Header = (props: Props) => {
  const handleLogoClick = () => {
    window.open("http://lumerin.io/", "_blank", "noopener,noreferrer");
  };

  return (
    <StyledToolbar>
      <TitleWrapper>
        <Logo src={LogoIcon} alt="Lumerin" onClick={handleLogoClick} />
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

const Logo = styled("img")`
  height: auto;
  width: auto;
  max-height: 50px;
  cursor: pointer;
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
