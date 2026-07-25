// Wires all bot handlers together. Called once from src/bot/index.ts.

import type { Telegraf } from "telegraf";
import type { BotContext } from "../context.js";
import { registerOnboarding } from "./onboarding.js";
import { registerSearch } from "./search.js";
import { registerActions } from "./actions.js";
import { registerLists } from "./lists.js";
import { registerAdmin } from "../../admin/admin.js";

export function registerHandlers(bot: Telegraf<BotContext>): void {
  registerOnboarding(bot);
  registerSearch(bot);
  registerActions(bot);
  registerLists(bot);
  registerAdmin(bot);
}
