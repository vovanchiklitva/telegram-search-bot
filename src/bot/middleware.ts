// Error-handling middleware + admin error notification helper.
// All unhandled errors are logged and forwarded to the admin chat.

import type { Context } from "telegraf";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export async function notifyAdminError(bot: { telegram: { sendMessage: (chatId: string, text: string) => Promise<unknown> } }, err: Error, ctx?: string): Promise<void> {
  const chatId = env.errorNotifyChatId || env.adminIds[0]?.toString();
  if (!chatId) return;
  const text = `⚠️ Ошибка в боте:\n${(ctx ?? "")}\n${err.message}`.slice(0, 1000);
  try {
    await bot.telegram.sendMessage(chatId, text);
  } catch {
    // ignore
  }
}

export function errorHandler(bot: { telegram: { sendMessage: (chatId: string, text: string) => Promise<unknown> } }): (err: unknown, ctx: Context) => Promise<void> {
  return async (err: unknown, ctx: Context) => {
    const e = err as Error;
    logger.error({ err: e.message, stack: e.stack, userId: ctx?.from?.id }, "unhandled bot error");
    try {
      await ctx.reply("Произошла ошибка. Мы уже знаем и работаем над этим.");
    } catch {
      // ignore
    }
    await notifyAdminError(bot, e, `user=${ctx?.from?.id ?? "?"}`);
  };
}
