import { graphqlRequest } from "../graphql";
import { FuturesOpenExposureQuery } from "../queries/futures";
import { PerpsOpenExposureQuery } from "../queries/perps";

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

export interface FuturesExposureRow {
  netQuantity: string;
  entryPrice: string;
  expiration: { settlementPrice: string | null } | null;
}

interface FuturesOpenExposureResponse {
  exposure: FuturesExposureRow[];
}

/// Fed by the `exposure` slice, whether it arrived batched into a venue tick or
/// through the standalone document built from that same slice.
export const mapFuturesExposure = (
  sessions: FuturesExposureRow[],
  quantityScale: bigint,
): OpenPositionLeg[] =>
  sessions.map((session) => {
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

export const fetchFuturesOpenExposure: FetchOpenExposure = async ({
  address,
  subgraphUrl,
  quantityScale,
}) => {
  const response = await graphqlRequest<FuturesOpenExposureResponse>(
    FuturesOpenExposureQuery,
    { address: address.toLowerCase(), exposureFirst: OPEN_SESSIONS_LIMIT },
    subgraphUrl,
  );

  return mapFuturesExposure(response.exposure, quantityScale);
};

export type PerpsExposureRow = { netQuantity: string; aggregatedEntryPrice: string };

interface PerpsOpenExposureResponse {
  me: PerpsExposureRow | null;
}

/// Fed by the perps `me` slice, batched or standalone.
export const mapPerpsExposure = (
  user: PerpsExposureRow | null,
  quantityScale: bigint,
): OpenPositionLeg[] => {
  // Null for an account that has never traded perps; `netQuantity` goes back to
  // zero once it closes out. Either way there is nothing to mark.
  if (!user) return [];

  return [
    {
      netQuantity: BigInt(user.netQuantity),
      entryPrice: BigInt(user.aggregatedEntryPrice),
      // Perps never settle, so the leg always marks against the live price.
      settlementPrice: null,
      quantityScale,
    },
  ];
};

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

  return mapPerpsExposure(response.me, quantityScale);
};
