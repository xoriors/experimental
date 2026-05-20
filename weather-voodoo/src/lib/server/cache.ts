type Entry<T> = { value: T; expiresAt: number };

const TTL_MS = 10 * 60 * 1000;
const MAX = 500;

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(key: string, fetcher: () => Promise<T>, ttlMs = TTL_MS): Promise<T> {
	const now = Date.now();
	const hit = store.get(key);
	if (hit && hit.expiresAt > now) {
		store.delete(key);
		store.set(key, hit);
		return hit.value as T;
	}
	const value = await fetcher();
	store.set(key, { value, expiresAt: now + ttlMs });
	while (store.size > MAX) {
		const oldest = store.keys().next().value;
		if (oldest === undefined) break;
		store.delete(oldest);
	}
	return value;
}

export function roundCoord(n: number, dp = 3): number {
	const mul = 10 ** dp;
	return Math.round(n * mul) / mul;
}
