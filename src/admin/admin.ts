// Admin panel: commands + inline buttons. Restricted to ADMIN_IDS.
// Capabilities: toggle sources, set delivery thresholds, view queue/cache
// stats, top queries, manage proxy list, A/B test buy-button labels.

import type { Telegraf } from "telegraf";
import { getRepositories } from "../db/repositories/index.js";
import { ALL_SOURCES } from "../types.js";
import { ProxyPool } from "../parsers/proxy-pool.js";
import { getQueueCounts } from "../queues/orchestrator.js";
import { getRedis } from "../db/redis.js";
import { adminKeyboard, sourcesKeyboard } from "../bot/keyboards.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { BotContext } from "../bot/context.js";

const proxyPool = new ProxyPool();

export function registerAdmin(bot: Telegraf<BotContext>): void {
  const isAdmin = (id: number): boolean => env.adminIds.includes(BigInt(id));

  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.reply("🛠️ Админ-панель:", adminKeyboard());
  });

  bot.action("admin:menu", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    await ctx.editMessageText("🛠️ Админ-панель:", adminKeyboard());
  });

  // ---- Sources ----
  bot.action("admin:sources", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const settings = await getRepositories().settings.get();
    await ctx.editMessageText("🔌 Источники (вкл/выкл):", { reply_markup: sourcesKeyboard(settings.enabledSources, ALL_SOURCES) });
  });

  bot.action(/admin:toggle:(.+)/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const source = ctx.match[1] as never;
    const settings = await getRepositories().settings.get();
    const enabled = settings.enabledSources.includes(source as never);
    const next = await getRepositories().settings.toggleSource(source as never, !enabled);
    await ctx.answerCbQuery(`${source}: ${!enabled ? "вкл" : "выкл"}`);
    await ctx.editMessageText("🔌 Источники:", { reply_markup: sourcesKeyboard(next.enabledSources, ALL_SOURCES) });
  });

  // ---- Thresholds ----
  bot.action("admin:thresholds", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const s = await getRepositories().settings.get();
    await ctx.editMessageText(
      `⏱️ Текущие пороги доставки:\nfastMaxDays=${s.deliveryThresholds.fastMaxDays}\nmediumMaxDays=${s.deliveryThresholds.mediumMaxDays}\n\nЧтобы изменить — /set_thresholds fast=1 medium=4`,
    );
  });

  bot.command("set_thresholds", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const args = ctx.message.text.split(" ").slice(1);
    const fast = args.find((a) => a.startsWith("fast="))?.split("=")[1];
    const medium = args.find((a) => a.startsWith("medium="))?.split("=")[1];
    const patch: { fastMaxDays?: number; mediumMaxDays?: number } = {};
    if (fast) patch.fastMaxDays = Number.parseInt(fast, 10);
    if (medium) patch.mediumMaxDays = Number.parseInt(medium, 10);
    const next = await getRepositories().settings.update({
      deliveryThresholds: { fastMaxDays: patch.fastMaxDays ?? 1, mediumMaxDays: patch.mediumMaxDays ?? 4 },
    });
    await ctx.reply(`Пороги обновлены: fast=${next.deliveryThresholds.fastMaxDays}, medium=${next.deliveryThresholds.mediumMaxDays}`);
  });

  // ---- Queues & cache ----
  bot.action("admin:queues", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const counts = await getQueueCounts();
    const keys = await getRedis().dbsize();
    const text = `📊 Очереди:\nAPI: waiting=${counts.api.waiting} active=${counts.api.active} completed=${counts.api.completed}\nParser: waiting=${counts.parser.waiting} active=${counts.parser.active} completed=${counts.parser.completed}\n\nRedis keys (примерно кэш): ${keys}`;
    await ctx.editMessageText(text);
  });

  // ---- Top queries ----
  bot.action("admin:top", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const top = await getRepositories().topQueries.top(15, 7);
    const text = top.length
      ? "🏆 Топ запросов за 7 дней:\n" + top.map((t, i) => `${i + 1}. ${t.query} — ${t.count}`).join("\n")
      : "Нет данных.";
    await ctx.editMessageText(text);
  });

  // ---- Proxy ----
  bot.action("admin:proxy", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const { all, bad } = await proxyPool.list();
    await ctx.editMessageText(
      `🌐 Прокси в пуле: ${all.length}\nВ бане: ${bad.length}\n\nКоманды:\n/add_proxy http://user:pass@host:port\n/clear_proxy`,
    );
  });

  bot.command("add_proxy", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const url = ctx.message.text.split(" ")[1];
    if (!url) {
      await ctx.reply("Использование: /add_proxy http://user:pass@host:port");
      return;
    }
    await proxyPool.seed([url]);
    const settings = await getRepositories().settings.get();
    await getRepositories().settings.update({ proxyList: [...settings.proxyList, url] });
    await ctx.reply("Прокси добавлен.");
  });

  bot.command("clear_proxy", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await proxyPool.replaceAll([]);
    await getRepositories().settings.update({ proxyList: [] });
    await ctx.reply("Список прокси очищен.");
  });

  // ---- A/B buttons ----
  bot.action("admin:ab", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const s = await getRepositories().settings.get();
    await ctx.editMessageText(
      `🅰️ Текущие варианты кнопки «Купить»:\n${s.buyButtonVariants.map((v, i) => `${i + 1}. ${v}`).join("\n")}\n\n/set_buttons "Купить сейчас","Перейти в магазин"`,
    );
  });

  bot.command("set_buttons", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const raw = ctx.message.text.replace(/^\/set_buttons\s*/, "");
    const variants = raw.split(",").map((v) => v.trim()).filter(Boolean);
    if (variants.length === 0) {
      await ctx.reply("Укажите варианты через запятую.");
      return;
    }
    await getRepositories().settings.update({ buyButtonVariants: variants });
    await ctx.reply(`Кнопки обновлены: ${variants.join(", ")}`);
  });

  logger.info({ admins: env.adminIds.map((i) => i.toString()) }, "Admin handlers registered");
}
