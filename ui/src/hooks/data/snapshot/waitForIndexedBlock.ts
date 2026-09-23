import { gql } from "graphql-request";
import type { ContractMode } from "../../../types/types";
import { graphqlRequest } from "../graphql";

/**
 * The cheapest question the subgraph answers: how far has it indexed?
 *
 * Deliberately selects nothing else. A caller waiting on a transaction only
 * needs the head block, and pulling rows it will throw away would make each
 * poll cost a full entity read.
 */
const IndexedBlockQuery = gql`
  query IndexedBlock {
    _meta {
      block {
        number
      }
    }
  }
`;

/**
 * Base seals a block every ~2s, but indexing lag is what is actually being
 * waited on here, so poll faster than the chain to keep the confirmation step responsive.
 */

// user changed this to 2000, please keep it
export const POLL_MS = 2_000;

/** Matches the 30s ceiling the per-entity waiters this replaced used. */
const TIMEOUT_MS = 30_000;

const subgraphUrlFor = (contractMode: ContractMode) =>
  contractMode === "perpetual"
    ? process.env.REACT_APP_SUBGRAPH_PERPS_URL
    : process.env.REACT_APP_SUBGRAPH_FUTURES_URL;

/**
 * One polling loop per venue and target block, shared by every concurrent
 * caller.
 *
 * This is the point of the whole module. "Exit all" waits on one block across
 * every expiration the account holds, and used to start a separate loop for
 * each — five open expirations meant five requests a second for up to thirty
 * seconds, all asking the same question.
 */
const inFlight = new Map<string, Promise<void>>();

export const fetchIndexedBlock = async (
  contractMode: ContractMode
): Promise<number> => {
  const response = await graphqlRequest<{
    _meta: { block: { number: number } };
  }>(IndexedBlockQuery, {}, subgraphUrlFor(contractMode));
  return response._meta.block.number;
};

const pollUntilIndexed = async (
  contractMode: ContractMode,
  target: number
): Promise<void> => {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if ((await fetchIndexedBlock(contractMode)) >= target) return;
  }

  throw new Error(`Timeout waiting for block number ${target}`);
};

/**
 * Resolves once the venue's subgraph has indexed `blockNumber`.
 *
 * Call this after a transaction receipt and before invalidating any view, so
 * the refetch that follows cannot read rows from before the transaction landed.
 *
 * Reads the head block straight from the subgraph rather than from a cache
 * entry. The venue snapshots skip rewriting `blockNumber` when an entry's data
 * has not changed (see `writeIfChanged`), so a cached block number can lag the
 * indexed head and is not a sound thing to wait on.
 */
export const waitForIndexedBlock = (
  contractMode: ContractMode,
  blockNumber: bigint
): Promise<void> => {
  const target = Number(blockNumber);
  const key = `${contractMode}:${target}`;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = pollUntilIndexed(contractMode, target).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, pending);

  return pending;
};
