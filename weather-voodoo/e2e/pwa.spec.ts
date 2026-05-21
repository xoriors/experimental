import { expect, test } from '@playwright/test';

test.describe('PWA install + service worker', () => {
	test('serves a valid web manifest with icons and theme', async ({ request }) => {
		const res = await request.get('/manifest.webmanifest');
		expect(res.ok()).toBeTruthy();
		const manifest = await res.json();

		expect(manifest.name).toBe('Weather Voodoo');
		expect(manifest.display).toBe('standalone');
		expect(manifest.start_url).toBe('/');
		expect(manifest.theme_color).toBe('#0b1220');
		expect(manifest.background_color).toBe('#0b1220');

		const sizes = (manifest.icons as Array<{ sizes: string }>).map((i) => i.sizes);
		expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));

		const hasMaskable = (manifest.icons as Array<{ purpose?: string }>).some((i) =>
			(i.purpose ?? '').split(' ').includes('maskable')
		);
		expect(hasMaskable).toBe(true);
	});

	test('declares manifest + apple-touch-icon + theme-color in <head>', async ({ page }) => {
		await page.goto('/');

		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
			'href',
			/manifest\.webmanifest$/
		);
		await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
			'href',
			/apple-touch-icon\.png$/
		);
		await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b1220');
		await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
			'content',
			'yes'
		);
	});

	test('all manifest icons return PNG bytes', async ({ request }) => {
		const manifest = await (await request.get('/manifest.webmanifest')).json();
		for (const icon of manifest.icons as Array<{ src: string; type: string }>) {
			const res = await request.get(icon.src);
			expect(res.ok(), `${icon.src} should be served`).toBeTruthy();
			expect(res.headers()['content-type']).toContain('image/png');
			const body = await res.body();
			// PNG magic bytes: 89 50 4E 47
			expect(body[0]).toBe(0x89);
			expect(body[1]).toBe(0x50);
			expect(body[2]).toBe(0x4e);
			expect(body[3]).toBe(0x47);
		}
	});

	test('service worker is served and registers', async ({ page }) => {
		await page.goto('/');

		// SvelteKit auto-injects a registration script. Wait for it to settle.
		await page.waitForFunction(async () => {
			if (!('serviceWorker' in navigator)) return false;
			const reg = await navigator.serviceWorker.getRegistration();
			return !!reg && !!(reg.active || reg.installing || reg.waiting);
		}, { timeout: 15_000 });

		const state = await page.evaluate(async () => {
			const reg = await navigator.serviceWorker.getRegistration();
			return {
				scope: reg?.scope,
				active: reg?.active?.state,
				scriptURL: reg?.active?.scriptURL ?? reg?.installing?.scriptURL ?? reg?.waiting?.scriptURL
			};
		});

		expect(state.scriptURL).toMatch(/service-worker\.js$/);
		expect(state.scope?.endsWith('/')).toBe(true);
	});

	test('shell still renders when offline after first load', async ({ page, context }) => {
		await page.goto('/');
		await page.waitForFunction(async () => {
			if (!('serviceWorker' in navigator)) return false;
			const reg = await navigator.serviceWorker.getRegistration();
			return reg?.active?.state === 'activated';
		}, { timeout: 15_000 });

		// Reload once so the active SW handles the navigation request.
		await page.reload();
		await expect(page.locator('h1')).toContainText('Weather Voodoo');

		await context.setOffline(true);
		await page.reload();
		await expect(page.locator('h1')).toContainText('Weather Voodoo');
		await context.setOffline(false);
	});
});
