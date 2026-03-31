import styled from "@mui/material/styles/styled";
import { tokens } from "../../styles/tokens";
import { Card, MobileWidget } from "../Cards/Cards.styled";
import { chain } from "../../config/chains";

export const MessageWidget = (props: { isMobile: boolean }) => {
  const MessageWrapper = styled(Card)`
    min-width: 250px;
    padding: 1rem;
    min-height: fit-content;
    width: 100%;
    background-color: ${tokens.card.bg};
    border: 1px solid ${tokens.border.default};
    p {
      font-size: 14px;
      color: ${tokens.text.onDark};
    }
    a {
      text-decoration: underline;
      color: ${tokens.text.messageLink};
    }
  `;

  const MobileMessageWrapper = styled(MobileWidget)`
    width: 100%;
    padding: 18px;
    margin-bottom: 1rem;
    background-color: ${tokens.card.bg};
    border: 1px solid ${tokens.border.default};
    p {
      font-size: 14px;
      color: ${tokens.text.onDark};
    }
    a {
      text-decoration: underline;
      color: ${tokens.text.messageLink};
    }
  `;

  const Content = () => {
    return (
      <p>
        Welcome to the Lumerin Marketplace on {chain.name}. Find detailed instructions in our{" "}
        <a href={`${process.env.REACT_APP_GITBOOK_URL}`} target="_blank" rel="noreferrer">
          Gitbook
        </a>
        {". "}
        Please provide feedback or submit any bugs to the{" "}
        <a href="https://github.com/Lumerin-protocol/proxy-router-ui/issues" target="_blank" rel="noreferrer">
          Github Repo
        </a>
        .
      </p>
    );
  };

  return (
    <>
      {props.isMobile ? (
        <MobileMessageWrapper>
          <Content />
        </MobileMessageWrapper>
      ) : (
        <MessageWrapper>
          <Content />
        </MessageWrapper>
      )}
    </>
  );
};
