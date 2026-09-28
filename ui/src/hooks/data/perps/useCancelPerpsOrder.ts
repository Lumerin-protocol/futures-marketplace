import { useWriteContract, usePublicClient } from "wagmi";
import { getContract } from "viem";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { withErrors } from "../../../lib/withErrors";
import { requireWalletClient } from "../../../clients/requireWalletClient";

interface CancelPerpsOrderProps {
  orderId: `0x${string}`;
}

export function useCancelPerpsOrder() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();

  const cancelOrderAsync = async (props: CancelPerpsOrderProps) => {
    if (!publicClient) throw new Error("No RPC client available. Please try again.");
    const walletClient = await requireWalletClient();

    const perpsContract = getContract({
      address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
      abi: withErrors(HashPowerPerpsDEXAbi),
      client: publicClient,
    });

    const req = await perpsContract.simulate.cancelOrder(
      [props.orderId],
      { account: walletClient.account.address },
    );

    return writeContractAsync(req.request);
  };

  return {
    cancelOrderAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
