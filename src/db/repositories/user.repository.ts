// User repository: onboarding, consent, city, minimal-mode, delete-my-data.

import { PrismaClient } from "@prisma/client";
import { logger } from "../../utils/logger.js";

export class UserRepository {
  constructor(private prisma: PrismaClient) {}

  async upsertByTelegramId(input: {
    telegramId: bigint;
    username?: string | null;
    firstName?: string | null;
  }) {
    return this.prisma.user.upsert({
      where: { telegramId: input.telegramId },
      create: {
        telegramId: input.telegramId,
        username: input.username ?? null,
        firstName: input.firstName ?? null,
      },
      update: {
        username: input.username ?? null,
        firstName: input.firstName ?? null,
      },
    });
  }

  async getByTelegramId(telegramId: bigint) {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  async setCity(telegramId: bigint, city: string, lat?: number, lon?: number) {
    return this.prisma.user.update({
      where: { telegramId },
      data: { city, lat, lon },
    });
  }

  async setConsent(telegramId: bigint, consent: boolean) {
    // Refusing consent → minimal mode. We keep telegramId + city only.
    return this.prisma.user.update({
      where: { telegramId },
      data: { consent, minimalMode: !consent },
    });
  }

  async deleteAllData(
    telegramId: bigint,
  ): Promise<{ users: number; searches: number; favorites: number; alerts: number }> {
    // Cascading FKs remove searches/favorites/alerts/states when the user row is deleted.
    const user = await this.prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      return { users: 0, searches: 0, favorites: 0, alerts: 0 };
    }
    const [searches, favorites, alerts] = await Promise.all([
      this.prisma.searchHistory.count({ where: { userId: user.id } }),
      this.prisma.favorite.count({ where: { userId: user.id } }),
      this.prisma.priceAlert.count({ where: { userId: user.id } }),
    ]);
    await this.prisma.user.delete({ where: { id: user.id } });
    logger.info({ telegramId: telegramId.toString(), userId: user.id }, "User data deleted");
    return { users: 1, searches, favorites, alerts };
  }
}
