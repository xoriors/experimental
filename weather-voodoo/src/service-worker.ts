/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_CACHE = `app-shell-${version}`;
const API_CACHE = `api-cache-${version}`;
const API_MAX_AGE_MS = 60 * 60 * 1000;

const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(APP_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((k) => k !== APP_CACHE && k !== API_CACHE).map((k) => caches.delete(k)))
			)
			.then(() => sw.clients.claim())
	);
});

function isApiRequest(url: URL): boolean {
	return url.origin === sw.location.origin && url.pathname.startsWith('/api/');
}

function isPrecached(url: URL): boolean {
	if (url.origin !== sw.location.origin) return false;
	return PRECACHE.includes(url.pathname);
}

async function networkFirstWithSWR(request: Request): Promise<Response> {
	const cache = await caches.open(API_CACHE);
	try {
		const fresh = await fetch(request);
		if (fresh.ok) {
			const stamped = await stampDate(fresh.clone());
			await cache.put(request, stamped);
		}
		return fresh;
	} catch (err) {
		const cached = await cache.match(request);
		if (cached) return cached;
		throw err;
	}
}

async function stampDate(response: Response): Promise<Response> {
	const headers = new Headers(response.headers);
	headers.set('x-sw-cached-at', String(Date.now()));
	const body = await response.arrayBuffer();
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(APP_CACHE);
	const hit = await cache.match(request);
	if (hit) return hit;
	const fresh = await fetch(request);
	if (fresh.ok && request.method === 'GET') {
		cache.put(request, fresh.clone()).catch(() => {});
	}
	return fresh;
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	if (isApiRequest(url)) {
		event.respondWith(networkFirstWithSWR(request));
		return;
	}

	if (isPrecached(url) || request.mode === 'navigate') {
		event.respondWith(cacheFirst(request));
	}
});

sw.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') sw.skipWaiting();
});
