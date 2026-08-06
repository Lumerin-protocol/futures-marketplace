import { useReadContract } from "wagmi";
import { FuturesAbi } from "futures-marketplace-abi/Futures.ts";
import { backgroundRefetchOpts } from "./config";

export function useGetExpirationDates() {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
    abi: FuturesAbi,
    functionName: "getExpirationDates",
    query: {
      ...backgroundRefetchOpts,
    },
  });
}
