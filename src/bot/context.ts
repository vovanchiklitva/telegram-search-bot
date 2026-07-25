// Custom Telegraf context. We declare `session` on the Context interface via
// module augmentation so every handler sees ctx.session without casting.
// The session shape is SessionData (defined in session.ts).

import type { Context } from "telegraf";
import type { SessionData } from "./session.js";

declare module "telegraf" {
  interface Context {
    session: SessionData;
  }
}

export type { Context };
export type BotContext = Context;
