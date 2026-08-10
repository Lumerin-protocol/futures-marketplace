import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { assertAbiFunctionCoverage, GasRecorder, writeSnapshot } from "@lsheva/evm-gas-benchmark";
import { network } from "hardhat";
import { type Address, encodeFunctionData, type Hash, type PublicClient, parseUnits } from "viem";
import { HashPowerFuturesAbi } from "../../abi/HashPowerFutures.ts";
import type { FuturesFixture } from "../fixtures.ts";
import { TimeInForce } from "../timeInForce.ts";
import { refreshHashprice, scaleHashprice } from "../utils.ts";
import { deployFuturesGasFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();
const gas = new GasRecorder();
const SNAPSHOT_PATH = fileURLToPath(new URL("../../benchmarks/futures-gas.json", import.meta.url));
const TRADING_BALANCE = parseUnits("5000", 6);

type GasFixture = FuturesFixture;
type HashPowerFuturesContract = GasFixture["contracts"]["futures"];
type OrderIntent = {
  price: bigint;
  expirationAt: bigint;
  quantity: bigint;
  timeInForce: number;
};

const exclusions = {
  "initialize(address,uint8,uint8,uint256)":
    "The deployed UUPS proxy is already initialized, while the implementation constructor disables initializers; no successful independent call exists after deployment.",
  "proxiableUUID()":
    "OpenZeppelin UUPS marks proxiableUUID notDelegated, so it intentionally reverts through the deployed proxy and is callable only on the implementation.",
} as const;

async function fresh(): Promise<GasFixture> {
  return networkHelpers.loadFixture(deployFuturesGasFixture);
}

async function receiptGas(pc: PublicClient, hash: Hash) {
  const receipt = await pc.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return receipt;
}

async function recordTransaction(
  pc: PublicClient,
  signature: string,
  scenario: string,
  transaction: Promise<Hash>,
) {
  gas.recordTransaction({ function: signature, scenario }, await receiptGas(pc, await transaction));
}

async function recordView(
  pc: PublicClient,
  futures: HashPowerFuturesContract,
  signature: string,
  functionName: string,
  args: readonly unknown[] = [],
  scenario = "representative",
  account?: Address,
) {
  const data = encodeFunctionData({
    abi: HashPowerFuturesAbi,
    functionName,
    args,
  } as never);
  const estimated = await pc.estimateGas({
    to: futures.address,
    data,
    ...(account === undefined ? {} : { account }),
  });
  gas.recordViewEstimate({ function: signature, scenario }, estimated);
}

async function fund(
  data: GasFixture,
  participants: Array<GasFixture["accounts"]["seller"]>,
  amount = TRADING_BALANCE,
) {
  for (const participant of participants) {
    await data.contracts.collateralVault.write.deposit([amount], {
      account: participant.account,
    });
  }
}

function restingIntents(
  count: number,
  price: bigint,
  expirations: readonly bigint[],
  start = 0,
): OrderIntent[] {
  return Array.from({ length: count }, (_, offset) => ({
    price,
    expirationAt: expirations[(start + offset) % expirations.length],
    quantity: -1n,
    timeInForce: TimeInForce.GTC,
  }));
}

async function openPosition(data: GasFixture, expirationAt: bigint, quantity = 1n, price?: bigint) {
  const { futures } = data.contracts;
  const { seller, buyer } = data.accounts;
  const tradePrice = price ?? (await futures.read.getMarketPrice());
  await futures.write.createOrder([tradePrice, expirationAt, -quantity, TimeInForce.GTC], {
    account: seller.account,
  });
  await futures.write.createOrder([tradePrice, expirationAt, quantity, TimeInForce.GTC], {
    account: buyer.account,
  });
  return tradePrice;
}

async function setupOrderLiquidation() {
  const data = await fresh();
  const { futures, collateralVault } = data.contracts;
  const { owner, seller, buyer, buyer2 } = data.accounts;
  const price = await futures.read.getMarketPrice();
  const expirationAt = data.config.deliveryDates[0];

  await collateralVault.write.deposit([price * 3n], { account: seller.account });
  await collateralVault.write.deposit([(price * 4n) / 5n], { account: buyer.account });
  await collateralVault.write.deposit([price * 3n], { account: buyer2.account });
  await openPosition(data, expirationAt, 1n, price);
  await futures.write.createOrders(
    [
      [
        { price, expirationAt, quantity: 1n, timeInForce: TimeInForce.GTC },
        { price, expirationAt, quantity: 1n, timeInForce: TimeInForce.GTC },
      ],
    ],
    { account: buyer.account },
  );
  await futures.write.setLiquidationFeeBps([50], { account: owner.account });
  await scaleHashprice(data.contracts.hashpriceUsd, 1n, 20n);
  assert.equal(await futures.read.isLiquidatable([buyer.account.address]), true);
  return data;
}

async function setupPositionLiquidation() {
  const data = await fresh();
  const { futures, portfolioMarginEngine, collateralVault } = data.contracts;
  const { owner, seller, buyer, buyer2 } = data.accounts;
  const price = await futures.read.getMarketPrice();
  const expirationAt = data.config.deliveryDates[0];
  const quantity = 10n;

  await portfolioMarginEngine.write.setShocks(
    [parseUnits("0.20", 18), parseUnits("0.10", 18), 0n, 0n],
    { account: owner.account },
  );
  await collateralVault.write.deposit([price * 100n], { account: seller.account });
  await collateralVault.write.deposit([(price * 22n) / 10n], { account: buyer.account });
  await collateralVault.write.deposit([price * 100n], { account: buyer2.account });
  await openPosition(data, expirationAt, quantity, price);
  await scaleHashprice(data.contracts.hashpriceUsd, 85n, 100n);
  assert.equal(await futures.read.isLiquidatable([buyer.account.address]), true);
  return { ...data, liquidation: { expirationAt, quantity } };
}

async function benchmarkViews() {
  const data = await fresh();
  const { futures } = data.contracts;
  const { seller, buyer, pc } = data.accounts;
  const [firstExpiration, secondExpiration, thirdExpiration] = data.config.deliveryDates;
  const price = await futures.read.getMarketPrice();
  const step = data.config.priceLadderStep;

  await fund(data, [seller, buyer]);
  await futures.write.createOrder([price + step, firstExpiration, -2n, TimeInForce.GTC], {
    account: seller.account,
  });
  await futures.write.createOrder([price - step, secondExpiration, 3n, TimeInForce.GTC], {
    account: buyer.account,
  });
  await openPosition(data, thirdExpiration, 1n, price);
  const [sellerOrder] = await futures.read.getUserOrders([seller.account.address]);

  const calls: Array<[string, string, (readonly unknown[])?]> = [
    ["CONTRACT_SIZE_HPS_DAY()", "CONTRACT_SIZE_HPS_DAY"],
    ["EXPIRATION_INTERVAL_DAYS()", "EXPIRATION_INTERVAL_DAYS"],
    ["MAX_ORACLE_STALENESS()", "MAX_ORACLE_STALENESS"],
    ["QUANTITY_DECIMALS()", "QUANTITY_DECIMALS"],
    [
      "MAX_ORDERS_PER_PARTICIPANT_PER_EXPIRATION()",
      "MAX_ORDERS_PER_PARTICIPANT_PER_EXPIRATION",
    ],
    ["MAX_PRICE_LEVELS_PER_SIDE()", "MAX_PRICE_LEVELS_PER_SIDE"],
    ["UPGRADE_INTERFACE_VERSION()", "UPGRADE_INTERFACE_VERSION"],
    ["VERSION()", "VERSION"],
    ["collectedFeesBalance()", "collectedFeesBalance"],
    ["expirationIntervalDays()", "expirationIntervalDays"],
    ["firstFutureExpirationDate()", "firstFutureExpirationDate"],
    ["futureExpirationDatesCount()", "futureExpirationDatesCount"],
    ["getActiveExpirationDates(address)", "getActiveExpirationDates", [buyer.account.address]],
    ["getBestAskPrice(uint256)", "getBestAskPrice", [firstExpiration]],
    ["getBestBidPrice(uint256)", "getBestBidPrice", [secondExpiration]],
    ["getExpirationDates()", "getExpirationDates"],
    ["getMarketPrice()", "getMarketPrice"],
    ["getNetPositionDelta(address)", "getNetPositionDelta", [buyer.account.address]],
    ["getOrder(bytes32)", "getOrder", [sellerOrder]],
    ["getOrderAggregate(address)", "getOrderAggregate", [seller.account.address]],
    [
      "getOrderAggregateAtExpiration(address,uint256)",
      "getOrderAggregateAtExpiration",
      [seller.account.address, firstExpiration],
    ],
    ["getOrderBookPrices(uint256,uint256)", "getOrderBookPrices", [firstExpiration, 10n]],
    [
      "getQuantityAtPrice(uint256,uint256,bool)",
      "getQuantityAtPrice",
      [firstExpiration, price + step, false],
    ],
    ["getRiskView(address)", "getRiskView", [seller.account.address]],
    ["hasRestingOrderDelta(address)", "hasRestingOrderDelta", [seller.account.address]],
    ["getUnrealizedPnl(address)", "getUnrealizedPnl", [buyer.account.address]],
    ["getUserOrders(address)", "getUserOrders", [seller.account.address]],
    [
      "getUserOrdersAtExpiration(address,uint256)",
      "getUserOrdersAtExpiration",
      [seller.account.address, firstExpiration],
    ],
    [
      "getUserPosition(address,uint256)",
      "getUserPosition",
      [buyer.account.address, thirdExpiration],
    ],
    ["hook()", "hook"],
    ["isLiquidatable(address)", "isLiquidatable", [buyer.account.address]],
    ["liquidationFeeBps()", "liquidationFeeBps"],
    ["liquidationMarginPercent()", "liquidationMarginPercent"],
    ["liquidatorShareBps()", "liquidatorShareBps"],
    ["makerFeeBps()", "makerFeeBps"],
    ["minimumPriceIncrement()", "minimumPriceIncrement"],
    ["owner()", "owner"],
    ["portfolioMargin()", "portfolioMargin"],
    ["priceOracle()", "priceOracle"],
    ["settlementPrice(uint256)", "settlementPrice", [firstExpiration]],
    ["takerFeeBps()", "takerFeeBps"],
    ["vault()", "vault"],
  ];
  for (const [signature, functionName, args = []] of calls) {
    await recordView(pc, futures, signature, functionName, args);
  }
  await recordView(
    pc,
    futures,
    "simulateOrder(uint256,uint256,int256)",
    "simulateOrder",
    [firstExpiration, price + step, 1n],
    "one-level fill",
    buyer.account.address,
  );
}

async function benchmarkScaledRiskViews() {
  const data = await fresh();
  const { futures } = data.contracts;
  const { seller, pc } = data.accounts;
  const price = await futures.read.getMarketPrice();
  const expirations = data.config.deliveryDates.slice(0, 3);
  await fund(data, [seller]);

  let existing = 0;
  for (const target of [0, 1, 5, 10, 25, 50, 100]) {
    if (target > existing) {
      await futures.write.createOrders(
        [
          restingIntents(
            target - existing,
            price + data.config.priceLadderStep,
            expirations,
            existing,
          ),
        ],
        { account: seller.account },
      );
      existing = target;
    }
    const expirationCount = Math.min(target, 3);
    const scenario = `${target}-orders-${expirationCount}-expirations`;
    await recordView(
      pc,
      futures,
      "getRiskView(address)",
      "getRiskView",
      [seller.account.address],
      scenario,
    );
  }
}

async function benchmarkAskLadderInsertion(
  scenario: string,
  selectPrice: (marketPrice: bigint, tick: bigint, prices: bigint[]) => bigint,
) {
  const data = await fresh();
  const { futures } = data.contracts;
  const { seller, pc } = data.accounts;
  const marketPrice = await futures.read.getMarketPrice();
  const tick = data.config.priceLadderStep;
  const expirationAt = data.config.deliveryDates[0];
  const prices = Array.from({ length: 10 }, (_, index) => marketPrice + BigInt((index + 1) * 2) * tick);
  await fund(data, [seller]);
  await futures.write.createOrders(
    [
      prices.map((price) => ({
        price,
        expirationAt,
        quantity: -1n,
        timeInForce: TimeInForce.GTC,
      })),
    ],
    { account: seller.account },
  );

  await recordTransaction(
    pc,
    "createOrder(uint256,uint256,int256,uint8)",
    scenario,
    futures.write.createOrder(
      [selectPrice(marketPrice, tick, prices), expirationAt, -1n, TimeInForce.GTC],
      { account: seller.account },
    ),
  );
}

async function benchmarkOrderPlacement() {
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { seller, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    await fund(data, [seller]);
    await recordTransaction(
      pc,
      "createOrder(uint256,uint256,int256,uint8)",
      "resting order",
      futures.write.createOrder([price, data.config.deliveryDates[0], -1n, TimeInForce.GTC], {
        account: seller.account,
      }),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { seller, buyer, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller, buyer]);
    await futures.write.createOrder([price, expirationAt, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await recordTransaction(
      pc,
      "createOrder(uint256,uint256,int256,uint8)",
      "full match",
      futures.write.createOrder([price, expirationAt, 1n, TimeInForce.GTC], {
        account: buyer.account,
      }),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { owner, seller, buyer, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    const points = await viem.deployContract("Points", [owner.account.address]);
    const pointsHook = await viem.deployContract("PointsHook", [
      points.address,
      owner.account.address,
      10n ** 18n,
      10n ** 18n,
      parseUnits("10", 6),
    ]);
    await points.write.grantRole([await points.read.MINTER_ROLE(), pointsHook.address], {
      account: owner.account,
    });
    await pointsHook.write.grantRole([await pointsHook.read.HOOK_CALLER_ROLE(), futures.address], {
      account: owner.account,
    });
    await futures.write.setHook([pointsHook.address], { account: owner.account });
    await fund(data, [seller, buyer]);
    await futures.write.createOrder([price, expirationAt, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder(
      [price + data.config.priceLadderStep, expirationAt, -1n, TimeInForce.GTC],
      { account: seller.account },
    );
    await recordTransaction(
      pc,
      "createOrder(uint256,uint256,int256,uint8)",
      "two-level fill with points hook",
      futures.write.createOrder(
        [price + data.config.priceLadderStep, expirationAt, 2n, TimeInForce.IOC],
        { account: buyer.account },
      ),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { seller, buyer, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller, buyer]);
    await futures.write.createOrder([price, expirationAt, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([price, expirationAt, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    await recordTransaction(
      pc,
      "createOrder(uint256,uint256,int256,uint8)",
      "portfolio-reducing resting order",
      futures.write.createOrder(
        [price + data.config.priceLadderStep, expirationAt, -1n, TimeInForce.GTC],
        {
          account: buyer.account,
        },
      ),
    );
  }
  await benchmarkAskLadderInsertion(
    "resting existing price in 10-level ask ladder",
    (_marketPrice, _tick, prices) => prices[4],
  );
  await benchmarkAskLadderInsertion(
    "resting head of 10-level ask ladder",
    (marketPrice, tick) => marketPrice + tick,
  );
  await benchmarkAskLadderInsertion(
    "resting middle of 10-level ask ladder",
    (marketPrice, tick) => marketPrice + 11n * tick,
  );
  await benchmarkAskLadderInsertion(
    "resting tail of 10-level ask ladder",
    (marketPrice, tick) => marketPrice + 21n * tick,
  );

  for (const size of [1, 5, 10]) {
    const data = await fresh();
    const { futures } = data.contracts;
    const { seller, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    await fund(data, [seller]);
    await recordTransaction(
      pc,
      "createOrders((uint256,uint256,int256,uint8)[])",
      `batch-${size}`,
      futures.write.createOrders(
        [
          restingIntents(
            size,
            price + data.config.priceLadderStep,
            data.config.deliveryDates.slice(0, 3),
          ),
        ],
        { account: seller.account },
      ),
    );
  }

  for (const size of [1, 5, 10]) {
    const data = await fresh();
    const { futures } = data.contracts;
    const { seller, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller]);
    await futures.write.createOrders(
      [
        Array.from({ length: size * 2 }, (_, index) => ({
          price: price + BigInt(index + 1) * data.config.priceLadderStep,
          expirationAt,
          quantity: -2n,
          timeInForce: TimeInForce.GTC,
        })),
      ],
      { account: seller.account },
    );
    const ids = await futures.read.getUserOrders([seller.account.address]);
    const creates = Array.from({ length: size }, (_, index) => ({
      price: price + BigInt(size * 2 + index + 1) * data.config.priceLadderStep,
      expirationAt,
      quantity: -1n,
      timeInForce: TimeInForce.GTC,
    }));
    await recordTransaction(
      pc,
      "updateOrders(bytes32[],(bytes32,int256)[],(uint256,uint256,int256,uint8)[])",
      `cancel-${size}-reduce-${size}-create-${size}`,
      futures.write.updateOrders(
        [
          ids.slice(0, size),
          ids.slice(size).map((orderId) => ({ orderId, newQuantity: -1n })),
          creates,
        ],
        { account: seller.account },
      ),
    );
  }
}

async function benchmarkOrderMaintenance() {
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { seller, buyer, pc, tc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller]);
    await futures.write.createOrders(
      [
        [
          { price, expirationAt, quantity: -1n, timeInForce: TimeInForce.GTC },
          {
            price: price + data.config.priceLadderStep,
            expirationAt,
            quantity: -4n,
            timeInForce: TimeInForce.GTC,
          },
          {
            price: price + 2n * data.config.priceLadderStep,
            expirationAt,
            quantity: -1n,
            timeInForce: TimeInForce.GTC,
          },
          {
            price: price + 3n * data.config.priceLadderStep,
            expirationAt,
            quantity: -1n,
            timeInForce: TimeInForce.GTC,
          },
        ],
      ],
      { account: seller.account },
    );
    const [cancelId, reduceId, outdatedId, outdatedBatchId] = await futures.read.getUserOrders([
      seller.account.address,
    ]);

    await recordTransaction(
      pc,
      "cancelOrder(bytes32)",
      "resting order",
      futures.write.cancelOrder([cancelId], { account: seller.account }),
    );
    await recordTransaction(
      pc,
      "reduceOrderSize(bytes32,int256)",
      "four-to-one",
      futures.write.reduceOrderSize([reduceId, -1n], { account: seller.account }),
    );
    await tc.setNextBlockTimestamp({ timestamp: expirationAt + 1n });
    await recordTransaction(
      pc,
      "removeOutdatedOrders(bytes32[])",
      "permissionless expired order batch-2",
      futures.write.removeOutdatedOrders([[outdatedId, outdatedBatchId]], { account: buyer.account }),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { seller, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller]);
    await futures.write.createOrder([price, expirationAt, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    const [orderId] = await futures.read.getUserOrders([seller.account.address]);
    await recordTransaction(
      pc,
      "updateOrders(bytes32[],(bytes32,int256)[],(uint256,uint256,int256,uint8)[])",
      "cancel-only",
      futures.write.updateOrders([[orderId], [], []], { account: seller.account }),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { seller, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller]);
    await futures.write.createOrder([price, expirationAt, -4n, TimeInForce.GTC], {
      account: seller.account,
    });
    const [orderId] = await futures.read.getUserOrders([seller.account.address]);
    await recordTransaction(
      pc,
      "updateOrders(bytes32[],(bytes32,int256)[],(uint256,uint256,int256,uint8)[])",
      "reduce-only",
      futures.write.updateOrders([[], [{ orderId, newQuantity: -1n }], []], {
        account: seller.account,
      }),
    );
  }
}

async function benchmarkSettlement() {
  {
    const data = await fresh();
    const { futures, hashpriceUsd } = data.contracts;
    const { buyer2, pc, tc } = data.accounts;
    const expirationAt = data.config.deliveryDates[0];
    await refreshHashprice(hashpriceUsd, expirationAt);
    await tc.setNextBlockTimestamp({ timestamp: expirationAt });
    await recordTransaction(
      pc,
      "recordSettlementPrice(uint256)",
      "first pin",
      futures.write.recordSettlementPrice([expirationAt], { account: buyer2.account }),
    );
  }
  {
    const data = await fresh();
    const { futures, hashpriceUsd } = data.contracts;
    const { seller, buyer, buyer2, pc, tc } = data.accounts;
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller, buyer]);
    await openPosition(data, expirationAt);
    await scaleHashprice(hashpriceUsd, 12n, 10n);
    await refreshHashprice(hashpriceUsd, expirationAt);
    await tc.setNextBlockTimestamp({ timestamp: expirationAt });
    await recordTransaction(
      pc,
      "settlePosition(address,uint256)",
      "matured position with pnl",
      futures.write.settlePosition([buyer.account.address, expirationAt], {
        account: buyer2.account,
      }),
    );
  }
  {
    const data = await fresh();
    const { futures, hashpriceUsd } = data.contracts;
    const { seller, buyer, buyer2, pc, tc } = data.accounts;
    const expirationAt = data.config.deliveryDates[0];
    const price = await futures.read.getMarketPrice();
    await fund(data, [seller, buyer, buyer2]);
    await futures.write.createOrder([price, expirationAt, -2n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([price, expirationAt, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    await futures.write.createOrder([price, expirationAt, 1n, TimeInForce.GTC], {
      account: buyer2.account,
    });
    await scaleHashprice(hashpriceUsd, 12n, 10n);
    await refreshHashprice(hashpriceUsd, expirationAt);
    await tc.setNextBlockTimestamp({ timestamp: expirationAt });
    await recordTransaction(
      pc,
      "settlePositions(address[],uint256[])",
      "batch-2",
      futures.write.settlePositions(
        [
          [buyer.account.address, buyer2.account.address],
          [expirationAt, expirationAt],
        ],
        { account: seller.account },
      ),
    );
  }
}

async function benchmarkLiquidations() {
  {
    const data = await setupOrderLiquidation();
    const { futures } = data.contracts;
    const { buyer, buyer2, pc } = data.accounts;
    const [orderId] = await futures.read.getUserOrders([buyer.account.address]);
    await recordTransaction(
      pc,
      "liquidateOrder(address,bytes32)",
      "one underwater resting order",
      futures.write.liquidateOrder([buyer.account.address, orderId], {
        account: buyer2.account,
      }),
    );
  }
  {
    const data = await setupOrderLiquidation();
    const { futures } = data.contracts;
    const { buyer, buyer2, pc } = data.accounts;
    const orderIds = await futures.read.getUserOrders([buyer.account.address]);
    await recordTransaction(
      pc,
      "liquidateOrders(address,bytes32[])",
      "batch-2",
      futures.write.liquidateOrders([buyer.account.address, orderIds], {
        account: buyer2.account,
      }),
    );
  }
  {
    const data = await setupOrderLiquidation();
    const { futures } = data.contracts;
    const { buyer, buyer2, pc } = data.accounts;
    const orderIds = await futures.read.getUserOrders([buyer.account.address]);
    const staleIds = [1n, 2n, 3n].map((id) => `0x${id.toString(16).padStart(64, "0")}` as Hash);
    await recordTransaction(
      pc,
      "liquidateOrders(address,bytes32[])",
      "three stale ids then batch-2",
      futures.write.liquidateOrders([buyer.account.address, [...staleIds, ...orderIds]], {
        account: buyer2.account,
      }),
    );
  }
  {
    const data = await setupPositionLiquidation();
    const { futures } = data.contracts;
    const { buyer, buyer2, pc } = data.accounts;
    await recordTransaction(
      pc,
      "liquidatePosition(address,uint256,uint256)",
      "partial close",
      futures.write.liquidatePosition([buyer.account.address, data.liquidation.expirationAt, 2n], {
        account: buyer2.account,
      }),
    );
  }
  {
    const data = await setupPositionLiquidation();
    const { futures } = data.contracts;
    const { buyer, buyer2, pc } = data.accounts;
    await recordTransaction(
      pc,
      "liquidatePositions(address,uint256[],uint256[])",
      "skip-empty-then-partial-close",
      futures.write.liquidatePositions(
        [
          buyer.account.address,
          [data.config.deliveryDates[1], data.liquidation.expirationAt],
          [1n, 2n],
        ],
        { account: buyer2.account },
      ),
    );
  }
}

async function benchmarkAdminAndLifecycle() {
  {
    const data = await fresh();
    const { futures, hashpriceUsd, portfolioMarginEngine } = data.contracts;
    const { owner, pc } = data.accounts;
    const feed = await viem.deployContract("PriceFeedMock", [8, "gas benchmark"]);
    await feed.write.setPrice([parseUnits("34.4", 8)]);

    await recordTransaction(
      pc,
      "setLiquidationMarginPercent(uint8)",
      "20-to-25",
      futures.write.setLiquidationMarginPercent([25], { account: owner.account }),
    );
    await recordTransaction(
      pc,
      "setFutureExpirationDatesCount(uint8)",
      "10-to-8",
      futures.write.setFutureExpirationDatesCount([8], { account: owner.account }),
    );
    await recordTransaction(
      pc,
      "dropActiveOrders(address[])",
      "empty post-upgrade cutover",
      futures.write.dropActiveOrders([[]], { account: owner.account }),
    );
    await recordTransaction(
      pc,
      "setMakerFeeBps(int16)",
      "zero-to-5",
      futures.write.setMakerFeeBps([5], { account: owner.account }),
    );
    await recordTransaction(
      pc,
      "setTakerFeeBps(int16)",
      "zero-to-5",
      futures.write.setTakerFeeBps([5], { account: owner.account }),
    );
    await recordTransaction(
      pc,
      "setLiquidationFeeBps(uint16)",
      "zero-to-50",
      futures.write.setLiquidationFeeBps([50], { account: owner.account }),
    );
    await recordTransaction(
      pc,
      "setLiquidatorShareBps(uint16)",
      "zero-to-5000",
      futures.write.setLiquidatorShareBps([5000], { account: owner.account }),
    );
    await recordTransaction(
      pc,
      "setHook(address)",
      "zero-to-contract",
      futures.write.setHook([hashpriceUsd.address], { account: owner.account }),
    );
    await recordTransaction(
      pc,
      "setOracle(address)",
      "replace-live-feed",
      futures.write.setOracle([feed.address], { account: owner.account }),
    );
    await recordTransaction(
      pc,
      "setPortfolioMargin(address)",
      "revalidate-current-engine",
      futures.write.setPortfolioMargin([portfolioMarginEngine.address], {
        account: owner.account,
      }),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { seller, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller]);
    await recordTransaction(
      pc,
      "createOrders((uint256,uint256,int256,uint8)[])",
      "two resting orders",
      futures.write.createOrders(
        [[
          { price, expirationAt, quantity: -1n, timeInForce: TimeInForce.GTC },
          {
            price: price + data.config.priceLadderStep,
            expirationAt,
            quantity: -1n,
            timeInForce: TimeInForce.GTC,
          },
        ]],
        { account: seller.account },
      ),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { owner, seller, buyer, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller, buyer]);
    await openPosition(data, expirationAt, 1n, price);
    await futures.write.createOrder(
      [price + data.config.priceLadderStep, expirationAt, -1n, TimeInForce.GTC],
      { account: seller.account },
    );
    await recordTransaction(
      pc,
      "resetState(address[])",
      "two participants with order-and-position state",
      futures.write.resetState([[seller.account.address, buyer.account.address]], {
        account: owner.account,
      }),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { owner, seller, buyer, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller, buyer]);
    await openPosition(data, expirationAt, 1n, price);
    await futures.write.createOrder(
      [price + data.config.priceLadderStep, expirationAt, -1n, TimeInForce.GTC],
      { account: seller.account },
    );
    await recordTransaction(
      pc,
      "resetParticipantState(address[])",
      "two participants with order-and-position state",
      futures.write.resetParticipantState([[seller.account.address, buyer.account.address]], {
        account: owner.account,
      }),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { owner, seller, buyer, pc } = data.accounts;
    const price = await futures.read.getMarketPrice();
    const expirationAt = data.config.deliveryDates[0];
    await fund(data, [seller, buyer]);
    await futures.write.setTakerFeeBps([100], { account: owner.account });
    await openPosition(data, expirationAt, 1n, price);
    assert.ok((await futures.read.collectedFeesBalance()) > 0n);
    await recordTransaction(
      pc,
      "withdrawCollectedFees()",
      "nonzero fee balance",
      futures.write.withdrawCollectedFees({ account: owner.account }),
    );
  }
  {
    const data = await fresh();
    const { futures, collateralVault } = data.contracts;
    const { owner, pc } = data.accounts;
    const implementation = await viem.deployContract("HashPowerFutures", [collateralVault.address]);
    await recordTransaction(
      pc,
      "upgradeToAndCall(address,bytes)",
      "new compatible implementation",
      futures.write.upgradeToAndCall([implementation.address, "0x"], {
        account: owner.account,
      }),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { owner, seller, pc } = data.accounts;
    await recordTransaction(
      pc,
      "transferOwnership(address)",
      "owner-to-seller",
      futures.write.transferOwnership([seller.account.address], { account: owner.account }),
    );
  }
  {
    const data = await fresh();
    const { futures } = data.contracts;
    const { owner, pc } = data.accounts;
    await recordTransaction(
      pc,
      "renounceOwnership()",
      "current owner",
      futures.write.renounceOwnership({ account: owner.account }),
    );
  }
}

describe("Futures gas benchmark", () => {
  it("records deterministic receipt gas, view estimates, and complete ABI coverage", async () => {
    await benchmarkViews();
    await benchmarkScaledRiskViews();
    await benchmarkOrderPlacement();
    await benchmarkOrderMaintenance();
    await benchmarkSettlement();
    await benchmarkLiquidations();
    await benchmarkAdminAndLifecycle();

    const snapshot = gas.snapshot();
    const coverage = assertAbiFunctionCoverage(HashPowerFuturesAbi, snapshot, exclusions);
    assert.equal(coverage.covered.length, 72);
    assert.deepEqual(coverage.excluded, [
      "initialize(address,uint8,uint8,uint256)",
      "proxiableUUID()",
    ]);

    await mkdir(fileURLToPath(new URL("../../benchmarks", import.meta.url)), { recursive: true });
    await writeSnapshot(SNAPSHOT_PATH, snapshot);
  });
});
