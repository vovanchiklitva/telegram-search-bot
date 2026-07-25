// Telegraf session store backed by Redis so multiple bot instances share state.
// Implements the Telegraf SessionStore interface (get/set/delete, async).

import { getRedis } from "../db/redis.js";
import { logger } from "../utils/logger.js";

interface SessionData {
  // conversational step machine: "await_city" | "await_query" | "await_refine" | ...
  step?: string;
  query?: string;
  city?: string;
  // cached between steps
  parsed?: unknown;
  requestId?: string;
  // pagination
  offset?: number;
  // for the photo flow
  photoFileId?: string;
  // refinement payload
  refine?: { field: string };
}

// Telegraf's SessionStore is the async variant; we satisfy get/set/delete
// returning promises. Structurally compatible with SessionStore<SessionData>.
export class RedisSessionStore {
  private prefix = "tg:session:";
  private ttlSec = 3600;

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }

  async get(id: string): Promise<SessionData | undefined> {
    const raw = await getRedis().get(this.key(id));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      return undefined;
    }
  }

  async set(id: string, data: SessionData): Promise<void> {
    try {
      await getRedis().set(this.key(id), JSON.stringify(data), "EX", this.ttlSec);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "session save failed");
    }
  }

  async delete(id: string): Promise<void> {
    await getRedis().del(this.key(id));
  }
}

export type { SessionData };
