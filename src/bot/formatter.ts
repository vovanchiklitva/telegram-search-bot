// Message formatter: turns a SearchResults object into the 4-block Telegram
// message described in the spec. Also formats favorites / alerts lists.

import type { Product, SearchResults } from "../types.js";
import { DELIVERY_LABEL } from "../types.js";
import { getRepositories } from "../db/repositories/index.js";
import { env } from "../config/env.js";

const MAX_PER_BLOCK = 5;

// The whole result message must fit Telegram's 4096-char limit. We truncate
// per-item descriptions to keep within bounds; "Показать ещё" loads more.

export async function formatResults(results: SearchResults): Promise<{ text: string; canSubscribe: boolean }> {
  const { products, city, fromCache, cacheAgeMs } = results;
  const settings = await getRepositories().settings.get();
  const buyLabel = settings.buyButtonVariants[0] ?? "🛒 Купить";

  // Block 0: price range
  const prices = products.map((p) => p.priceRub).filter((p) => p > 0);
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  const range = min !== null && max !== null ? `Диапазон цен: ${min} – ${max} ₽` : "Цены не найдены";

  const fresh = fromCache && cacheAgeMs !== undefined && cacheAgeMs > 10 * 60_000;
  const staleWarn = fromCache ? (fresh ? "\n⚠️ Данные могут быть устаревшими (кэш)." : "\n⚠️ Данные из кэша.") : "";

  // Block 1: fast local (delivery 0–1 day)
  const fast = products
    .filter((p) => p.deliveryCategory === "fast")
    .sort(byPrice)
    .slice(0, MAX_PER_BLOCK);

  // Block 2: cheaper with delivery (exclude block 1 ids)
  const fastIds = new Set(fast.map((p) => p.id));
  const cheaper = products
    .filter((p) => !fastIds.has(p.id) && (p.deliveryCategory === "medium" || p.deliveryCategory === "slow" || p.deliveryCategory === "abroad"))
    .sort(byPrice)
    .slice(0, MAX_PER_BLOCK);

  // Block 3: by parameters & reviews (if LLM extracted params)
  const hasParams = results.parsed.brand || results.parsed.category || (results.parsed.attributes && Object.keys(results.parsed.attributes).length);
  const byParams = hasParams
    ? products
        .filter((p) => matchParams(p, results.parsed))
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        .slice(0, MAX_PER_BLOCK)
    : [];

  const lines: string[] = [];
  lines.push(`💸 ${range}${staleWarn}`);
  lines.push("");

  lines.push(`🚀 Быстрые варианты в ${city ?? "вашем городе"}:`);
  if (fast.length) fast.forEach((p, i) => lines.push(formatItem(i + 1, p, buyLabel)));
  else lines.push("Ничего не найдено с быстрой доставкой.");
  lines.push("");

  lines.push(`💰 Ещё дешевле с доставкой:`);
  if (cheaper.length) cheaper.forEach((p, i) => lines.push(formatItem(i + 1, p, buyLabel)));
  else lines.push("Дополнительных вариантов нет.");
  lines.push("");

  if (hasParams) {
    lines.push(`⭐ Подборка по параметрам и отзывам:`);
    if (byParams.length) byParams.forEach((p, i) => lines.push(formatItem(i + 1, p, buyLabel)));
    else lines.push("Нет товаров, точно подходящих под параметры.");
  }

  if (results.failedSources.length) {
    lines.push("");
    lines.push(`⚠️ Часть источников недоступна: ${results.failedSources.join(", ")}`);
  }

  const text = clampToTelegram(lines.join("\n"));
  return { text, canSubscribe: products.length > 0 };
}

function formatItem(idx: number, p: Product, buyLabel: string): string {
  const rating = p.rating ? ` · ⭐ ${p.rating}` : "";
  const reviews = p.reviewsCount ? ` (${p.reviewsCount})` : "";
  const old = p.oldPriceRub ? ` ~~${p.oldPriceRub} ₽~~` : "";
  const city = p.cityFrom ? ` · 📍 ${p.cityFrom}` : "";
  const delivery = DELIVERY_LABEL[p.deliveryCategory];
  const link = p.affiliateUrl ?? p.url;
  return `${idx}. [${escapeTg(p.title)}](${link})\n   🏷️ ${p.source} · ${p.priceRub} ₽${old}${rating}${reviews}${city}\n   ${delivery}`;
}

function byPrice(a: Product, b: Product): number {
  return a.priceRub - b.priceRub;
}

function matchParams(p: Product, parsed: import("../types.js").ParsedQuery): boolean {
  if (parsed.brand && p.brand && !p.brand.toLowerCase().includes(parsed.brand.toLowerCase())) return false;
  if (parsed.minPrice && p.priceRub < parsed.minPrice) return false;
  if (parsed.maxPrice && p.priceRub > parsed.maxPrice) return false;
  return true;
}

// Telegram MarkdownV2 / Markdown escaping for safe display. We use Markdown
// (not V2) for link syntax simplicity; escape backticks and brackets lightly.
function escapeTg(s: string): string {
  return s.replace(/[`*_~]/g, (c) => `\\${c}`).slice(0, 120);
}

function clampToTelegram(s: string): string {
  if (s.length <= 4000) return s;
  return `${s.slice(0, 3990)}\n…(обрезано)`;
}

// ---- Favorites & alerts lists ----
export function formatFavorites(rows: { id: bigint; title: string; source: string; priceRub: { toString(): string }; url: string }[]): string {
  if (!rows.length) return "⭐ Избранное пусто. Сохраняйте товары кнопкой «Купить» после поиска.";
  return rows
    .map((r, i) => `${i + 1}. ${escapeTg(r.title)}\n   🏷️ ${r.source} · ${r.priceRub} ₽\n   [открыть](${r.url})`)
    .join("\n\n");
}

export function formatAlerts(rows: { id: bigint; title: string; targetPriceRub: { toString(): string }; lastPriceRub: { toString(): string } | null; active: boolean }[]): string {
  if (!rows.length) return "🔔 У вас нет активных оповещений о цене.";
  return rows
    .map((r, i) => `${i + 1}. ${escapeTg(r.title)}\n   цель: ${r.targetPriceRub} ₽ · последняя: ${r.lastPriceRub ?? "—"} ${r.active ? "✅" : "⏸️"}`)
    .join("\n\n");
}
