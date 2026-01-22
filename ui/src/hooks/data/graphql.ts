import { request } from "graphql-request";

export const graphqlRequest = async <T>(
  query: string,
  variables: Record<string, any> = {},
  url: string = process.env.REACT_APP_SUBGRAPH_FUTURES_URL,
): Promise<T> => {
  return await request<T>(url, query, { ...variables });
};
