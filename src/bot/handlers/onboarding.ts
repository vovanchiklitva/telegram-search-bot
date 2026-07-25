// Onboarding, consent, city, and delete-my-data flows.

import type { Telegraf } from "telegraf";
import { getRepositories } from "../../db/repositories/index.js";
import { consentKeyboard, cityReply, mainMenu } from "../keyboards.js";
import type { BotContext } from "../context.js";
import { logger } from "../../utils/logger.js";

export function registerOnboarding(bot: Telegraf<BotContext>): void {
  // /start: greet, ask city (unless already known).
  bot.start(async (ctx) => {
    const tgId = ctx.from.id;
    const repos = getRepositories();
    const existing = await repos.users.getByTelegramId(BigInt(tgId));
    await repos.users.upsertByTelegramId({
      telegramId: BigInt(tgId),
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    if (existing?.city) {
      await ctx.reply(`С возвращением! Ваш город: ${existing.city}.`, mainMenu());
      return;
    }
    await ctx.reply(
      "Привет! Я помогу найти товар на маркетплейсах (Wildberries, Ozon, AliExpress, М.Видео, ДНС, Ситилинк).\n\nДля начала укажите свой город — это поможет показывать товары с быстрой доставкой.",
      cityReply(),
    );
    ctx.session.step = "await_city";
  });

  // Geolocation as city source.
  bot.on("location", async (ctx) => {
    const repos = getRepositories();
    const { latitude, longitude } = ctx.message.location;
    const cityName = await reverseGeocode(latitude, longitude).catch(() => null);
    if (!cityName) {
      await ctx.reply("Не удалось определить город по координатам. Введите название текстом.");
      return;
    }
    await repos.users.setCity(BigInt(ctx.from.id), cityName, latitude, longitude);
    await ctx.reply(`Город сохранён: ${cityName}.`, mainMenu());
    await askConsent(ctx);
  });

  // Text city input handled in session step await_city.
  bot.on("text", async (ctx, next) => {
    const step = ctx.session?.step;
    if (step !== "await_city") return next();
    const text = ctx.message.text.trim();
    if (text.startsWith("📍") || text.startsWith("✏️")) return; // button echoes
    const repos = getRepositories();
    await repos.users.setCity(BigInt(ctx.from.id), text);
    await ctx.reply(`Город сохранён: ${text}.`, mainMenu());
    await askConsent(ctx);
    ctx.session.step = undefined;
  });

  // Consent buttons.
  bot.action("consent:yes", async (ctx) => {
    await getRepositories().users.setConsent(BigInt(ctx.from.id), true);
    await ctx.answerCbQuery("Спасибо! История, избранное и оповещения включены.");
    await ctx.editMessageText("✅ Согласие получено. Полный функционал активен.");
    await ctx.reply("Главное меню:", mainMenu());
  });

  bot.action("consent:no", async (ctx) => {
    await getRepositories().users.setConsent(BigInt(ctx.from.id), false);
    await ctx.answerCbQuery("Включён минимальный режим.");
    await ctx.editMessageText(
      "Понял. Включён минимальный режим: поиск доступен, но история, избранное и оповещения отключены. Мы храним только ваш ID и город для доставки.",
    );
    await ctx.reply("Главное меню:", mainMenu());
  });

  // /change_city
  bot.command("change_city", async (ctx) => {
    await ctx.reply("Введите новый город текстом или отправьте геолокацию.", cityReply());
    ctx.session.step = "await_city";
  });

  // /delete_my_data
  bot.command("delete_my_data", async (ctx) => {
    const result = await getRepositories().users.deleteAllData(BigInt(ctx.from.id));
    logger.info({ tgId: ctx.from.id, result }, "delete_my_data");
    await ctx.reply(
      "🗑️ Все ваши данные удалены: профиль, история поиска, избранное и оповещения.\nЧтобы начать заново — отправьте /start.",
    );
    ctx.session = {};
  });
}

async function askConsent(ctx: BotContext): Promise<void> {
  await ctx.reply("Мы сохраняем ваш город и историю поиска для улучшения сервиса. Вы согласны?", consentKeyboard());
}

// Minimal reverse geocoder using the free Nominatim endpoint. Returns the
// Russian city name or null. Rate-limited upstream (1 req/s).
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=ru`;
  const res = await fetch(url, { headers: { "User-Agent": "shop-search-bot/1.0" } });
  if (!res.ok) return null;
  const data = (await res.json()) as { address?: { city?: string; town?: string; village?: string; state?: string } };
  return data.address?.city ?? data.address?.town ?? data.address?.village ?? data.address?.state ?? null;
}
