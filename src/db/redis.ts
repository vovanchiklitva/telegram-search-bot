// Single shared ioredis instance for the whole process.
// Used by: Telegraf session store, BullMQ queues, caches, rate limiter.

import { Redis as RedisClass } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

type RedisClient = InstanceType<typeof RedisClass>;

let connection: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (!connection) {
    connection = new RedisClass(env.redisUrl, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: true,
      lazyConnect: false,
    });
    connection.on("error", (err: Error) => {
      logger.error({ err: err.message }, "Redis error");
    });
  }
  return connection;
}

// BullMQ recommends a dedicated connection per Queue/Worker so that blocking
// reads do not interfere with normal commands. Use this for queues.
export function getRedisForQueue(): RedisClient {
  return new RedisClass(env.redisUrl, { maxRetriesPerRequest: null });
}

export type { RedisClient };
