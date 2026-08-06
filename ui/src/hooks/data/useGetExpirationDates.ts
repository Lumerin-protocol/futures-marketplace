import { useReadContract } from "wagmi";
import { FuturesAbi } from "futures-marketplace-abi/Futures.ts";
import { backgroundRefetchOpts } from "./config";
import { withErrors } from "../../lib/withErrors";

export function useGetExpirationDates() {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
    abi: withErrors(FuturesAbi),
    functionName: "getExpirationDates",
    query: {
      ...backgroundRefetchOpts,
    },
  });
}
