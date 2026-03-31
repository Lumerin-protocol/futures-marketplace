import styled from "@mui/material/styles/styled";
import { tokens } from "../styles/tokens";

export const ModalBox = styled("div")`
  padding: 40px;
  max-width: 450px;
  text-align: left;
  display: flex;
  justify-content: center;
  align-items: center;
`;

export const NetworkBox = styled(ModalBox)`
  max-width: 400px;
  display: block;
  padding: 80px 40px;
  h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  p {
    margin-bottom: 2rem;
  }
`;

export const ModalCard = styled("div")`
  background: ${tokens.modal.bg};
  border: 1px solid ${tokens.border.default};
  color: ${tokens.text.onDark};
  border-radius: ${tokens.radius.md};
  display: flex;
  flex-direction: column;
  margin: 3rem auto;
  max-width: 600px;
  padding: 2rem 4rem 4rem;
  box-shadow: ${tokens.shadow.level3};

  @media (max-width: 600px) {
    padding: 1rem 2rem 2rem;
    padding-top: 1rem;
    margin-top: 1rem;
    p {
      font-size: 0.9rem;
    }
  }

  .close {
    margin-left: auto;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 500;
    padding-bottom: 1rem;
    @media (max-width: 600px) {
      font-size: 1rem;
    }
  }

  .subtext {
    font-size: 0.8rem;
  }

  @media (max-width: 500px) {
    max-width: 90%;
  }
`;

export const ContractLink = styled("a")`
  font-size: 0.8rem;
  margin-bottom: 1rem;
  color: ${tokens.brand.blue};
  font-weight: 500;
  &:hover {
    color: ${tokens.brand.blueDark};
  }
`;
