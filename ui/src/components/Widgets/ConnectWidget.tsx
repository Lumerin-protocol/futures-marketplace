import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
} from "react";
import { useAccount } from "wagmi";
import { styled } from "next-yak";
import { WalletModal } from "konekt-ui";
import { abortPairing, AccountModal, useWagmiPairing } from "konekt-ui/wagmi";
import "konekt-ui/styles.css";
import { AddressLength } from "../../types/types";
import { PrimaryButton } from "../Forms/FormButtons/Buttons.styled";
import { ChainIcon } from "../../config/chains";
import { truncateAddress } from "../../utils/formatters";
import { tokens } from "../../styles/tokens";
import { WalletAvatar } from "../WalletAvatar";

type WalletUi = {
  openConnect: () => void;
  openAccount: () => void;
  openNetworks: () => void;
};

const WalletUiContext = createContext<WalletUi | null>(null);

export const useWalletUi = () => {
  const ui = useContext(WalletUiContext);
  if (!ui) {
    throw new Error("Wallet controls must be rendered inside WalletUiProvider");
  }
  return ui;
};

export const WalletUiProvider: FC<PropsWithChildren> = ({ children }) => {
  const [connectOpen, setConnectOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountView, setAccountView] = useState<"account" | "networks">("account");
  const pairing = useWagmiPairing();

  const ui = useMemo<WalletUi>(
    () => ({
      openConnect: () => setConnectOpen(true),
      openAccount: () => {
        setAccountView("account");
        setAccountOpen(true);
      },
      openNetworks: () => {
        setAccountView("networks");
        setAccountOpen(true);
      },
    }),
    [],
  );

  return (
    <WalletUiContext.Provider value={ui}>
      {children}
      <WalletModal
        open={connectOpen}
        pairing={pairing}
        theme="dark"
        onDismiss={abortPairing}
        onClose={() => setConnectOpen(false)}
      />
      <AccountModal
        open={accountOpen}
        view={accountView}
        theme="dark"
        onView={setAccountView}
        onClose={() => setAccountOpen(false)}
      />
    </WalletUiContext.Provider>
  );
};

type Props = {
  onConnect?: () => void;
  addressLength?: AddressLength;
  hideChain?: boolean;
  hideConnector?: boolean;
};

export const AccountButton = (props: Props) => {
  const { onConnect, addressLength = AddressLength.MEDIUM } = props;
  const { address, isConnected } = useAccount();
  const { openConnect, openAccount } = useWalletUi();

  const shouldRedirect = useRef(false);

  useEffect(() => {
    if (isConnected && shouldRedirect.current) {
      onConnect?.();
    }
  }, [isConnected, onConnect]);

  if (address) {
    return (
      <Button type="button" onClick={openAccount}>
        <WalletAvatar address={address} />
        {truncateAddress(address, addressLength)}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      onClick={() => {
        openConnect();
        shouldRedirect.current = true;
      }}
    >
      Connect wallet
    </Button>
  );
};

export const ChainButton = (props?: { hideName?: boolean }) => {
  const { chain } = useAccount();
  const { openNetworks } = useWalletUi();

  return (
    ChainIcon && (
      <Button type="button" onClick={openNetworks}>
        {/* SVG width/height attrs require unitless px (or %), not rem */}
        <ChainIcon width={24} height={24} />
        {!props?.hideName && chain?.name}
      </Button>
    )
  );
};

export const ConnectorButton = () => {
  const { connector } = useAccount();
  const { openAccount } = useWalletUi();

  return (
    connector?.icon && (
      <Button type="button" onClick={openAccount}>
        <ConnectorIcon src={connector?.icon} alt="connector icon" />
      </Button>
    )
  );
};

const ConnectorIcon = styled.img`
  width: 1.5rem;
  height: 1.5rem;
`;

export const Button = styled(PrimaryButton)`
  height: 48px;
  border-radius: ${tokens.radius.md};
  color: ${tokens.text.onDark};
  font-weight: 600;
  font-size: 0.875rem;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  gap: 0.5rem;
  border: 1px solid ${tokens.border.muted05};
  &:hover {
    background: ${tokens.overlay.white08};
  }
  &:not(:last-child) {
    margin-right: 0;
  }
`;
