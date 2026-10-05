import { ClientError } from "graphql-request";
import { showAlert } from "../../components/AlertModal.store";

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

let outageNotified = false;

/** Shows the outage popup at most once per page load. */
export const notifyIndexerOutage = (): void => {
  if (outageNotified) return;
  outageNotified = true;
  void showAlert({
    variant: "warning",
    title: "Service temporarily unavailable",
    message:
      "We're experiencing issues with our data indexer. Some data may be missing or outdated. Please try again later.",
  });
};
