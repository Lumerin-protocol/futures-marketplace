import {
  BadDebt as BadDebtEventLog,
  Liquidation as LiquidationEvent,
} from "../../generated/Futures/Futures";
import { BadDebtEvent, Liquidation } from "../../generated/schema";
import { createEventId } from "../ids";
import { getOrCreateFutures, getOrCreateUser } from "../internal/store";

export function handleLiquidation(event: LiquidationEvent): void {
  const user = getOrCreateUser(event.params.participant, event.block.timestamp);
  const liquidator = getOrCreateUser(event.params.liquidator, event.block.timestamp);

  const liq = new Liquidation(createEventId(event.transaction.hash, event.logIndex));
  liq.user = user.id;
  liq.liquidator = liquidator.id;
  liq.reclaimedMargin = event.params.reclaimedMargin;
  liq.realizedPnl = event.params.realizedPnl;
  liq.timestamp = event.block.timestamp;
  liq.blockNumber = event.block.number;
  liq.transactionHash = event.transaction.hash;
  liq.save();

  user.realizedPnl = user.realizedPnl.plus(event.params.realizedPnl);
  user.lastActivityAt = event.block.timestamp;
  user.save();

  liquidator.lastActivityAt = event.block.timestamp;
  liquidator.save();

  const futures = getOrCreateFutures();
  futures.totalLiquidations++;
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}

export function handleBadDebt(event: BadDebtEventLog): void {
  const user = getOrCreateUser(event.params.account, event.block.timestamp);
  const ev = new BadDebtEvent(createEventId(event.transaction.hash, event.logIndex));
  ev.user = user.id;
  ev.amount = event.params.amount;
  ev.timestamp = event.block.timestamp;
  ev.blockNumber = event.block.number;
  ev.transactionHash = event.transaction.hash;
  ev.save();

  const futures = getOrCreateFutures();
  futures.totalBadDebt = futures.totalBadDebt.plus(event.params.amount);
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}
