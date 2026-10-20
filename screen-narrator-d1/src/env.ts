// Loads screen-narrator-d1/.env (if present) into process.env, without overriding variables already set.
// Import this first in every entry point (capture, run, report, live).
import { existsSync } from "node:fs";
import path from "node:path";

/** Absolute path of the project root (the folder holding package.json). */
export const ROOT = path.resolve(import.meta.dirname, "..");

const envFile = path.join(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** Resolve a project-relative path (as stored in Pair.before / after) to an absolute one. */
export const fromRoot = (...parts: string[]): string => path.join(ROOT, ...parts);
