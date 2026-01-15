import { privateKeyToAccount } from "viem/accounts";
import { Subgraph } from "./subgraph.ts";
import pino from "pino";
import { FuturesContract } from "./contract.ts";
import { NowSeconds, mult, wait, clamp, abs, roundToNearest, getGasFee } from "./lib.ts";
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
import { getConfig } from "./config.ts";
import { formatUnits } from "viem/utils";

export async function main() {
  const config = getConfig();
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
      LOOP_INTERVAL_MS: config.LOOP_INTERVAL_MS,
      MAX_POSITION: config.MAX_POSITION,
      RISK_AVERSION: config.RISK_AVERSION,
      SPREAD_AMOUNT: `${formatUnits(config.SPREAD_AMOUNT, 6)} USDC`,
      SUBGRAPH_URL: config.SUBGRAPH_URL,
    },
    "Config"
  );

  const subgraph = new Subgraph(config.SUBGRAPH_URL, config.SUBGRAPH_API_KEY);
  const contract = new FuturesContract(
    config.FUTURES_ADDRESS,
    config.ETH_NODE_URL,
    config.PRIVATE_KEY,
    config.CHAIN_ID
  );
  const volatilityDurationSeconds = 30 * 24 * 3600;
  const nowSeconds = NowSeconds();
  const historicalPrices = await subgraph.getHistoricalPrices(
    nowSeconds - volatilityDurationSeconds,
    nowSeconds
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
    "Derived data"
  );

  if (config.SPREAD_AMOUNT % tickSize !== 0n) {
    throw new Error(
      `Spread amount (${config.SPREAD_AMOUNT}) is not divisible by tick size (${tickSize}), please adjust the spread amount`
    );
  }

  const futuresBalance = await contract.getBalance();
  const usdcBalance = await contract.getUSDCBalance(contract.getWalletAddress());

  log.info(
    {
      futuresBalance: `${formatUnits(futuresBalance, 6)} USDC`,
      usdcBalance: `${formatUnits(usdcBalance, 6)} USDC`,
      floatAmount: `${formatUnits(config.FLOAT_AMOUNT, 6)} USDC`,
    },
    "Account balances"
  );

  if (futuresBalance < config.FLOAT_AMOUNT) {
    const depositAmount = config.FLOAT_AMOUNT - futuresBalance;
    if (depositAmount <= usdcBalance) {
      if (!config.DRY_RUN) {
        await contract.approve(depositAmount);
        const { blockNumber } = await contract.deposit(depositAmount);
        log.info(
          {
            depositAmount,
            blockNumber,
          },
          "Deposited to margin account"
        );
      } else {
        log.info("Dry run, skipping deposit");
      }
    } else {
      log.warn(
        { depositAmount, accountBalance: usdcBalance },
        "Deposit amount is greater than account balance, skipping..."
      );
    }
  }

  for (let iteration = 0; ; iteration++) {
    log.info({ iteration }, `\n\n\n\n================= Iteration =================`);
    // main loop
    // 1. Observe the market
    // 	•	Continuously read the best bid, best ask, and last traded price for the gold futures you care about.
    const marginAccountBalance = await contract.getBalance();
    const remainingGas = await contract.getETHBalance();
    const indexPrice = await contract.getIndexPrice();
    const deliveryDate = await contract.getCurrentDeliveryDate();
    const currentPosition = await subgraph.getCurrentPosition(
      BigInt(deliveryDate),
      config.DRY_RUN && config.DRY_RUN_WALLET_ADDRESS
        ? config.DRY_RUN_WALLET_ADDRESS
        : contract.getWalletAddress()
    );
    const unrealizedPnL = currentPosition.position * (indexPrice - currentPosition.averagePrice);

    const now = new Date();
    const nextMarginCallTime = new Date(now);
    nextMarginCallTime.setUTCHours(0, 0, config.MARGIN_CALL_TIME_SECONDS, 0);
    const remainingTimeToMarginCallHours =
      (nextMarginCallTime.getTime() - now.getTime()) / (3600 * 1000);

    log.info(`Margin account balance: $${formatUnits(marginAccountBalance, 6)}`);
    log.info(`Remaining gas: $${formatUnits(remainingGas, 18)} ETH`);

    log.info(
      {
        marginAccountBalance: `${formatUnits(marginAccountBalance, 6)} USDC`,
        remainingGas: `${formatUnits(remainingGas, 18)} ETH`,
      },
      "Margin account balance and remaining gas"
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
      "Market data"
    );

    // 	•	Optionally estimate a “fair” mid price (for example, midpoint of bid/ask) and some measure of recent volatility to know how “calm” or “wild” the market is.
    // const fairPrice = (price.bestBid + price.bestAsk) / 2n;
    let reservationPrice = calculateReservationPrice(
      indexPrice,
      currentPosition.position * contractMultiplier,
      config.RISK_AVERSION,
      volatilityPerHour,
      remainingTimeToMarginCallHours
    );
    reservationPrice = roundToNearest(reservationPrice, tickSize);
    log.info(
      {
        reservationPrice: `${formatUnits(reservationPrice, 6)} USDC`,
        priceShift: `${formatUnits(reservationPrice - indexPrice, 6)} USDC`,
      },
      "Reservation price"
    );

    // inventory skew shifts the middle price up or down based on the current position
    // const inventorySkew = (currentPosition.position * config.SPREAD_AMOUNT) / config.MAX_POSITION;

    // 2. Model the grid of orders based on the current price
    const budget = mult(config.FLOAT_AMOUNT, config.ACTIVE_QUOTING_AMOUNT_RATIO);

    // budget skew shifts the budget up or down based on the current position
    const normalizedInventory = clamp(
      Number(currentPosition.position) / Number(config.MAX_POSITION),
      -1,
      1
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
      "Bid and ask budgets"
    );
    // geometric taper allocations are used to distribute the budget across the grid levels
    // more distributed closer to the middle price, less further away
    const bidOrdersNotional = geometricTaperAllocations(bidBudget, Number(config.GRID_LEVELS));
    const askOrdersNotional = geometricTaperAllocations(askBudget, Number(config.GRID_LEVELS));
    let bidSpread = config.SPREAD_AMOUNT / 2n;
    let askSpread = config.SPREAD_AMOUNT / 2n;

    if (config.SPREAD_AMOUNT <= tickSize) {
      bidSpread = 0n;
      askSpread = config.SPREAD_AMOUNT;
    }
    // generate the contract total values for the different price levels
    const bidOrderValues = generateContractValues(
      (reservationPrice + bidSpread) * contractMultiplier,
      tickSize * contractMultiplier,
      -Number(config.GRID_LEVELS)
    );
    const askOrderValues = generateContractValues(
      (reservationPrice + askSpread) * contractMultiplier,
      tickSize * contractMultiplier,
      Number(config.GRID_LEVELS)
    );
    const bidOrders = currencyToQuantityAllocations(
      bidOrdersNotional.allocations.reverse(),
      bidOrderValues
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

    // 3. Query current orders
    const currentOrders = await subgraph.getCurrentOrders(
      BigInt(deliveryDate),
      config.DRY_RUN && config.DRY_RUN_WALLET_ADDRESS
        ? config.DRY_RUN_WALLET_ADDRESS
        : contract.getWalletAddress()
    );
    log.info(ordersToString(currentOrders), "Current orders");

    // 4. Calculate which orders to place to achieve modelled orders
    const ordersToPlace = calculateOrders(modelledOrders, currentOrders);
    log.info(ordersToString(ordersToPlace), "Orders to place");

    const ordersToPlaceWithDeliveryDate = ordersToPlace.map((order) => ({
      ...order,
      deliveryDate: BigInt(deliveryDate),
    }));

    if (ordersToPlaceWithDeliveryDate.length > 0) {
      if (!config.DRY_RUN) {
        const rec = await contract.placeOrders(ordersToPlaceWithDeliveryDate);
        log.info(
          {
            blockNumber: rec.blockNumber,
            gasFee: `${formatUnits(getGasFee(rec), 18)} ETH`,
          },
          "Orders placed"
        );
      } else {
        log.info("Dry run, skipping orders placement");
      }
    } else {
      log.info(`No orders to place, skipping...`);
    }

    // 5. Wait for someone to fill the orders and create a position, or loop interval
    await Promise.race([
      // contract.waitForPositionCreated(account.address, Number(blockNumber)).then(() => {
      //   log.info(`Position created, continuing...`);
      // }),
      wait(config.LOOP_INTERVAL_MS).then(() => {
        log.info(
          { LOOP_INTERVAL_MS: config.LOOP_INTERVAL_MS },
          "Loop interval timeout, continuing..."
        );
      }),
    ]);

    // 6. start over
  }
}
// wait for either fill or loop timeout

