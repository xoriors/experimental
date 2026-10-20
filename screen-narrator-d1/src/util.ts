// Small helpers shared by the CLIs (capture, bench, report) and the live server.
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Run `fn` over `items` with at most `limit` in flight, keeping results in input order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]!);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

/** The first line of an error's message (stack traces and multi-line SDK messages stay out of tables and JSON). */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split("\n")[0]!;

/** True when the module at `importMetaUrl` is the script node was started with (`tsx src/run.ts`), not an import. */
export const isEntryPoint = (importMetaUrl: string): boolean =>
	process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
