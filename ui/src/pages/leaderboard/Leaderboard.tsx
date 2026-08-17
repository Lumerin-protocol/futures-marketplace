import { type FC, useMemo } from "react";
import { useAccount } from "wagmi";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import styled from "@mui/material/styles/styled";
import { tokens } from "../../styles/tokens";
import { SmallWidget } from "../../components/Cards/Cards.styled";
import { truncateAddress } from "../../utils/formatters";
import { getTxUrl } from "../../lib/indexer";
import { AddressLength } from "../../types/types";
import { usePointsHookWeights } from "../../hooks/data/usePointsHookWeights";
import { PAYMENT_TOKEN_SCALE_NUM } from "../../lib/units";
import {
  usePointsLeaderboard,
  useUserPoints,
  useUserPointsMints,
} from "../../hooks/data/usePointsLeaderboard";

// Points are stored on-chain scaled by the payment-token decimals (the same
// scale `PlaceOrderForm` divides by), so collapse them into human units before
// rendering with two decimals — e.g. 23,520,000 -> "23.52".
const formatPoints = (points: bigint) =>
  (Number(points) / PAYMENT_TOKEN_SCALE_NUM).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// The same address-derived gradient avatar AppKit/WalletConnect renders. The
// `wui-avatar` custom element is registered globally by AppKit.
const WalletAvatar = ({ address }: { address: string }) => (
  // @ts-ignore - `wui-avatar` is an AppKit web component, not in JSX types.
  <wui-avatar alt={address} address={address} size="sm" />
);

// Points per 1 USDC of trade size, i.e. weight / WEIGHT_SCALE. This collapses
// the raw fixed-point weights (which carry a lot of trailing zeros) into a
// readable multiplier.
const formatRate = (weight?: bigint, scale?: bigint) => {
  if (weight === undefined || scale === undefined || scale === 0n) {
    return "—";
  }
  const rate = Number(weight) / Number(scale);
  return rate.toLocaleString("en-US", { maximumFractionDigits: 4 });
};

