import { createConversation } from "@grammyjs/conversations";
import { type Db } from "../db/connection.ts";
import { usersTable } from "../db/schema.ts";
import { TypeEthAddress } from "../lib/type.ts";
import { ajv } from "../config/env.ts";

export const collectWalletAddress = (db: Db) =>
  createConversation(
    async function collectWalletAddress(conversation, ctx) {
      for (;;) {
        await ctx.reply("To get started, please send me your wallet address:");
        const { message } = await conversation.waitFor("message:text");
        const res = ajv.validate(TypeEthAddress(), message.text);
        if (res) {
          await ctx.reply(`Thank you! I've registered your wallet address: ${message.text}`);
          const user = await ctx.getAuthor();
          console.log(user);
          const userRecord: typeof usersTable.$inferInsert = {
            telegramUserId: user.user.id,
            walletAddress: message.text.toLowerCase(),
          };
          await db.insert(usersTable).values(userRecord);
          await ctx.reply(
            "I'll now monitor your margin balance and send you notifications when needed."
          );
          break;
        }
        await ctx.reply("Invalid wallet address. Please try again.");
      }
    },
    { id: "collectWalletAddress" }
  );
