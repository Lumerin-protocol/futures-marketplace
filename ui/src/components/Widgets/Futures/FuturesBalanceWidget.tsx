import styled from "@mui/material/styles/styled";
import { useAccount } from "wagmi";
import { useMemo } from "react";
import { useLmrBalanceValidation } from "../../../hooks/data/useLmrBalanceValidation";
import { useModal } from "../../../hooks/useModal";
import { Spinner } from "../../Spinner.styled";
import { formatValue, paymentToken } from "../../../lib/units";
import { UsdcIcon } from "../../../images";
import { PrimaryButton } from "../../Forms/FormButtons/Buttons.styled";
import { ModalItem } from "../../Modal";
import { DepositForm } from "../../Forms/DepositForm";
import { WithdrawalForm } from "../../Forms/WithdrawalForm";
import { WithdrawalFormPerps } from "../../Forms/WithdrawalFormPerps";
import EastIcon from "@mui/icons-material/East";
import type { ContractMode, AccountBalance } from "../../../types/types";
import { DepositFormPerps } from "../../Forms/DepositFormPerps";

interface BalanceQueryResult {
  data: bigint | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => void;
}

interface FuturesBalanceWidgetProps {
  minMargin: bigint | null;
  isLoadingMinMargin: boolean;
  unrealizedPnL: bigint | null;
  realizedPnL30D: number | null;
  isLoadingRealizedPnL?: boolean;
  contractMode?: ContractMode;
  balanceQuery: BalanceQueryResult;
  accountBalance?: AccountBalance;
}

export const FuturesBalanceWidget = ({
  minMargin,
  isLoadingMinMargin,
  unrealizedPnL,
  realizedPnL30D,
  isLoadingRealizedPnL,
  contractMode = "futures",
  balanceQuery,
  accountBalance,
}: FuturesBalanceWidgetProps) => {
  const { address } = useAccount();
  const lmrBalanceValidation = useLmrBalanceValidation(address);
  const depositModal = useModal();
  const withdrawalModal = useModal();

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
      ? "#22c55e"
      : unrealizedPnL && unrealizedPnL < 0
      ? "#ef4444"
      : "#fff";
  const realizedPnlColor =
    realizedPnL30D && realizedPnL30D > 0
      ? "#22c55e"
      : realizedPnL30D && realizedPnL30D < 0
      ? "#ef4444"
      : "#fff";
  const realizedPnL30DFormatted = realizedPnL30D !== null ? (realizedPnL30D / 1e6).toFixed(2) : "-";

  const requiredLmrAmount = 0n;
  const hasMinimumLmrBalance = lmrBalanceValidation.totalBalance >= requiredLmrAmount;
  const isLmrBalanceLoading = lmrBalanceValidation.isLoading;

  const lockedBalanceThreshold = Number(
    process.env.REACT_APP_MARGIN_UTILIZATION_WARNING_PERCENT || "80",
  );
  const shouldHighlight = useMemo(() => {
    if (!balanceQuery.data || !minMargin || balanceQuery.data === 0n) return false;
    const lockedAmount = minMargin > 0n ? minMargin : -minMargin;
    const lockedPercentage = (Number(lockedAmount) / Number(balanceQuery.data)) * 100;
    return lockedPercentage >= lockedBalanceThreshold;
  }, [balanceQuery.data, minMargin, lockedBalanceThreshold]);

  return (
    <>
      <PanelSection $shouldHighlight={shouldHighlight}>
        {/* Header row */}
        <SectionHeader>
          <UsdcIcon style={{ width: "14px", flexShrink: 0 }} />
          <SectionTitle>
            {contractMode === "perpetual" ? "Perpetual" : "Futures"} Portfolio (USDC)
          </SectionTitle>
        </SectionHeader>

        {/* Not connected */}
        {!address && (
          <DisconnectedMsg>Connect wallet to view balance</DisconnectedMsg>
        )}

        {/* Loading */}
        {isLoading && address && <Spinner fontSize="0.3em" />}

        {/* Insufficient LMR */}
        {isSuccess && address && !hasMinimumLmrBalance && (
          <div style={{ fontSize: "0.75rem", color: "#a7a9b6" }}>
            {isLmrBalanceLoading
              ? "Checking LMR balance..."
              : `⚠ Insufficient LMR balance (${lmrBalanceValidation.totalBalance.toString()} LMR)`}
            <br />
            <a href={process.env.REACT_APP_BUY_LMR_URL} target="_blank" rel="noreferrer" style={{ color: "#22c55e" }}>
              Buy LMR on Uniswap <EastIcon style={{ fontSize: "0.65rem" }} />
            </a>
          </div>
        )}

        {/* Main metrics */}
        {isSuccess && address && hasMinimumLmrBalance && (
          <>
            <MetricsGrid>
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
              <ActionButton
                onClick={depositModal.open}
                disabled={!hasMinimumLmrBalance || isLmrBalanceLoading}
              >
                Deposit
              </ActionButton>
              <ActionButton
                onClick={withdrawalModal.open}
                disabled={!hasMinimumLmrBalance || isLmrBalanceLoading}
              >
                Withdraw
              </ActionButton>
            </ActionButtons>
          </>
        )}

        {shouldHighlight && (
          <MarginCallWarning>
            ⚠️ Margin Call Warning: Add Funds to Avoid Liquidation
          </MarginCallWarning>
        )}
      </PanelSection>

      <ModalItem open={depositModal.isOpen} setOpen={depositModal.setOpen}>
        {contractMode === "futures" && (
          <DepositForm
            closeForm={handleDepositSuccess}
            accountBalance={accountBalance}
            contractMode={contractMode}
          />
        )}
        {contractMode === "perpetual" && (
          <DepositFormPerps closeForm={handleDepositSuccess} accountBalance={accountBalance} />
        )}
      </ModalItem>

      <ModalItem open={withdrawalModal.isOpen} setOpen={withdrawalModal.setOpen}>
        {contractMode === "perpetual" ? (
          <WithdrawalFormPerps
            closeForm={handleWithdrawalSuccess}
            minMargin={minMargin}
            isLoadingMinMargin={isLoadingMinMargin}
            balanceQuery={balanceQuery}
          />
        ) : (
          <WithdrawalForm
            closeForm={handleWithdrawalSuccess}
            minMargin={minMargin}
            isLoadingMinMargin={isLoadingMinMargin}
            balanceQuery={balanceQuery}
          />
        )}
      </ModalItem>
    </>
  );
};

