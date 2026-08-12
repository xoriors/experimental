import { describe, expect, it } from 'vitest';
import { localCircumstances, sunIsUp, SUNSET_ALTITUDE } from '../src/lib/eclipse/local';

describe('eclipses that happen below the horizon', () => {
	it('does not credit Bucharest with the 90% it never sees', () => {
		// The Moon covers 90% of the Sun at Bucharest's longitude, but maximum
		// falls more than eight degrees below the horizon: the Sun has long set.
		const local = localCircumstances({ lat: 44.4268, lon: 26.1025 });
		expect(local.hasEclipse).toBe(true);
		expect(local.maxObscuration).toBeGreaterThan(0.85);
		expect(local.max.altitude).toBeLessThan(-5);

		// What is actually visible is a sliver as the Sun touches the horizon.
		expect(local.visibleObscuration).toBeLessThan(0.05);
		expect(local.partlyBelowHorizon).toBe(true);
		expect(local.bestVisible).not.toBeNull();
		expect(sunIsUp(local.bestVisible!.altitude)).toBe(true);
	});

	it('reports the reduction wherever the Sun sets mid-eclipse', () => {
		// Rome reaches 95% on paper but the Sun goes down on the way there.
		const rome = localCircumstances({ lat: 41.9028, lon: 12.4964 });
		expect(rome.partlyBelowHorizon).toBe(true);
		expect(rome.visibleObscuration).toBeLessThan(rome.maxObscuration);
		expect(rome.visibleObscuration).toBeGreaterThan(0.7);
	});

	it('leaves places with the Sun well up untouched', () => {
		for (const [name, lat, lon] of [
			['London', 51.5072, -0.1276],
			['Paris', 48.8566, 2.3522],
			['Reykjavik', 64.1466, -21.9426],
			['New York', 40.7128, -74.006]
		] as Array<[string, number, number]>) {
			const local = localCircumstances({ lat, lon });
			expect(local.belowHorizon, name).toBe(false);
			expect(local.partlyBelowHorizon, name).toBe(false);
			expect(local.visibleObscuration, name).toBeCloseTo(local.maxObscuration, 6);
		}
	});

	it('keeps the Spanish path fully visible where it matters', () => {
		const palencia = localCircumstances({ lat: 42.0096, lon: -4.5288, elevation: 740 });
		expect(palencia.isTotal).toBe(true);
		expect(palencia.belowHorizon).toBe(false);
		expect(palencia.visibleObscuration).toBeCloseTo(1, 6);
		// Totality itself must happen with the Sun up.
		expect(sunIsUp(palencia.c2!.altitude)).toBe(true);
		expect(sunIsUp(palencia.c3!.altitude)).toBe(true);
	});

	it('marks a place east of the whole event as entirely unseen', () => {
		// Deep in Asia the eclipse is over before sunrise and never rises.
		const local = localCircumstances({ lat: 39.9042, lon: 116.4074 }); // Beijing
		if (local.hasEclipse) {
			expect(local.belowHorizon).toBe(true);
			expect(local.visibleObscuration).toBe(0);
			expect(local.bestVisible).toBeNull();
		} else {
			expect(local.maxObscuration).toBe(0);
		}
	});

	it('uses the standard sunset threshold, not the geometric horizon', () => {
		// The upper limb is still up when the centre is 0.833 deg down.
		expect(SUNSET_ALTITUDE).toBeCloseTo(-0.833, 3);
		expect(sunIsUp(-0.5)).toBe(true);
		expect(sunIsUp(-1)).toBe(false);
	});
});
