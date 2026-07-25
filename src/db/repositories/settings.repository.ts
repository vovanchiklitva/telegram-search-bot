// Admin settings repository. The `settings` table is a single-row-per-key
// JSON store. We cache values in Redis (60s) to avoid hammering Postgres.

import { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { AdminSettings, Source } from "../../types.js";
import { ALL_SOURCES } from "../../types.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

const SETTING_KEY = "admin_settings";
const CACHE_KEY = "settings:admin";
const CACHE_TTL = 60;

const DEFAULT_SETTINGS: AdminSettings = {
  enabledSources: [...ALL_SOURCES],
  deliveryThresholds: { fastMaxDays: 1, mediumMaxDays: 4 },
  proxyList: env.proxyList,
  buyButtonVariants: ["🛒 Купить", "🛍️ Перейти в магазин"],
};

export class SettingsRepository {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  async get(): Promise<AdminSettings> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) {
      try {
        return { ...DEFAULT_SETTINGS, ...(JSON.parse(cached) as AdminSettings) };
      } catch {
        // fall through
      }
    }
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const value = row?.value as AdminSettings | null;
    const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
    await this.redis.set(CACHE_KEY, JSON.stringify(merged), "EX", CACHE_TTL);
    return merged;
  }

  async update(patch: Partial<AdminSettings>): Promise<AdminSettings> {
    const current = await this.get();
    const next: AdminSettings = {
      ...current,
      ...patch,
      deliveryThresholds: { ...current.deliveryThresholds, ...(patch.deliveryThresholds ?? {}) },
    };
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: next as unknown as object },
      update: { value: next as unknown as object },
    });
    await this.redis.del(CACHE_KEY);
    logger.info({ settings: next }, "Admin settings updated");
    return next;
  }

  async toggleSource(source: Source, enabled: boolean): Promise<AdminSettings> {
    const current = await this.get();
    const set = new Set(current.enabledSources);
    if (enabled) set.add(source);
    else set.delete(source);
    return this.update({ enabledSources: [...set] });
  }
}
