import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

export const db = drizzle({
  connection: {
    url: databaseUrl,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
  schema,
});
