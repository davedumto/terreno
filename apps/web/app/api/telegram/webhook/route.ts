import { webhookCallback, type Bot } from "grammy";
import { eq } from "drizzle-orm";
import { STROOPS_PER_USDC } from "@terreno/shared";
import { db } from "@/lib/db";
import { workers } from "@/lib/db/schema";
import { requireEnv } from "@/lib/env";
import { computeReputationScore } from "@/lib/reputation";
import { getUsdcBalance } from "@/lib/usdc";
import { claimTask } from "@/lib/claim-task";
import { consumeLinkCode, getBot, markTaskTakenForOthers } from "@/lib/telegram";

async function workerForChat(chatId: string) {
  const [worker] = await db.select().from(workers).where(eq(workers.telegramChatId, chatId));
  return worker;
}

/**
 * Registers every command/callback-query handler on a Bot instance.
 * Separated from route-module scope and only ever called from
 * getConfiguredBot() (lazily, memoized): Next.js imports every route module
 * at build time to collect route metadata, even routes that won't run
 * during the build, and this file's own getBot()/requireEnv() calls would
 * throw on a missing TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET if they ran
 * at module scope -- confirmed by a real `pnpm build` failing with exactly
 * that error before this was fixed (see docs/decisions.md, 2026-10-07).
 */
