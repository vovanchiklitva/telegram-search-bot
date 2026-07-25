-- Migration 0001_init: initial schema for shop-search Telegram bot.
-- Tables: users, search_history, favorites, price_alerts, user_search_states, settings, top_queries.

CREATE TABLE IF NOT EXISTS "users" (
  "id"            BIGSERIAL PRIMARY KEY,
  "telegram_id"   BIGINT NOT NULL UNIQUE,
  "username"      TEXT,
  "first_name"    TEXT,
  "city"          TEXT,
  "lat"           DOUBLE PRECISION,
  "lon"           DOUBLE PRECISION,
  "consent"       BOOLEAN NOT NULL DEFAULT false,
  "minimal_mode"  BOOLEAN NOT NULL DEFAULT false,
  "language"      TEXT NOT NULL DEFAULT 'ru',
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "search_history" (
  "id"            BIGSERIAL PRIMARY KEY,
  "user_id"       BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "query"         TEXT NOT NULL,
  "city"          TEXT,
  "parsed_json"   JSONB,
  "result_count"  INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "search_history_user_id_created_at_idx"
  ON "search_history"("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "favorites" (
  "id"            BIGSERIAL PRIMARY KEY,
  "user_id"       BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "product_id"    TEXT NOT NULL,
  "source"        TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "url"           TEXT NOT NULL,
  "price_rub"     DECIMAL(12,2) NOT NULL,
  "image_url"     TEXT,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "favorites_user_id_idx" ON "favorites"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "favorites_user_product_source_unique"
  ON "favorites"("user_id", "product_id", "source");

CREATE TABLE IF NOT EXISTS "price_alerts" (
  "id"                BIGSERIAL PRIMARY KEY,
  "user_id"           BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "favorite_id"       BIGINT,
  "product_id"        TEXT NOT NULL,
  "source"            TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "target_price_rub"  DECIMAL(12,2) NOT NULL,
  "last_price_rub"    DECIMAL(12,2),
  "last_checked_at"   TIMESTAMPTZ,
  "triggered_at"      TIMESTAMPTZ,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "price_alerts_active_idx" ON "price_alerts"("active");

CREATE TABLE IF NOT EXISTS "user_search_states" (
  "id"          BIGSERIAL PRIMARY KEY,
  "user_id"     BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "step"        TEXT NOT NULL,
  "payload"     JSONB,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "user_search_states_user_id_idx" ON "user_search_states"("user_id");

CREATE TABLE IF NOT EXISTS "settings" (
  "id"    BIGSERIAL PRIMARY KEY,
  "key"   TEXT NOT NULL UNIQUE,
  "value" JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS "top_queries" (
  "id"    BIGSERIAL PRIMARY KEY,
  "day"   DATE NOT NULL,
  "query" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "top_queries_day_query_unique" ON "top_queries"("day", "query");
CREATE INDEX IF NOT EXISTS "top_queries_day_count_idx" ON "top_queries"("day", "count");