export const Leaderboard: FC = () => {
  const { address, isConnected } = useAccount();
  const isMobile = useMediaQuery("(max-width: 600px)", { noSsr: true });
  const { wMaker, wTaker, weightScale } = usePointsHookWeights();

  const { data: rawLeaderboard = [], isLoading: isLeaderboardLoading } = usePointsLeaderboard(20);
  const { data: userPoints, isLoading: isUserPointsLoading } = useUserPoints(address);
  const { data: pointsMints = [], isLoading: isMintsLoading } = useUserPointsMints(address);

  // Exclude the market maker wallet from the leaderboard (case-insensitive).
  const leaderboard = useMemo(() => {
    const marketMaker = process.env.REACT_APP_MARKET_MAKER_ADDRESS?.toLowerCase();
    if (!marketMaker) return rawLeaderboard;
    return rawLeaderboard.filter((entry) => entry.address.toLowerCase() !== marketMaker);
  }, [rawLeaderboard]);

  // Rank is derived client-side from the top-20 ordering (the schema has no
  // stored rank). Wallets outside the top 20 are shown as "Unranked".
  const userRank = useMemo(() => {
    if (!address) return undefined;
    const index = leaderboard.findIndex(
      (entry) => entry.address.toLowerCase() === address.toLowerCase(),
    );
    return index >= 0 ? index + 1 : undefined;
  }, [address, leaderboard]);

  return (
    <PageContainer>
      {/* <PageHeader>
        <PageTitle>Leaderboard</PageTitle>
        <PageSubtitle>Earn points for trading on HPDX and climb the ranks.</PageSubtitle>
      </PageHeader> */}

      <ScoreWidget>
        <SectionTitle>Your Score</SectionTitle>
        {!isConnected ? (
          <EmptyState>Connect your wallet to see your score and rank.</EmptyState>
        ) : isUserPointsLoading ? (
          <EmptyState>Loading your score…</EmptyState>
        ) : (
          <ScoreContent>
            <ScoreBlock>
              <ScoreLabel>Wallet</ScoreLabel>
              <Tooltip title={address ?? ""}>
                <ScoreValue>{truncateAddress(address ?? "", AddressLength.MEDIUM)}</ScoreValue>
              </Tooltip>
            </ScoreBlock>
            <ScoreDivider />
            <ScoreBlock>
              <ScoreLabel>Points</ScoreLabel>
              <ScoreValue $highlight>{formatPoints(userPoints?.total ?? 0n)}</ScoreValue>
            </ScoreBlock>
            <ScoreDivider />
            <ScoreBlock>
              <ScoreLabel>Rank</ScoreLabel>
              <ScoreValue>{userRank !== undefined ? `#${userRank}` : "Unranked"}</ScoreValue>
            </ScoreBlock>
          </ScoreContent>
        )}
      </ScoreWidget>

      <ContentGrid>
        <TableWidget>
          <SectionTitle>Top 20 Traders</SectionTitle>
          <TableContainer>
            <Table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Wallet</th>
                  <th>Transactions</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {isLeaderboardLoading ? (
                  <tr>
                    <EmptyCell colSpan={4}>Loading leaderboard…</EmptyCell>
                  </tr>
                ) : leaderboard.length === 0 ? (
                  <tr>
                    <EmptyCell colSpan={4}>No traders have earned points yet.</EmptyCell>
                  </tr>
                ) : (
                  leaderboard.map((entry, index) => {
                    const rank = index + 1;
                    const isCurrentUser =
                      !!address && entry.address.toLowerCase() === address.toLowerCase();
                    return (
                      <TableRow key={entry.id} $highlight={isCurrentUser}>
                        <td>
                          <RankBadge $rank={rank}>#{rank}</RankBadge>
                        </td>
                        <td>
                          <Tooltip title={entry.address}>
                            <WalletCell>
                              {!isMobile && <WalletAvatar address={entry.address} />}
                              {truncateAddress(
                                entry.address,
                                isMobile ? AddressLength.SHORT : AddressLength.LONG,
                              )}
                              {isCurrentUser && <YouTag>You</YouTag>}
                            </WalletCell>
                          </Tooltip>
                        </td>
                        <td>{entry.mintCount.toLocaleString("en-US")}</td>
                        <td>
                          <Points>{formatPoints(entry.total)}</Points>
                        </td>
                      </TableRow>
                    );
                  })
                )}
              </tbody>
            </Table>
          </TableContainer>
        </TableWidget>

        <SideColumn>
          <RulesWidget>
            <SectionTitle>How To Earn Points</SectionTitle>
            <RulesList>
              <RuleItem>
                <RuleHeader>
                  <RuleAction>Trade rewards</RuleAction>
                </RuleHeader>
                <RuleDescription>
                  Earn points based on the size (USDC notional) of your trades. Points are only credited
                  once your order is matched and becomes a position — resting or unmatched orders don't
                  earn anything.
                </RuleDescription>
                <RateList>
                  <RateRow>
                    <RateLabel>Maker fills</RateLabel>
                    <RatePoints>{formatRate(wMaker, weightScale)} pts / USDC</RatePoints>
                  </RateRow>
                  <RateRow>
                    <RateLabel>Taker fills</RateLabel>
                    <RatePoints>{formatRate(wTaker, weightScale)} pts / USDC</RatePoints>
                  </RateRow>
                </RateList>
              </RuleItem>
            </RulesList>
          </RulesWidget>

          <LogsWidget>
            <SectionTitle>Logs</SectionTitle>
            <TableContainer>
              <Table>
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {!isConnected ? (
                    <tr>
                      <EmptyCell colSpan={2}>Connect your wallet to see your logs.</EmptyCell>
                    </tr>
                  ) : isMintsLoading ? (
                    <tr>
                      <EmptyCell colSpan={2}>Loading logs…</EmptyCell>
                    </tr>
                  ) : pointsMints.length === 0 ? (
                    <tr>
                      <EmptyCell colSpan={2}>No points earned yet.</EmptyCell>
                    </tr>
                  ) : (
                    pointsMints.map((mint) => (
                      <TableRow key={mint.id}>
                        <td>
                          <Tooltip title={mint.transactionHash}>
                            <TxHashLink
                              href={getTxUrl(mint.transactionHash as `0x${string}`)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {truncateAddress(mint.transactionHash, AddressLength.MEDIUM)}
                            </TxHashLink>
                          </Tooltip>
                        </td>
                        <td>
                          <Points>+{formatPoints(mint.amount)}</Points>
                        </td>
                      </TableRow>
                    ))
                  )}
                </tbody>
              </Table>
            </TableContainer>
          </LogsWidget>
        </SideColumn>
      </ContentGrid>
    </PageContainer>
  );
};

const PageContainer = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  margin-top: 10px;
`;

const _PageHeader = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const _PageTitle = styled("h1")`
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
  color: ${tokens.text.onDark};
`;

const _PageSubtitle = styled("p")`
  margin: 0;
  font-size: 0.9rem;
  color: ${tokens.text.secondary};
`;

const SectionTitle = styled("span")`
  font-size: 0.7rem;
  font-weight: 600;
  color: ${tokens.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const ScoreWidget = styled(SmallWidget)`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
`;

const ScoreContent = styled("div")`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1.5rem;

  @media (max-width: 600px) {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }
`;

const ScoreBlock = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 90px;

  @media (max-width: 600px) {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    gap: 1rem;
  }
`;

const ScoreDivider = styled("div")`
  width: 1px;
  align-self: stretch;
  background: ${tokens.border.default};

  @media (max-width: 600px) {
    width: 100%;
    height: 1px;
    align-self: auto;
  }
`;

const ScoreLabel = styled("span")`
  font-size: 0.7rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: ${tokens.text.muted};
`;

const ScoreValue = styled("span")<{ $highlight?: boolean }>`
  font-size: 1.35rem;
  font-weight: 700;
  color: ${(props) => (props.$highlight ? tokens.trading.profit : tokens.text.onDark)};
`;

const ContentGrid = styled("div")`
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const TableWidget = styled(SmallWidget)`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
`;

const TableContainer = styled("div")`
  width: 100%;
  overflow-x: auto;

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

  @media (max-width: 600px) {
    overflow-x: hidden;
  }
`;

const Table = styled("table")`
  width: 100%;
  border-collapse: collapse;
  min-width: 400px;

  th {
    text-align: left;
    padding: 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: ${tokens.text.secondary};
    border-bottom: 1px solid ${tokens.overlay.white10};
    white-space: nowrap;
  }

  th:last-child,
  td:last-child {
    text-align: right;
  }

  td {
    padding: 0.75rem 0.5rem;
    font-size: 0.875rem;
    color: ${tokens.text.onDark};
    border-bottom: 1px solid ${tokens.overlay.white05};
  }

  @media (max-width: 600px) {
    min-width: 0;

    th,
    td {
      padding: 0.5rem 0.35rem;
      font-size: 0.75rem;
    }
  }
`;

const TableRow = styled("tr")<{ $highlight?: boolean }>`
  background-color: ${(props) => (props.$highlight ? tokens.trading.infoRowBg : "transparent")};

  &:hover {
    background-color: ${(props) => (props.$highlight ? tokens.trading.infoRowBg : tokens.overlay.white02)};
  }

  &:last-child td {
    border-bottom: none;
  }
`;

const RankBadge = styled("span")<{ $rank: number }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  padding: 0.2rem 0.45rem;
  border-radius: ${tokens.radius.sm};
  font-size: 0.8rem;
  font-weight: 700;
  color: ${(props) => (props.$rank <= 3 ? tokens.brand.dark : tokens.text.onDark)};
  background-color: ${(props) => {
    switch (props.$rank) {
      case 1:
        return tokens.brand.orange;
      case 2:
        return tokens.neutral[400];
      case 3:
        return tokens.brand.orangeDark;
      default:
        return tokens.overlay.white05;
    }
  }};

  @media (max-width: 600px) {
    min-width: 26px;
    padding: 0.15rem 0.3rem;
  }
`;

const WalletCell = styled("span")`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  white-space: nowrap;
  cursor: default;

  wui-avatar {
    width: 22px !important;
    height: 22px !important;
    margin-right: 0.25rem;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: none !important;
    filter: none !important;
    --wui-box-shadow: none;
  }

  @media (max-width: 600px) {
    gap: 0.3rem;
  }
`;

const YouTag = styled("span")`
  padding: 0.1rem 0.4rem;
  border-radius: ${tokens.radius.sm};
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${tokens.trading.info};
  background-color: ${tokens.trading.infoRowBg};
`;

const Points = styled("span")`
  font-weight: 700;
  color: ${tokens.trading.profit};
`;

const SideColumn = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const RulesWidget = styled(SmallWidget)`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
`;

const LogsWidget = styled(SmallWidget)`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
`;

const TxHashLink = styled("a")`
  font-family: "Inter", monospace;
  color: ${tokens.trading.info};
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const RulesList = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const RuleItem = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 1px solid ${tokens.border.muted04};
  border-radius: ${tokens.radius.md};
  background-color: ${tokens.overlay.white02};
`;

const RuleHeader = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
`;

const RuleAction = styled("span")`
  font-size: 0.9rem;
  font-weight: 600;
  color: ${tokens.text.onDark};
`;

const RateList = styled("div")`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.25rem;
`;

const RateRow = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  border-radius: ${tokens.radius.sm};
  background-color: ${tokens.overlay.white02};
`;

const RateLabel = styled("span")`
  font-size: 0.8rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
`;

const RatePoints = styled("span")`
  font-size: 0.85rem;
  font-weight: 700;
  color: ${tokens.trading.profit};
`;

const RuleDescription = styled("span")`
  font-size: 0.8rem;
  color: ${tokens.text.secondary};
  line-height: 1.4;
`;

const EmptyState = styled("div")`
  padding: 1.5rem 0;
  text-align: center;
  color: ${tokens.text.muted};
  font-size: 0.9rem;
`;

const EmptyCell = styled("td")`
  padding: 1.5rem 0.5rem !important;
  text-align: center !important;
  color: ${tokens.text.muted};
  font-size: 0.9rem;
`;
