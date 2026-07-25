// Centralized, typed access to environment variables.
// Reads from process.env (populated by dotenv at the entry point).
// Throws early at startup if any required value is missing so the bot
// never runs in a half-configured state.

import { config as loadEnv } from "dotenv";
loadEnv();

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

function optional(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function csv(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function bigints(name: string): bigint[] {
  return csv(name).map((s) => {
    const n = Number.parseInt(s, 10);
    if (!Number.isFinite(n)) throw new Error(`Invalid id in ${name}: ${s}`);
    return BigInt(n);
  });
}

export const env = {
  botToken: required("BOT_TOKEN"),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  openaiApiKey: required("OPENAI_API_KEY"),

  wbApiKey: optional("WB_API_KEY"),
  ozonApiKey: optional("OZON_API_KEY"),
  ozonClientId: optional("OZON_CLIENT_ID"),
  aliexpressAppKey: optional("ALIEXPRESS_APP_KEY"),
  aliexpressAppSecret: optional("ALIEXPRESS_APP_SECRET"),

  partnerUtm: {
    wb: optional("PARTNER_WB_UTM"),
    ozon: optional("PARTNER_OZON_UTM"),
    aliexpress: optional("PARTNER_ALIEXPRESS_UTM"),
  },

  adminIds: bigints("ADMIN_IDS"),
  errorNotifyChatId: optional("ERROR_NOTIFY_CHAT_ID"),

  proxyList: csv("PROXY_LIST"),

  cacheResultsTtl: int("CACHE_RESULTS_TTL", 900),
  cacheLlmParamsTtl: int("CACHE_LLM_PARAMS_TTL", 3600),

  rateLimitSearchPerMin: int("RATE_LIMIT_SEARCH_PER_MIN", 10),
  queueMaxPending: int("QUEUE_MAX_PENDING", 50),

  timeoutApiMs: int("TIMEOUT_API_MS", 8000),
  timeoutParserMs: int("TIMEOUT_PARSER_MS", 15000),

  priceAlertCron: optional("PRICE_ALERT_CRON", "0 */6 * * *"),
};

export type Env = typeof env;
