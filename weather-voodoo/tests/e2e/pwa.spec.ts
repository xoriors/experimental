import { test, expect } from '@playwright/test';

test.describe('PWA installability', () => {
	test('serves manifest with required fields', async ({ request }) => {
		const res = await request.get('/manifest.webmanifest');
		expect(res.status()).toBe(200);
		const contentType = res.headers()['content-type'] ?? '';
		expect(contentType).toMatch(/manifest\+json|application\/json/);
		const manifest = await res.json();
		expect(manifest.name).toBe('Weather Voodoo');
		expect(manifest.short_name).toBeTruthy();
		expect(manifest.start_url).toBe('/');
		expect(manifest.display).toBe('standalone');
		expect(manifest.theme_color).toBe('#0b1220');
		expect(manifest.background_color).toBe('#0b1220');
		expect(Array.isArray(manifest.icons)).toBe(true);
		const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
		expect(sizes).toContain('192x192');
		expect(sizes).toContain('512x512');
		const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose);
		expect(purposes).toContain('maskable');
	});

	test('every icon referenced by manifest is reachable', async ({ request }) => {
		const manifest = await (await request.get('/manifest.webmanifest')).json();
		for (const icon of manifest.icons) {
			const r = await request.get(icon.src);
			expect(r.status(), `${icon.src} status`).toBe(200);
			expect(r.headers()['content-type'], `${icon.src} type`).toContain('image/png');
		}
	});

	test('apple-touch-icon is reachable and linked from <head>', async ({ page, request }) => {
		await page.goto('/');
		const href = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
		expect(href).toBeTruthy();
		const r = await request.get(href!);
		expect(r.status()).toBe(200);
	});

	test('manifest is linked from <head>', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
		const href = await page.getAttribute('link[rel="manifest"]', 'href');
		expect(href).toMatch(/manifest\.webmanifest$/);
	});

	test('theme-color meta matches manifest', async ({ page }) => {
		await page.goto('/');
		const content = await page.getAttribute('meta[name="theme-color"]', 'content');
		expect(content).toBe('#0b1220');
	});

	test('iOS-specific meta tags are present', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveCount(1);
		await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveCount(1);
	});

	test('service worker registers and becomes active', async ({ page }) => {
		await page.goto('/');
		const state = await page.evaluate(async () => {
			if (!('serviceWorker' in navigator)) return 'no-sw';
			const reg = await navigator.serviceWorker.ready;
			const worker = reg.active;
			if (!worker) return 'no-active';
			if (worker.state === 'activated') return 'activated';
			return await new Promise<string>((resolve) => {
				const onChange = () => {
					if (worker.state === 'activated') {
						worker.removeEventListener('statechange', onChange);
						resolve('activated');
					}
				};
				worker.addEventListener('statechange', onChange);
			});
		});
		expect(state).toBe('activated');
	});

	test('app shell still loads (smoke test)', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('h1')).toContainText('Weather Voodoo');
	});
});
