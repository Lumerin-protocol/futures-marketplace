import { BadDebt as BadDebtEventLog } from "../../generated/Futures/Futures";
import { BadDebtEvent } from "../../generated/schema";
import { createEventId } from "../ids";
import { flushFuturesCounters } from "../internal/match";
import { getOrCreateFutures, getOrCreateUser } from "../internal/store";

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
  flushFuturesCounters(futures);
  futures.totalBadDebt = futures.totalBadDebt.plus(event.params.amount);
  futures.lastUpdatedAt = event.block.timestamp;
  futures.save();
}
