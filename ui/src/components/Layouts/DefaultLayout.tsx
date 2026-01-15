import styled from "@mui/material/styles/styled";
import Box from "@mui/material/Box";
import type { FC, PropsWithChildren } from "react";
import { Header } from "../Header";
import { Footer } from "../Footer";
import { useMediaQuery } from "@mui/material";

type Props = PropsWithChildren<{ pageTitle: string }>;

export const DefaultLayout: FC<Props> = ({ children, pageTitle }) => {
  const isMobile = useMediaQuery("(max-width: 768px)");

  return (
    <BodyWrapper>
      <Box
        sx={{
          flexGrow: 1,
          p: isMobile ? 2 : 3,
          width: "100%",
          minHeight: "100vh",
          color: "white",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ContentWrapper>
          <Header pageTitle={pageTitle} />
          <Box component="main">{children}</Box>
        </ContentWrapper>
        <Footer />
      </Box>
    </BodyWrapper>
  );
};

const BodyWrapper = styled("div")`
  display: flex;
`;

const ContentWrapper = styled("div")`
  max-width: 1920px;
  margin: 0 auto;
  width: 100%;
  flex-grow: 1;
`;
