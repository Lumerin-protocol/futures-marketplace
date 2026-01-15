import { type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import fastify from "fastify";
import { type Db } from "../db/connection.ts";
import { type ConversationFlavor } from "@grammyjs/conversations";
import { Bot, type Context } from "grammy";
import { PostNotificationBody } from "./schema.ts";
import { eq } from "drizzle-orm";
import { usersTable } from "../db/schema.ts";

export function createServer(db: Db, bot: Bot<ConversationFlavor<Context>>) {
  const server = fastify({ logger: { level: "debug" } }).withTypeProvider<TypeBoxTypeProvider>();

  const startTime = Date.now();

  server.get("/healthcheck", async (req, res) => {
    res.send({ status: "ok", uptime: Date.now() - startTime });
  });

  server.post(
    "/notifications",
    {
      schema: {
        body: PostNotificationBody,
      },
    },
    async (req, res) => {
      const { walletAddress, collateralBalance, minBalance } = req.body;
      const normalizedWalletAddress = walletAddress.toLowerCase();
      const allrecords = await db.query.usersTable.findMany();
      console.log(allrecords);
      const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.walletAddress, normalizedWalletAddress),
        columns: {
          telegramUserId: true,
        },
      });
      if (!user) {
        req.log.debug("User have not set up telegram notification");
        return;
      }
      await bot.api.sendMessage(
        user.telegramUserId,
        `🚨 **ALERT** 🚨\n\nYour wallet ${walletAddress} margin balance is low: ${collateralBalance}.\nMinimum balance is ${minBalance}.`
      );
      req.log.debug(`Notification sent to user ${user.telegramUserId}`);
      await res.send({ message: "Notification received", walletAddress });
    }
  );

  return server;
}
