import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContract,
  keccak256,
  numberToHex,
  parseAbi,
  zeroAddress,
} from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/** Slots in the compiler storage layout (`forge inspect HashPowerFutures storageLayout`). */
const MARK_ORACLE_SLOT = 38n;
const EXPIRY_SCHEDULE_SLOT = 39n;
const PINNED_EXPIRY_OF_SLOT = 40n;
const SLOT_OF_PINNED_EXPIRY_SLOT = 41n;

const REINITIALIZE_ABI = parseAbi([
  "function reinitialize(address oracle)",
  "error InvalidInitialization()",
]);

function mappingSlot(key: bigint, slot: bigint) {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [key, slot]));
}

/** Zero the state 6.18 added, as it is on a proxy initialized at 6.8.0 and then upgraded. */
async function eraseScheduleAndMarkOracle(proxy: Address) {
  const pc = await viem.getPublicClient();
  const schedule = BigInt(
    (await pc.getStorageAt({ address: proxy, slot: numberToHex(EXPIRY_SCHEDULE_SLOT, { size: 32 }) })) ?? "0x0",
  );
  const pinnedCount = schedule & 0xffffffffn;
  for (let k = 0n; k < pinnedCount; k++) {
    const expirySlot = mappingSlot(k, PINNED_EXPIRY_OF_SLOT);
    const expiry = BigInt((await pc.getStorageAt({ address: proxy, slot: expirySlot })) ?? "0x0");
    await networkHelpers.setStorageAt(proxy, expirySlot, 0n);
    await networkHelpers.setStorageAt(proxy, mappingSlot(expiry, SLOT_OF_PINNED_EXPIRY_SLOT), 0n);
  }
  await networkHelpers.setStorageAt(proxy, numberToHex(EXPIRY_SCHEDULE_SLOT, { size: 32 }), 0n);
  await networkHelpers.setStorageAt(proxy, numberToHex(MARK_ORACLE_SLOT, { size: 32 }), 0n);
}

/**
 * N37: only `initialize` sets the 6.18 delivery schedule and the mark oracle, and an upgrade runs
 * no initializer, so a venue upgraded in place from 6.8.0 has neither. The upgrade call must be a
 * reinitializer that adopts the mark oracle and starts the schedule on the stored first expiration
 * date, so the venue keeps listing the 30-day grid it always had. On a venue that already has a
 * schedule it must be rejected, since re-anchoring would orphan the pinned dates.
 */
describe("N37: HashPowerFutures.reinitialize after an in-place upgrade from 6.8.0", () => {
  it("adopts the mark oracle and lists the venue's old grid", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, markOracle, collateralVault, bookLib } = data.contracts;
    const { owner } = data.accounts;
    await eraseScheduleAndMarkOracle(futures.address);
    assert.equal(await futures.read.markOracle(), zeroAddress);

    const implementation = await viem.deployContract("HashPowerFutures", [collateralVault.address], {
      libraries: { FuturesBookLib: bookLib.address },
    });
    try {
      await futures.write.upgradeToAndCall(
        [
          implementation.address,
          encodeFunctionData({
            abi: REINITIALIZE_ABI,
            functionName: "reinitialize",
            args: [markOracle.address],
          }),
        ],
        { account: owner.account },
      );
    } catch {}

    assert.equal(getAddress(await futures.read.markOracle()), getAddress(markOracle.address));
    assert.deepEqual(
      await futures.read.getExpirationDates().catch(() => []),
      data.config.deliveryDates,
    );
  });

  it("is rejected on a venue that already has a schedule", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, markOracle } = data.contracts;
    const pc = await viem.getPublicClient();
    const [wallet] = await viem.getWalletClients();
    const reinitializable = getContract({
      abi: REINITIALIZE_ABI,
      address: futures.address,
      client: { public: pc, wallet },
    });

    await viem.assertions.revertWithCustomError(
      reinitializable.write.reinitialize([markOracle.address], { account: data.accounts.owner.account }),
      reinitializable,
      "InvalidInitialization",
    );
  });
});
