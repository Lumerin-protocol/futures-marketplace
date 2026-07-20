import { log } from "@graphprotocol/graph-ts";
import { ConfigUpdated, Initialized, Upgraded } from "../../generated/Futures/Futures";
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

/// Single-event refresh path for the entire owner-settable config surface. Replaces
/// the per-field `MakerFeeUpdated`/`TakerFeeUpdated`/`ValidatorURLUpdated`/`LiquidationFeeUpdated`
/// handlers. The contract emits this event on every setter (and once from `initialize`),
/// so we can always overwrite local state with the snapshot.
export function handleConfigUpdated(event: ConfigUpdated): void {
  log.debug("config updated event ", [stringifyParameters(event)]);
  const futures = getOrCreateFutures();
  flushFuturesCounters(futures);
  const cfg = event.params.config;
  futures.makerFee = cfg.makerFee;
  futures.takerFee = cfg.takerFee;
  futures.liquidationFee = cfg.liquidationFee;
  futures.minimumPriceIncrement = cfg.minimumPriceIncrement;
  futures.liquidationMarginPercent = cfg.liquidationMarginPercent;
  futures.futureExpirationDatesCount = cfg.futureExpirationDatesCount;
  futures.hashrateOracleAddress = cfg.hashrateOracle;
  futures.marginEngineAddress = cfg.marginEngine;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}
