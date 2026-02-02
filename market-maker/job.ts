import { FuturesSubgraph } from "./clients/futures-subgraph.ts";
import { OraclesSubgraph } from "./clients/oracles-subgraph.ts";
import pino from "pino";
import { FuturesContract } from "./contract.ts";
import { NowSeconds, mult, clamp, roundToNearest, getGasFee } from "./lib.ts";
import {
  resampleHourlyClose,
  realizedVolatility,
  generateContractValues,
  geometricTaperAllocations,
  currencyToNotionalAllocations as currencyToQuantityAllocations,
  calculateReservationPrice,
  ordersToString,
  calculateOrders,
} from "./helpers.ts";
import { type RuntimeConfig } from "./config.ts";
import { formatUnits } from "viem/utils";

export type MarketMakerResult = {
  success: boolean;
  message: string;
  ordersPlaced: number;
  balances?: {
    ethBalance: string;
    usdcBalance: string;
    marginBalance: string;
  };
  insufficientFunds?: boolean;
};

/**
 * Run a single market maker iteration
 * Returns result indicating success/failure and details
 */
export async function runMarketMaker(config: RuntimeConfig): Promise<MarketMakerResult> {
  const log = pino({
    level: config.LOG_LEVEL,
  });
  
  log.info(
    {
      ACTIVE_QUOTING_AMOUNT_RATIO: config.ACTIVE_QUOTING_AMOUNT_RATIO,
      CHAIN_ID: config.CHAIN_ID,
      FLOAT_AMOUNT: `${formatUnits(config.FLOAT_AMOUNT, 6)} USDC`,
      FUTURES_ADDRESS: config.FUTURES_ADDRESS,
      GRID_LEVELS: config.GRID_LEVELS,
      LOG_LEVEL: config.LOG_LEVEL,
      MAX_POSITION: config.MAX_POSITION,
      RISK_AVERSION: config.RISK_AVERSION,
      SPREAD_AMOUNT: `${formatUnits(config.SPREAD_AMOUNT, 6)} USDC`,
      MIN_ETH_BALANCE: `${formatUnits(config.MIN_ETH_BALANCE, 18)} ETH`,
      MIN_USDC_BALANCE: `${formatUnits(config.MIN_USDC_BALANCE, 6)} USDC`,
    },
    "Config",
  );

  const futuresSubgraph = new FuturesSubgraph(config.FUTURES_SUBGRAPH_URL);
  const oraclesSubgraph = new OraclesSubgraph(config.ORACLES_SUBGRAPH_URL);
  const contract = new FuturesContract(
    config.FUTURES_ADDRESS,
    config.ETH_NODE_URL,
    config.PRIVATE_KEY,
    config.CHAIN_ID,
  );

  // Check ETH balance first (needed for gas)
  const ethBalance = await contract.getETHBalance();
  const usdcBalance = await contract.getUSDCBalance(contract.getWalletAddress());
  const marginBalance = await contract.getBalance();

  const balances = {
    ethBalance: formatUnits(ethBalance, 18),
    usdcBalance: formatUnits(usdcBalance, 6),
    marginBalance: formatUnits(marginBalance, 6),
  };

  log.info(
    {
      ethBalance: `${balances.ethBalance} ETH`,
      usdcBalance: `${balances.usdcBalance} USDC`,
      marginBalance: `${balances.marginBalance} USDC`,
      minEthRequired: `${formatUnits(config.MIN_ETH_BALANCE, 18)} ETH`,
      minUsdcRequired: `${formatUnits(config.MIN_USDC_BALANCE, 6)} USDC`,
    },
    "Balance check",
  );

  // Check minimum ETH balance (for gas)
  if (ethBalance < config.MIN_ETH_BALANCE) {
    const message = `Insufficient ETH for gas: ${balances.ethBalance} ETH < ${formatUnits(config.MIN_ETH_BALANCE, 18)} ETH required`;
    log.warn({ ethBalance: balances.ethBalance, minRequired: formatUnits(config.MIN_ETH_BALANCE, 18) }, message);
    return {
      success: false,
      message,
      ordersPlaced: 0,
      balances,
      insufficientFunds: true,
    };
  }

  // Check minimum USDC balance (margin account + wallet)
  const totalUsdc = marginBalance + usdcBalance;
  if (totalUsdc < config.MIN_USDC_BALANCE) {
    const message = `Insufficient USDC: ${formatUnits(totalUsdc, 6)} USDC < ${formatUnits(config.MIN_USDC_BALANCE, 6)} USDC required`;
    log.warn({ totalUsdc: formatUnits(totalUsdc, 6), minRequired: formatUnits(config.MIN_USDC_BALANCE, 6) }, message);
    return {
      success: false,
      message,
      ordersPlaced: 0,
      balances,
      insufficientFunds: true,
    };
  }

  // Get historical prices for volatility calculation
  const volatilityDurationSeconds = 30 * 24 * 3600;
  const nowSeconds = NowSeconds();
  const historicalPrices = await oraclesSubgraph.getHistoricalPrices(
    nowSeconds - volatilityDurationSeconds,
    nowSeconds,
  );
  const resampledPrices = resampleHourlyClose(historicalPrices, 3600);
  const { sigmaPerStep: volatilityPerHour } = realizedVolatility(resampledPrices);
  const contractMultiplier = BigInt(await contract.getContractMultiplier());
  const tickSize = await contract.getTickSize();
  
  log.info(
    {
      contractMultiplier,
      walletAddress: contract.getWalletAddress(),
      volatilityPerHour,
      tickSize,
      commitHash: config.COMMIT_HASH,
    },
    "Derived data",
  );

  if (config.SPREAD_AMOUNT % tickSize !== 0n) {
    throw new Error(
      `Spread amount (${config.SPREAD_AMOUNT}) is not divisible by tick size (${tickSize}), please adjust the spread amount`,
    );
  }

  // Handle margin account funding
  if (marginBalance < config.FLOAT_AMOUNT) {
    const depositAmount = config.FLOAT_AMOUNT - marginBalance;
    if (depositAmount <= usdcBalance) {
      if (!config.DRY_RUN) {
        await contract.approve(depositAmount);
        const { blockNumber } = await contract.deposit(depositAmount);
        log.info(
          {
            depositAmount: formatUnits(depositAmount, 6),
            blockNumber,
          },
          "Deposited to margin account",
        );
      } else {
        log.info("Dry run, skipping deposit");
      }
    } else {
      log.warn(
        { depositAmount: formatUnits(depositAmount, 6), accountBalance: balances.usdcBalance },
        "Deposit amount is greater than account balance, skipping...",
      );
    }
  }

  // Main market making logic
  log.info("================= Market Maker Iteration =================");
  
  const marginAccountBalance = await contract.getBalance();
  const remainingGas = await contract.getETHBalance();
  const indexPrice = await contract.getIndexPrice();
  const deliveryDate = await contract.getCurrentDeliveryDate();
  const currentPosition = await futuresSubgraph.getCurrentPosition(
    BigInt(deliveryDate),
    config.DRY_RUN && config.DRY_RUN_WALLET_ADDRESS
      ? config.DRY_RUN_WALLET_ADDRESS
      : contract.getWalletAddress(),
  );
  const unrealizedPnL = currentPosition.position * (indexPrice - currentPosition.averagePrice);

  const now = new Date();
  const nextMarginCallTime = new Date(now);
  nextMarginCallTime.setUTCHours(0, 0, config.MARGIN_CALL_TIME_SECONDS, 0);
  const remainingTimeToMarginCallHours =
    (nextMarginCallTime.getTime() - now.getTime()) / (3600 * 1000);

  log.info(
    {
      marginAccountBalance: `${formatUnits(marginAccountBalance, 6)} USDC`,
      remainingGas: `${formatUnits(remainingGas, 18)} ETH`,
    },
    "Margin account balance and remaining gas",
  );

  log.info(
    {
      indexPrice: `${formatUnits(indexPrice, 6)} USDC`,
      deliveryDate: new Date(deliveryDate * 1000).toISOString(),
      currentPosition: currentPosition.position,
      currentAveragePrice: `${formatUnits(currentPosition.averagePrice, 6)} USDC`,
      unrealizedPnL: `${formatUnits(unrealizedPnL, 6)} USDC`,
      remainingTimeToMarginCallHours,
      volatilityPerHour,
    },
    "Market data",
  );

  // Calculate reservation price
  let reservationPrice = calculateReservationPrice(
    indexPrice,
    currentPosition.position * contractMultiplier,
    config.RISK_AVERSION,
    volatilityPerHour,
    remainingTimeToMarginCallHours,
  );
  reservationPrice = roundToNearest(reservationPrice, tickSize);
  log.info(
    {
      reservationPrice: `${formatUnits(reservationPrice, 6)} USDC`,
      priceShift: `${formatUnits(reservationPrice - indexPrice, 6)} USDC`,
    },
    "Reservation price",
  );

  // Model the grid of orders based on the current price
  const budget = mult(config.FLOAT_AMOUNT, config.ACTIVE_QUOTING_AMOUNT_RATIO);

  // Budget skew based on current position
  const normalizedInventory = clamp(
    Number(currentPosition.position) / Number(config.MAX_POSITION),
    -1,
    1,
  );
  const bidSkew = clamp(1 - Math.max(normalizedInventory, 0), 0, null);
  const askSkew = clamp(1 + Math.min(normalizedInventory, 0), 0, null);

  const bidBudget = mult(budget / 2n, bidSkew);
  const askBudget = mult(budget / 2n, askSkew);

  log.info(
    {
      bidSkew,
      askSkew,
      budget: `${formatUnits(budget, 6)} USDC`,
      bidBudget: `${formatUnits(bidBudget, 6)} USDC`,
      askBudget: `${formatUnits(askBudget, 6)} USDC`,
    },
    "Bid and ask budgets",
  );

  // Generate grid orders
  const bidOrdersNotional = geometricTaperAllocations(bidBudget, Number(config.GRID_LEVELS));
  const askOrdersNotional = geometricTaperAllocations(askBudget, Number(config.GRID_LEVELS));
  let bidSpread = config.SPREAD_AMOUNT / 2n;
  let askSpread = config.SPREAD_AMOUNT / 2n;

  if (config.SPREAD_AMOUNT <= tickSize) {
    bidSpread = 0n;
    askSpread = config.SPREAD_AMOUNT;
  }

  const bidOrderValues = generateContractValues(
    (reservationPrice + bidSpread) * contractMultiplier,
    tickSize * contractMultiplier,
    -Number(config.GRID_LEVELS),
  );
  const askOrderValues = generateContractValues(
    (reservationPrice + askSpread) * contractMultiplier,
    tickSize * contractMultiplier,
    Number(config.GRID_LEVELS),
  );
  const bidOrders = currencyToQuantityAllocations(
    bidOrdersNotional.allocations.reverse(),
    bidOrderValues,
  );
  const askOrders = currencyToQuantityAllocations(askOrdersNotional.allocations, askOrderValues);

  const modelledOrders: { price: bigint; qty: bigint }[] = [];
  for (let i = 0; i < bidOrders.result.length; i++) {
    modelledOrders.push({
      price: bidOrderValues[i] / contractMultiplier,
      qty: bidOrders.result[i],
    });
  }
  for (let i = 0; i < askOrders.result.length; i++) {
    modelledOrders.push({
      price: askOrderValues[i] / contractMultiplier,
      qty: -askOrders.result[i],
    });
  }
  log.info(ordersToString(modelledOrders), "Modelled orders");

  // Query current orders
  const currentOrders = await futuresSubgraph.getCurrentOrders(
    BigInt(deliveryDate),
    config.DRY_RUN && config.DRY_RUN_WALLET_ADDRESS
      ? config.DRY_RUN_WALLET_ADDRESS
      : contract.getWalletAddress(),
  );
  log.info(ordersToString(currentOrders), "Current orders");

  // Calculate which orders to place
  const ordersToPlace = calculateOrders(modelledOrders, currentOrders);
  log.info(ordersToString(ordersToPlace), "Orders to place");

  const ordersToPlaceWithDeliveryDate = ordersToPlace.map((order) => ({
    ...order,
    deliveryDate: BigInt(deliveryDate),
  }));

  let ordersPlaced = 0;
  if (ordersToPlaceWithDeliveryDate.length > 0) {
    if (!config.DRY_RUN) {
      const rec = await contract.placeOrders(ordersToPlaceWithDeliveryDate);
      ordersPlaced = ordersToPlaceWithDeliveryDate.length;
      log.info(
        {
          blockNumber: rec.blockNumber,
          gasFee: `${formatUnits(getGasFee(rec), 18)} ETH`,
          ordersPlaced,
        },
        "Orders placed",
      );
    } else {
      log.info("Dry run, skipping orders placement");
    }
  } else {
    log.info("No orders to place, skipping...");
  }

  return {
    success: true,
    message: ordersPlaced > 0 ? `Placed ${ordersPlaced} orders` : "No orders needed",
    ordersPlaced,
    balances: {
      ethBalance: formatUnits(remainingGas, 18),
      usdcBalance: formatUnits(usdcBalance, 6),
      marginBalance: formatUnits(marginAccountBalance, 6),
    },
  };
}
