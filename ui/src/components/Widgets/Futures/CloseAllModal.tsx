import { tokens } from "../../../styles/tokens";
import { useState, useMemo, useCallback } from "react";
import styled from "@mui/material/styles/styled";
import Modal from "@mui/material/Modal";
import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import { ModalCard } from "../../Modal.styled";
import { ModalActions, ModalCancelButton, ModalConfirmButton } from "./PerpsOrderFormFields";
import type { PositionSession } from "../../../hooks/data/perps/useUserPositionSessions";
import { readContract } from "@wagmi/core";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { useConfig } from "wagmi";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../../lib/units";
import { withErrors } from "../../../lib/withErrors";

interface SimulationResult {
  sessionId: string;
  side: string;
  size: bigint;
  filledQuantity: bigint;
  averageFillPrice: bigint;
  remainingQuantity: bigint;
}

interface CloseAllModalProps {
  open: boolean;
  onClose: () => void;
  positionSessions: PositionSession[];
  marketPrice?: bigint;
  onCloseAll?: () => void;
}

export const CloseAllModal = ({ open, onClose, positionSessions, marketPrice, onCloseAll }: CloseAllModalProps) => {
  const [simResults, setSimResults] = useState<SimulationResult[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const config = useConfig();

  const openPositions = useMemo(
    () => positionSessions.filter((s) => s.status === "OPEN"),
    [positionSessions],
  );

  const totalSize = useMemo(() => {
    return openPositions.reduce((sum, s) => {
      const qty = s.netQuantity < 0n ? -s.netQuantity : s.netQuantity;
      return sum + qty;
    }, 0n);
  }, [openPositions]);

  const formatPrice = (price: bigint) => (Number(price) / PAYMENT_TOKEN_SCALE_NUM).toFixed(2);
  const formatQuantity = (qty: bigint) => {
    const abs = qty < 0n ? -qty : qty;
    return (Number(abs) / PAYMENT_TOKEN_SCALE_NUM).toFixed(6);
  };

  const handleConfirm = useCallback(async () => {
    setIsSimulating(true);
    setSimError(null);
    setSimResults([]);

    try {
      const results: SimulationResult[] = [];

      for (const session of openPositions) {
        const netQty = session.netQuantity;
        if (netQty === 0n) continue;

        const closeQuantity = -netQty;
        const closePrice = closeQuantity > 0n
          ? BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")
          : 0n;

        const result = await readContract(config, {
          address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
          abi: withErrors(HashPowerPerpsDEXAbi),
          functionName: "simulateOrder",
          args: [closePrice, closeQuantity],
        });

        const [filledQuantity, averageFillPrice, remainingQuantity] = result as [bigint, bigint, bigint];

        results.push({
          sessionId: session.id,
          side: netQty > 0n ? "Long" : "Short",
          size: netQty < 0n ? -netQty : netQty,
          filledQuantity,
          averageFillPrice,
          remainingQuantity,
        });
      }

      setSimResults(results);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setIsSimulating(false);
    }
  }, [openPositions, config]);

  const handleClose = () => {
    setSimResults([]);
    setSimError(null);
    setIsSimulating(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <CloseAllModalCard>
        <IconButton
          className="close"
          sx={{ color: "white" }}
          onClick={handleClose}
        >
          <CloseIcon />
        </IconButton>

        <h2>Close All Positions</h2>

        {simResults.length === 0 ? (
          <>
            <Description>
              This will attempt to close all open positions at market price.
            </Description>

            <Summary>
              <SummaryRow>
                <SummaryLabel>Open Positions</SummaryLabel>
                <SummaryValue>{openPositions.length}</SummaryValue>
              </SummaryRow>
              <SummaryRow>
                <SummaryLabel>Total Size</SummaryLabel>
                <SummaryValue>{formatQuantity(totalSize)}</SummaryValue>
              </SummaryRow>
              {marketPrice !== undefined ? (
                <SummaryRow>
                  <SummaryLabel>Current Market Price</SummaryLabel>
                  <SummaryValue>{formatPrice(marketPrice)} USDC</SummaryValue>
                </SummaryRow>
              ) : null}
            </Summary>

            {simError && <ErrorText>{simError}</ErrorText>}

            <ModalActions>
              <ModalCancelButton onClick={handleClose}>Cancel</ModalCancelButton>
              <ModalConfirmButton onClick={handleConfirm} disabled={isSimulating || openPositions.length === 0}>
                {isSimulating ? "Simulating..." : "Confirm"}
              </ModalConfirmButton>
            </ModalActions>
          </>
        ) : (
          <>
            <Description>
              Simulation results for closing all positions at market price:
            </Description>

            <SimResultsContainer>
              <Table>
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Position Size</th>
                    <th>Filled Quantity</th>
                    <th>Avg Fill Price (USDC)</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {simResults.map((r) => (
                    <ResultRow key={r.sessionId}>
                      <td>
                        <TypeBadge $type={r.side}>
                          {r.side}
                        </TypeBadge>
                      </td>
                      <td>{formatQuantity(r.size)}</td>
                      <td>{formatQuantity(r.filledQuantity)}</td>
                      <td>{formatPrice(r.averageFillPrice)}</td>
                      <td>{formatQuantity(r.remainingQuantity)}</td>
                    </ResultRow>
                  ))}
                </tbody>
              </Table>
            </SimResultsContainer>

            <ModalActions>
              <ModalCancelButton onClick={handleClose}>Close</ModalCancelButton>
            </ModalActions>
          </>
        )}
      </CloseAllModalCard>
    </Modal>
  );
};

const CloseAllModalCard = styled(ModalCard)`
  max-width: 700px;

  h2 {
    font-size: 1.5rem;
    font-weight: 500;
    padding-bottom: 0.5rem;
    margin-bottom: 0.5rem;
  }
`;

const Description = styled("p")`
  color: ${tokens.text.secondary};
  font-size: 0.875rem;
  margin: 0 0 1.25rem 0;
`;

const Summary = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: ${tokens.overlay.white05};
  border-radius: 8px;
  margin-bottom: 1.25rem;
`;

const SummaryRow = styled("div")`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SummaryLabel = styled("span")`
  color: ${tokens.text.secondary};
  font-size: 0.875rem;
`;

const SummaryValue = styled("span")`
  color: ${tokens.text.onDark};
  font-size: 0.875rem;
  font-weight: 600;
`;

const ErrorText = styled("p")`
  color: ${tokens.trading.short};
  font-size: 0.8125rem;
  margin: 0 0 1rem 0;
`;


const SimResultsContainer = styled("div")`
  width: 100%;
  overflow-x: auto;
  margin-top: 0.5rem;

  &::-webkit-scrollbar {
    height: 4px;
  }

  &::-webkit-scrollbar-track {
    background: ${tokens.overlay.white10};
    border-radius: 2px;
  }

  &::-webkit-scrollbar-thumb {
    background: ${tokens.overlay.white30};
    border-radius: 2px;
  }
`;

const Table = styled("table")`
  width: 100%;
  border-collapse: collapse;

  th {
    text-align: left;
    padding: 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    border-bottom: 1px solid ${tokens.overlay.white10};
    white-space: nowrap;
  }

  td {
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
    color: ${tokens.text.onDark};
    border-bottom: 1px solid ${tokens.overlay.white05};
  }
`;

const ResultRow = styled("tr")`
  &:hover {
    background-color: ${tokens.overlay.white02};
  }

  &:last-child td {
    border-bottom: none;
  }
`;

const TypeBadge = styled("span")<{ $type: string }>`
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background-color: ${(props) => (props.$type === "Long" ? tokens.trading.longRowBg : tokens.trading.shortRowBg)};
  color: ${(props) => (props.$type === "Long" ? tokens.trading.long : tokens.trading.short)};
`;
