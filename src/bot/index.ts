// Bot entry point. Starts long-polling.
import { Telegraf, session } from "telegraf";
import { env } from "../config/env.js";
import { RedisSessionStore, type SessionData } from "./session.js";
import type { BotContext } from "./context.js";
import { registerHandlers } from "./handlers/index.js";
import { errorHandler, notifyAdminError } from "./middleware.js";
import { getRepositories } from "../db/repositories/index.js";
import { ProxyPool } from "../parsers/proxy-pool.js";
import { schedulePriceAlertJob } from "../queues/workers/price-alert.worker.js";
import { logger } from "../utils/logger.js";
import { disconnectPrisma } from "../db/prisma.js";

async function bootstrap(): Promise<void> {
  console.log('🔄 1. Запуск bootstrap() в боте');
  const bot = new Telegraf<BotContext>(env.botToken);
  console.log('🔄 2. Бот создан');

  // Шаг 1: Удаляем вебхук (если был)
  console.log('🔄 Удаляем вебхук...');
  try {
    await bot.telegram.deleteWebhook();
    console.log('✅ Вебхук удалён');
  } catch (e) {
    console.log('⚠️ Ошибка удаления вебхука:', (e as Error).message);
  }

  // Шаг 2: Принудительно завершаем все старые long-polling сеансы
  console.log('🔄 Завершаем старые обновления...');
  try {
    // Получаем последнее обновление
    const updates = await bot.telegram.callApi('getUpdates', { limit: 1 });
    if (updates && Array.isArray(updates) && updates.length > 0) {
      const lastUpdateId = (updates[0] as any).update_id;
      // Устанавливаем offset = lastUpdateId + 1
      await bot.telegram.callApi('getUpdates', { offset: lastUpdateId + 1, limit: 0 });
      console.log(`✅ Старые обновления завершены, offset=${lastUpdateId + 1}`);
    } else {
      console.log('✅ Нет старых обновлений');
    }
  } catch (e) {
    console.log('⚠️ Ошибка при завершении старых обновлений:', (e as Error).message);
  }

  // Шаг 3: Останавливаем возможный предыдущий процесс
  console.log('🔄 Останавливаем возможный старый процесс...');
  try {
    await bot.stop();
    console.log('✅ Предыдущий процесс остановлен');
  } catch (e) {
    console.log('⚠️ Не удалось остановить предыдущий процесс (скорее всего, его нет)');
  }

  // Redis-backed sessions
  bot.use(
    session({
      store: new RedisSessionStore(),
      defaultSession: (): SessionData => ({}),
    }),
  );

  registerHandlers(bot);
  bot.catch(errorHandler(bot));

  if (env.proxyList.length) {
    await new ProxyPool().seed(env.proxyList).catch((e) => logger.warn({ err: e.message }, "proxy seed failed"));
  }

  await schedulePriceAlertJob().catch((e) => logger.warn({ err: e.message }, "price alert schedule failed"));

  console.log('🔄 3. Пытаюсь запустить бота (bot.launch())...');

  // Повторные попытки при ошибке 409
  let attempts = 0;
  while (attempts < 3) {
    try {
      await bot.launch();
      console.log('✅ 4. Бот успешно запущен');
      break;
    } catch (e) {
      const err = e as Error;
      if (err.message.includes('409') || err.message.includes('Conflict')) {
        attempts++;
        console.log(`⚠️ Конфликт (409), попытка ${attempts} из 3. Ждём 2 секунды...`);
        if (attempts < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          // Повторно удаляем вебхук и завершаем обновления
          await bot.telegram.deleteWebhook().catch(() => {});
          try {
            const updates = await bot.telegram.callApi('getUpdates', { limit: 1 });
            if (updates && Array.isArray(updates) && updates.length > 0) {
              const lastUpdateId = (updates[0] as any).update_id;
              await bot.telegram.callApi('getUpdates', { offset: lastUpdateId + 1, limit: 0 });
            }
          } catch (_) {}
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  logger.info("Bot started (long-polling)");

  const shutdown = async (sig: string) => {
    logger.info({ sig }, "Shutting down bot");
    bot.stop(sig);
    await disconnectPrisma();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error({ err: err.message }, "unhandledRejection");
    void notifyAdminError(bot, err, "unhandledRejection");
  });
}

bootstrap().catch(async (err) => {
  console.error("❌ Ошибка в bootstrap бота:", err);
  logger.fatal({ err: err.message, stack: err.stack }, "Bot bootstrap failed");
  process.exit(1);
});
