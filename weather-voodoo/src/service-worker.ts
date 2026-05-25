/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL_CACHE = `shell-${version}`;
const API_CACHE = `api-${version}`;

// Precache the SvelteKit-built app shell (JS, CSS) and `static/` files.
// Excludes service-worker.js itself and source maps.
const PRECACHE_URLS = [...build, ...files].filter(
	(url) => !url.endsWith('.map') && url !== '/service-worker.js'
);

// Treat API responses older than this as too stale to show on a cold load.
const API_MAX_STALE_MS = 6 * 60 * 60 * 1000; // 6 hours

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key !== SHELL_CACHE && key !== API_CACHE)
					.map((key) => caches.delete(key))
			);
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	if (url.pathname.startsWith('/api/')) {
		event.respondWith(networkFirstSWR(request));
		return;
	}

	event.respondWith(cacheFirst(request));
});

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(SHELL_CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;

	try {
		const response = await fetch(request);
		if (response.ok && response.type === 'basic') {
			cache.put(request, response.clone()).catch(() => {});
		}
		return response;
	} catch {
		if (request.mode === 'navigate') {
			const fallback = await cache.match('/');
			if (fallback) return fallback;
		}
		return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
	}
}

async function networkFirstSWR(request: Request): Promise<Response> {
	const cache = await caches.open(API_CACHE);

	try {
		const response = await fetch(request);
		if (response.ok) {
			const stamped = await stampResponse(response.clone());
			cache.put(request, stamped).catch(() => {});
		}
		return response;
	} catch {
		const cached = await cache.match(request);
		if (cached && !isExpired(cached)) return cached;
		if (cached) {
			// Better to show a stale forecast than nothing when offline.
			return cached;
		}
		return new Response(
			JSON.stringify({ error: 'offline', message: 'No cached data for this request.' }),
			{ status: 503, headers: { 'content-type': 'application/json' } }
		);
	}
}

async function stampResponse(response: Response): Promise<Response> {
	const headers = new Headers(response.headers);
	headers.set('x-sw-cached-at', String(Date.now()));
	const body = await response.blob();
	return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function isExpired(response: Response): boolean {
	const ts = Number(response.headers.get('x-sw-cached-at') ?? 0);
	if (!ts) return false;
	return Date.now() - ts > API_MAX_STALE_MS;
}
