import { and, count, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { workers } from "./db/schema";
import { LIVE_CITY_MIN_ACTIVE_WORKERS } from "@terreno/shared";

type DB = LibSQLDatabase<Record<string, unknown>>;

/** SPEC.md section 12: a city is live when it has at least 2 active workers. */
export async function isCityLive(db: DB, country: string, city: string): Promise<boolean> {
  const [row] = await db
    .select({ activeWorkers: count() })
    .from(workers)
    .where(and(eq(workers.country, country), eq(workers.city, city), eq(workers.status, "active")));

  return (row?.activeWorkers ?? 0) >= LIVE_CITY_MIN_ACTIVE_WORKERS;
}
