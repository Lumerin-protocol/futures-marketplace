import pino from "pino";
import { BalanceEntry } from "./balanceEntry";

export async function sendDeficitAlerts(
  entries: BalanceEntry[],
  notificationServiceUrl: string,
  MARGIN_UTILIZATION_WARNING_PERCENT: number,
  log: pino.Logger
) {
  if (entries.length === 0) {
    log.info("No entries to send margin utilization warning");
    return;
  }
  const entriesToSend = entries.map((entry) => ({
    walletAddress: entry.address,
    collateralBalance: entry.balance,
    minBalance: calcMinBalance(entry.minMargin, MARGIN_UTILIZATION_WARNING_PERCENT),
  }));

  log.info(`Sending deficit alerts: ${entriesToSend.length}`);
  for (const entry of entriesToSend) {
    log.info(
      `address ${entry.walletAddress} collateral balance ${entry.collateralBalance} and min balance ${entry.minBalance}`
    );
  }

  const url = new URL("/notifications", notificationServiceUrl);
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(entriesToSend),
  });

  if (!res.ok) {
    log.error(`Failed to send deficit alerts: ${res.statusText}`);
  }
}

function calcMinBalance(minMargin: bigint, marginUtilizationWarningPercent: number) {
  return (Number(minMargin) / marginUtilizationWarningPercent) * 100;
}
