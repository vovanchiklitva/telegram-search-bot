// Queue producers. The bot enqueues a fan-out of per-source jobs and waits
// for all results (with timeout), then hands them to the orchestrator which
// merges + renders. If all sources fail, we fall back to cached results.

import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { Product, SearchResults, Source } from "../types.js";
import { API_SOURCES, PARSER_SOURCES } from "../types.js";
import {
  getApiQueue,
  getParserQueue,
  totalPendingSearchJobs,
  type SearchJobData,
  type SearchJobResult,
  getQueueEvents,
  API_QUEUE,
  PARSER_QUEUE,
} from "./queues.js";
import { env } from "../config/env.js";
import { Cache } from "../utils/cache.js";
import { Deduplicator } from "../utils/deduplicator.js";
import { getRepositories } from "../db/repositories/index.js";
import { logger } from "../utils/logger.js";

export interface OrchestratedSearchInput {
  telegramId: bigint;
  userId: bigint;
  query: string;
  city: string | null;
  photoFileId?: string;
  offset: number;
}

export class SearchOrchestrator {
  private cache = new Cache();
  private dedup = new Deduplicator();

  // Check queue pressure; return false if we should refuse the new search.
  async canEnqueue(): Promise<{ ok: boolean; pending: number }> {
    const pending = await totalPendingSearchJobs();
    return { ok: pending < env.queueMaxPending, pending };
  }

  // Fan out per-source jobs and wait for results. Updates the status callback
  // as each source completes. Returns the merged SearchResults (or cached).
  async run(
    input: OrchestratedSearchInput,
    parsed: import("../types.js").ParsedQuery,
    onStatus: (status: string) => Promise<void>,
  ): Promise<SearchResults> {
    const requestId = randomUUID();
    const settings = await getRepositories().settings.get();

    const cacheKey = this.cache.resultsKey(input.query, input.city);
    const cached = await this.cache.getJson<SearchResults>(cacheKey);
    const now = Date.now();

    const apiSources = API_SOURCES.filter((s) => settings.enabledSources.includes(s));
    const parserSources = PARSER_SOURCES.filter((s) => settings.enabledSources.includes(s));

  const apiJobs = apiSources.map((source) => this.enqueue(getApiQueue(), source, input, parsed, requestId, env.timeoutApiMs).then((r) => ({ ...r, queueName: API_QUEUE })));
    const parserJobs = parserSources.map((source) => this.enqueue(getParserQueue(), source, input, parsed, requestId, env.timeoutParserMs).then((r) => ({ ...r, queueName: PARSER_QUEUE })));
    
    const allJobs = [...apiJobs, ...parserJobs];
    if (allJobs.length === 0) {
      return this.fallbackCached(cached, input, parsed, "Все источники отключены", [], now);
    }

    const failedSources: Source[] = [];
    const collected: Product[] = [];

    // Wait for each job, respecting a per-source timeout (handled by the worker).
    await Promise.all(
      allJobs.map(async (jobPromise) => {
        const { source, job, queueName } = await jobPromise;
        await onStatus(`🔍 Ищем на ${labelOf(source)}...`);
        try {
          const result = await job.waitUntilFinished(getQueueEvents(queueName), env.timeoutParserMs + 2000).catch(() => null);
          if (!result || result.error) {
            failedSources.push(source as Source);
            return;
          }
          const products = (result.products as Product[]) ?? [];
          collected.push(...products);
          await onStatus(`✅ Найдено ${products.length}, теперь ${labelOf(nextSource(source, apiSources, parserSources))}...`);
        } catch {
          failedSources.push(source as Source);
        }
      }),
    );

    if (collected.length === 0) {
      return this.fallbackCached(cached, input, parsed, "Все источники недоступны", failedSources, now);
    }

    const deduped = await this.dedup.dedupe(collected, false);
    const results: SearchResults = {
      requestId,
      query: input.query,
      city: input.city,
      parsed,
      products: deduped,
      fetchedAt: now,
      fromCache: false,
      failedSources,
    };
    await this.cache.setJson(cacheKey, results, this.cache.resultsTtl());

    await onStatus("✅ Готово, формируем ответ...");
    return results;
  }

  private async fallbackCached(
    cached: SearchResults | null,
    input: OrchestratedSearchInput,
    parsed: import("../types.js").ParsedQuery,
    reason: string,
    failedSources: Source[],
    now: number,
  ): Promise<SearchResults> {
    logger.warn({ reason, query: input.query }, "Falling back to cache");
    if (cached) {
      return {
        ...cached,
        fromCache: true,
        cacheAgeMs: now - cached.fetchedAt,
        failedSources,
      };
    }
    return {
      requestId: randomUUID(),
      query: input.query,
      city: input.city,
      parsed,
      products: [],
      fetchedAt: now,
      fromCache: false,
      failedSources,
    };
  }

  private async enqueue(
    queue: import("bullmq").Queue<SearchJobData, SearchJobResult>,
    source: string,
    input: OrchestratedSearchInput,
    parsed: import("../types.js").ParsedQuery,
    requestId: string,
    timeoutMs: number,
  ): Promise<{ source: string; job: Job<SearchJobData, SearchJobResult> }> {
    const data: SearchJobData = {
      requestId,
      source,
      query: input.query,
      city: input.city,
      brand: parsed.brand,
      minPrice: parsed.minPrice,
      maxPrice: parsed.maxPrice,
      attributes: parsed.attributes,
      timeoutMs,
    };
    const job = await queue.add(`search:${source}`, data, {
      jobId: `${requestId}-${source}`,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    return { source, job };
  }
}

function labelOf(source: string): string {
  const map: Record<string, string> = {
    wildberries: "Wildberries",
    ozon: "Ozon",
    aliexpress: "AliExpress",
    mvideo: "М.Видео",
    dns: "ДНС",
    citilink: "Ситилинк",
  };
  return map[source] ?? source;
}

function nextSource(current: string, api: Source[], parsers: Source[]): string {
  const all = [...api, ...parsers];
  const idx = all.indexOf(current as Source);
  return all[idx + 1] ?? "итог";
}

// Helper used by tests / admin to peek at queue counts.
export async function getQueueCounts() {
  const api = getApiQueue();
  const parser = getParserQueue();
  const [a, p] = await Promise.all([api.getJobCounts(), parser.getJobCounts()]);
  return { api: a, parser: p };
}
