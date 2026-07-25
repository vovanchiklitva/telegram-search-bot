// Top-queries analytics: increment a per-day counter for each query string.
// Used by the admin "top requests" view. Kept deliberately lightweight.

import { PrismaClient } from "@prisma/client";

export class TopQueryRepository {
  constructor(private prisma: PrismaClient) {}

  async increment(query: string, day: Date = new Date()): Promise<void> {
    const dayOnly = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    await this.prisma.topQuery.upsert({
      where: { day_query: { day: dayOnly, query } },
      create: { day: dayOnly, query, count: 1 },
      update: { count: { increment: 1 } },
    });
  }

  async top(limit = 20, days = 7): Promise<{ query: string; count: number }[]> {
    const since = new Date(Date.now() - days * 86400_000);
    const rows = await this.prisma.topQuery.groupBy({
      by: ["query"],
      _sum: { count: true },
      where: { day: { gte: since } },
      orderBy: { _sum: { count: "desc" } },
      take: limit,
    });
    return rows.map((r) => ({ query: r.query, count: r._sum.count ?? 0 }));
  }
}
