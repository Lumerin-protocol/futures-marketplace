import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { FC, PropsWithChildren } from "react";
import { WagmiProvider } from "wagmi";
import { config } from "./clients/wagmi";

/** wagmi query-key prefixes that correspond to on-chain reads/simulations. */
const WEB3_READ_TYPES = new Set([
  "readContract",
  "readContracts",
  "simulateContract",
]);

/** Build a human-readable label (incl. the called method) for a wagmi read query. */
function describeReadQuery(queryKey: unknown): string | undefined {
  if (!Array.isArray(queryKey)) return undefined;
  const [type, params] = queryKey as [unknown, unknown];
  if (typeof type !== "string" || !WEB3_READ_TYPES.has(type)) return undefined;

  if (params && typeof params === "object") {
    const p = params as {
      functionName?: string;
      address?: string;
      contracts?: Array<{ functionName?: string }>;
    };
    if (p.functionName) {
      return `${type} ${p.functionName}()${p.address ? ` @ ${p.address}` : ""}`;
    }
    if (Array.isArray(p.contracts)) {
      const fns = p.contracts
        .map((c) => c?.functionName)
        .filter(Boolean)
        .join(", ");
      return `${type} [${fns}]`;
    }
  }
  return type;
}

/** Build a human-readable label (incl. the called method) for a wagmi write mutation. */
function describeWriteMutation(variables: unknown): string | undefined {
  if (!variables || typeof variables !== "object") return undefined;
  const v = variables as { functionName?: string; address?: string };
  // Only surface contract writes (they carry a functionName); ignore unrelated mutations.
  if (!v.functionName) return undefined;
  return `writeContract ${v.functionName}()${v.address ? ` @ ${v.address}` : ""}`;
}

const qc = new QueryClient({
  queryCache: new QueryCache({
    // Central handler for every on-chain read/simulation error. Logs the failing
    // method name plus the decoded error (custom errors are named because the ABIs
    // are merged with `contractErrors` via `withErrors`).
    onError: (error, query) => {
      const label = describeReadQuery(query.queryKey);
      if (!label) return; // ignore non-web3 queries (e.g. subgraph GraphQL)
      console.error(`[web3][read] ${label} failed:`, error);
    },
  }),
  mutationCache: new MutationCache({
    // Central handler for every on-chain write (transaction) error.
    onError: (error, variables) => {
      const label = describeWriteMutation(variables);
      if (!label) return; // ignore non-web3 mutations
      console.error(`[web3][write] ${label} failed:`, error);
    },
  }),
});

export const Web3Provider: FC<PropsWithChildren> = ({ children }) => {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
};
