import styled from "@mui/material/styles/styled";
import { tokens } from "../../../styles/tokens";
import { useAccount } from "wagmi";
import { useMemo } from "react";
import { useModal } from "../../../hooks/useModal";
import { SmallWidget } from "../../Cards/Cards.styled";
import { Spinner } from "../../Spinner.styled";
import { formatValue, PAYMENT_TOKEN_SCALE_NUM, paymentToken } from "../../../lib/units";
import { UsdcIcon } from "../../../images";
import { PrimaryButton } from "../../Forms/FormButtons/Buttons.styled";
import { ModalItem } from "../../Modal";
import { WithdrawalFormPerps } from "../../Forms/WithdrawalFormPerps";
import type { AccountBalance } from "../../../types/types";
import { DepositFormPerps } from "../../Forms/DepositFormPerps";
import { useGetPerpsInitialMargin } from "../../../hooks/data/perps/useGetPerpsInitialMargin";

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface PerpsBalanceWidgetProps {
  minMargin: bigint | null;
  isLoadingMinMargin: boolean;
  unrealizedPnL: bigint | null;
  realizedPnL30D: number | null;
  isLoadingRealizedPnL?: boolean;
  balanceQuery: BalanceQueryResult;
  accountBalance?: AccountBalance;
}

export const PerpsBalanceWidget = ({
  minMargin,
  isLoadingMinMargin,
  unrealizedPnL,
  realizedPnL30D,
  isLoadingRealizedPnL,
  balanceQuery,
  accountBalance,
}: PerpsBalanceWidgetProps) => {
  const { address } = useAccount();
  const depositModal = useModal();
  const withdrawalModal = useModal();

  const initialMarginQuery = useGetPerpsInitialMargin(address, {
    enabled: withdrawalModal.isOpen,
  });
  const initialMargin =
    initialMarginQuery.data !== undefined ? (initialMarginQuery.data as bigint) : null;
  const isLoadingInitialMargin = initialMarginQuery.isLoading && withdrawalModal.isOpen;
  const isInitialMarginError = initialMarginQuery.isError;

  const handleDepositSuccess = () => {
    balanceQuery.refetch();
    depositModal.close();
  };

  const handleWithdrawalSuccess = () => {
    balanceQuery.refetch();
    withdrawalModal.close();
  };

  const isLoading = balanceQuery.isLoading;
  const isSuccess = !!(balanceQuery.isSuccess && address);
  const balanceValue = formatValue(balanceQuery.data ?? 0n, paymentToken);
  const lockedBalanceValue = formatValue(minMargin ?? 0n, paymentToken);
  const unrealizedPnLValue = formatValue(unrealizedPnL ?? 0n, paymentToken);
  const unrealizedPnlColor =
    unrealizedPnL && unrealizedPnL > 0
      ? tokens.trading.long
      : unrealizedPnL && unrealizedPnL < 0
      ? tokens.trading.short
      : tokens.text.onDark;
  const realizedPnlColor =
    realizedPnL30D && realizedPnL30D > 0
      ? tokens.trading.long
      : realizedPnL30D && realizedPnL30D < 0
      ? tokens.trading.short
      : tokens.text.onDark;
  const realizedPnL30DFormatted = realizedPnL30D !== null ? (realizedPnL30D / PAYMENT_TOKEN_SCALE_NUM).toFixed(2) : "-";

  // Check if locked amount is at or above threshold percentage of balance
  const lockedBalanceThreshold = Number(
    process.env.REACT_APP_MARGIN_UTILIZATION_WARNING_PERCENT || "80",
  );
  const shouldHighlight = useMemo(() => {
    if (!balanceQuery.data || !minMargin || balanceQuery.data === 0n) return false;
    const lockedAmount = minMargin > 0n ? minMargin : -minMargin; // Use absolute value
    const lockedPercentage = (Number(lockedAmount) / Number(balanceQuery.data)) * 100;
    return lockedPercentage >= lockedBalanceThreshold;
  }, [balanceQuery.data, minMargin, lockedBalanceThreshold]);

  return (
    <>
      <BalanceWidgetContainer
        className="lg:w-[60%]"
        $shouldHighlight={shouldHighlight}
        $centerContent={!address}
      >
        {address && (
          <div className="flex items-center justify-center" style={{ fontSize: "0.75rem" }}>
            <UsdcIcon style={{ width: "18px", marginRight: "6px" }} />
            <span>Perpetuals Portfolio Overview (USDC)</span>
          </div>
        )}
        <BalanceContainer $shouldHighlight={shouldHighlight}>
          {!address && <div>Connect wallet to view balance and use marketplace</div>}
          {isLoading && address && <Spinner fontSize="0.3em" />}
          {isSuccess && address && (
            <BalanceRow>
              <MetricsGrid>
                {/* Row 1: Balance | Unrealized PnL */}
                <MetricCell>
                  <MetricLabel>Balance</MetricLabel>
                  <MetricValue>{Number(balanceValue?.valueRounded).toFixed(2)}</MetricValue>
                </MetricCell>
                <MetricCell>
                  <MetricLabel>Unrealized PnL</MetricLabel>
                  <MetricValue style={{ color: unrealizedPnlColor }}>
                    {unrealizedPnL !== null
                      ? Number(unrealizedPnLValue.valueRounded).toFixed(2)
                      : "-"}
                  </MetricValue>
                </MetricCell>
                {/* Row 2: Locked | Realized PnL (30D) */}
                <MetricCell>
                  <MetricLabel>Locked</MetricLabel>
                  <MetricValue>
                    {isLoadingMinMargin ? (
                      <Spinner fontSize="0.2em" />
                    ) : (
                      Number(lockedBalanceValue.valueRounded).toFixed(2)
                    )}
                  </MetricValue>
                </MetricCell>
                <MetricCell>
                  <MetricLabel>Realized PnL (30D)</MetricLabel>
                  <MetricValue style={{ color: realizedPnlColor }}>
                    {isLoadingRealizedPnL ? <Spinner fontSize="0.2em" /> : realizedPnL30DFormatted}
                  </MetricValue>
                </MetricCell>
              </MetricsGrid>
              <ActionButtons>
                <PrimaryButton onClick={depositModal.open}>Deposit</PrimaryButton>
                <PrimaryButton onClick={withdrawalModal.open}>Withdraw</PrimaryButton>
              </ActionButtons>
            </BalanceRow>
          )}
        </BalanceContainer>
        {shouldHighlight && (
          <MarginCallWarning>
            ⚠️ Margin Call Warning: Add Funds to Avoid Liquidation
          </MarginCallWarning>
        )}
      </BalanceWidgetContainer>

      <ModalItem open={depositModal.isOpen} setOpen={depositModal.setOpen}>
        <DepositFormPerps closeForm={handleDepositSuccess} accountBalance={accountBalance} />
      </ModalItem>

      <ModalItem open={withdrawalModal.isOpen} setOpen={withdrawalModal.setOpen}>
        <WithdrawalFormPerps
          closeForm={handleWithdrawalSuccess}
          initialMargin={initialMargin}
          isLoadingInitialMargin={isLoadingInitialMargin}
          isInitialMarginError={isInitialMarginError}
          balanceQuery={balanceQuery}
        />
      </ModalItem>
    </>
  );
};

