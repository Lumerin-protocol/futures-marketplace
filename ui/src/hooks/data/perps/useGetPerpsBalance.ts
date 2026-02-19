import { useReadContract } from "wagmi";
import { PerpsABI } from "../../../abi/Perps";

export function useGetPerpsBalance(address: `0x${string}` | undefined) {
  return useReadContract({
    address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS,
    abi: PerpsABI,
    functionName: "balanceOf",
    args: [address!],
  });
}
