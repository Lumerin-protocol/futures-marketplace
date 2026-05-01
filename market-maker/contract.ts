import { createPublicClient, createWalletClient, encodeFunctionData, http } from "viem";
import { FuturesAbi } from "./abi/Futures.ts";
import { privateKeyToAccount } from "viem/accounts";
import { getChain } from "./chainId.ts";
import { IERC20ABI } from "./abi/IERC20.ts";

function makeClient(url: string, chainId: number) {
  return createPublicClient({
    transport: http(url),
    chain: getChain(chainId),
  });
}

function makeWalletClient(url: string, privateKey: `0x${string}`, chainId: number) {
  return createWalletClient({
    transport: http(url),
    account: privateKeyToAccount(privateKey),
    chain: getChain(chainId),
  });
}

export class FuturesContract {
  private address: `0x${string}`;
  private pc: ReturnType<typeof makeClient>;
  private wc: ReturnType<typeof makeWalletClient>;
  private usdcAddress?: `0x${string}`;
  private vaultAddress?: `0x${string}`;

  constructor(address: `0x${string}`, url: string, privateKey: `0x${string}`, chainId: number) {
    this.address = address;
    this.pc = makeClient(url, chainId);
    this.wc = makeWalletClient(url, privateKey, chainId);
  }

  getWalletAddress(): `0x${string}` {
    return this.wc.account.address;
  }

  async getBalance(): Promise<bigint> {
    return this.pc.readContract({
      address: this.address as `0x${string}`,
      abi: FuturesAbi,
      functionName: "balanceOf",
      args: [this.wc.account.address],
      authorizationList: undefined,
    });
  }

  private async getTokenAddress(): Promise<`0x${string}`> {
    if (!this.usdcAddress) {
      this.usdcAddress = await this.pc.readContract({
        address: this.address as `0x${string}`,
        abi: FuturesAbi,
        functionName: "token",
        authorizationList: undefined,
      });
    }
    return this.usdcAddress;
  }

  /// `addMargin` proxies to `collateralVault.depositFor`, which pulls the underlying token
  /// from `msg.sender` into the vault. The ERC20 spender that needs allowance is therefore
  /// the vault, not the Futures contract.
  private async getVaultAddress(): Promise<`0x${string}`> {
    if (!this.vaultAddress) {
      this.vaultAddress = await this.pc.readContract({
        address: this.address as `0x${string}`,
        abi: FuturesAbi,
        functionName: "collateralVault",
        authorizationList: undefined,
      });
    }
    return this.vaultAddress;
  }

  async getUSDCBalance(address: `0x${string}`): Promise<bigint> {
    const tokenAddress = await this.getTokenAddress();
    return this.pc.readContract({
      address: tokenAddress,
      abi: IERC20ABI,
      functionName: "balanceOf",
      args: [address],
      authorizationList: undefined,
    });
  }

  async getETHBalance(): Promise<bigint> {
    return this.pc.getBalance({ address: this.wc.account.address });
  }

  async approve(amount: bigint): Promise<TxResult> {
    const [tokenAddress, vaultAddress] = await Promise.all([
      this.getTokenAddress(),
      this.getVaultAddress(),
    ]);

    const tx = await this.pc.simulateContract({
      address: tokenAddress,
      abi: IERC20ABI,
      functionName: "approve",
      args: [vaultAddress, amount],
      account: this.wc.account,
      chain: this.wc.chain,
    });
    const hash = await this.wc.writeContract(tx.request);
    return await this.pc.waitForTransactionReceipt({ hash });
  }

  async deposit(amount: bigint): Promise<TxResult> {
    const tx = await this.pc.simulateContract({
      address: this.address as `0x${string}`,
      abi: FuturesAbi,
      functionName: "addMargin",
      args: [amount],
      account: this.wc.account,
      chain: this.wc.chain,
    });
    const hash = await this.wc.writeContract(tx.request);
    return await this.pc.waitForTransactionReceipt({ hash });
  }

  async placeOrders(
    orders: { price: bigint; qty: bigint; deliveryDate: bigint }[]
  ): Promise<TxResult> {
    const callsDatas = orders.map((order) =>
      encodeFunctionData({
        abi: FuturesAbi,
        functionName: "createOrder",
        args: [order.price, order.deliveryDate, "", Number(order.qty)],
      })
    );
    const tx = await this.pc.simulateContract({
      address: this.address as `0x${string}`,
      abi: FuturesAbi,
      functionName: "multicall",
      args: [callsDatas],
      account: this.wc.account,
    });
    const txHash = await this.wc.writeContract(tx.request);
    return await this.pc.waitForTransactionReceipt({ hash: txHash });
  }

  //TODO: rewrite for continuous monitoring
  async waitForPositionCreated(address: `0x${string}`, blockNumber: number): Promise<void> {
    const positionCreatedAbi = FuturesAbi.find(
      (event) => event.type === "event" && event.name === "PositionCreated"
    )!;

    return new Promise((resolve, reject) => {
      const unwatch = this.pc.watchEvent({
        address: this.address as `0x${string}`,
        events: [positionCreatedAbi, positionCreatedAbi],
        fromBlock: BigInt(blockNumber),
        args: [{ seller: address }, { buyer: address }] as any,
        onLogs: (logs) => {
          unwatch();
          resolve();
        },
        onError: (error) => {
          unwatch();
          reject(error);
        },
      });
    });
  }

  async getCurrentDeliveryDate(): Promise<number> {
    const deliveryDates = await this.pc.readContract({
      address: this.address as `0x${string}`,
      abi: FuturesAbi,
      functionName: "getDeliveryDates",
      authorizationList: undefined,
    });

    return Number(deliveryDates[0]);
  }

  async getIndexPrice(): Promise<bigint> {
    return this.pc.readContract({
      address: this.address as `0x${string}`,
      abi: FuturesAbi,
      functionName: "getMarketPrice",
      authorizationList: undefined,
    });
  }

  async getContractMultiplier(): Promise<number> {
    return this.pc.readContract({
      address: this.address as `0x${string}`,
      abi: FuturesAbi,
      functionName: "deliveryDurationDays",
      authorizationList: undefined,
    });
  }

  async getTickSize(): Promise<bigint> {
    return this.pc.readContract({
      address: this.address as `0x${string}`,
      abi: FuturesAbi,
      functionName: "minimumPriceIncrement",
      authorizationList: undefined,
    });
  }
}

type TxResult = {
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
};