function registerHandlers(bot: Bot): void {
  /**
   * SPEC.md section 10 step 3: links this Telegram chat to the worker who
   * generated the code at /join. The code itself is one-time (see
   * consumeLinkCode's doc comment); a stale or reused code gets an honest
   * "expired" reply rather than a silent no-op, since a worker stuck mid-link
   * with no feedback has no other way to know something went wrong.
   */
  bot.command("start", async (ctx) => {
    const code = ctx.match.trim();
    const chatId = String(ctx.chat.id);
    if (!code) {
      await ctx.reply("Open the Connect Telegram link from the Terreno app to link your account.");
      return;
    }

    const result = await consumeLinkCode(db, code, chatId);
    switch (result.kind) {
      case "linked":
        await ctx.reply("Connected. New tasks in your city will appear here.");
        return;
      case "already_linked_elsewhere":
        await ctx.reply("This Telegram account is already linked to a different Terreno worker.");
        return;
      case "invalid_or_expired":
        await ctx.reply("That link has expired. Go back to the Terreno app and tap Connect Telegram again.");
        return;
    }
  });

  bot.command("pause", async (ctx) => {
    const worker = await workerForChat(String(ctx.chat.id));
    if (!worker) {
      await ctx.reply("Link your account first with the Connect Telegram link from the Terreno app.");
      return;
    }
    await db.update(workers).set({ status: "paused" }).where(eq(workers.id, worker.id));
    await ctx.reply("Paused. You won't be notified of new tasks until you /resume.");
  });

  bot.command("resume", async (ctx) => {
    const worker = await workerForChat(String(ctx.chat.id));
    if (!worker) {
      await ctx.reply("Link your account first with the Connect Telegram link from the Terreno app.");
      return;
    }
    await db.update(workers).set({ status: "active" }).where(eq(workers.id, worker.id));
    await ctx.reply("Resumed. New tasks in your city will appear here again.");
  });

  bot.command("me", async (ctx) => {
    const worker = await workerForChat(String(ctx.chat.id));
    if (!worker) {
      await ctx.reply("Link your account first with the Connect Telegram link from the Terreno app.");
      return;
    }

    const [reputation, balanceStroops] = await Promise.all([
      computeReputationScore(db, worker.id),
      getUsdcBalance(worker.walletAddress).catch(() => null),
    ]);

    const balanceLine =
      balanceStroops === null
        ? "Balance: unavailable right now."
        : `Balance: ${(Number(balanceStroops) / STROOPS_PER_USDC).toFixed(2)} USDC.`;

    await ctx.reply(
      [
        `Status: ${worker.status}.`,
        balanceLine,
        `Completed tasks: ${reputation.completedTasks}.`,
        `Score: ${reputation.score.toFixed(2)}.`,
        `${requireEnv("APP_URL")}/me`,
      ].join("\n"),
    );
  });

  /**
   * SPEC.md section 11: "Claim pressed -> calls the same claim logic as the
   * web app; edits the message to 'Claimed by you, answer here'... Claimed
   * by someone else -> edits the message to 'Taken' for all other
   * recipients." Runs through claimTask(), the exact same function
   * POST /api/worker/tasks/[id]/claim calls, so a claim via this button and
   * a claim via the web app are provably identical in every edge case
   * (session/CSRF aside, which is each caller's own concern -- see
   * claimTask's doc comment).
   */
  bot.callbackQuery(/^claim:(.+)$/, async (ctx) => {
    const taskId = ctx.match[1];
    if (!taskId) {
      // Unreachable given the regex (`(.+)` requires at least one char to
      // match at all), but TypeScript types every capture group as possibly
      // undefined; fail closed rather than call claimTask with "".
      await ctx.answerCallbackQuery({ text: "Malformed claim button." });
      return;
    }
    const worker = await workerForChat(String(ctx.chat?.id ?? ""));
    if (!worker) {
      await ctx.answerCallbackQuery({ text: "Link your account in the Terreno app first.", show_alert: true });
      return;
    }
    if (worker.status !== "active") {
      await ctx.answerCallbackQuery({
        text: "Resume your account with /resume before claiming.",
        show_alert: true,
      });
      return;
    }

    const result = await claimTask(db, taskId, worker.id);
    switch (result.kind) {
      case "claimed": {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`Claimed by you, answer here: ${requireEnv("APP_URL")}/work/${taskId}`);
        await markTaskTakenForOthers(db, bot, taskId, worker.id);
        return;
      }
      case "already_claimed":
        await ctx.answerCallbackQuery({ text: "Someone else already claimed this." });
        await ctx.editMessageText("Taken");
        return;
      case "already_holding_a_claim":
        await ctx.answerCallbackQuery({
          text: "Finish or drop your current claim before taking another.",
          show_alert: true,
        });
        return;
      case "language_mismatch":
        await ctx.answerCallbackQuery({
          text: "This task needs a language you haven't listed.",
          show_alert: true,
        });
        return;
      case "not_open":
        await ctx.answerCallbackQuery({ text: "This task is no longer open." });
        return;
      case "not_found":
        await ctx.answerCallbackQuery({ text: "This task no longer exists." });
        return;
      case "escrow_failed":
        await ctx.answerCallbackQuery({ text: "Claim failed, try again.", show_alert: true });
        return;
    }
  });
}

let configuredBot: Bot | undefined;

function getConfiguredBot(): Bot {
  if (!configuredBot) {
    configuredBot = getBot();
    registerHandlers(configuredBot);
  }
  return configuredBot;
}

// Explicit concrete shape, not `ReturnType<typeof webhookCallback>`: that
// type is the broad union across every adapter webhookCallback supports,
// which Next's own route-type checking then can't match against a plain
// App Router POST handler. The "std/http" adapter's own type
// (StdHttpAdapter = (req: Request) => ReqResHandler<Response>) guarantees
// this exact concrete signature.
let handler: ((req: Request) => Promise<Response>) | undefined;

/**
 * POST itself must also stay lazy, not `webhookCallback(getConfiguredBot(),
 * ...)` evaluated at module scope: webhookCallback's own options object
 * calls requireEnv("TELEGRAM_WEBHOOK_SECRET") eagerly too, which is exactly
 * the same build-time-import failure this file works around everywhere
 * else.
 */
export async function POST(req: Request): Promise<Response> {
  if (!handler) {
    handler = webhookCallback(getConfiguredBot(), "std/http", {
      secretToken: requireEnv("TELEGRAM_WEBHOOK_SECRET"),
    });
  }
  return handler(req);
}
