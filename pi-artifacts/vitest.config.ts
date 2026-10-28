import { defineConfig } from "vitest/config";

// Unit tests run in Node, without the Cloudflare and React plugins vite.config.ts loads.
export default defineConfig({ test: { include: ["test/**/*.test.{ts,tsx}"] } });
