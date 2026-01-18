import { request, gql, rawRequest } from "graphql-request";

export class Subgraph {
  private apiKey: string;
  private url: string;

  constructor(url: string, apiKey?: string) {
    this.apiKey = apiKey ?? "";
    this.url = url;
  }

  async getParticipants() {
    return await this.request<ParticipantsRes>(ParticipantQuery);
  }

  async request<T>(query: string, variables: Record<string, any> = {}) {
    return await request<T>(this.url, query, variables, {
      Authorization: `Bearer ${this.apiKey}`,
    });
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
