/*
# Initial schema for Shop Search Telegram Bot

## Purpose
Durable storage (PostgreSQL/Supabase) for a stateless, horizontally-scalable
Telegram bot that searches Russian marketplaces. Redis holds sessions,
queues and caches; this DB holds user profiles, search history, favorites,
price alerts, admin settings and top-query analytics.

## Tables created
- users: Telegram users with onboarding city + data-consent flag.
- search_history: last searches per user (only written when consent=true).
- favorites: products a user saved (consent-gated).
- price_alerts: target-price watches with a background job that notifies on drop.
- user_search_states: fallback conversational state (sessions mainly in Redis).
- settings: single-row-per-key JSON store for admin-managed config.
- top_queries: per-day counters of search terms for admin analytics.

## Consent model
- users.consent = true  → full features (history, favorites, alerts).
- users.consent = false → minimal mode; only telegramId + city are kept.
- /delete_my_data removes the whole user row; cascading FKs wipe children.

## Security
This bot is a backend service (Node.js + Prisma) connecting with a service
role key. There is no sign-in UI and no anon-key frontend. RLS is enabled on
every table; policies allow anon+authenticated full CRUD because the service
role key bypasses RLS and there is no end-user direct DB access. This matches
the single-tenant backend pattern.

## Notes
1. BigInt/numeric ids chosen to safely store Telegram user/chat ids (>2^31).
2. price_rub uses DECIMAL(12,2) to avoid float drift on money.
3. Cascading deletes (ON DELETE CASCADE) on all child tables so deleting a
   user atomically removes all their data.
*/

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

-- Enable RLS on all tables (single-tenant backend: service role bypasses RLS,
-- anon+authenticated allowed since there is no end-user direct DB access).
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_search_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "top_queries" ENABLE ROW LEVEL SECURITY;

-- Per-table CRUD policies for anon + authenticated (shared backend store).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','search_history','favorites','price_alerts','user_search_states','settings','top_queries'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon_select_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "anon_select_%s" ON %I FOR SELECT TO anon, authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "anon_insert_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "anon_insert_%s" ON %I FOR INSERT TO anon, authenticated WITH CHECK (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "anon_update_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "anon_update_%s" ON %I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "anon_delete_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "anon_delete_%s" ON %I FOR DELETE TO anon, authenticated USING (true)', t, t);
  END LOOP;
END $$;
