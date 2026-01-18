import { type ConversationFlavor, conversations } from "@grammyjs/conversations";
import { Bot, type Context } from "grammy";
import { collectWalletAddress } from "./conversations.ts";
import { type Db } from "../db/connection.ts";

export function createBot(db: Db, botToken: string) {
  const bot = new Bot<ConversationFlavor<Context>>(botToken);

  bot.use(conversations());
  bot.use(collectWalletAddress(db));

  bot.command("start", async (ctx) => {
    ctx.reply("Welcome to the Lumerin Futures Bot!");

    ctx.reply(
      "I will send you notifications when your margin balance is low, to avoid margin calls"
    );
    await ctx.conversation.enter("collectWalletAddress");
  });

  return bot;
}
