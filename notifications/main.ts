import { createBot } from "./bot/bot.ts";
import { config } from "./config/env.ts";
import { createConnection } from "./db/connection.ts";
import { createServer } from "./server/server.ts";

async function main() {
  const db = createConnection();
  const bot = createBot(db, config.TELEGRAM_BOT_TOKEN);
  const server = createServer(db, bot);

  await Promise.all([
    bot.start(),
    server.listen({
      port: 3000,
      host: '0.0.0.0',  // Listen on all interfaces (required for ECS ALB health checks)
      listenTextResolver: (address) => `Server is listening on ${address}`,
    }),
  ]);
}

main();
