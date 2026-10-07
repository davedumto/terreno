import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { requireEnv } from "../env";
import * as schema from "./schema";

export type Schema = typeof schema;

/**
 * Plain, eager client construction: reads DATABASE_URL/DATABASE_AUTH_TOKEN
 * and connects immediately. Fine for a plain Node process (the sweeper) with
 * no build-time constraint. apps/web wraps this in its own lazy Proxy
 * instead of calling it directly, since Next.js collects route metadata at
 * build time by importing every route module, even ones that won't run
 * during the build; throwing here eagerly for a missing DATABASE_URL would
 * fail the whole build rather than the one request that actually needs it.
 */
export function createDbClient(): LibSQLDatabase<Schema> {
  return drizzle({
    connection: {
      url: requireEnv("DATABASE_URL"),
      authToken: process.env.DATABASE_AUTH_TOKEN,
    },
    schema,
  });
}
