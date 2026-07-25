// Search handlers: text query, photo query, and the live-status orchestration.

import type { Telegraf } from "telegraf";
import { getRepositories } from "../../db/repositories/index.js";
import { getOpenAI } from "../../services/openai.service.js";
import { SearchOrchestrator } from "../../queues/orchestrator.js";
import { RateLimiter } from "../../utils/rate-limiter.js";
import { formatResults } from "../formatter.js";
import { afterSearchKeyboard } from "../keyboards.js";
import type { BotContext } from "../context.js";
import { logger } from "../../utils/logger.js";

const limiter = new RateLimiter();

export function registerSearch(bot: Telegraf<BotContext>): void {
  // Text search: any text message that isn't a command and isn't a known
  // step state (handled elsewhere). We treat it as a product query.
  bot.on("text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) return next();
    const step = ctx.session?.step;
    if (
      step === "await_city" ||
      step === "await_refine_price" ||
      step === "await_refine_attrs" ||
      step === "await_alert_target"
    ) {
      return next();
    }
    await runSearch(ctx, ctx.message.text);
  });

  // Photo search: Vision recognizes the product → run a text search.
  bot.on("photo", async (ctx) => {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    if (!photo) return;
    const fromId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!fromId || chatId === undefined) return;
    const lim = await limiter.tryAcquire(BigInt(fromId));
    if (!lim.allowed) {
      await ctx.reply(`Слишком много запросов. Попробуйте через ${lim.retryAfterSec} сек.`);
      return;
    }
    const status = await ctx.reply("📷 Распознаю товар на фото...");
    try {
      const link = await bot.telegram.getFileLink(photo.file_id);
      const imgRes = await fetch(link.href);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const base64 = buf.toString("base64");
      const recognized = await getOpenAI().recognizeImage(base64, "image/jpeg");
      if (!recognized) {
        await bot.telegram.editMessageText(
          chatId,
          status.message_id,
          undefined,
          "Не удалось распознать товар. Пожалуйста, опишите его текстом.",
        );
        ctx.session.step = undefined;
        return;
      }
      await bot.telegram.editMessageText(chatId, status.message_id, undefined, `Распознал: «${recognized}». Ищу...`);
      await runSearch(ctx, recognized);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "photo search failed");
      await bot.telegram
        .editMessageText(chatId, status.message_id, undefined, "Произошла ошибка при распознавании. Опишите товар текстом.")
        .catch(() => undefined);
    }
  });
}

// Exported so other handlers (repeat query, refine) can re-run a search.
export async function runSearch(ctx: BotContext, query: string): Promise<void> {
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!fromId || chatId === undefined) return;
  const tgId = BigInt(fromId);
  const repos = getRepositories();
  const user = await repos.users.getByTelegramId(tgId);

  // rate limit
  const lim = await limiter.tryAcquire(tgId);
  if (!lim.allowed) {
    await ctx.reply(`Слишком много запросов. Попробуйте через ${lim.retryAfterSec} сек.`);
    return;
  }

  // queue pressure check
  const orch = new SearchOrchestrator();
  const can = await orch.canEnqueue();
  if (!can.ok) {
    await ctx.reply("Сервер перегружен, пожалуйста, подождите 1 минуту или повторите позже.");
    return;
  }

  // extract params (LLM, cached)
  const parsed = await getOpenAI().extractParams(query);

  const status = await ctx.reply("🔍 Начинаю поиск...");

  const onStatus = async (s: string): Promise<void> => {
    try {
      await ctx.telegram.editMessageText(chatId, status.message_id, undefined, s);
    } catch {
      // ignore edit failures (race with other edits)
    }
  };

  const results = await orch.run(
    { telegramId: tgId, userId: user?.id ?? 0n, query, city: user?.city ?? null, offset: 0 },
    parsed,
    onStatus,
  );

  const { text, canSubscribe } = await formatResults(results);
  try {
    await ctx.telegram.editMessageText(chatId, status.message_id, undefined, text, {
      parse_mode: "Markdown",
      reply_markup: afterSearchKeyboard(canSubscribe),
    } as never);
  } catch {
    // edit may fail if message text unchanged or too long → send fresh
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: afterSearchKeyboard(canSubscribe) } as never);
  }

  // persist history + analytics only if user consented
  if (user?.consent && user.id) {
    await repos.searchHistory
      .add({ userId: user.id, query, city: user.city ?? null, parsed, resultCount: results.products.length })
      .catch((e) => logger.warn({ err: e.message }, "history save failed"));
  }
  await repos.topQueries.increment(query).catch(() => undefined);

  // cache results id for "show more" / refine
  ctx.session.requestId = results.requestId;
  ctx.session.query = query;
  ctx.session.offset = results.products.length;
}
