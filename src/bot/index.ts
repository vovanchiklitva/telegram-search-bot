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

  // Шаг 1: Удаляем вебхук и ждём 5 секунд
  console.log('🔄 Удаляем вебхук и ждём 5 секунд...');
  try {
    await bot.telegram.deleteWebhook();
    console.log('✅ Вебхук удалён');
  } catch (e) {
    console.log('⚠️ Ошибка удаления вебхука:', (e as Error).message);
  }
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Шаг 2: Пытаемся остановить старый polling (если он есть)
  console.log('🔄 Пытаемся остановить старый процесс (если есть)...');
  try {
    await bot.stop();
    console.log('✅ Процесс остановлен');
  } catch (e) {
    console.log('⚠️ Не удалось остановить (возможно, его нет)');
  }

  // Шаг 3: Ещё раз удаляем вебхук и ждём 3 секунды
  console.log('🔄 Повторное удаление вебхука и ожидание 3 секунды...');
  try {
    await bot.telegram.deleteWebhook();
    console.log('✅ Вебхук удалён повторно');
  } catch (e) {
    console.log('⚠️ Ошибка повторного удаления вебхука:', (e as Error).message);
  }
  await new Promise(resolve => setTimeout(resolve, 3000));

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

  // Основной запуск с повторными попытками
  let attempts = 0;
  while (attempts < 5) { // увеличено до 5 попыток
    try {
      await bot.launch();
      console.log('✅ 4. Бот успешно запущен');
      break;
    } catch (e) {
      const err = e as Error;
      if (err.message.includes('409') || err.message.includes('Conflict')) {
        attempts++;
        console.log(`⚠️ Конфликт (409), попытка ${attempts} из 5. Ждём 3 секунды...`);
        if (attempts < 5) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          // Снова удаляем вебхук
          await bot.telegram.deleteWebhook().catch(() => {});
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
