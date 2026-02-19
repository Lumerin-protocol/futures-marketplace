import { useWriteContract, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { PerpsABI } from "../../../abi/Perps";
import { usePerpsPaymentToken } from "./usePerpsPaymentToken";
import { type PermitSignature, usePermit } from "./usePermit";

export type AddCollateralWithPermitProps = {
  amount: bigint;
  deadline: bigint;
  signature: PermitSignature;
};

export function usePermitPerps() {
  const { data: tokenAddress } = usePerpsPaymentToken();

  const spenderAddress = process.env.REACT_APP_PERPS_TOKEN_ADDRESS!;

  return usePermit({ contractAddress: tokenAddress!, spenderAddress });
}

export function usePerpsAddCollateralWithPermit() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const { data: walletClient } = useWalletClient();

  const addCollateralAsync = async (props: AddCollateralWithPermitProps) => {
    if (!writeContractAsync || !walletClient) return;

    const perpsContract = getContract({
      address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
      abi: PerpsABI,
      client: walletClient,
    });

    const { amount, deadline, signature } = props;
    const { v, r, s } = signature;

    const req = await perpsContract.simulate.addCollateralWithPermit([amount, deadline, v, r, s], {
      account: walletClient.account.address,
    });

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