// Replaces SmallWidget — renders as a flat panel section (no outer border/card)
const PanelSection = styled("div")<{ $shouldHighlight: boolean }>`
  padding: 0.875rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  background: ${(props) =>
    props.$shouldHighlight
      ? "radial-gradient(circle, rgba(0,0,0,0) 36%, rgba(255,255,0,0.05) 100%)"
      : "transparent"};
  border-left: ${(props) => (props.$shouldHighlight ? "2px solid #fbbf24" : "none")} !important;
`;

const SectionHeader = styled("div")`
  display: flex;
  align-items: center;
  gap: 0.4rem;
`;

const SectionTitle = styled("span")`
  font-size: 0.7rem;
  font-weight: 500;
  color: #a7a9b6;
  text-transform: uppercase;
  letter-spacing: 0.03em;
`;

const DisconnectedMsg = styled("div")`
  font-size: 0.75rem;
  color: #a7a9b6;
  text-align: center;
  padding: 0.5rem 0;
`;

const MetricsGrid = styled("div")`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem 0.75rem;
`;

const MetricCell = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
`;

const MetricLabel = styled("span")`
  font-size: 0.6rem;
  font-weight: 500;
  color: #a7a9b6;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  white-space: nowrap;
`;

const MetricValue = styled("span")`
  font-size: 0.95rem;
  font-weight: 600;
  color: #fff;
  line-height: 1.2;
`;

const ActionButtons = styled("div")`
  display: flex;
  gap: 0.5rem;
`;

const ActionButton = styled(PrimaryButton)`
  flex: 1;
  padding: 0.45rem 0.5rem;
  font-size: 0.8rem;
  min-width: 0;
`;

const MarginCallWarning = styled("div")`
  padding: 0.35rem 0.5rem;
  background-color: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 6px;
  color: #fbbf24;
  font-size: 0.75rem;
  font-weight: 600;
  text-align: center;
`;
