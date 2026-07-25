// Proxy pool for Puppeteer parsers. Proxies come from PROXY_LIST (env) plus
// any list the admin stores in the settings table. We round-robin and mark a
// proxy as temporarily "bad" (until cool-down) when a parse fails on it.
// All state lives in Redis so multiple workers share the pool.

import type { Redis } from "ioredis";
import { getRedis } from "../db/redis.js";
import { logger } from "../utils/logger.js";

const POOL_KEY = "proxy:pool";
const BAD_KEY = "proxy:bad"; // sorted set: proxy -> cooldown-until (epoch sec)

export class ProxyPool {
  private redis: Redis;

  constructor(redis: Redis = getRedis()) {
    this.redis = redis;
  }

  // Seed the pool from env + admin settings. Idempotent.
  async seed(proxies: string[]): Promise<void> {
    if (proxies.length === 0) return;
    // dedupe and store
    const unique = [...new Set(proxies)];
    await this.redis.sadd(POOL_KEY, ...unique);
    logger.info({ count: unique.length }, "Proxy pool seeded");
  }

  // Get a healthy proxy (not in cooldown), round-robin via RANDOMMEMBER.
  async acquire(): Promise<string | null> {
    const all = await this.redis.smembers(POOL_KEY);
    if (all.length === 0) return null;
    const now = Math.floor(Date.now() / 1000);
    // Drop expired bad marks
    await this.redis.zremrangebyscore(BAD_KEY, 0, now);
    const bad = new Set(await this.redis.zrange(BAD_KEY, 0, -1));
    const healthy = all.filter((p) => !bad.has(p));
    if (healthy.length === 0) {
      // all proxies in cooldown → return any (worker will mark bad again)
      return all[Math.floor(Math.random() * all.length)] ?? null;
    }
    return healthy[Math.floor(Math.random() * healthy.length)] ?? null;
  }

  // Mark a proxy as bad for `cooldownSec` (default 5 min).
  async markBad(proxy: string, cooldownSec = 300): Promise<void> {
    const until = Math.floor(Date.now() / 1000) + cooldownSec;
    await this.redis.zadd(BAD_KEY, until, proxy);
    logger.warn({ proxy, cooldownSec }, "Proxy marked bad");
  }

  async list(): Promise<{ all: string[]; bad: string[] }> {
    const [all, bad] = await Promise.all([
      this.redis.smembers(POOL_KEY),
      this.redis.zrange(BAD_KEY, 0, -1),
    ]);
    return { all, bad };
  }

  async replaceAll(proxies: string[]): Promise<void> {
    const existing = await this.redis.smembers(POOL_KEY);
    if (existing.length) await this.redis.srem(POOL_KEY, ...existing);
    if (proxies.length) await this.redis.sadd(POOL_KEY, ...proxies);
    await this.redis.del(BAD_KEY);
  }
}
