// Bot entry point. Starts long-polling. Stateless: sessions live in Redis,
// queues in Redis, persistent data in Postgres. Multiple instances can run
// behind a load balancer (use webhooks in prod; polling is fine for dev).

import { Telegraf, session } from "telegraf";
import { env } from "../config/env.js";
import { RedisSessionStore, type SessionData } from "./session.js";
import type { BotContext } from "./context.js";
import { registerHandlers } from "./handlers/index.js";
import { errorHandler, notifyAdminError } from "./middleware.js";
import { getRepositories } from "../db/repositories/index.js";
import { ProxyPool } from "../parsers/proxy-pool.js";
import { schedulePriceAlertJob } from "../queues/workers/price-alert.worker.js";
import { logger } from "../utils/logger.js";
import { disconnectPrisma } from "../db/prisma.js";
import { Redis } from 'ioredis';

async function bootstrap(): Promise<void> {
  console.log('🔄 1. Запуск bootstrap() в боте');
  const bot = new Telegraf<BotContext>(env.botToken);
  console.log('🔄 2. Бот создан');

  // Redis-backed sessions → stateless across instances.
  bot.use(
    session({
      store: new RedisSessionStore(),
      defaultSession: (): SessionData => ({}),
    }),
  );

  registerHandlers(bot);
  bot.catch(errorHandler(bot));

  // Seed proxy pool from env at startup (workers also seed from settings).
  if (env.proxyList.length) {
    await new ProxyPool().seed(env.proxyList).catch((e) => logger.warn({ err: e.message }, "proxy seed failed"));
  }

  // Schedule the price-alert repeatable job (idempotent).
  await schedulePriceAlertJob().catch((e) => logger.warn({ err: e.message }, "price alert schedule failed"));

  console.log('🔄 3. Пытаюсь запустить бота (bot.launch())...');
  await bot.launch();
  console.log('✅ 4. Бот успешно запущен');
  logger.info("Bot started (long-polling)");

  const shutdown = async (sig: string) => {
    logger.info({ sig }, "Shutting down bot");
    bot.stop(sig);
    await releaseLock();
    await disconnectPrisma();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error({ err: err.message }, "unhandledRejection");
    void notifyAdminError(bot, err, "unhandledRejection");
  });
}

bootstrap().catch(async (err) => {
  console.error("❌ Ошибка в bootstrap бота:", err);
  logger.fatal({ err: err.message, stack: err.stack }, "Bot bootstrap failed");
  process.exit(1);
});
