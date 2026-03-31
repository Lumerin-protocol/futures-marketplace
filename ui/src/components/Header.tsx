import styled from "@mui/material/styles/styled";
import { tokens } from "../styles/tokens";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { safeLazy } from "../utils/safeLazy";
import LogoIcon from "../images/icons/hpdx-logo.png";

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
        <Logo src={LogoIcon} alt="HPDX" onClick={handleLogoClick} />
        <BrandName onClick={handleLogoClick}>HPDX</BrandName>
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
  height: 46px;
  width: 46px;
  cursor: pointer;
`;

const BrandName = styled(Typography)`
  color: ${tokens.text.onDark};
  font-weight: 700;
  font-family: "Inter", sans-serif;
  font-size: 1.6rem;
  letter-spacing: 0.04em;
  cursor: pointer;
`;
