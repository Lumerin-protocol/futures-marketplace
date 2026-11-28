import { styled } from "next-yak";
import type { FC, PropsWithChildren } from "react";
import { Header } from "../Header";
import { Footer } from "../Footer";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTradingAllowed } from "../../hooks/useTradingAccess";
import { tokens } from "../../styles/tokens";

type Props = PropsWithChildren;

export const DefaultLayout: FC<Props> = ({ children }) => {
  const isMobile = useMediaQuery("(max-width: 768px)");

  return (
    <Shell>
      <RestrictedJurisdictionBanner />
      <BodyWrapper>
        <Page $mobile={isMobile}>
          <ContentWrapper>
            <Header />
            <Main>{children}</Main>
          </ContentWrapper>
          <Footer />
        </Page>
      </BodyWrapper>
    </Shell>
  );
};

const RestrictedJurisdictionBanner = () => {
  const allowed = useTradingAllowed();
  if (allowed) return null;
  return (
    <RestrictedBar role="alert">
      You are accessing our products and services from a restricted jurisdiction. We do not allow access
      from certain jurisdictions including locations subject to sanctions restrictions and other
      jurisdictions where our services are ineligible for use. For more information, see our Terms of
      Use. If you think this is an error, try refreshing the page or opening a support ticket.
    </RestrictedBar>
  );
};

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100vh;
`;

const RestrictedBar = styled.div`
  width: 100%;
  box-sizing: border-box;
  background: ${tokens.trading.shortHover};
  color: #ffffff;
  text-align: center;
  padding: 0.65rem 1.25rem;
  font-family: "Inter", sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.45;
`;

const BodyWrapper = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
`;

const Page = styled.div<{ $mobile: boolean }>`
  flex-grow: 1;
  padding: ${(p) => (p.$mobile ? "16px" : "24px")};
  width: 100%;
  color: white;
  display: flex;
  flex-direction: column;
`;

const Main = styled.main``;

const ContentWrapper = styled.div`
  max-width: 1920px;
  margin: 0 auto;
  width: 100%;
  flex-grow: 1;
`;
