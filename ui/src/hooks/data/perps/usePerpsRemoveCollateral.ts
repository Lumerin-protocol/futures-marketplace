import { useWriteContract, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { PerpsABI } from "../../../abi/Perps";

interface RemoveCollateralProps {
  amount: bigint;
}

export function usePerpsRemoveCollateral() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const { data: walletClient } = useWalletClient();

  const removeCollateralAsync = async (props: RemoveCollateralProps) => {
    if (!writeContractAsync || !walletClient) return;

    const perpsContract = getContract({
      address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
      abi: PerpsABI,
      client: walletClient,
    });

    const req = await perpsContract.simulate.removeCollateral([props.amount], { account: walletClient.account.address });

    return writeContractAsync(req.request);
  };

  return {
    removeCollateralAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
