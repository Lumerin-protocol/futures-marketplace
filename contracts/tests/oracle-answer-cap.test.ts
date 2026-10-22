import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/** `HashPowerFuturesBase.MAX_PRICE`: the largest price any venue calculation accepts. */
const MAX_PRICE = 10n ** 18n;
const COLLATERAL_DECIMALS = 6n;

/** The fixture types the hashprice feed with a two-argument `setPrice`; the mock takes one. */
type PriceFeed = { write: { setPrice: (args: readonly [bigint]) => Promise<unknown> } };

/** Feed answer that scales to `price` in venue units. */
function answerFor(price: bigint, feedDecimals: number): bigint {
  return price * 10n ** (BigInt(feedDecimals) - COLLATERAL_DECIMALS);
}

describe("HashPowerFutures oracle answer cap", () => {
  it("reverts the mark when the feed scales above MAX_PRICE, and accepts MAX_PRICE itself", async () => {
    const { contracts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, hashpriceUsd } = contracts;
    const decimals = await hashpriceUsd.read.decimals();
    const feed = hashpriceUsd as unknown as PriceFeed;

    await feed.write.setPrice([answerFor(MAX_PRICE, decimals)]);
    assert.equal(await futures.read.getMarketPrice(), MAX_PRICE);

    await feed.write.setPrice([answerFor(MAX_PRICE + config.priceLadderStep, decimals)]);
    await viem.assertions.revertWithCustomError(futures.read.getMarketPrice(), futures, "InvalidOracle");
  });

  it("setOracle rejects a feed whose answer scales above MAX_PRICE", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, hashpriceUsd } = contracts;
    const decimals = await hashpriceUsd.read.decimals();
    const feed = await viem.deployContract("PriceFeedMock", [decimals, "out of range"]);
    await feed.write.setPrice([answerFor(MAX_PRICE + config.priceLadderStep, decimals)]);

    await viem.assertions.revertWithCustomError(
      futures.write.setOracle([feed.address], { account: accounts.owner.account }),
      futures,
      "InvalidOracle",
    );
  });
});
