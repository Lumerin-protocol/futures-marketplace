import { safeLazy } from "./utils/safeLazy";

/**
 * Lazy-loaded wrapper around `Web3Provider`, kept out of the main bundle
 * since wagmi/@reown/appkit is heavy and not needed to paint the app shell
 * (header logo/nav, page skeletons, etc).
 *
 * `Web3Provider` wraps a module-level singleton `config`/`QueryClient` (see
 * Web3Provider.tsx), so it's safe to mount this same lazy reference at
 * multiple, independent points in the tree — each mount just hands the same
 * underlying wagmi store/query cache to whichever subtree actually needs it
 * (HeaderConnect, the trading sub-header, the Futures/Leaderboard page
 * bodies). Every mount point shares one dynamic-import request/cache, so the
 * chunk is only ever fetched once no matter how many places render it.
 */
export const Web3ProviderLazy = safeLazy(() =>
  import("./Web3Provider").then((module) => ({ default: module.Web3Provider })),
);
