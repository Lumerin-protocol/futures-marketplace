import { request } from "graphql-request";
import { classifyIndexerError, reportIndexerFailure, reportIndexerSuccess } from "./indexerErrors";

export const graphqlRequest = async <T>(
  query: string,
  variables: Record<string, unknown> = {},
  url: string = process.env.REACT_APP_SUBGRAPH_FUTURES_URL,
): Promise<T> => {
  try {
    const result = await request<T>(url, query, { ...variables });
    reportIndexerSuccess();
    return result;
  } catch (error) {
    if (classifyIndexerError(error) === "outage") {
      console.error(`[indexer] request to ${url} failed:`, error);
      reportIndexerFailure();
    }
    throw error;
  }
};
