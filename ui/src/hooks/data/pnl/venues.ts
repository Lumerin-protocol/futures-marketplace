import { QUANTITY_SCALE } from "../../../lib/units";
import {
  fetchFuturesOpenExposure,
  fetchPerpsOpenExposure,
  type FetchOpenExposure,
} from "./exposure";

/**
 * The venues the account's PnL is summed over.
 *
 * The portfolio header is venue-agnostic by construction: it walks this list
 * rather than branching on whichever tab is open, so a new product (options,
 * say) shows up in the header as soon as it has an entry here and a reader in
 * `exposure.ts` — no changes to the widget or the page.
 */

/** Ids match `ContractMode` for the two venues that have a trading tab today. */
export type PnlVenueId = "futures" | "perpetual";

export interface PnlVenue {
  id: PnlVenueId;
  label: string;
  /** Undefined when the venue's subgraph is not configured for this environment. */
  subgraphUrl?: string;
  /**
   * On-chain quantity scale: futures contracts are indivisible (`quantityDecimals`
   * 0), perps quantities carry 6 decimals.
   */
  quantityScale: bigint;
  fetchOpenExposure: FetchOpenExposure;
}

export type ConfiguredPnlVenue = PnlVenue & { subgraphUrl: string };

const VENUES: PnlVenue[] = [
  {
    id: "futures",
    label: "Futures",
    subgraphUrl: process.env.REACT_APP_SUBGRAPH_FUTURES_URL,
    quantityScale: 1n,
    fetchOpenExposure: fetchFuturesOpenExposure,
  },
  {
    id: "perpetual",
    label: "Perpetuals",
    subgraphUrl: process.env.REACT_APP_SUBGRAPH_PERPS_URL,
    quantityScale: QUANTITY_SCALE,
    fetchOpenExposure: fetchPerpsOpenExposure,
  },
];

/**
 * Venues actually reachable here. `REACT_APP_SUBGRAPH_PERPS_URL` is optional, so
 * an environment without it contributes nothing instead of failing every read.
 */
export const PNL_VENUES: readonly ConfiguredPnlVenue[] = VENUES.filter(
  (venue): venue is ConfiguredPnlVenue => !!venue.subgraphUrl,
);
