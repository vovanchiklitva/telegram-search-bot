// BullMQ queue definitions. Two queues per the spec:
//   - "api-search": WB, Ozon, AliExpress (fast, parallel)
//   - "parser-search": M.Video, DNS, Citilink (slow, Puppeteer)
// Plus a scheduled "price-alerts" repeatable job.

import { Queue, QueueEvents } from "bullmq";
import { getRedisForQueue } from "../db/redis.js";

export const API_QUEUE = "api-search";
export const PARSER_QUEUE = "parser-search";
export const PRICE_ALERT_QUEUE = "price-alerts";

export interface SearchJobData {
  requestId: string;
  source: string;
  query: string;
  city: string | null;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  attributes?: Record<string, string>;
  timeoutMs: number;
}

export interface SearchJobResult {
  source: string;
  products: unknown[];
  error?: string;
}

export interface PriceAlertJobData {
  dryRun?: boolean;
}

let apiQueue: Queue<SearchJobData, SearchJobResult> | null = null;
let parserQueue: Queue<SearchJobData, SearchJobResult> | null = null;
let priceQueue: Queue<PriceAlertJobData> | null = null;

export function getApiQueue(): Queue<SearchJobData, SearchJobResult> {
  if (!apiQueue) apiQueue = new Queue<SearchJobData, SearchJobResult>(API_QUEUE, { connection: getRedisForQueue() });
  return apiQueue;
}

export function getParserQueue(): Queue<SearchJobData, SearchJobResult> {
  if (!parserQueue) parserQueue = new Queue<SearchJobData, SearchJobResult>(PARSER_QUEUE, { connection: getRedisForQueue() });
  return parserQueue;
}

export function getPriceAlertQueue(): Queue<PriceAlertJobData> {
  if (!priceQueue) priceQueue = new Queue<PriceAlertJobData>(PRICE_ALERT_QUEUE, { connection: getRedisForQueue() });
  return priceQueue;
}

export function getQueueEvents(name: string): QueueEvents {
  return new QueueEvents(name, { connection: getRedisForQueue() });
}

// Get total waiting+delayed count across both search queues. Used by the
// producer to refuse new jobs when the system is overloaded.
export async function totalPendingSearchJobs(): Promise<number> {
  const [api, parser] = await Promise.all([getApiQueue(), getParserQueue()]);
  const [apiCounts, parserCounts] = await Promise.all([
    api.getJobCounts("waiting", "delayed", "active"),
    parser.getJobCounts("waiting", "delayed", "active"),
  ]);
  return (apiCounts.waiting ?? 0) + (apiCounts.delayed ?? 0) + (apiCounts.active ?? 0) + (parserCounts.waiting ?? 0) + (parserCounts.delayed ?? 0) + (parserCounts.active ?? 0);
}
