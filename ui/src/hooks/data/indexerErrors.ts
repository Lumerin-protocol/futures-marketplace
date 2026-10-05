import { ClientError } from "graphql-request";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { RiskToastItem } from "../../components/Widgets/Futures/RiskToast";

export type IndexerErrorKind = "rate_limit" | "outage" | "other";

const RATE_LIMIT_RE = /rate.?limit|too many requests/i;
const OUTAGE_RE =
  /indexing_error|bad indexers|no healthy indexers|subgraph .*failed|deployment .*not found|indexer .*unavailable/i;

const graphqlMessages = (error: ClientError): string =>
  (error.response.errors ?? []).map((e) => e.message).join("\n");

const isNetworkFailure = (error: unknown): boolean =>
  error instanceof TypeError && (typeof navigator === "undefined" || navigator.onLine !== false);

export const classifyIndexerError = (error: unknown): IndexerErrorKind => {
  if (error instanceof ClientError) {
    const messages = graphqlMessages(error);
    if (error.response.status === 429 || RATE_LIMIT_RE.test(messages)) return "rate_limit";
    if (error.response.status >= 500 || OUTAGE_RE.test(messages)) return "outage";
    return "other";
  }
  if (isNetworkFailure(error)) return "outage";
  return "other";
};

export const INDEXER_TOAST_PREFIX = "indexer:";
const INDEXER_TOAST_ID = `${INDEXER_TOAST_PREFIX}outage`;
const INDEXER_TOAST_MESSAGE =
  "We're experiencing issues with our data indexer. Some data may be missing or outdated. Please try again later.";

let outageNotified = false;
let toastVisible = false;
const listeners = new Set<() => void>();

const setToastVisible = (visible: boolean) => {
  toastVisible = visible;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getToastVisible = () => toastVisible;

/** Shows the outage toast at most once per page load; a dismissed toast stays dismissed. */
export const notifyIndexerOutage = (): void => {
  if (outageNotified) return;
  outageNotified = true;
  setToastVisible(true);
};

/** Indexer outage notice in the `RiskToast` item shape, ready to merge into a toast stack. */
export const useIndexerOutageToast = () => {
  const visible = useSyncExternalStore(subscribe, getToastVisible, getToastVisible);
  const toasts = useMemo<RiskToastItem[]>(
    () => (visible ? [{ id: INDEXER_TOAST_ID, message: INDEXER_TOAST_MESSAGE, variant: "warning" }] : []),
    [visible],
  );
  const dismiss = useCallback(() => setToastVisible(false), []);
  return { toasts, dismiss };
};
