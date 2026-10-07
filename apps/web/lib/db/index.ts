import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { createDbClient, type Schema } from "@terreno/shared/db";

// Lazy: Next.js collects route metadata at build time by importing every
// route module, even ones that won't run during the build. Throwing here
// eagerly (e.g. for a missing DATABASE_URL) would fail the whole build
// rather than the request that actually needs the database.
let instance: LibSQLDatabase<Schema> | undefined;

export const db: LibSQLDatabase<Schema> = new Proxy({} as LibSQLDatabase<Schema>, {
  get(_target, prop, receiver) {
    if (!instance) {
      instance = createDbClient();
    }
    return Reflect.get(instance, prop, receiver);
  },
});
