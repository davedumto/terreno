import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { requireEnv } from "../env";
import * as schema from "./schema";

type Schema = typeof schema;

// Lazy: Next.js collects route metadata at build time by importing every
// route module, even ones that won't run during the build. Throwing here
// eagerly (e.g. for a missing DATABASE_URL) would fail the whole build
// rather than the request that actually needs the database.
let instance: LibSQLDatabase<Schema> | undefined;

function createDb(): LibSQLDatabase<Schema> {
  return drizzle({
    connection: {
      url: requireEnv("DATABASE_URL"),
      authToken: process.env.DATABASE_AUTH_TOKEN,
    },
    schema,
  });
}

export const db: LibSQLDatabase<Schema> = new Proxy({} as LibSQLDatabase<Schema>, {
  get(_target, prop, receiver) {
    if (!instance) {
      instance = createDb();
    }
    return Reflect.get(instance, prop, receiver);
  },
});
