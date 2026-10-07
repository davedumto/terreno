import { and, eq, isNotNull, max, notInArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { taskSchemaByType } from "./task-schemas";
import { notifications, tasks, workers } from "./db/schema";
import { computeReputationScore } from "./reputation";

type DB = LibSQLDatabase<Record<string, unknown>>;
type Task = typeof tasks.$inferSelect;
type Worker = typeof workers.$inferSelect;

const NOTIFY_BATCH_SIZE = 10;

/**
 * SPEC.md section 12: who gets notified for a given open task, ranked.
 * Filters to active, telegram-linked workers in the task's own city who
 * aren't already holding a claim elsewhere; for `translate`, further
 * requires the worker's languages include the requested target_language.
 * Ranked by reputation score (section 14) descending, then by least
 * recently notified (nulls first) to spread work across equally-reputable
 * workers, capped at 10.
 *
 * Pass `excludeWorkerIds` (the first wave's own notified ids) to get the
 * sweeper's second wave -- "the next 10" per section 16 job 3 -- rather
 * than re-ranking and re-notifying the same top 10.
 */
export async function matchWorkers(
  db: DB,
  task: Task,
  options: { excludeWorkerIds?: string[] } = {},
): Promise<Worker[]> {
  const candidates = await db
    .select()
    .from(workers)
    .where(
      and(
        eq(workers.status, "active"),
        eq(workers.country, task.country),
        eq(workers.city, task.city),
        isNotNull(workers.telegramChatId),
        notInArray(
          workers.id,
          db.select({ id: tasks.workerId }).from(tasks).where(eq(tasks.status, "claimed")),
        ),
        options.excludeWorkerIds?.length ? notInArray(workers.id, options.excludeWorkerIds) : undefined,
      ),
    );

  const eligible = candidates.filter((worker) => workerMatchesLanguage(task, worker));
  if (eligible.length === 0) {
    return [];
  }

  const lastNotifiedAt = await lastNotifiedAtByWorker(
    db,
    eligible.map((worker) => worker.id),
  );

  const ranked = await Promise.all(
    eligible.map(async (worker) => ({
      worker,
      score: (await computeReputationScore(db, worker.id)).score,
      lastNotifiedAt: lastNotifiedAt.get(worker.id) ?? null,
    })),
  );

  ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Nulls (never notified) sort first -- a worker with no history yet
    // should get a fair first shot before someone already notified once.
    if (a.lastNotifiedAt === null) return b.lastNotifiedAt === null ? 0 : -1;
    if (b.lastNotifiedAt === null) return 1;
    return a.lastNotifiedAt - b.lastNotifiedAt;
  });

  return ranked.slice(0, NOTIFY_BATCH_SIZE).map((entry) => entry.worker);
}

/** Only `translate` tasks filter by language; every other type matches any worker the city/status filters already passed. */
function workerMatchesLanguage(task: Task, worker: Worker): boolean {
  if (task.type !== "translate") {
    return true;
  }
  const parsed = taskSchemaByType.translate.safeParse(task.input);
  if (!parsed.success) {
    return false;
  }
  return worker.languages.includes(parsed.data.target_language);
}

async function lastNotifiedAtByWorker(db: DB, workerIds: string[]): Promise<Map<string, number>> {
  if (workerIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ workerId: notifications.workerId, lastNotifiedAt: max(notifications.createdAt) })
    .from(notifications)
    .where(sql`${notifications.workerId} in ${workerIds}`)
    .groupBy(notifications.workerId);
  return new Map(rows.map((row) => [row.workerId, row.lastNotifiedAt ?? 0]));
}
