import { Bot, InlineKeyboard } from "grammy";
import { and, eq, gt } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ulid } from "ulid";
import { STROOPS_PER_USDC } from "./constants";
import { requireEnv } from "./env";
import { notifications, taskEvents, telegramLinks, tasks, workers } from "./db/schema";

type DB = LibSQLDatabase<Record<string, unknown>>;
type Task = typeof tasks.$inferSelect;

const LINK_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * The slice of grammY's Bot a caller actually needs to pass in -- not
 * `Pick<Bot, "api">`, which would still demand the full ~200-method Api
 * class on that property. A real Bot satisfies this structurally with no
 * cast; a test passes a two-method object instead.
 */
export interface TelegramSender {
  api: {
    sendMessage: Bot["api"]["sendMessage"];
    editMessageText: Bot["api"]["editMessageText"];
  };
}

let bot: Bot | undefined;

/**
 * Lazy, memoized per process -- not constructed at module load. apps/web's
 * Next.js routes import this module at build time to collect route
 * metadata, even for routes that won't run during the build (the same
 * reason apps/web/lib/db/index.ts's db Proxy is lazy); constructing eagerly
 * here would fail the whole web build on a missing TELEGRAM_BOT_TOKEN
 * rather than only the one request that actually needs it (confirmed by a
 * real build failure before this was lazy -- see docs/decisions.md,
 * 2026-10-07).
 */
export function getBot(): Bot {
  if (!bot) {
    bot = new Bot(requireEnv("TELEGRAM_BOT_TOKEN"));
  }
  return bot;
}

function taskSummary(task: Task): string {
  const usdc = (task.price / STROOPS_PER_USDC).toFixed(2);
  const minutesLeft = Math.max(0, Math.round((task.deadlineAt - Date.now()) / 60_000));
  const label = TASK_TYPE_LABEL[task.type];
  return `New task in ${task.city}: ${label}. Pays ${usdc} USDC. Answer within ${minutesLeft} min.`;
}

const TASK_TYPE_LABEL: Record<Task["type"], string> = {
  verify_place: "verify a place",
  check_price: "check a price",
  translate: "translate something",
};

/**
 * SPEC.md section 11: push one task alert per matched worker, with inline
 * Claim/Open buttons, and store (task_id, chat_id, message_id) so a later
 * claim (by this worker or another) can edit every other recipient's
 * message. One notifications row per (task, worker) -- the unique index on
 * that pair is what stops a worker being notified twice for the same task
 * if this function is ever called again for the same task/worker (e.g. a
 * retried sweeper tick).
 *
 * Takes `bot` as an explicit parameter, not a hidden getBot() lookup
 * inside: every real caller passes getBot(), but tests pass a mock api
 * surface instead. A module-internal getBot() call here would not be
 * interceptable by vi.mock from this same module's own test file (a
 * module mocking itself doesn't rewrite its own internal call sites), so
 * this follows the same explicit-dependency shape as claimTask()'s db/
 * escrow parameters rather than reaching for a global.
 */
export async function notifyWorkersOfTask(
  db: DB,
  bot: TelegramSender,
  task: Task,
  matchedWorkers: Array<typeof workers.$inferSelect>,
): Promise<void> {
  const appUrl = requireEnv("APP_URL");
  const keyboard = new InlineKeyboard()
    .text("Claim", `claim:${task.id}`)
    .url("Open", `${appUrl}/work/${task.id}`);
  const text = taskSummary(task);

  for (const worker of matchedWorkers) {
    if (!worker.telegramChatId) {
      // matchWorkers() already filters to telegram-linked workers; this is
      // defense in depth against a future caller that doesn't.
      continue;
    }
    try {
      const message = await bot.api.sendMessage(worker.telegramChatId, text, {
        reply_markup: keyboard,
      });
      await db.insert(notifications).values({
        id: ulid(),
        taskId: task.id,
        workerId: worker.id,
        telegramChatId: worker.telegramChatId,
        telegramMessageId: message.message_id,
        createdAt: Date.now(),
      });
    } catch (err) {
      // One worker's send failing (blocked the bot, invalid chat id after
      // the fact, a transient Telegram error) must not stop the rest of
      // the batch from being notified.
      console.error(`failed to notify worker ${worker.id} of task ${task.id}`, err);
    }
  }

  await db.insert(taskEvents).values({
    id: ulid(),
    taskId: task.id,
    kind: "notified",
    data: { workerIds: matchedWorkers.map((w) => w.id) },
    createdAt: Date.now(),
  });
}

/**
 * Edits every other recipient's notification message to "Taken" once one
 * worker's claim wins, per SPEC.md section 11. Best-effort: a message grammY
 * can't edit (already edited, too old, chat blocked the bot) is logged and
 * skipped rather than failing the whole claim over a cosmetic update.
 */
export async function markTaskTakenForOthers(
  db: DB,
  bot: TelegramSender,
  taskId: string,
  winningWorkerId: string,
): Promise<void> {
  const rows = await db.select().from(notifications).where(eq(notifications.taskId, taskId));
  for (const row of rows) {
    if (row.workerId === winningWorkerId) {
      continue;
    }
    try {
      await bot.api.editMessageText(row.telegramChatId, row.telegramMessageId, "Taken");
    } catch (err) {
      console.error(`failed to edit "taken" message for worker ${row.workerId} on task ${taskId}`, err);
    }
  }
}

/**
 * Generates a one-time /start deep-link code for a newly-confirmed worker
 * (SPEC.md section 10 step 3), valid for 10 minutes. telegram_links has no
 * "used" flag by design (docs/decisions.md, 2026-10-07): consumeLinkCode's
 * atomic delete-on-consume makes the row's own presence the used/unused
 * signal, so generation needs no extra bookkeeping beyond the insert.
 */
export async function generateLinkCode(db: DB, workerId: string): Promise<string> {
  const code = ulid();
  await db.insert(telegramLinks).values({
    code,
    workerId,
    expiresAt: Date.now() + LINK_CODE_TTL_MS,
  });
  return code;
}

export type ConsumeLinkCodeResult =
  | { kind: "linked"; workerId: string }
  | { kind: "invalid_or_expired" }
  | { kind: "already_linked_elsewhere" };

/**
 * Consumes a /start <code> deep link: atomically deletes the telegram_links
 * row (so a second /start with the same code finds nothing, by design --
 * see generateLinkCode's doc comment) and sets the worker's telegram_chat_id.
 * Runs in one db.transaction() so a crash between the two writes can't leave
 * the code consumed with no chat id set.
 */
export async function consumeLinkCode(db: DB, code: string, chatId: string): Promise<ConsumeLinkCodeResult> {
  return db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(telegramLinks)
      .where(and(eq(telegramLinks.code, code), gt(telegramLinks.expiresAt, Date.now())));
    if (!link) {
      return { kind: "invalid_or_expired" };
    }

    await tx.delete(telegramLinks).where(eq(telegramLinks.code, code));

    const [existingLinkedWorker] = await tx
      .select()
      .from(workers)
      .where(eq(workers.telegramChatId, chatId));
    if (existingLinkedWorker && existingLinkedWorker.id !== link.workerId) {
      // This Telegram chat is already linked to a different worker. The
      // code is still consumed above (one-time use holds regardless), but
      // re-linking the same chat to a second worker would let one person's
      // Telegram account silently receive and claim tasks meant for
      // another worker's city/reputation -- refuse instead.
      return { kind: "already_linked_elsewhere" };
    }

    await tx.update(workers).set({ telegramChatId: chatId }).where(eq(workers.id, link.workerId));
    return { kind: "linked", workerId: link.workerId };
  });
}
