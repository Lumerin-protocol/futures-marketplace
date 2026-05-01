import { log } from "@graphprotocol/graph-ts";
import {
  Initialized,
  OrderFeeUpdated,
  Upgraded,
  ValidatorURLUpdated,
} from "../../generated/Futures/Futures";
import { getOrCreateFutures, loadFuturesFromContract } from "../internal/store";

export function handleInitialized(event: Initialized): void {
  log.info("Futures initialized: version {}", [event.params.version.toString()]);
  const futures = getOrCreateFutures();
  futures.initializedAt = event.block.timestamp;
  futures.lastUpdatedAt = event.block.timestamp;
  loadFuturesFromContract(futures);
  futures.save();
}

export function handleUpgraded(event: Upgraded): void {
  log.info("Futures upgraded to {}", [event.params.implementation.toHexString()]);
  const futures = getOrCreateFutures();
  futures.lastUpdatedAt = event.block.timestamp;
  loadFuturesFromContract(futures);
  futures.save();
}

export function handleOrderFeeUpdated(event: OrderFeeUpdated): void {
  const futures = getOrCreateFutures();
  futures.orderFee = event.params.orderFee;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleValidatorURLUpdated(event: ValidatorURLUpdated): void {
  const futures = getOrCreateFutures();
  futures.validatorURL = event.params.validatorURL;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}
