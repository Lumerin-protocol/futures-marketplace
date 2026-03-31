import styled from "@mui/material/styles/styled";
import { tokens } from "../../styles/tokens";
import { AddressLength } from "../../types/types";
import { truncateAddress } from "../../utils/formatters";
import { MobileWidget } from "../Cards/Cards.styled";

export const MobileWalletInfo = (props: { walletAddress: string; isMobile: boolean }) => {
  return (
    <WalletBalanceWrapper>
      <h3>Connected Wallet</h3>
      <p>{truncateAddress(props.walletAddress, AddressLength.MEDIUM)}</p>
    </WalletBalanceWrapper>
  );
};

const WalletBalanceWrapper = styled(MobileWidget)`
  flex: 40%;
  h3 {
    color: ${tokens.text.onDark};
    font-size: 10px;
  }
  p {
    font-size: 16px;
    color: ${tokens.text.onDark};
    font-weight: 500;
  }
`;
