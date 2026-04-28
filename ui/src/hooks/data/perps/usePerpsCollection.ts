import { graphqlRequest } from "../graphql";
import { useQuery } from "@tanstack/react-query";
import { PerpsCollectionQuery } from "./graphql-queries";

export const PERPS_COLLECTION_QK = "PerpsCollection";

export const usePerpsCollection = () => {
  const query = useQuery({
    queryKey: [PERPS_COLLECTION_QK],
    queryFn: () => fetchPerpsCollectionAsync(),
  });

  return query;
};

const fetchPerpsCollectionAsync = async () => {
  const response = await graphqlRequest<PerpsCollectionResponse>(
    PerpsCollectionQuery,
    {},
    process.env.REACT_APP_SUBGRAPH_PERPS_URL
  );

  // perps_collection is an array, get the first item
  const data = response.perps_collection[0];

  const result: PerpsCollection = {
    makerFeeBps: data.makerFeeBps,
    takerFeeBps: data.takerFeeBps,
    minimumMarginPerOrder: parseInt(data.minimumMarginPerOrder),
    minimumPriceIncrement: parseInt(data.minimumPriceIncrement),
    marginPercent: data.marginPercent,
    maintenanceMarginPercent: data.maintenanceMarginPercent,
    totalVolume: data.totalVolume,
  };

  return {
    data: result,
  };
};

export type PerpsCollection = {
  makerFeeBps: number;
  takerFeeBps: number;
  minimumMarginPerOrder: number;
  minimumPriceIncrement: number;
  marginPercent: number;
  maintenanceMarginPercent: number;
  totalVolume: string;
};

type PerpsCollectionResponse = {
  perps_collection: {
    makerFeeBps: number;
    takerFeeBps: number;
    minimumMarginPerOrder: string;
    minimumPriceIncrement: string;
    marginPercent: number;
    maintenanceMarginPercent: number;
    totalVolume: string;
  }[];
};

