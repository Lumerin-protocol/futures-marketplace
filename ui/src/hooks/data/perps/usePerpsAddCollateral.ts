import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { PerpsABI } from "../../../abi/Perps";
import { useApproveERC20 } from "../useApproveERC20";
import { usePerpsPaymentToken } from "./usePerpsPaymentToken";

interface AddCollateralProps {
  amount: bigint;
}

export function useApprovePerpsAddCollateral() {
  const { data: tokenAddress } = usePerpsPaymentToken();

  return useApproveERC20(tokenAddress!);
}

export function usePerpsAddCollateral() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const { data: walletClient } = useWalletClient();

  const addCollateralAsync = async (props: AddCollateralProps) => {
    if (!writeContractAsync || !walletClient) return;

    const perpsContract = getContract({
      address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
      abi: PerpsABI,
      client: walletClient,
    });

    const req = await perpsContract.simulate.addCollateral([props.amount], { account: walletClient.account.address });

    return writeContractAsync(req.request);
  };

  return {
    addCollateralAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
