import {
  createPublicClient,
  createWalletClient,
  http,
  decodeFunctionData,
  encodeFunctionData,
  formatEther,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Transport,
  type Account,
  erc20Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, base } from "viem/chains";
import { futuresAbi as FuturesAbi } from "../contracts/abi/abi.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MARKET_MAKER_ADDRESS = (
  process.env.COPYTRADE_MARKET_MAKER_ADDRESS ?? "0xc1e187e4a677da017ecfac011c9d381c3e7baee4"
).toLowerCase() as Hex;

const ARB_FUTURES_ADDRESS = "0x8464dc5ab80e76e497fad318fe6d444408e5ccda" as Hex;
const BASE_FUTURES_ADDRESS = "0xf97a1bbfb5e061ef73dad8ebf25939d93639fb7f" as Hex;
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;
const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex;

const ARB_RPC_URL = "https://arb-mainnet.g.alchemy.com/v2/_Bho_hAPyM3RzVu4uawWByrpGt0eVUZI";
const BASE_RPC_URL = "https://base-mainnet.g.alchemy.com/v2/_Bho_hAPyM3RzVu4uawWByrpGt0eVUZI";

const POLL_INTERVAL_MS = Number(process.env.COPYTRADE_POLL_INTERVAL_MS ?? "2000");
const ETH_PRICE_REFRESH_MS = 60_000;

// Functions we replicate from the market maker
const COPYABLE_FUNCTIONS = new Set(["createOrder", "addMargin", "removeMargin", "multicall"]);

// ---------------------------------------------------------------------------
// ETH price tracking
// ---------------------------------------------------------------------------

let cachedEthPriceUsd = 0;
let lastPriceFetchMs = 0;

async function getEthPriceUsd(): Promise<number> {
  const now = Date.now();
  if (cachedEthPriceUsd > 0 && now - lastPriceFetchMs < ETH_PRICE_REFRESH_MS) {
    return cachedEthPriceUsd;
  }
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    );
    const json = (await res.json()) as { ethereum?: { usd?: number } };
    const price = json?.ethereum?.usd;
    if (price && price > 0) {
      cachedEthPriceUsd = price;
      lastPriceFetchMs = now;
    }
  } catch (err: any) {
    console.warn("ETH price fetch failed, using cached:", err.message);
  }
  return cachedEthPriceUsd;
}

