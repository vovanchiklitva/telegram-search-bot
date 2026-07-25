// Inline-button actions after a search: "Уточнить запрос", "Показать ещё",
// "Подписаться на цену". Refinement walks a small step machine.

import type { Telegraf } from "telegraf";
import { getRepositories } from "../../db/repositories/index.js";
import { Cache } from "../../utils/cache.js";
import { formatResults } from "../formatter.js";
import { afterSearchKeyboard, refineKeyboard } from "../keyboards.js";
import type { BotContext } from "../context.js";
import { runSearch } from "./search.js";
import { logger } from "../../utils/logger.js";

const cache = new Cache();

export function registerActions(bot: Telegraf<BotContext>): void {
  // ---- Refine ----
  bot.action("refine:start", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Что уточнить?", refineKeyboard());
  });

  bot.action("refine:cancel", async (ctx) => {
    await ctx.answerCbQuery("Отмена");
    await ctx.deleteMessage().catch(() => undefined);
  });

  bot.action("refine:city", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.step = "await_city";
    await ctx.reply("Введите новый город для поиска:");
  });

  bot.action("refine:price", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.step = "await_refine_price";
    await ctx.reply("Введите диапазон цен через дефис, например: 5000-15000");
  });

  bot.action("refine:attrs", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.step = "await_refine_attrs";
    await ctx.reply("Опишите дополнительные характеристики (например: «красный, 64 ГБ»):");
  });

  // text inputs for refinement flows
  bot.on("text", async (ctx, next) => {
    const step = ctx.session?.step;
    if (step !== "await_refine_price" && step !== "await_refine_attrs") return next();

    const text = ctx.message.text.trim();
    const query = ctx.session.query ?? "";
    let refined = query;
    if (step === "await_refine_price") {
      const m = text.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (m) refined = `${query} цена ${m[1]}-${m[2]}`;
      else refined = `${query} ${text}`;
    } else {
      refined = `${query} ${text}`;
    }
    ctx.session.step = undefined;
    await runSearch(ctx, refined);
  });

  // ---- Show more ----
  bot.action("results:more", async (ctx) => {
    await ctx.answerCbQuery("Подгружаю ещё...");
    const query = ctx.session.query;
    if (!query) {
      await ctx.reply("Контекст поиска потерян. Повторите запрос, пожалуйста.");
      return;
    }
    const user = await getRepositories().users.getByTelegramId(BigInt(ctx.from.id));
    const cached = await cache.getJson<import("../../types.js").SearchResults>(
      cache.resultsKey(query, user?.city ?? null),
    );
    if (!cached || cached.products.length === 0) {
      await ctx.reply("Данные устарели. Выполните новый поиск.");
      return;
    }
    const offset = ctx.session.offset ?? 5;
    const more = cached.products.slice(offset, offset + 5);
    if (more.length === 0) {
      await ctx.reply("Больше нет результатов по этому запросу.");
      return;
    }
    const { text } = await formatResults({ ...cached, products: more });
    await ctx.reply(text, { parse_mode: "Markdown" });
    ctx.session.offset = offset + more.length;
  });

  // ---- Subscribe to price ----
  bot.action("alert:start", async (ctx) => {
    await ctx.answerCbQuery();
    const user = await getRepositories().users.getByTelegramId(BigInt(ctx.from.id));
    if (!user?.consent) {
      await ctx.reply("Оповещения доступны только при согласии на хранение данных. Вы в минимальном режиме.");
      return;
    }
    ctx.session.step = "await_alert_target";
    await ctx.reply("Отправьте целевую цену числом (в рублях), при достижении которой пришлю уведомление:");
  });

  bot.on("text", async (ctx, next) => {
    if (ctx.session?.step !== "await_alert_target") return next();
    const target = Number.parseFloat(ctx.message.text.replace(/[^\d.]/g, ""));
    ctx.session.step = undefined;
    if (!Number.isFinite(target) || target <= 0) {
      await ctx.reply("Не похоже на число. Попробуйте снова кнопкой «🔔 Подписаться на цену».");
      return;
    }
    const query = ctx.session.query;
    const user = await getRepositories().users.getByTelegramId(BigInt(ctx.from.id));
    if (!user || !query) {
      await ctx.reply("Не удалось найти товар для подписки. Повторите поиск.");
      return;
    }
    const cached = await cache.getJson<import("../../types.js").SearchResults>(
      cache.resultsKey(query, user.city ?? null),
    );
    const cheapest = cached?.products?.[0];
    if (!cheapest) {
      await ctx.reply("Товар не найден в кэше. Повторите поиск, чтобы подписаться.");
      return;
    }
    await getRepositories().priceAlerts.create({ userId: user.id, product: cheapest, targetPriceRub: target });
    await ctx.reply(`🔔 Подписка оформлена. Сообщу, когда «${cheapest.title.slice(0, 40)}» подешевеет ниже ${target} ₽.`);
    logger.info({ userId: user.id, target }, "price alert created");
  });
}
