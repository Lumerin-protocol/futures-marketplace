import styled from "@emotion/styled";
import type { FC, PropsWithChildren } from "react";
import { Header } from "../Header";
import { Footer } from "../Footer";
import { useMediaQuery } from "../../hooks/useMediaQuery";

type Props = PropsWithChildren;

export const DefaultLayout: FC<Props> = ({ children }) => {
  const isMobile = useMediaQuery("(max-width: 768px)");

  return (
    <BodyWrapper>
      <Page $mobile={isMobile}>
        <ContentWrapper>
          <Header />
          <Main>{children}</Main>
        </ContentWrapper>
        <Footer />
      </Page>
    </BodyWrapper>
  );
};

const BodyWrapper = styled("div")`
  display: flex;
`;

const Page = styled("div")<{ $mobile: boolean }>`
  flex-grow: 1;
  padding: ${(p) => (p.$mobile ? "16px" : "24px")};
  width: 100%;
  min-height: 100vh;
  color: white;
  display: flex;
  flex-direction: column;
`;

const Main = styled("main")``;

const ContentWrapper = styled("div")`
  max-width: 1920px;
  margin: 0 auto;
  width: 100%;
  flex-grow: 1;
`;
