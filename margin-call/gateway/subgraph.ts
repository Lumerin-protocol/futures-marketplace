import { request, gql, rawRequest } from "graphql-request";

export class Subgraph {
  private apiKey: string | undefined;
  private url: string;

  constructor(url: string, apiKey?: string) {
    this.apiKey = apiKey;
    this.url = url;
  }

  async getParticipants() {
    return await this.request<ParticipantsRes>(ParticipantQuery);
  }

  async request<T>(query: string, variables: Record<string, any> = {}) {
    // Only include Authorization header if apiKey is provided
    // The Graph Network uses API key in URL path, not Bearer token
    const headers = this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
    return await request<T>(this.url, query, variables, headers);
  }
}

export const ParticipantQuery = gql`
  {
    participants {
      address
      balance
    }
  }
`;

type ParticipantsRes = {
  participants: {
    address: `0x${string}`;
    balance: string;
  }[];
};
