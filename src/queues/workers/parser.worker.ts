// Worker that consumes the "parser-search" queue. Each job targets one
// Puppeteer parser (M.Video / DNS / Citilink). Failures (captcha, block,
// timeout) are swallowed into a result with an `error` field so the
// orchestrator can keep the other sources' results.

import { Worker, type Job } from "bullmq";
import { getRedisForQueue } from "../../db/redis.js";
import { PARSER_QUEUE, type SearchJobData, type SearchJobResult } from "../queues.js";
import { getParser } from "../../parsers/index.js";
import type { SearchContext } from "../../services/source/base.js";
import { logger } from "../../utils/logger.js";

export function startParserWorker(concurrency = 2): Worker<SearchJobData, SearchJobResult> {
  const worker = new Worker<SearchJobData, SearchJobResult>(
    PARSER_QUEUE,
    async (job: Job<SearchJobData, SearchJobResult>): Promise<SearchJobResult> => {
      const { source, query, city, brand, minPrice, maxPrice, attributes, timeoutMs } = job.data;
      const parser = getParser(source as never);
      if (!parser) return { source, products: [], error: `No parser for ${source}` };
      const ctx: SearchContext = { query, city, brand, minPrice, maxPrice, attributes };
      try {
        const products = await parser.parse(ctx, timeoutMs);
        return { source, products };
      } catch (err) {
        const msg = (err as Error).message;
        logger.warn({ job: job.id, source, err: msg }, "Parser worker error");
        return { source, products: [], error: msg };
      }
    },
    { connection: getRedisForQueue(), concurrency },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "parser worker job failed");
  });

  return worker;
}
