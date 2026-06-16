import styled from "@mui/material/styles/styled";
import { Link, useLocation } from "react-router";
import { tokens } from "../styles/tokens";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { safeLazy } from "../utils/safeLazy";
import { PathName } from "../types/types";
import LogoIcon from "../images/icons/hpdx-logo.png";

type Props = {
  pageTitle: string;
};

const HeaderConnectLazy = safeLazy(() =>
  import("./HeaderConnect").then((module) => ({ default: module.HeaderConnect })),
);

const Web3ProviderLazy = safeLazy(() => import("../Web3Provider").then((module) => ({ default: module.Web3Provider })));

export const Header = (props: Props) => {
  const location = useLocation();
  const isLeaderboardActive = location.pathname === PathName.Leaderboard;

  const handleLogoClick = () => {
    window.open("http://lumerin.io/", "_blank", "noopener,noreferrer");
  };

  return (
    <StyledToolbar>
      <TitleWrapper>
        <Logo src={LogoIcon} alt="HPDX" onClick={handleLogoClick} />
        <BrandName onClick={handleLogoClick}>
          HashPower Derivatives Exchange{isLeaderboardActive ? " Leaderboard" : ""}
        </BrandName>
      </TitleWrapper>
      <Nav>
        {isLeaderboardActive ? (
          <NavLink to={PathName.Landing} $active={false}>
            Back to Trading
          </NavLink>
        ) : (
          <NavLink to={PathName.Leaderboard} $active={false}>
            Leaderboard
          </NavLink>
        )}
      </Nav>
      <Web3ProviderLazy>
        <HeaderConnectLazy />
      </Web3ProviderLazy>
    </StyledToolbar>
  );
};

const StyledToolbar = styled(Toolbar)`
  display: flex;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 0 !important;
`;

const Nav = styled("nav")`
  display: flex;
  align-items: center;
  gap: 1.5rem;
  margin-left: auto;
`;

const NavLink = styled(Link)<{ $active: boolean }>`
  font-family: "Inter", sans-serif;
  font-size: 0.95rem;
  font-weight: ${(props) => (props.$active ? 700 : 500)};
  letter-spacing: 0.02em;
  text-decoration: none;
  color: ${(props) => (props.$active ? tokens.accent.main : tokens.text.secondary)};
  padding: 0.4rem 0;
  border-bottom: 2px solid ${(props) => (props.$active ? tokens.accent.main : "transparent")};
  transition: color 0.15s ease;

  &:hover {
    color: ${tokens.text.onDark};
  }
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
