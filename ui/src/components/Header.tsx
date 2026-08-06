import { Suspense } from "react";
import styled from "@mui/material/styles/styled";
import { Link, useLocation, useNavigate } from "react-router";
import { tokens } from "../styles/tokens";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { safeLazy } from "../utils/safeLazy";
import { PathName } from "../types/types";
import LogoIcon from "../images/icons/hpdx-logo.png";
import { Web3ProviderLazy } from "../Web3ProviderLazy";

const HeaderConnectLazy = safeLazy(() =>
  import("./HeaderConnect").then((module) => ({ default: module.HeaderConnect })),
);

export const Header = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isLeaderboardActive = location.pathname === PathName.Leaderboard;

  // On the leaderboard the logo doubles as a "back to trading" control so users
  // can leave the page even when the brand text fills the available width;
  // elsewhere it links out to the Lumerin site.
  const handleLogoClick = () => {
    if (isLeaderboardActive) {
      navigate(PathName.Landing);
      return;
    }
    window.open("http://lumerin.io/", "_blank", "noopener,noreferrer");
  };

  return (
    <StyledToolbar>
      <TitleWrapper>
        <Logo src={LogoIcon} alt="HPDX" onClick={handleLogoClick} />
        <BrandName onClick={handleLogoClick}>
          {isLeaderboardActive ? (
            <LeaderboardTitle>Leaderboard</LeaderboardTitle>
          ) : (
            <>
              <FullBrand>HashPower Derivatives Exchange</FullBrand>
              <ShortBrand>HPDX</ShortBrand>
            </>
          )}
        </BrandName>
      </TitleWrapper>
      <Nav>
        {isLeaderboardActive ? (
          <BackButton to={PathName.Landing} aria-label="Back to Trading">
            <ArrowBackIcon fontSize="small" />
            Back
          </BackButton>
        ) : (
          <NavLink to={PathName.Leaderboard} aria-label="Leaderboard">
            <NavIcon>
              <EmojiEventsOutlinedIcon fontSize="small" />
            </NavIcon>
            <NavLabel>Leaderboard</NavLabel>
          </NavLink>
        )}
      </Nav>
      {/* Local boundary so loading this chunk *and* the wagmi/appkit provider
          it needs only shows a small inline spinner here, instead of
          bubbling up and blanking the whole page like it did when nothing
          caught it locally. Web3ProviderLazy is mounted fresh at this one
          spot — see its comment for why that's safe/cheap. */}
      <Suspense fallback={<ConnectSlotSkeleton />}>
        <Web3ProviderLazy>
          <HeaderConnectLazy />
        </Web3ProviderLazy>
      </Suspense>
    </StyledToolbar>
  );
};

const ConnectSlotSkeleton = () => (
  <ConnectSlotSkeletonWrapper>
    <Skeleton variant="rounded" width={140} height={48} sx={{ borderRadius: tokens.radius.md }} />
  </ConnectSlotSkeletonWrapper>
);

const ConnectSlotSkeletonWrapper = styled("div")`
  display: flex;
  align-items: center;
`;

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

const BackButton = styled(Link)`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  height: 48px;
  border-radius: ${tokens.radius.md};
  padding: 0 1rem;
  font-family: "Inter", sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  color: ${tokens.text.onDark};
  background: none;
  border: 1px solid ${tokens.border.muted05};
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 150ms ease, border-color 150ms ease;

  &:hover {
    background: ${tokens.overlay.white08};
    border-color: ${tokens.text.secondary};
  }
`;

const LeaderboardTitle = styled("span")`
  @media (max-width: 768px) {
    display: none;
  }
`;

const NavLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  font-family: "Inter", sans-serif;
  font-size: 0.95rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-decoration: none;
  color: ${tokens.text.secondary};
  padding: 0.4rem 0;
  border-bottom: 2px solid transparent;
  transition: color 0.15s ease;

  &:hover {
    color: ${tokens.text.onDark};
  }
`;

const NavLabel = styled("span")`
  @media (max-width: 768px) {
    display: none;
  }
`;

const NavIcon = styled("span")`
  display: none;
  align-items: center;
  justify-content: center;

  @media (max-width: 768px) {
    display: inline-flex;
  }
`;

const TitleWrapper = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
`;

const Logo = styled("img")`
  height: 46px;
  width: 46px;
  cursor: pointer;

  @media (max-width: 768px) {
    height: 36px;
    width: 36px;
  }
`;

const BrandName = styled(Typography)`
  color: ${tokens.text.onDark};
  font-weight: 700;
  font-family: "Inter", sans-serif;
  font-size: 1.6rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  white-space: nowrap;

  @media (max-width: 768px) {
    font-size: 1.25rem;
  }
`;

const FullBrand = styled("span")`
  @media (max-width: 768px) {
    display: none;
  }
`;

const ShortBrand = styled("span")`
  display: none;

  @media (max-width: 768px) {
    display: inline;
  }
`;
