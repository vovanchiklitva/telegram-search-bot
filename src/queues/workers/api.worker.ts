// Worker that consumes the "api-search" queue. Each job targets one API
// source (WB / Ozon / AliExpress). The worker calls the matching client,
// catches errors, and returns a SearchJobResult.

import { Worker, type Job } from "bullmq";
import { getRedisForQueue } from "../../db/redis.js";
import { API_QUEUE, type SearchJobData, type SearchJobResult } from "../queues.js";
import { getApiClient } from "../../services/source/index.js";
import type { SearchContext } from "../../services/source/base.js";
import { logger } from "../../utils/logger.js";

export function startApiWorker(concurrency = 4): Worker<SearchJobData, SearchJobResult> {
  const worker = new Worker<SearchJobData, SearchJobResult>(
    API_QUEUE,
    async (job: Job<SearchJobData, SearchJobResult>): Promise<SearchJobResult> => {
      const { source, query, city, brand, minPrice, maxPrice, attributes, timeoutMs } = job.data;
      const client = getApiClient(source as never);
      if (!client) {
        return { source, products: [], error: `No client for ${source}` };
      }
      const ctx: SearchContext = { query, city, brand, minPrice, maxPrice, attributes };
      try {
        const products = await client.search(ctx, timeoutMs);
        return { source, products };
      } catch (err) {
        const msg = (err as Error).message;
        logger.warn({ job: job.id, source, err: msg }, "API worker error");
        return { source, products: [], error: msg };
      }
    },
    { connection: getRedisForQueue(), concurrency },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "api worker job failed");
  });

  return worker;
}
