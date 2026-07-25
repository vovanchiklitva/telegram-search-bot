// Search history, favorites and price-alert repositories.
// All writes here are gated on user consent (checked by the caller).

import { PrismaClient } from "@prisma/client";
import type { ParsedQuery, Product, Source } from "../../types.js";

export class SearchHistoryRepository {
  constructor(private prisma: PrismaClient) {}

  async add(input: {
    userId: bigint;
    query: string;
    city: string | null;
    parsed: ParsedQuery;
    resultCount: number;
  }) {
    return this.prisma.searchHistory.create({
      data: {
        userId: input.userId,
        query: input.query,
        city: input.city,
        parsedJson: input.parsed as unknown as object,
        resultCount: input.resultCount,
      },
    });
  }

  async recent(userId: bigint, limit = 10) {
    return this.prisma.searchHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

export class FavoriteRepository {
  constructor(private prisma: PrismaClient) {}

  async add(input: {
    userId: bigint;
    product: Product;
  }) {
    return this.prisma.favorite.upsert({
      where: {
        userId_productId_source: {
          userId: input.userId,
          productId: input.product.id,
          source: input.product.source,
        },
      },
      create: {
        userId: input.userId,
        productId: input.product.id,
        source: input.product.source,
        title: input.product.title,
        url: input.product.affiliateUrl || input.product.url,
        priceRub: input.product.priceRub,
        imageUrl: input.product.imageUrl ?? null,
      },
      update: {
        // refresh price on re-save
        priceRub: input.product.priceRub,
        title: input.product.title,
        url: input.product.affiliateUrl || input.product.url,
      },
    });
  }

  async list(userId: bigint) {
    return this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async remove(userId: bigint, productId: string, source: Source) {
    return this.prisma.favorite.deleteMany({
      where: { userId, productId, source },
    });
  }
}

export class PriceAlertRepository {
  constructor(private prisma: PrismaClient) {}

  async create(input: {
    userId: bigint;
    product: Product;
    targetPriceRub: number;
  }) {
    return this.prisma.priceAlert.create({
      data: {
        userId: input.userId,
        productId: input.product.id,
        source: input.product.source,
        title: input.product.title,
        targetPriceRub: input.targetPriceRub,
        lastPriceRub: input.product.priceRub,
      },
    });
  }

  async listActive() {
    return this.prisma.priceAlert.findMany({ where: { active: true } });
  }

  async markTriggered(id: bigint) {
    return this.prisma.priceAlert.update({
      where: { id },
      data: { triggeredAt: new Date(), active: false },
    });
  }

  async updateLastPrice(id: bigint, price: number) {
    return this.prisma.priceAlert.update({
      where: { id },
      data: { lastPriceRub: price, lastCheckedAt: new Date() },
    });
  }

  async listForUser(userId: bigint) {
    return this.prisma.priceAlert.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async cancel(id: bigint, userId: bigint) {
    return this.prisma.priceAlert.updateMany({
      where: { id, userId },
      data: { active: false },
    });
  }
}
