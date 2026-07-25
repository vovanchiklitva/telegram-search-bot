// Per-user rate limiter using a sliding-window counter in Redis.
// Used to cap searches (default 10/min). Returns whether the action is allowed
// and how many seconds until the window resets if denied.

import type { Redis } from "ioredis";
import { getRedis } from "../db/redis.js";
import { env } from "../config/env.js";

const KEY = (id: bigint | string) => `rl:search:${id.toString()}`;

export class RateLimiter {
  constructor(private redis: Redis = getRedis()) {}

  async tryAcquire(telegramId: bigint): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const key = KEY(telegramId);
    const now = Date.now();
    const windowMs = 60_000;
    const max = env.rateLimitSearchPerMin;
    // sorted set: member=timestamp, score=timestamp
    const pipe = this.redis.multi();
    pipe.zremrangebyscore(key, 0, now - windowMs);
    pipe.zadd(key, now, `${now}`);
    pipe.zcard(key);
    pipe.pexpire(key, windowMs + 1000);
    const results = await pipe.exec();
    const count = results?.[2]?.[1] as number | undefined;
    if (count === undefined) return { allowed: true, retryAfterSec: 0 };
    if (count > max) {
      const oldest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
      const oldestScore = oldest[1] ? Number.parseFloat(oldest[1]) : now;
      const retryAfter = Math.ceil((oldestScore + windowMs - now) / 1000);
      return { allowed: false, retryAfterSec: Math.max(1, retryAfter) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }
}
