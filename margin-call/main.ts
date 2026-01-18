import * as viem from "viem";
import pino from "pino";
import { Subgraph } from "./gateway/subgraph";
import { FuturesABI } from "./abi/Futures";
import { config } from "./config/env";
import { hardhat } from "viem/chains";
import { sendDeficitAlerts } from "./gateway/marginAlert";
import { executeMarginCalls } from "./gateway/marginCall";
import { BalanceEntry } from "./gateway/balanceEntry";

async function main(executeMarginCall = false) {
  const ethClient = viem.createClient({
    transport: viem.http(config.ETH_NODE_URL),
    chain: {
      ...hardhat,
      multicall3Address: config.MULTICALL_ADDRESS,
    },
    batch: {
      multicall: {
        wait: 1000,
      },
    },
  });

  const subgraphClient = new Subgraph(config.SUBGRAPH_URL, config.SUBGRAPH_API_KEY);

  const log = pino({
    level: config.LOG_LEVEL,
  });

  const futures = viem.getContract({
    address: config.FUTURES_ADDRESS,
    abi: FuturesABI,
    client: ethClient,
  });

  const { participants } = await subgraphClient.getParticipants();

  log.info(`Found ${participants.length} participants`);

  const deficits = await Promise.all(
    participants.map(async (participant) => {
      const minMargin = await futures.read.getMinMargin([participant.address]);
      const balance = await futures.read.balanceOf([participant.address]);
      // const balance = BigInt(participant.balance);
      const marginUtilizationRatio = Number(minMargin) / Number(balance);

      log.debug(
        `Participant ${participant.address} has min margin ${minMargin} and balance ${balance} and margin utilization ratio ${marginUtilizationRatio}`
      );

      return {
        address: participant.address,
        minMargin: minMargin,
        balance: balance,
        marginUtilizationRatio: marginUtilizationRatio,
      };
    })
  );

  const addressesForMarginCall: BalanceEntry[] = [];
  const addressesForAlert: BalanceEntry[] = [];

  for (const deficit of deficits) {
    if (deficit.marginUtilizationRatio >= 1) {
      addressesForMarginCall.push(deficit);
    }
    if (deficit.marginUtilizationRatio > config.MARGIN_UTILIZATION_WARNING_PERCENT / 100) {
      addressesForAlert.push(deficit);
    }
  }

  await sendDeficitAlerts(
    addressesForAlert,
    config.NOTIFICATIONS_SERVICE_URL,
    config.MARGIN_UTILIZATION_WARNING_PERCENT,
    log
  );
  if (executeMarginCall) {
    await executeMarginCalls(addressesForMarginCall, ethClient, log);
  }
}

// Lambda handler export
export const handler = async (event: any, context: any) => {
  try {
    await main(event?.executeMarginCall);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Margin call check completed successfully" }),
    };
  } catch (error) {
    console.error("Error in margin call handler:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Margin call check failed",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

// For local testing
if (require.main === module) {
  main();
}
