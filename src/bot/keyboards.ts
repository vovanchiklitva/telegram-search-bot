// Inline and reply keyboards used across the bot.

import { Markup } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";

// ---- Onboarding / consent ----
export const cityReply = () =>
  Markup.keyboard([["📍 Отправить геолокацию"], ["✏️ Ввести город текстом"]])
    .resize()
    .oneTime();

export const consentKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ Принимаю", "consent:yes"), Markup.button.callback("❌ Не принимаю", "consent:no")],
  ]);

// ---- Main menu ----
export const mainMenu = () =>
  Markup.keyboard([
    ["🔍 Поиск товара", "📷 Поиск по фото"],
    ["⭐ Избранное", "🔔 Мои оповещения"],
    ["🕒 Мои запросы", "🏙️ Сменить город"],
    ["🗑️ Удалить мои данные"],
  ]).resize();

// ---- Result actions ----
export function resultsKeyboard(opts: {
  buyLabel: string;
  productId: string;
  source: string;
  url: string;
}): InlineKeyboardMarkup {
  return Markup.inlineKeyboard([[Markup.button.url(opts.buyLabel, opts.url)]]).reply_markup;
}

export function afterSearchKeyboard(canSubscribe: boolean): InlineKeyboardMarkup {
  const rows = [
    [Markup.button.callback("🔍 Уточнить запрос", "refine:start")],
    [Markup.button.callback("📄 Показать ещё", "results:more")],
  ];
  if (canSubscribe) rows.push([Markup.button.callback("🔔 Подписаться на цену", "alert:start")]);
  return Markup.inlineKeyboard(rows).reply_markup;
}

// ---- Refinement flow ----
export const refineKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🏙️ Другой город", "refine:city")],
    [Markup.button.callback("💰 Ценовой диапазон", "refine:price")],
    [Markup.button.callback("🔧 Характеристики", "refine:attrs")],
    [Markup.button.callback("◀️ Назад", "refine:cancel")],
  ]);

// ---- Admin ----
export const adminKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🔌 Источники", "admin:sources")],
    [Markup.button.callback("⏱️ Пороги доставки", "admin:thresholds")],
    [Markup.button.callback("📊 Очереди и кэш", "admin:queues")],
    [Markup.button.callback("🏆 Топ запросов", "admin:top")],
    [Markup.button.callback("🌐 Прокси", "admin:proxy")],
    [Markup.button.callback("🅰️ A/B кнопки", "admin:ab")],
  ]);

export function sourcesKeyboard(enabled: string[], all: string[]): InlineKeyboardMarkup {
  const rows = all.map((s) => {
    const on = enabled.includes(s);
    return [Markup.button.callback(`${on ? "✅" : "⬜"} ${s}`, `admin:toggle:${s}`)];
  });
  rows.push([Markup.button.callback("◀️ Назад", "admin:menu")]);
  return Markup.inlineKeyboard(rows).reply_markup;
}
