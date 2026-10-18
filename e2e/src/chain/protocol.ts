import { type Address, encodeFunctionData, formatUnits, type Hex, parseUnits } from "viem";
import type { E2EEnv } from "../env";
import type { NodeSigner } from "../wallet/node-signer";
import { erc20Abi, futuresAbi, vaultAbi, venueAbi } from "./abi";

export interface ProtocolAddresses {
  futures: Address;
  vault: Address;
  token: Address;
  tokenDecimals: number;
}

/**
 * Direct chain reads the specs assert against, plus one write: topping the
 * vault up from Node so trading specs do not depend on the deposit spec.
 */
export class Protocol {
  private addresses?: Promise<ProtocolAddresses>;

  constructor(
    private readonly env: E2EEnv,
    readonly signer: NodeSigner,
  ) {}

  /** Vault and collateral token are resolved the way the UI does: futures.vault() -> vault.collateralToken(). */
  resolve(): Promise<ProtocolAddresses> {
    this.addresses ??= (async () => {
      const futures = this.env.contracts.futures;
      if (!futures) {
        throw new Error(
          `REACT_APP_FUTURES_TOKEN_ADDRESS is not set for target "${this.env.target}" (config/${this.env.target}.env, ui/.env or shell).`,
        );
      }
      const client = this.signer.publicClient;
      const vault = await client.readContract({ address: futures, abi: futuresAbi, functionName: "vault" });
      const token = await client.readContract({ address: vault, abi: vaultAbi, functionName: "collateralToken" });
      const tokenDecimals = await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
      return { futures, vault, token, tokenDecimals };
    })();
    return this.addresses;
  }

  /** Collateral token held by the wallet, in USDC. */
  async walletUsdc(owner: Address = this.signer.address): Promise<number> {
    const { token, tokenDecimals } = await this.resolve();
    const raw = await this.signer.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    });
    return Number(formatUnits(raw, tokenDecimals));
  }

  /** Collateral deposited in the vault, in USDC. */
  async vaultUsdc(owner: Address = this.signer.address): Promise<number> {
    const { vault, tokenDecimals } = await this.resolve();
    const raw = await this.signer.publicClient.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "balanceOf",
      args: [owner],
    });
    return Number(formatUnits(raw, tokenDecimals));
  }

  async ethBalance(owner: Address = this.signer.address): Promise<bigint> {
    return this.signer.publicClient.getBalance({ address: owner });
  }

  /** The venue's price tick in USDC (minimumPriceIncrement, 0.01 on dev for both). */
  async priceTick(venue: "futures" | "perpetual" = "futures"): Promise<number> {
    const { futures, tokenDecimals } = await this.resolve();
    const address = venue === "futures" ? futures : this.env.contracts.perps;
    if (!address) {
      throw new Error(`REACT_APP_PERPS_TOKEN_ADDRESS is not set for target "${this.env.target}"; skip with SKIP.noPerps.`);
    }
    const raw = await this.signer.publicClient.readContract({
      address,
      abi: venueAbi,
      functionName: "minimumPriceIncrement",
    });
    return Number(formatUnits(raw, tokenDecimals));
  }

  /** Approve + deposit from Node until the vault holds at least `minimum` USDC. */
  async ensureCollateral(minimum: number): Promise<void> {
    const { vault, token, tokenDecimals } = await this.resolve();
    const owner = this.signer.address;
    const client = this.signer.publicClient;
    const want = parseUnits(minimum.toFixed(tokenDecimals), tokenDecimals);
    const have = await client.readContract({ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [owner] });
    if (have >= want) return;

    const missing = want - have;
    const inWallet = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
    if (inWallet < missing) {
      throw new Error(
        `Test wallet ${owner} needs ${formatUnits(missing, tokenDecimals)} more USDC in the vault ` +
          `(E2E_MIN_COLLATERAL=${minimum}) but holds only ${formatUnits(inWallet, tokenDecimals)} USDC.`,
      );
    }
    const allowance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, vault],
    });
    if (allowance < missing) {
      await this.send(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, missing] }));
    }
    await this.send(vault, encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [missing] }));
  }

  private async send(to: Address, data: Hex): Promise<void> {
    const hash = await this.signer.sendTransaction({ to, data }, "node");
    const receipt = await this.signer.publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  }
}
