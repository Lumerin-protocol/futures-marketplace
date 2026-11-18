import type { NetworkConnection } from "hardhat/types/network";
import type { Address } from "viem";
import { readOptionalAddress } from "../../lib/env.ts";
import { addrUrl } from "../../lib/explorer.ts";
import { logInfo, logStep } from "../../lib/log.ts";
import { verifyContract } from "../../lib/verify.ts";

type Viem = NetworkConnection["viem"];

/**
 * `HashPowerFutures` links `FuturesBookLib` (its off-chain order-book views). Reuse the library at
 * `FUTURES_BOOK_LIB_ADDRESS` when set (one per network is enough: it holds no state), otherwise
 * deploy and verify a new one. Returns the `libraries` map for the implementation deploy and its
 * verification.
 */
export async function resolveBookLib(viem: Viem, confirmations: number): Promise<{ FuturesBookLib: Address }> {
  const pc = await viem.getPublicClient();
  const existing = readOptionalAddress("FUTURES_BOOK_LIB_ADDRESS");
  if (existing) {
    logInfo("FuturesBookLib", { Address: addrUrl(pc, existing), Source: "FUTURES_BOOK_LIB_ADDRESS" });
    return { FuturesBookLib: existing };
  }
  logInfo("Deploy FuturesBookLib (external library linked into HashPowerFutures)", {});
  const bookLib = await viem.deployContract("FuturesBookLib", [], { confirmations });
  logStep("Deployed", addrUrl(pc, bookLib.address));
  await verifyContract(bookLib.address, [], undefined, {
    contract: "contracts/libs/FuturesBookLib.sol:FuturesBookLib",
  });
  return { FuturesBookLib: bookLib.address };
}
