// Favorites, price-alerts and search history menu handlers.
// All gated on user consent — minimal-mode users get a friendly message.

import type { Telegraf } from "telegraf";
import { getRepositories } from "../../db/repositories/index.js";
import { formatFavorites, formatAlerts } from "../formatter.js";
import { mainMenu } from "../keyboards.js";
import type { BotContext } from "../context.js";
import { runSearch } from "./search.js";

export function registerLists(bot: Telegraf<BotContext>): void {
  bot.hears("⭐ Избранное", async (ctx) => {
    const user = await getRepositories().users.getByTelegramId(BigInt(ctx.from.id));
    if (!user?.consent) {
      await ctx.reply("Избранное доступно только при согласии на хранение данных.", mainMenu());
      return;
    }
    const rows = await getRepositories().favorites.list(user.id);
    await ctx.reply(formatFavorites(rows as never), { parse_mode: "Markdown", ...mainMenu() });
  });

  bot.hears("🔔 Мои оповещения", async (ctx) => {
    const user = await getRepositories().users.getByTelegramId(BigInt(ctx.from.id));
    if (!user?.consent) {
      await ctx.reply("Оповещения доступны только при согласии на хранение данных.", mainMenu());
      return;
    }
    const rows = await getRepositories().priceAlerts.listForUser(user.id);
    await ctx.reply(formatAlerts(rows as never), mainMenu());
  });

  bot.hears("🕒 Мои запросы", async (ctx) => {
    const user = await getRepositories().users.getByTelegramId(BigInt(ctx.from.id));
    if (!user?.consent) {
      await ctx.reply("История доступна только при согласии на хранение данных.", mainMenu());
      return;
    }
    const recent = await getRepositories().searchHistory.recent(user.id, 10);
    if (recent.length === 0) {
      await ctx.reply("История поиска пуста.", mainMenu());
      return;
    }
    const buttons = recent.map((r) => [{ text: r.query, callback_data: `repeat:${r.id.toString()}` }]);
    await ctx.reply("Последние 10 запросов. Нажмите, чтобы повторить:", {
      reply_markup: { inline_keyboard: buttons },
    });
  });

  // Repeat a past query
  bot.action(/repeat:(\d+)/, async (ctx) => {
    const match = ctx.match[1];
    if (!match) {
      await ctx.answerCbQuery("Ошибка");
      return;
    }
    const id = BigInt(match);
    const user = await getRepositories().users.getByTelegramId(BigInt(ctx.from.id));
    if (!user) {
      await ctx.answerCbQuery("Ошибка");
      return;
    }
    const item = await getRepositories()
      .searchHistory.recent(user.id, 50)
      .then((rows) => rows.find((r) => r.id === id));
    if (!item) {
      await ctx.answerCbQuery("Запись не найдена");
      return;
    }
    await ctx.answerCbQuery("Повторяю поиск");
    await runSearch(ctx, item.query);
  });

  bot.hears("📷 Поиск по фото", async (ctx) => {
    await ctx.reply("Отправьте фото товара — я попробую его распознать и найти.");
  });

  bot.hears("🔍 Поиск товара", async (ctx) => {
    await ctx.reply("Введите название товара текстом.", mainMenu());
  });

  bot.hears("🏙️ Сменить город", async (ctx) => {
    await ctx.reply("Введите новый город текстом или отправьте геолокацию.");
    ctx.session.step = "await_city";
  });

  bot.hears("🗑️ Удалить мои данные", async (ctx) => {
    const result = await getRepositories().users.deleteAllData(BigInt(ctx.from.id));
    await ctx.reply(
      `🗑️ Удалено: профиль (${result.users}), история (${result.searches}), избранное (${result.favorites}), оповещения (${result.alerts}).`,
    );
    ctx.session = {};
  });
}
