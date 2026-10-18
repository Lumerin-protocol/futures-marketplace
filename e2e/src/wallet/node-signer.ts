import {
  type Address,
  BaseError,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  hexToBigInt,
  http,
  isAddressEqual,
  isHex,
  type PrivateKeyAccount,
  type PublicClient,
  type Transport,
  type TypedDataDefinition,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFor } from "../chain/clients";

export interface SentTransaction {
  hash: Hex;
  to: Address | null;
  /** "page" = requested by the UI through the mock wallet, "node" = a test helper. */
  origin: "page" | "node";
  at: number;
}

export interface BridgeResponse {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** EIP-1193 error shape, returned to the page as `{ code, message, data }`. */
export class ProviderRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

interface RpcTransactionRequest {
  from?: Address;
  to?: Address | null;
  data?: Hex;
  input?: Hex;
  value?: Hex;
  gas?: Hex;
}

/**
 * The wallet's private half: holds the key, signs and broadcasts, and proxies
 * plain JSON-RPC reads. One instance per worker, so the UI and Node-side
 * helpers share a single, serialized nonce sequence.
 */
export class NodeSigner {
  readonly account: PrivateKeyAccount;
  readonly chain: Chain;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient<Transport, Chain, PrivateKeyAccount>;
  readonly sent: SentTransaction[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private nextNonce: number | undefined;
  private rpcId = 0;

  constructor(private readonly options: { privateKey: Hex; rpcUrl: string; chainId: number }) {
    this.account = privateKeyToAccount(options.privateKey);
    this.chain = chainFor(options.chainId, options.rpcUrl);
    const transport = http(options.rpcUrl, { retryCount: 2 });
    this.publicClient = createPublicClient({ chain: this.chain, transport });
    this.walletClient = createWalletClient({ account: this.account, chain: this.chain, transport });
  }

  get address(): Address {
    return this.account.address;
  }

  /** Entry point for the in-page bridge. Never throws: failures go back as EIP-1193 errors. */
  async handleRequest(payload: { method: string; params?: unknown[] }): Promise<BridgeResponse> {
    try {
      return { result: await this.request(payload.method, payload.params ?? []) };
    } catch (error) {
      const { code, message, data } = toProviderError(error);
      if (payload.method !== "eth_call" && payload.method !== "eth_estimateGas") {
        console.warn(`[e2e-wallet] ${payload.method} failed (${code}): ${message}`);
      }
      return { error: { code, message, data } };
    }
  }

  async request(method: string, params: unknown[]): Promise<unknown> {
    switch (method) {
      case "eth_sendTransaction":
      case "wallet_sendTransaction":
        return this.sendTransaction(params[0] as RpcTransactionRequest, "page");
      case "eth_signTypedData_v4":
        return this.signTypedData(params);
      case "personal_sign":
        return this.personalSign(params);
      case "eth_sign":
      case "eth_signTransaction":
        throw new ProviderRpcError(4200, `E2E wallet does not support ${method}`);
      default:
        return this.rpc(method, params);
    }
  }

  /** Signs and broadcasts; returns the hash as soon as the node accepts it. */
  sendTransaction(tx: RpcTransactionRequest, origin: SentTransaction["origin"]): Promise<Hex> {
    this.assertOwnAccount(tx.from);
    return this.serialize(async () => {
      const pending = await this.publicClient.getTransactionCount({ address: this.address, blockTag: "pending" });
      // A load-balanced RPC can briefly report a stale pending count right after a send.
      const nonce = Math.max(pending, this.nextNonce ?? 0);
      try {
        const hash = await this.walletClient.sendTransaction({
          to: tx.to ?? undefined,
          data: tx.data ?? tx.input,
          value: tx.value ? hexToBigInt(tx.value) : undefined,
          gas: tx.gas ? hexToBigInt(tx.gas) : undefined,
          nonce,
        });
        this.nextNonce = nonce + 1;
        this.sent.push({ hash, to: tx.to ?? null, origin, at: Date.now() });
        console.log(`[e2e-wallet] ${origin} tx ${hash} -> ${tx.to ?? "(create)"} nonce=${nonce}`);
        return hash;
      } catch (error) {
        this.nextNonce = undefined;
        throw error;
      }
    });
  }

  private async signTypedData(params: unknown[]): Promise<Hex> {
    const [from, payload] = params as [Address, string | object];
    this.assertOwnAccount(from);
    const typedData = (typeof payload === "string" ? JSON.parse(payload) : payload) as TypedDataDefinition;
    return this.account.signTypedData(typedData);
  }

  private async personalSign(params: unknown[]): Promise<Hex> {
    const [message, from] = params as [string, Address];
    this.assertOwnAccount(from);
    return this.account.signMessage({ message: isHex(message) ? { raw: message } : message });
  }

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(this.options.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.rpcId, method, params }),
    });
    if (!response.ok) throw new ProviderRpcError(-32603, `RPC ${method} failed with HTTP ${response.status}`);
    const body = (await response.json()) as BridgeResponse;
    if (body.error) throw new ProviderRpcError(body.error.code, body.error.message, body.error.data);
    return body.result;
  }

  private assertOwnAccount(from: Address | undefined): void {
    if (from && !isAddressEqual(from, this.address)) {
      throw new ProviderRpcError(4100, `E2E wallet cannot sign for ${from}`);
    }
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function toProviderError(error: unknown): ProviderRpcError {
  if (error instanceof ProviderRpcError) return error;
  if (error instanceof BaseError) {
    const withCode = error.walk((cause) => typeof (cause as { code?: unknown }).code === "number") as {
      code?: number;
    } | null;
    const withData = error.walk((cause) => isHex((cause as { data?: unknown }).data)) as { data?: Hex } | null;
    return new ProviderRpcError(withCode?.code ?? -32603, error.shortMessage, withData?.data);
  }
  return new ProviderRpcError(-32603, error instanceof Error ? error.message : String(error));
}
