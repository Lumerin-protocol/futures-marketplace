import { graphqlRequest } from "../graphql";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PerpsCollectionQuery } from "../queries/perps";
import { snapshotFedQueryOptions } from "../snapshot/config";
import { readViaSnapshot } from "../snapshot/snapshotFed";

export const PERPS_COLLECTION_QK = "PerpsCollection";

/// Kept fresh by `usePerpsSnapshot`, which writes this cache entry directly.
export const usePerpsCollection = () => {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [PERPS_COLLECTION_QK],
    queryFn: () =>
      readViaSnapshot(qc, "perpetual", [PERPS_COLLECTION_QK], fetchPerpsCollectionAsync),
    ...snapshotFedQueryOptions,
  });

  return query;
};

/// Shared with `PerpsSnapshotQuery`'s `collection` alias, which writes this
/// cache entry directly. Both paths must produce identical shapes.
export const mapPerpsCollection = (row: PerpsCollectionRow): PerpsCollection => ({
  makerFeeBps: row.makerFeeBps,
  takerFeeBps: row.takerFeeBps,
  minimumMarginPerOrder: parseInt(row.minimumMarginPerOrder),
  minimumPriceIncrement: parseInt(row.minimumPriceIncrement),
  totalVolume: row.totalVolume,
});

const fetchPerpsCollectionAsync = async () => {
  const response = await graphqlRequest<PerpsCollectionResponse>(
    PerpsCollectionQuery,
    {},
    process.env.REACT_APP_SUBGRAPH_PERPS_URL
  );

  // perps_collection is an array, get the first item
  return {
    data: mapPerpsCollection(response.collection[0]),
  };
};

export type PerpsCollection = {
  makerFeeBps: number;
  takerFeeBps: number;
  minimumMarginPerOrder: number;
  minimumPriceIncrement: number;
  totalVolume: string;
};

export type PerpsCollectionRow = {
  makerFeeBps: number;
  takerFeeBps: number;
  minimumMarginPerOrder: string;
  minimumPriceIncrement: string;
  totalVolume: string;
};

type PerpsCollectionResponse = {
  collection: PerpsCollectionRow[];
};

