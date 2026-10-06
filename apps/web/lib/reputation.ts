import { and, avg, count, eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ratings, taskEvents, tasks } from "./db/schema";

type DB = LibSQLDatabase<Record<string, unknown>>;

const DEFAULT_AVG_RATING = 4;

export interface ReputationScore {
  score: number;
  completedTasks: number;
  expiredClaims: number;
  avgRating: number;
}

/**
 * SPEC.md section 14: score = ((completed+1)/(completed+expired+2)) *
 * ((avg_rating+1)/6), computed on read, not stored. The +1/+2 give a new
 * worker a neutral 0.5 reliability factor instead of 0 or 1.
 *
 * Expired-claim counts come from task_events.data.expiredWorkerId (JSON),
 * not a worker_id column: once a claim expires, transition()'s
 * claimed->open edge nulls tasks.worker_id, so the sweeper's call must
 * capture the worker id into context before that happens for this count to
 * exist at all (see docs/decisions.md, 2026-10-06).
 */
export async function computeReputationScore(db: DB, workerId: string): Promise<ReputationScore> {
  const [completedRow] = await db
    .select({ value: count() })
    .from(tasks)
    .where(and(eq(tasks.workerId, workerId), eq(tasks.status, "completed")));
  const completedTasks = completedRow?.value ?? 0;

  const [expiredRow] = await db
    .select({ value: count() })
    .from(taskEvents)
    .where(
      and(
        eq(taskEvents.kind, "claim_expired"),
        sql`json_extract(${taskEvents.data}, '$.expiredWorkerId') = ${workerId}`,
      ),
    );
  const expiredClaims = expiredRow?.value ?? 0;

  const [ratingRow] = await db
    .select({ value: avg(ratings.score) })
    .from(ratings)
    .innerJoin(tasks, eq(ratings.taskId, tasks.id))
    .where(eq(tasks.workerId, workerId));
  const avgRating = ratingRow?.value === null || ratingRow?.value === undefined
    ? DEFAULT_AVG_RATING
    : Number(ratingRow.value);

  const reliability = (completedTasks + 1) / (completedTasks + expiredClaims + 2);
  const quality = (avgRating + 1) / 6;

  return {
    score: reliability * quality,
    completedTasks,
    expiredClaims,
    avgRating,
  };
}
