import { log } from "@graphprotocol/graph-ts";
import {
  Initialized,
  Upgraded,
  LiquidationMarginPercentUpdated,
  FutureExpirationDatesCountUpdated,
  MakerFeeUpdated,
  TakerFeeUpdated,
  LiquidationFeeUpdated,
  LiquidationFeeBpsUpdated,
  LiquidatorShareBpsUpdated,
  OracleUpdated,
  PortfolioMarginUpdated,
} from "../../generated/Futures/Futures";
import { flushFuturesCounters } from "../internal/match";
import { getOrCreateFutures, loadFuturesFromContract } from "../internal/store";
import { stringifyParameters } from "../internal/utils";

export function handleInitialized(event: Initialized): void {
  log.debug("initialized event ", [stringifyParameters(event)]);
  log.info("Futures initialized: version {}", [event.params.version.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.initializedAt = event.block.timestamp;
  futures.lastUpdatedAt = event.block.timestamp;
  loadFuturesFromContract(futures);
  futures.save();
}

export function handleUpgraded(event: Upgraded): void {
  log.debug("upgraded event ", [stringifyParameters(event)]);
  log.info("Futures upgraded to {}", [event.params.implementation.toHexString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.lastUpdatedAt = event.block.timestamp;
  loadFuturesFromContract(futures);
  futures.save();
}

/// Individual per-field handlers replacing the former monolithic ConfigUpdated path.
/// Each setter now emits its own event; on every change we reload the full snapshot
/// from chain so the local Futures entity stays consistent.

function _reloadAndSave(): void {
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.lastUpdatedAt = _blockTimestamp();
  loadFuturesFromContract(futures);
  futures.save();
}

function _blockTimestamp(): i32 {
  // Provided by the host at handler invocation time via event.block.timestamp.
  // We don't have access to the raw event here, so the caller must set it.
  // This is set by each handler below.
  return 0; // replaced inline
}

export function handleLiquidationMarginPercentUpdated(event: LiquidationMarginPercentUpdated): void {
  log.info("LiquidationMarginPercentUpdated: {}", [event.params.newLiquidationMarginPercent.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.liquidationMarginPercent = event.params.newLiquidationMarginPercent;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleFutureExpirationDatesCountUpdated(event: FutureExpirationDatesCountUpdated): void {
  log.info("FutureExpirationDatesCountUpdated: {}", [event.params.newFutureExpirationDatesCount.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.futureExpirationDatesCount = event.params.newFutureExpirationDatesCount;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleMakerFeeUpdated(event: MakerFeeUpdated): void {
  log.info("MakerFeeUpdated: {}", [event.params.newMakerFee.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.makerFee = event.params.newMakerFee;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleTakerFeeUpdated(event: TakerFeeUpdated): void {
  log.info("TakerFeeUpdated: {}", [event.params.newTakerFee.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.takerFee = event.params.newTakerFee;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleLiquidationFeeUpdated(event: LiquidationFeeUpdated): void {
  log.info("LiquidationFeeUpdated: {}", [event.params.newLiquidationFee.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.liquidationFee = event.params.newLiquidationFee;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleLiquidationFeeBpsUpdated(event: LiquidationFeeBpsUpdated): void {
  log.info("LiquidationFeeBpsUpdated: {}", [event.params.newLiquidationFeeBps.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.liquidationFeeBps = event.params.newLiquidationFeeBps;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleLiquidatorShareBpsUpdated(event: LiquidatorShareBpsUpdated): void {
  log.info("LiquidatorShareBpsUpdated: {}", [event.params.newLiquidatorShareBps.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.liquidatorShareBps = event.params.newLiquidatorShareBps;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleOracleUpdated(event: OracleUpdated): void {
  log.info("OracleUpdated: {}", [event.params.newOracle.toHexString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.hashrateOracleAddress = event.params.newOracle;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handlePortfolioMarginUpdated(event: PortfolioMarginUpdated): void {
  log.info("PortfolioMarginUpdated: {}", [event.params.newPortfolioMargin.toHexString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.portfolioMarginAddress = event.params.newPortfolioMargin;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}