// calculate risk

// 3. Control spread and size
// 	•	When volatility increases or order flow looks “toxic” (prices jump quickly in one direction), widen the spread and/or reduce order size to protect yourself.
// 	•	When the market is calm, you can tighten the spread and maybe increase size to collect more small profits.
// 4. Track inventory (position)
// 	•	Keep track of how many gold futures contracts you are long or short.
// 	•	Define a maximum position in each direction (e.g., max +10 long, max −10 short); never quote in a way that easily pushes you beyond those limits.
// 5. Skew quotes based on inventory
// 	•	If you are too long (holding many contracts), you want to sell more and buy less, so you shift your quotes: move the bid down and/or ask down a bit to encourage selling and discourage more buying.
// 	•	If you are too short, do the opposite: move quotes up a bit to attract buys from you (so you can cover shorts) and discourage further shorting.
// 6. React to fills (trades)
// 	•	Whenever a customer order trades against your quote, update your position and record the trade price.
// 	•	After each fill, immediately recalculate and update your bid/ask, taking into account new inventory and any change in market conditions.
// 7. Monitor P&L and risk
// 	•	Continuously estimate unrealized P&L: how much you gain or lose if you mark your current position to the latest mid or last traded price.
// 	•	If losses or position get too large, have safety rules: widen spreads, reduce size, or temporarily stop quoting until risk is back under control.
// 8. Loop continuously
// 	•	The basic loop is: read market → compute quotes → place/modify/cancel orders → handle fills → update inventory and risk → repeat.
// 	•	For learning purposes, you can simulate this with a toy price process for gold (e.g., price around 2650) and random “customer” trades hitting your quotes, and then watch how your position, quotes, and P&L evolve over time.