const BalanceContainer = styled("div")<{ $shouldHighlight: boolean }>`
  // padding: ${(props) => (props.$shouldHighlight ? "1rem 0 0 0" : "1rem 0")};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  gap: 1rem;
`;

const BalanceRow = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 1rem;

  @media (max-width: 768px) {
    flex-direction: column;
    gap: 0.75rem;
  }
`;

const MetricsGrid = styled("div")`
  display: grid;
  grid-template-columns: 1fr 1fr;
  // gap: 0.5rem 1.5rem; // Gaps betwen rows
  flex: 1;

  @media (max-width: 1200px) {
    gap: 0.4rem 1rem;
  }

  @media (max-width: 768px) {
    width: 100%;
    gap: 0.5rem 1rem;
  }
`;

const MetricCell = styled("div")`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;

  @media (max-width: 768px) {
    align-items: center;
  }
`;

const MetricLabel = styled("span")`
  font-size: 0.65rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.02em;
  white-space: nowrap;
`;

const MetricValue = styled("span")`
  font-size: 1.25rem;
  font-weight: 600;
  color: ${tokens.text.onDark};
  line-height: 1.2;

  @media (max-width: 1200px) {
    font-size: 1.1rem;
  }

  @media (max-width: 768px) {
    font-size: 1.2rem;
  }
`;

const ActionButtons = styled("div")`
  display: flex;
  gap: 0.75rem;
  flex-shrink: 0;

  button {
    padding: 0.75rem 1rem;
    font-size: 0.9rem;
    min-width: 80px;
  }

  @media (max-width: 768px) {
    width: 100%;
    justify-content: center;

    button {
      flex: 1;
      max-width: 120px;
    }
  }

  @media (min-width: 769px) and (max-width: 1562px) {
    flex-direction: column;

    button {
      width: 100%;
    }
  }
`;

const BalanceWidgetContainer = styled(SmallWidget)<{
  $shouldHighlight: boolean;
  $centerContent: boolean;
}>`
  border: ${(props) =>
    props.$shouldHighlight ? `2px solid ${tokens.trading.highlight}` : `${tokens.border.default} 1px solid`};
  background: ${(props) =>
    props.$shouldHighlight ? tokens.perps.yellowRadial : tokens.card.radialGradient};
  transition: border-color 0.3s ease;
  justify-content: ${(props) => (props.$centerContent ? "center" : "space-between")};
  align-items: ${(props) => (props.$centerContent ? "center" : "stretch")};
`;

const MarginCallWarning = styled("div")`
  padding: 0.2rem;
  background-color: ${tokens.perps.highlightBg};
  border: 1px solid ${tokens.perps.highlightBorderSoft};
  border-radius: 6px;
  color: ${tokens.trading.highlight};
  font-size: 0.875rem;
  font-weight: 600;
  text-align: center;
  width: 100%;
`;
