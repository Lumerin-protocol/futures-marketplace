import { graphqlRequest } from "../graphql";
import { FuturesOpenExposureQuery, PerpsOpenExposureQuery } from "./queries";

/**
 * Per-venue readers for the account's open exposure.
 *
 * Each venue models exposure differently — futures split it across expirations,
 * perps pre-aggregate it on `User` — so the shape of the read belongs to the
 * venue while the PnL arithmetic stays in `lib/portfolioPnl`. A new venue plugs
 * in by adding a reader here and an entry in the registry.
 *
 * Legs come back unpriced on purpose: the mark polls every 10s, and folding it
 * in here would put it in the query key and re-hit the subgraph on every tick.
 */

/** Open exposure as the subgraph reports it, before a mark is applied. */
export interface OpenPositionLeg {
  /** Signed: positive = long, negative = short. */
  netQuantity: bigint;
  entryPrice: bigint;
  /** Set once the venue pins a price for this leg, which freezes its PnL. */
  settlementPrice: bigint | null;
  quantityScale: bigint;
}

export interface ExposureContext {
  address: `0x${string}`;
  subgraphUrl: string;
  quantityScale: bigint;
}

export type FetchOpenExposure = (ctx: ExposureContext) => Promise<OpenPositionLeg[]>;

/**
 * Upper bound on concurrently open futures expirations. Far above the handful of
 * maturities the contract lists, and it keeps the read a single request.
 */
const OPEN_SESSIONS_LIMIT = 200;

interface FuturesOpenExposureResponse {
  positionSessions: {
    netQuantity: string;
    entryPrice: string;
    expiration: { settlementPrice: string | null } | null;
  }[];
}

export const fetchFuturesOpenExposure: FetchOpenExposure = async ({
  address,
  subgraphUrl,
  quantityScale,
}) => {
  const response = await graphqlRequest<FuturesOpenExposureResponse>(
    FuturesOpenExposureQuery,
    { address: address.toLowerCase(), first: OPEN_SESSIONS_LIMIT },
    subgraphUrl,
  );

  return response.positionSessions.map((session) => {
    // `expiration` is a nullable add-on, and its settlement price stays null
    // until SettlementPriceRecorded fires for that maturity.
    const settlementPrice = session.expiration?.settlementPrice ?? null;
    return {
      netQuantity: BigInt(session.netQuantity),
      entryPrice: BigInt(session.entryPrice),
      settlementPrice: settlementPrice !== null ? BigInt(settlementPrice) : null,
      quantityScale,
    };
  });
};

interface PerpsOpenExposureResponse {
  user: { netQuantity: string; aggregatedEntryPrice: string } | null;
}

export const fetchPerpsOpenExposure: FetchOpenExposure = async ({
  address,
  subgraphUrl,
  quantityScale,
}) => {
  const response = await graphqlRequest<PerpsOpenExposureResponse>(
    PerpsOpenExposureQuery,
    { address: address.toLowerCase() },
    subgraphUrl,
  );

  // Null for an account that has never traded perps; `netQuantity` goes back to
  // zero once it closes out. Either way there is nothing to mark.
  if (!response.user) return [];

  return [
    {
      netQuantity: BigInt(response.user.netQuantity),
      entryPrice: BigInt(response.user.aggregatedEntryPrice),
      // Perps never settle, so the leg always marks against the live price.
      settlementPrice: null,
      quantityScale,
    },
  ];
};
