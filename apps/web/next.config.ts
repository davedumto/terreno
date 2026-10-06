import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// .env.local lives at the monorepo root (SPEC.md section 16: one shared set
// of variables for apps/web and apps/sweeper), but Next.js's own automatic
// loading only looks in the directory it's invoked from (apps/web). Load the
// root file explicitly so `pnpm --filter web dev/build` picks it up without
// requiring every invocation to export the vars into the shell first.
// Next.js's own internal loadEnvConfig call runs before this file does and
// caches its result; without forceReload this call would just return that
// cached (and, for apps/web, always-empty) result instead of genuinely
// re-reading from the monorepo root.
loadEnvConfig(path.resolve(__dirname, "../.."), process.env.NODE_ENV !== "production", console, true);

const nextConfig: NextConfig = {};

export default nextConfig;
