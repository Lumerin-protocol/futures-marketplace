import { request } from "graphql-request";
import { classifyIndexerError, notifyIndexerOutage } from "./indexerErrors";

export const graphqlRequest = async <T>(
  query: string,
  variables: Record<string, unknown> = {},
  url: string = process.env.REACT_APP_SUBGRAPH_FUTURES_URL,
): Promise<T> => {
  try {
    return await request<T>(url, query, { ...variables });
  } catch (error) {
    if (classifyIndexerError(error) === "outage") {
      console.error(`[indexer] request to ${url} failed:`, error);
      notifyIndexerOutage();
    }
    throw error;
  }
};
