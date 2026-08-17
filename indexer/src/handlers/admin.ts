import { log } from "@graphprotocol/graph-ts";
import {
  Initialized,
  Upgraded,
  FutureExpirationDatesCountUpdated,
  MakerFeeBpsUpdated,
  TakerFeeBpsUpdated,
  LiquidationFeeBpsUpdated,
  LiquidatorShareBpsUpdated,
  OracleUpdated,
  PortfolioMarginUpdated,
} from "../../generated/HashPowerFutures/HashPowerFutures";
import { flushFuturesCounters } from "../internal/match";
import { getOrCreateFutures, loadFuturesFromContract } from "../internal/store";
import { stringifyParameters } from "../internal/utils";

export function handleInitialized(event: Initialized): void {
  log.debug("initialized event ", [stringifyParameters(event)]);
  log.info("HashPowerFutures initialized: version {}", [event.params.version.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.initializedAt = event.block.timestamp;
  futures.lastUpdatedAt = event.block.timestamp;
  loadFuturesFromContract(futures);
  futures.save();
}

export function handleUpgraded(event: Upgraded): void {
  log.debug("upgraded event ", [stringifyParameters(event)]);
  log.info("HashPowerFutures upgraded to {}", [event.params.implementation.toHexString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.lastUpdatedAt = event.block.timestamp;
  loadFuturesFromContract(futures);
  futures.save();
}

/// Individual per-field handlers replacing the former monolithic ConfigUpdated
/// path: every admin setter now emits its own event carrying the new value, so
/// each handler writes just that field rather than re-reading the whole config.
///
/// `LiquidationMarginPercentUpdated` is deliberately not indexed: margin is a
/// cross-account figure owned by the PortfolioMarginEngine (spot shocks), and
/// the per-venue percent it carries no longer drives anything.

export function handleFutureExpirationDatesCountUpdated(event: FutureExpirationDatesCountUpdated): void {
  log.info("FutureExpirationDatesCountUpdated: {}", [event.params.newFutureExpirationDatesCount.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.futureExpirationDatesCount = event.params.newFutureExpirationDatesCount;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleMakerFeeBpsUpdated(event: MakerFeeBpsUpdated): void {
  log.info("MakerFeeBpsUpdated: {}", [event.params.newMakerFeeBps.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.makerFeeBps = event.params.newMakerFeeBps;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleTakerFeeBpsUpdated(event: TakerFeeBpsUpdated): void {
  log.info("TakerFeeBpsUpdated: {}", [event.params.newTakerFeeBps.toString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.takerFeeBps = event.params.newTakerFeeBps;
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
  futures.priceOracle = event.params.newOracle;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handlePortfolioMarginUpdated(event: PortfolioMarginUpdated): void {
  log.info("PortfolioMarginUpdated: {}", [event.params.newPortfolioMargin.toHexString()]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  futures.portfolioMargin = event.params.newPortfolioMargin;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}
