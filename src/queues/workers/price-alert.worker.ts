// Price-alert worker. A repeatable BullMQ job (every 6h by default) iterates
// active price alerts, re-queries the matching source for the current price,
// and notifies the user via Telegram if the price dropped below their target.

import { Worker, type Job } from "bullmq";
import { Telegraf } from "telegraf";
import { getRedisForQueue } from "../../db/redis.js";
import { PRICE_ALERT_QUEUE, type PriceAlertJobData } from "../queues.js";
import { getRepositories } from "../../db/repositories/index.js";
import { getApiClient } from "../../services/source/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

export function startPriceAlertWorker(bot: Telegraf, concurrency = 1): Worker<PriceAlertJobData> {
  const worker = new Worker<PriceAlertJobData>(
    PRICE_ALERT_QUEUE,
    async (job: Job<PriceAlertJobData>) => {
      const repos = getRepositories();
      const alerts = await repos.priceAlerts.listActive();
      logger.info({ count: alerts.length }, "Price alerts running");
      for (const alert of alerts) {
        const client = getApiClient(alert.source as never);
        if (!client) continue; // parser sources unsupported for re-check here
        try {
          const results = await client.search(
            { query: alert.title, city: null },
            env.timeoutApiMs,
          );
          const match = results.find((p) => p.id === alert.productId);
          const price = match?.priceRub ?? null;
          if (price === null) continue;
          await repos.priceAlerts.updateLastPrice(alert.id, price);
          const target = Number(alert.targetPriceRub);
          if (price < target) {
            const tgId = (await repos.users.getByTelegramId(alert.userId))?.telegramId;
            if (tgId) {
              const text = `🔔 Цена упала!\n${alert.title}\nБыло: ${target} ₽ → Сейчас: ${price} ₽\n${match?.affiliateUrl ?? match?.url ?? ""}`;
              await bot.telegram.sendMessage(tgId.toString(), text).catch((e) => logger.warn({ err: e.message }, "alert send failed"));
            }
            await repos.priceAlerts.markTriggered(alert.id);
          }
        } catch (err) {
          logger.warn({ alertId: alert.id, err: (err as Error).message }, "price alert check failed");
        }
      }
    },
    { connection: getRedisForQueue(), concurrency },
  );

  worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err: err.message }, "price alert job failed"));
  return worker;
}

// Schedule the repeatable job. Call once at worker startup.
export async function schedulePriceAlertJob(): Promise<void> {
  const { getPriceAlertQueue } = await import("../queues.js");
  const queue = getPriceAlertQueue();
  // BullMQ repeatable opts. We use a simple every-6h pattern via `repeat.every`.
  await queue.add(
    "price-alerts-tick",
    { dryRun: false } satisfies PriceAlertJobData,
    { repeat: { pattern: env.priceAlertCron }, removeOnComplete: 10, removeOnFail: 10 },
  );
}
