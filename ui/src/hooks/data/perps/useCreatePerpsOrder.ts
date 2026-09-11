import { useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { getContract } from "viem";
import { HashPowerPerpsDEXAbi } from "derivatives-marketplace-abi/HashPowerPerpsDEX.ts";
import { QUANTITY_SCALE_NUM } from "../../../lib/units";
import { TimeInForce, type TimeInForceValue } from "../../../types/timeInForce";
import { withErrors } from "../../../lib/withErrors";

interface CreatePerpsOrderProps {
  price: bigint;
  quantity: number; // Positive for Buy, Negative for Sell
  /** Defaults to GTC. */
  timeInForce?: TimeInForceValue;
}

export function useCreatePerpsOrder() {
  const { writeContractAsync, isPending, isError, error, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const createOrderAsync = async (props: CreatePerpsOrderProps) => {
    if (!writeContractAsync || !publicClient || !walletClient) return;

    const perpsContract = getContract({
      address: process.env.REACT_APP_PERPS_TOKEN_ADDRESS as `0x${string}`,
      abi: withErrors(HashPowerPerpsDEXAbi),
      client: publicClient,
    });

    // Convert quantity to bigint (int256 in contract)
    // Contract expects: positive = Buy, negative = Sell
    // Multiply by QUANTITY_SCALE_NUM to convert decimal to integer (QUANTITY_DECIMALS precision)
    const quantityWithDecimals = Math.round(props.quantity * QUANTITY_SCALE_NUM);
    const quantityBigInt = BigInt(quantityWithDecimals);

    const tif = props.timeInForce ?? TimeInForce.GTC;

    const req = await perpsContract.simulate.createOrder(
      [props.price, quantityBigInt, tif],
      { account: walletClient.account.address },
    );

    return writeContractAsync(req.request);
  };

  return {
    createOrderAsync,
    isPending,
    isError,
    error,
    hash,
  };
}
