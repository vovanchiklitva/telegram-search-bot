// Redis-backed cache helpers. Centralizes TTLs and key naming.
// Used for: search results, LLM-extracted parameters (text-hash), image
// recognition results (image-hash, permanent).

import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { getRedis } from "../db/redis.js";
import { env } from "../config/env.js";

export class Cache {
  constructor(private redis: Redis = getRedis()) {}

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSec);
  }

  // Permanent cache (no TTL) - used for image recognition results.
  async setJsonPermanent(key: string, value: unknown): Promise<void> {
    await this.redis.set(key, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  // ---- typed key builders ----
  resultsKey(query: string, city: string | null): string {
    return `cache:results:${hashStr(`${query}|${city ?? ""}`)}`;
  }
  llmParamsKey(text: string): string {
    return `cache:llm:${hashStr(text)}`;
  }
  visionKey(imageHash: string): string {
    return `cache:vision:${imageHash}`;
  }

  resultsTtl(): number {
    return env.cacheResultsTtl;
  }
  llmTtl(): number {
    return env.cacheLlmParamsTtl;
  }
}

export function hashStr(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 24);
}

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
