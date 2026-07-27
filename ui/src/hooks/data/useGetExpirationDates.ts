import { useReadContract } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";
import { withErrors } from "../../lib/withErrors";
import { backgroundRefetchOpts } from "./config";

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
