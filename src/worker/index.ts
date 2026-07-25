// Worker entry point. Runs the BullMQ workers for API search, parser search
// and price alerts. Horizontally scalable: spin up more `worker` replicas.
// The worker process imports a Telegraf instance ONLY for sending proactive
// messages (price alerts) — it does not start polling.

import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { startApiWorker } from "../queues/workers/api.worker.js";
import { startParserWorker } from "../queues/workers/parser.worker.js";
import { startPriceAlertWorker, schedulePriceAlertJob } from "../queues/workers/price-alert.worker.js";
import { ProxyPool } from "../parsers/proxy-pool.js";
import { getRepositories } from "../db/repositories/index.js";
import { disconnectPrisma } from "../db/prisma.js";
import { logger } from "../utils/logger.js";

async function bootstrap(): Promise<void> {
  const bot = new Telegraf(env.botToken); // not launched; used for telegram.sendMessage

  // seed proxies from admin settings + env
  const settings = await getRepositories().settings.get();
  const proxyPool = new ProxyPool();
  await proxyPool.seed([...new Set([...env.proxyList, ...settings.proxyList])]).catch((e) => logger.warn({ err: e.message }, "proxy seed failed"));

  const apiW = startApiWorker(Number(process.env.API_CONCURRENCY ?? 4));
  const parserW = startParserWorker(Number(process.env.PARSER_CONCURRENCY ?? 2));
  const alertW = startPriceAlertWorker(bot, 1);

  await schedulePriceAlertJob().catch((e) => logger.warn({ err: e.message }, "price alert schedule failed"));

  logger.info("Worker started (api + parser + price-alerts)");

  const shutdown = async (sig: string) => {
    logger.info({ sig }, "Shutting down worker");
    await Promise.allSettled([apiW.close(), parserW.close(), alertW.close()]);
    await disconnectPrisma();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason: String(reason) }, "worker unhandledRejection");
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err: err.message, stack: err.stack }, "Worker bootstrap failed");
  process.exit(1);
});
