// Composition root for repositories. One place to construct them with the
// shared Prisma + Redis dependencies, so handlers never wire up deps manually.

import { getPrisma } from "../prisma.js";
import { getRedis } from "../redis.js";
import { UserRepository } from "./user.repository.js";
import { SearchHistoryRepository, FavoriteRepository, PriceAlertRepository } from "./search.repository.js";
import { SettingsRepository } from "./settings.repository.js";
import { TopQueryRepository } from "./topquery.repository.js";

export interface Repositories {
  users: UserRepository;
  searchHistory: SearchHistoryRepository;
  favorites: FavoriteRepository;
  priceAlerts: PriceAlertRepository;
  settings: SettingsRepository;
  topQueries: TopQueryRepository;
}

let cached: Repositories | null = null;

export function getRepositories(): Repositories {
  if (!cached) {
    cached = {
      users: new UserRepository(getPrisma()),
      searchHistory: new SearchHistoryRepository(getPrisma()),
      favorites: new FavoriteRepository(getPrisma()),
      priceAlerts: new PriceAlertRepository(getPrisma()),
      settings: new SettingsRepository(getPrisma(), getRedis()),
      topQueries: new TopQueryRepository(getPrisma()),
    };
  }
  return cached;
}
