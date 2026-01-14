import styled from "@mui/material/styles/styled";
import { useAccount } from "wagmi";
import { useMemo } from "react";
import { useGetFutureBalance } from "../../../hooks/data/useGetFutureBalance";
import { useLmrBalanceValidation } from "../../../hooks/data/useLmrBalanceValidation";
import { useModal } from "../../../hooks/useModal";
import { SmallWidget } from "../../Cards/Cards.styled";
import { Spinner } from "../../Spinner.styled";
import { formatValue, paymentToken } from "../../../lib/units";
import { UsdcIcon } from "../../../images";
import { PrimaryButton } from "../../Forms/FormButtons/Buttons.styled";
import { ModalItem } from "../../Modal";
import { DepositForm } from "../../Forms/DepositForm";
import { WithdrawalForm } from "../../Forms/WithdrawalForm";
import EastIcon from "@mui/icons-material/East";

interface FuturesBalanceWidgetProps {
  minMargin: bigint | null;
  isLoadingMinMargin: boolean;
  unrealizedPnL: bigint | null;
  realizedPnL30D: number | null;
  isLoadingRealizedPnL?: boolean;
}

export const FuturesBalanceWidget = ({
  minMargin,
  isLoadingMinMargin,
  unrealizedPnL,
  realizedPnL30D,
  isLoadingRealizedPnL,
}: FuturesBalanceWidgetProps) => {
  const { address } = useAccount();
  const futureBalance = useGetFutureBalance(address);
  const lmrBalanceValidation = useLmrBalanceValidation(address);
  const depositModal = useModal();
  const withdrawalModal = useModal();

  const handleDepositSuccess = () => {
    futureBalance.refetch();
    depositModal.close();
  };

  const handleWithdrawalSuccess = () => {
    futureBalance.refetch();
    withdrawalModal.close();
  };

  const isLoading = futureBalance.isLoading;
  const isSuccess = !!(futureBalance.isSuccess && address);
  const balanceValue = formatValue(futureBalance.data ?? 0n, paymentToken);
  const lockedBalanceValue = formatValue(minMargin ?? 0n, paymentToken);
  const unrealizedPnLValue = formatValue(unrealizedPnL ?? 0n, paymentToken);
  const unrealizedPnlColor =
    unrealizedPnL && unrealizedPnL > 0 ? "#22c55e" : unrealizedPnL && unrealizedPnL < 0 ? "#ef4444" : "#fff";
  const realizedPnlColor =
    realizedPnL30D && realizedPnL30D > 0 ? "#22c55e" : realizedPnL30D && realizedPnL30D < 0 ? "#ef4444" : "#fff";
  const realizedPnL30DFormatted = realizedPnL30D !== null ? (realizedPnL30D / 1e6).toFixed(2) : "-";

  // Check if LMR balance meets minimum requirement
  const requiredLmrAmount = BigInt(process.env.REACT_APP_FUTURES_REQUIRED_LMR || "10000");
  const hasMinimumLmrBalance = lmrBalanceValidation.totalBalance >= requiredLmrAmount;
  const isLmrBalanceLoading = lmrBalanceValidation.isLoading;

  // Check if locked amount is at or above threshold percentage of balance
  const lockedBalanceThreshold = Number(process.env.REACT_APP_MARGIN_UTILIZATION_WARNING_PERCENT || "80");
  const shouldHighlight = useMemo(() => {
    if (!futureBalance.data || !minMargin || futureBalance.data === 0n) return false;
    const lockedAmount = minMargin > 0n ? minMargin : -minMargin; // Use absolute value
    const lockedPercentage = (Number(lockedAmount) / Number(futureBalance.data)) * 100;
    return lockedPercentage >= lockedBalanceThreshold;
  }, [futureBalance.data, minMargin, lockedBalanceThreshold]);

  return (
    <>
      <BalanceWidgetContainer className="lg:w-[60%]" $shouldHighlight={shouldHighlight} $centerContent={!address}>
        {address && (
          <div className="flex items-center justify-center" style={{ fontSize: "0.75rem" }}>
            <UsdcIcon style={{ width: "18px", marginRight: "6px" }} />
            <span>Portfolio Overview (USDC)</span>
          </div>
        )}
        <BalanceContainer $shouldHighlight={shouldHighlight}>
          {!address && <div>Connect wallet to view balance and use marketplace</div>}
          {isLoading && address && <Spinner fontSize="0.3em" />}
          {isSuccess && address && hasMinimumLmrBalance && (
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
                    {unrealizedPnL !== null ? Number(unrealizedPnLValue.valueRounded).toFixed(2) : "-"}
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
                <PrimaryButton
                  onClick={depositModal.open}
                  disabled={!hasMinimumLmrBalance || isLmrBalanceLoading}
                  title={
                    !hasMinimumLmrBalance ? `Insufficient LMR balance. Required: ${requiredLmrAmount} LMR` : undefined
                  }
                >
                  Deposit
                </PrimaryButton>
                <PrimaryButton
                  onClick={withdrawalModal.open}
                  disabled={!hasMinimumLmrBalance || isLmrBalanceLoading}
                  title={
                    !hasMinimumLmrBalance ? `Insufficient LMR balance. Required: ${requiredLmrAmount} LMR` : undefined
                  }
                >
                  Withdraw
                </PrimaryButton>
              </ActionButtons>
            </BalanceRow>
          )}
          {isSuccess && address && !hasMinimumLmrBalance && (
            <p onClick={(e) => e.preventDefault()}>
              {isLmrBalanceLoading
                ? "Checking LMR balance..."
                : hasMinimumLmrBalance
                  ? `✓ LMR balance sufficient (${lmrBalanceValidation.totalBalance.toString()} LMR)`
                  : `⚠ Insufficient LMR balance (${lmrBalanceValidation.totalBalance.toString()} LMR). Required: ${process.env.REACT_APP_FUTURES_REQUIRED_LMR} LMR (Arbitrum or Ethereum)`}
            </p>
          )}
        </BalanceContainer>
        {isSuccess && address && !hasMinimumLmrBalance && (
          <div className="link">
            <a href={process.env.REACT_APP_BUY_LMR_URL} target="_blank" rel="noreferrer">
              Buy LMR tokens on Uniswap <EastIcon style={{ fontSize: "0.75rem" }} />
            </a>
          </div>
        )}

        {shouldHighlight && (
          <MarginCallWarning>⚠️ Margin Call Warning: Add Funds to Avoid Liquidation</MarginCallWarning>
        )}

        {/* Bottom footer */}
        {!shouldHighlight && hasMinimumLmrBalance && (
          <div className="link">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
              }}
            ></a>
          </div>
        )}
      </BalanceWidgetContainer>

      <ModalItem open={depositModal.isOpen} setOpen={depositModal.setOpen}>
        <DepositForm closeForm={handleDepositSuccess} />
      </ModalItem>

      <ModalItem open={withdrawalModal.isOpen} setOpen={withdrawalModal.setOpen}>
        <WithdrawalForm
          closeForm={handleWithdrawalSuccess}
          minMargin={minMargin}
          isLoadingMinMargin={isLoadingMinMargin}
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
  color: #a7a9b6;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  white-space: nowrap;
`;

const MetricValue = styled("span")`
  font-size: 1.25rem;
  font-weight: 600;
  color: #fff;
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

const BalanceWidgetContainer = styled(SmallWidget)<{ $shouldHighlight: boolean; $centerContent: boolean }>`
  border: ${(props) => (props.$shouldHighlight ? "2px solid #fbbf24" : "rgba(171, 171, 171, 1) 1px solid")};
  background: ${(props) => (props.$shouldHighlight ? "radial-gradient(circle, rgba(0, 0, 0, 0) 36%, rgba(255, 255, 0, 0.05) 100%)" : "radial-gradient(circle, rgba(0, 0, 0, 0) 36%, rgba(255, 255, 255, 0.05) 100%)")};
  transition: border-color 0.3s ease;
  justify-content: ${(props) => (props.$centerContent ? "center" : "space-between")};
  align-items: ${(props) => (props.$centerContent ? "center" : "stretch")};
`;

const MarginCallWarning = styled("div")`
  padding: 0.2rem;
  background-color: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 6px;
  color: #fbbf24;
  font-size: 0.875rem;
  font-weight: 600;
  text-align: center;
  width: 100%;
`;
