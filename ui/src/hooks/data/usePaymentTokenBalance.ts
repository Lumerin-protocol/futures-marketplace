import { usdcMockAbi } from "contracts-js/dist/abi/abi";
import { useReadContract } from "wagmi";
import { backgroundRefetchOpts } from "./config";
import { useFuturePaymentToken } from "./useFuturePaymentToken";

/// Wallet (ERC20) balance of the futures payment token.
///
/// The token address is resolved via the CollateralVault chain (see
/// `useFuturePaymentToken`): Futures.collateralVault() → CollateralVault.collateralToken().
/// Once available, we call `balanceOf(address)` against that ERC20.
export function useFuturesPaymentTokenBalance(address: `0x${string}` | undefined) {
  const { data: paymentTokenAddress } = useFuturePaymentToken();

  return useReadContract({
    address: paymentTokenAddress,
    abi: usdcMockAbi,
    functionName: "balanceOf",
    args: [address!],
    query: {
      ...backgroundRefetchOpts,
      enabled: !!address && !!paymentTokenAddress,
    },
  });
}
