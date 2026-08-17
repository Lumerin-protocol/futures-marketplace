import { useReadContract } from "wagmi";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { backgroundRefetchOpts } from "./config";
import { withErrors } from "../../lib/withErrors";

export function useGetExpirationDates() {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
    abi: withErrors(HashPowerFuturesAbi),
    functionName: "getExpirationDates",
    query: {
      ...backgroundRefetchOpts,
    },
  });
}
