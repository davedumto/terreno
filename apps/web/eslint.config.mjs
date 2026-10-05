import nextConfig from "eslint-config-next";

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...nextConfig,
  {
    ignores: [".next/**", "lib/db/migrations/**"],
  },
];

export default config;