function feeToUsd(feeWei: bigint, ethPriceUsd: number): string {
  const feeEth = Number(formatEther(feeWei));
  return (feeEth * ethPriceUsd).toFixed(4);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertEnv() {
  const missing: string[] = [];
  if (!ARB_FUTURES_ADDRESS) missing.push("COPYTRADE_ARB_FUTURES_ADDRESS");
  if (!BASE_FUTURES_ADDRESS) missing.push("COPYTRADE_BASE_FUTURES_ADDRESS");
  if (!BASE_USDC_ADDRESS) missing.push("COPYTRADE_BASE_USDC_ADDRESS");
  if (!PRIVATE_KEY) missing.push("COPYTRADE_PRIVATE_KEY");
  if (missing.length > 0) {
    console.error(`Missing env vars:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

function buildArbClient(): PublicClient {
  const transport = http(ARB_RPC_URL);
  return createPublicClient({ chain: arbitrum, transport }) as PublicClient;
}

function buildBaseClients() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const transport = http(BASE_RPC_URL);
  const publicClient = createPublicClient({ chain: base, transport }) as PublicClient;
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport,
  });
  return { publicClient, walletClient, account };
}

// ---------------------------------------------------------------------------
// Decode helpers
// ---------------------------------------------------------------------------

type DecodedCall = {
  functionName: string;
  args: readonly unknown[];
};

function tryDecodeFuturesCall(data: Hex): DecodedCall | null {
  try {
    const decoded = decodeFunctionData({ abi: FuturesAbi, data });
    return { functionName: decoded.functionName, args: decoded.args ?? [] };
  } catch {
    return null;
  }
}

/**
 * Multicall bundles multiple calls into one tx. We decode each inner call
 * and filter to only the ones we want to replicate.
 */
function decodeMulticallData(args: readonly unknown[]): Hex[] {
  const [callDataArray] = args as [Hex[]];
  const replayable: Hex[] = [];
  for (const innerData of callDataArray) {
    const inner = tryDecodeFuturesCall(innerData);
    if (inner && COPYABLE_FUNCTIONS.has(inner.functionName)) {
      replayable.push(innerData);
    }
  }
  return replayable;
}

// ---------------------------------------------------------------------------
// Replay logic
// ---------------------------------------------------------------------------

async function replayOnBase(
  decoded: DecodedCall,
  txData: Hex,
  basePublic: PublicClient,
  baseWallet: WalletClient<Transport, Chain, Account>,
): Promise<TxFeeInfo | null> {
  const label = `[Base] ${decoded.functionName}`;

  try {
    if (decoded.functionName === "multicall") {
      const innerCalls = decodeMulticallData(decoded.args);
      if (innerCalls.length === 0) {
        console.log(`${label}: no replayable calls in multicall, skipping`);
        return null;
      }
      console.log(`${label}: replaying ${innerCalls.length} inner calls via multicall`);

      const calldata = encodeFunctionData({
        abi: FuturesAbi,
        functionName: "multicall",
        args: [innerCalls],
      });

      return await sendAndConfirm(calldata, basePublic, baseWallet, label);
    }

    if (decoded.functionName === "addMargin") {
      const [amount] = decoded.args as [bigint];
      console.log(`${label}: approving ${amount} USDC then adding margin`);
      await approveIfNeeded(amount, basePublic, baseWallet);
    }

    return await sendAndConfirm(txData, basePublic, baseWallet, label);
  } catch (err: any) {
    console.error(`${label} FAILED:`, err.shortMessage ?? err.message);
    return null;
  }
}

async function approveIfNeeded(
  amount: bigint,
  basePublic: PublicClient,
  baseWallet: WalletClient<Transport, Chain, Account>,
) {
  const allowance = await basePublic.readContract({
    address: BASE_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: [baseWallet.account.address, BASE_FUTURES_ADDRESS],
  });

  if (allowance < amount) {
    const approveHash = await baseWallet.writeContract({
      address: BASE_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [BASE_FUTURES_ADDRESS, amount * 10n],
    });
    await basePublic.waitForTransactionReceipt({ hash: approveHash });
    console.log("  approved USDC spend");
  }
}

type TxFeeInfo = { gasUsed: bigint; feeWei: bigint; feeEth: string; feeUsd: string };

async function sendAndConfirm(
  calldata: Hex,
  basePublic: PublicClient,
  baseWallet: WalletClient<Transport, Chain, Account>,
  label: string,
): Promise<TxFeeInfo> {
  const hash = await baseWallet.sendTransaction({
    to: BASE_FUTURES_ADDRESS,
    data: calldata,
  });
  console.log(`  ${label} tx sent: ${hash}`);
  const receipt = await basePublic.waitForTransactionReceipt({ hash });
  const gasUsed = receipt.gasUsed;
  const feeWei = gasUsed * receipt.effectiveGasPrice;
  const feeEth = formatEther(feeWei);
  const ethPrice = await getEthPriceUsd();
  const feeUsd = feeToUsd(feeWei, ethPrice);
  const status = receipt.status === "success" ? "OK" : "REVERTED";
  console.log(`  ${label} ${status} | gas: ${gasUsed} | fee: ${feeEth} ETH ($${feeUsd})`);
  return { gasUsed, feeWei, feeEth, feeUsd };
}

// ---------------------------------------------------------------------------
// Track processed transactions to avoid duplicates
// ---------------------------------------------------------------------------

const processedTxHashes = new Set<string>();
const MAX_PROCESSED_CACHE = 10_000;

function markProcessed(hash: string) {
  processedTxHashes.add(hash);
  if (processedTxHashes.size > MAX_PROCESSED_CACHE) {
    const first = processedTxHashes.values().next().value;
    if (first) processedTxHashes.delete(first);
  }
}

// ---------------------------------------------------------------------------
// Process a single confirmed transaction
// ---------------------------------------------------------------------------

async function processTransaction(
  txHash: Hex,
  arbClient: PublicClient,
  basePublic: PublicClient,
  baseWallet: WalletClient<Transport, Chain, Account>,
) {
  if (processedTxHashes.has(txHash)) return;
  markProcessed(txHash);

  const tx = await arbClient.getTransaction({ hash: txHash });
  if (!tx || !tx.to) return;

  if (tx.to.toLowerCase() !== ARB_FUTURES_ADDRESS.toLowerCase()) return;

  const decoded = tryDecodeFuturesCall(tx.input);
  if (!decoded) {
    console.log(`[Arb] tx ${txHash}: unrecognized function, skipping`);
    return;
  }

  if (!COPYABLE_FUNCTIONS.has(decoded.functionName)) {
    console.log(`[Arb] tx ${txHash}: ${decoded.functionName} not in copyable set, skipping`);
    return;
  }

  // Fetch Arbitrum tx receipt for gas cost
  const arbReceipt = await arbClient.getTransactionReceipt({ hash: txHash });
  const arbFeeWei = arbReceipt.gasUsed * arbReceipt.effectiveGasPrice;
  const arbFeeEth = formatEther(arbFeeWei);
  const ethPrice = await getEthPriceUsd();
  const arbFeeUsd = feeToUsd(arbFeeWei, ethPrice);

  console.log(`\n[Arb] Detected: ${decoded.functionName} | tx: ${txHash}`);
  console.log(`[Arb] Gas: ${arbReceipt.gasUsed} | fee: ${arbFeeEth} ETH ($${arbFeeUsd})`);

  const baseFee = await replayOnBase(decoded, tx.input, basePublic, baseWallet);

  if (baseFee) {
    const savings = Number(arbFeeUsd) - Number(baseFee.feeUsd);
    const savingsPct =
      Number(arbFeeUsd) > 0 ? ((savings / Number(arbFeeUsd)) * 100).toFixed(1) : "N/A";
    console.log(
      `[Compare] Arb: $${arbFeeUsd} → Base: $${baseFee.feeUsd} | savings: $${savings.toFixed(4)} (${savingsPct}%)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Watch modes
// ---------------------------------------------------------------------------

async function watchViaPolling(
  arbClient: PublicClient,
  basePublic: PublicClient,
  baseWallet: WalletClient<Transport, Chain, Account>,
) {
  console.log(`Polling every ${POLL_INTERVAL_MS}ms via getLogs on ${ARB_FUTURES_ADDRESS} ...`);
  let lastBlock = await arbClient.getBlockNumber();

  const poll = async () => {
    try {
      const currentBlock = await arbClient.getBlockNumber();
      if (currentBlock <= lastBlock) return;

      const rangeSize = currentBlock - lastBlock;
      console.log(`[Arb] Scanning blocks ${lastBlock + 1n}..${currentBlock} (${rangeSize} blocks)`);

      // Single RPC call: get all logs from the Futures contract in this range
      const logs = await arbClient.getLogs({
        address: ARB_FUTURES_ADDRESS,
        fromBlock: lastBlock + 1n,
        toBlock: currentBlock,
      });

      // Deduplicate tx hashes from the logs
      const txHashes = [...new Set(logs.map((log) => log.transactionHash))];

      if (txHashes.length > 0) {
        console.log(`[Arb] Found ${logs.length} events across ${txHashes.length} txs`);
      }

      for (const txHash of txHashes) {
        const tx = await arbClient.getTransaction({ hash: txHash });
        if (!tx) continue;

        if (tx.from.toLowerCase() !== MARKET_MAKER_ADDRESS) continue;

        await processTransaction(txHash, arbClient, basePublic, baseWallet);
      }

      lastBlock = currentBlock;
    } catch (err: any) {
      console.error("Poll error:", err.shortMessage ?? err.message);
    }
  };

  setInterval(poll, POLL_INTERVAL_MS);
  await poll();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  assertEnv();

  const arbClient = buildArbClient();
  const { publicClient: basePublic, walletClient: baseWallet, account } = buildBaseClients();

  console.log("=== Copytrade Bot ===");
  console.log(`Market maker (Arb):  ${MARKET_MAKER_ADDRESS}`);
  console.log(`Arb Futures:         ${ARB_FUTURES_ADDRESS}`);
  console.log(`Base Futures:        ${BASE_FUTURES_ADDRESS}`);
  console.log(`Copytrade wallet:    ${account.address}`);
  console.log(`Base RPC:            ${BASE_RPC_URL}`);
  console.log();

  const balance = await basePublic.getBalance({ address: account.address });
  console.log(`Wallet ETH balance (Base): ${formatEther(balance)}`);

  const ethPrice = await getEthPriceUsd();
  console.log(`ETH/USD price: $${ethPrice} (refreshes every ${ETH_PRICE_REFRESH_MS / 1000}s)`);

  if (balance === 0n) {
    console.warn("WARNING: wallet has 0 ETH on Base — transactions will fail");
  }

  await watchViaPolling(arbClient, basePublic, baseWallet);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
