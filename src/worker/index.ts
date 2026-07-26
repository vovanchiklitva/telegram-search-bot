// src/worker/index.ts
// Starts the BullMQ workers that actually process queued search jobs
// (api-search, parser-search) and the repeatable price-alert job.
import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { startApiWorker } from "../queues/workers/api.worker.js";
import { startParserWorker } from "../queues/workers/parser.worker.js";
import { startPriceAlertWorker } from "../queues/workers/price-alert.worker.js";
import { logger } from "../utils/logger.js";

export async function startWorker() {
  const notifierBot = new Telegraf(env.botToken);

  startApiWorker();
  startParserWorker(1); // 1 at a time — headless Chrome is heavy, free-tier RAM is limited
  startPriceAlertWorker(notifierBot);

  logger.info("Воркеры запущены: api-search, parser-search, price-alerts");
  console.log('👷 Воркеры запущены и обрабатывают очередь');
}
