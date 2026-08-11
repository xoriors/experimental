/**
 * The whole site rests on this maths being right, so these tests check it
 * against independently published predictions (NASA/GSFC and timeanddate.com).
 */

import { describe, expect, it } from 'vitest';
import {
	centralLinePoint,
	elementsAt,
	pathLimits,
	tToUtc,
	umbraOutline,
	utcToT
} from '../src/lib/eclipse/besselian';
import {
	haversineKm,
	localCircumstances,
	skyGeometry,
	sunAngularRadius,
	timeOfMaximum
} from '../src/lib/eclipse/local';

/** Format a Date as HH:MM:SS UTC for readable assertions. */
function hms(date: Date): string {
	return date.toISOString().slice(11, 19);
}

/** Seconds between two dates. */
function gap(a: Date, b: Date): number {
	return Math.abs(a.getTime() - b.getTime()) / 1000;
}

describe('time scale conversion', () => {
	it('round-trips UTC through element hours', () => {
		const d = new Date(Date.UTC(2026, 7, 12, 18, 30, 0));
		expect(gap(tToUtc(utcToT(d)), d)).toBeLessThan(1e-6);
	});

	it('places the elements epoch 75.4 s before 18:00 UTC', () => {
		// t = 0 is 18:00 TDT, which is 18:00 UTC minus deltaT.
		expect(hms(tToUtc(0))).toBe('17:58:44');
	});
});

describe('greatest eclipse (NASA reference values)', () => {
	// NASA: 2026 Aug 12 17:45:51 UT, 65.2N 25.2W, alt 25.8, width 293.9 km,
	// central duration 02m18s, gamma 0.8977, magnitude 1.0386.
	const tGreatest = utcToT(new Date(Date.UTC(2026, 7, 12, 17, 45, 51)));

	it('puts the shadow axis on Iceland at the right spot', () => {
		const point = centralLinePoint(tGreatest);
		expect(point).not.toBeNull();
		expect(point!.lat).toBeCloseTo(65.2, 0);
		expect(point!.lon).toBeCloseTo(-25.2, 0);
	});

	it('reproduces the published path width', () => {
		const limits = pathLimits(tGreatest);
		expect(limits).not.toBeNull();
		const width = haversineKm(limits!.north, limits!.south);
		expect(width).toBeGreaterThan(285);
		expect(width).toBeLessThan(302);
	});

	it('reproduces the published eclipse magnitude on the centre line', () => {
		const point = centralLinePoint(tGreatest)!;
		const local = localCircumstances({ lat: point.lat, lon: point.lon });
		expect(local.isTotal).toBe(true);
		// NASA quotes 1.0386 for a central eclipse, which is the ratio of the
		// Moon's apparent diameter to the Sun's rather than the magnitude formula.
		expect(local.diameterRatio).toBeCloseTo(1.0386, 3);
		// The magnitude proper is smaller, and always above 1 during totality.
		expect(local.maxMagnitude).toBeGreaterThan(1);
		expect(local.maxMagnitude).toBeLessThan(local.diameterRatio);
	});

	it('reproduces the published central duration of 2m18s', () => {
		const point = centralLinePoint(tGreatest)!;
		const local = localCircumstances({ lat: point.lat, lon: point.lon });
		expect(local.totalitySeconds).toBeGreaterThan(136);
		expect(local.totalitySeconds).toBeLessThan(140);
	});

	it('reproduces the published Sun altitude of 25.8 degrees', () => {
		const point = centralLinePoint(tGreatest)!;
		const local = localCircumstances({ lat: point.lat, lon: point.lon });
		expect(local.max.altitude).toBeCloseTo(25.8, 0);
	});

	it('has gamma near 0.8977', () => {
		// gamma is the least distance of the axis from Earth's centre, in Earth radii.
		let gamma = Infinity;
		for (let t = -3; t <= 3; t += 0.0005) {
			const e = elementsAt(t);
			gamma = Math.min(gamma, Math.hypot(e.x, e.y));
		}
		expect(gamma).toBeCloseTo(0.8977, 3);
	});
});

describe('local circumstances in the path of totality', () => {
	it('matches published timings for A Coruna, Spain', () => {
		// timeanddate.com: partial 19:31 CEST, max 20:28 CEST, end 21:22 CEST,
		// totality 76 s, Sun altitude ~12 degrees. CEST is UTC+2. Published times
		// are given to the minute and depend on the exact point chosen in the
		// city, so allow a minute of slack.
		const local = localCircumstances({ lat: 43.3623, lon: -8.4115, elevation: 20 });
		expect(local.isTotal).toBe(true);
		expect(gap(local.c1!.time, new Date('2026-08-12T17:31:00Z'))).toBeLessThan(60);
		expect(gap(local.max.time, new Date('2026-08-12T18:28:00Z'))).toBeLessThan(60);
		expect(gap(local.c4!.time, new Date('2026-08-12T19:22:00Z'))).toBeLessThan(60);
		expect(local.totalitySeconds).toBeGreaterThan(68);
		expect(local.totalitySeconds).toBeLessThan(82);
		expect(local.max.altitude).toBeCloseTo(12, 0);
	});

	it('matches published durations for cities across the Spanish path', () => {
		// These are the cases that pin down the position of the path over Spain:
		// two sit within about 10 km of a limit, so they only come out right if
		// the ephemeris-meridian correction is applied.
		const cases: Array<[string, number, number, number, number, number]> = [
			// name, lat, lon, elevation, expected seconds, tolerance
			['Bilbao', 43.263, -2.935, 19, 31, 12],
			['Palma de Mallorca', 39.5696, 2.6502, 13, 96, 10],
			['A Coruna', 43.3623, -8.4115, 20, 76, 8]
		];
		for (const [name, lat, lon, elevation, expected, tolerance] of cases) {
			const local = localCircumstances({ lat, lon, elevation });
			expect(local.isTotal, `${name} should be inside the path`).toBe(true);
			expect(
				Math.abs(local.totalitySeconds - expected),
				`${name}: got ${local.totalitySeconds.toFixed(1)}s, expected ~${expected}s`
			).toBeLessThan(tolerance);
		}
	});

	it('finds totality in Reykjavik with the Sun well up', () => {
		const local = localCircumstances({ lat: 64.1466, lon: -21.9426, elevation: 30 });
		expect(local.isTotal).toBe(true);
		expect(local.totalitySeconds).toBeGreaterThan(60);
		expect(local.max.altitude).toBeGreaterThan(20);
	});

	it('finds totality in Valencia, Spain', () => {
		const local = localCircumstances({ lat: 39.4699, lon: -0.3763 });
		expect(local.isTotal).toBe(true);
		expect(local.totalitySeconds).toBeGreaterThan(30);
		// The Sun is nearly on the horizon on the Mediterranean coast.
		expect(local.max.altitude).toBeLessThan(10);
		expect(local.max.altitude).toBeGreaterThan(0);
	});

	it('orders the four contacts correctly', () => {
		const local = localCircumstances({ lat: 42.35, lon: -3.7 }); // Burgos
		expect(local.c1!.t).toBeLessThan(local.c2!.t);
		expect(local.c2!.t).toBeLessThan(local.max.t);
		expect(local.max.t).toBeLessThan(local.c3!.t);
		expect(local.c3!.t).toBeLessThan(local.c4!.t);
	});

	it('reports obscuration of 1 during totality and magnitude above 1', () => {
		const local = localCircumstances({ lat: 41.65, lon: -4.72 }); // Valladolid
		expect(local.maxObscuration).toBeCloseTo(1, 6);
		expect(local.maxMagnitude).toBeGreaterThan(1);
	});
});

describe('local circumstances outside the path', () => {
	it('gives London a deep partial eclipse but no totality', () => {
		const local = localCircumstances({ lat: 51.5072, lon: -0.1276 });
		expect(local.isTotal).toBe(false);
		expect(local.hasEclipse).toBe(true);
		expect(local.c2).toBeNull();
		expect(local.c3).toBeNull();
		// Widely quoted figure for London is around 90 percent of the diameter.
		expect(local.maxMagnitude).toBeGreaterThan(0.85);
		expect(local.maxMagnitude).toBeLessThan(0.95);
		// Area obscuration is always noticeably less than the magnitude.
		expect(local.maxObscuration).toBeLessThan(local.maxMagnitude);
	});

	it('leaves Madrid just outside the southern limit', () => {
		// The southern limit clips the city: Madrid misses totality by a few km.
		const local = localCircumstances({ lat: 40.4168, lon: -3.7038, elevation: 650 });
		expect(local.isTotal).toBe(false);
		expect(local.maxMagnitude).toBeGreaterThan(0.99);
		expect(local.maxObscuration).toBeGreaterThan(0.999);
	});

	it('leaves Barcelona just outside the path as well', () => {
		const local = localCircumstances({ lat: 41.3874, lon: 2.1686, elevation: 12 });
		expect(local.isTotal).toBe(false);
		expect(local.maxMagnitude).toBeGreaterThan(0.99);
	});

	it('sees nothing at all from Cape Town', () => {
		const local = localCircumstances({ lat: -33.9249, lon: 18.4241 });
		expect(local.hasEclipse).toBe(false);
	});
});

describe('sky geometry for the simulator', () => {
	it('gives a Sun about 15.8 arcminutes in radius in August', () => {
		// Near aphelion the Sun is at its smallest, ~15.8' radius.
		const radius = sunAngularRadius(0) * 60;
		expect(radius).toBeGreaterThan(15.7);
		expect(radius).toBeLessThan(15.9);
	});

	it('has the Moon larger than the Sun inside the path', () => {
		const obs = { lat: 41.65, lon: -4.72 };
		const sky = skyGeometry(timeOfMaximum(obs), obs);
		expect(sky.moonRadius).toBeGreaterThan(sky.sunRadius);
		expect(sky.moonRadius / sky.sunRadius).toBeCloseTo(1.03, 1);
	});

	it('covers the Sun completely at maximum inside the path', () => {
		const obs = { lat: 41.65, lon: -4.72 };
		const sky = skyGeometry(timeOfMaximum(obs), obs);
		expect(sky.separation).toBeLessThan(sky.moonRadius - sky.sunRadius);
		expect(sky.obscuration).toBeCloseTo(1, 6);
	});

	it('keeps the screen offset consistent with the angular separation', () => {
		const obs = { lat: 43.26, lon: -2.93 }; // Bilbao
		const sky = skyGeometry(timeOfMaximum(obs) - 0.3, obs);
		expect(Math.hypot(sky.offsetRight, sky.offsetUp)).toBeCloseTo(sky.separation, 9);
	});

	it('sweeps the Moon left to right across the Sun over the eclipse', () => {
		// The Moon always moves eastward relative to the Sun, so in the observer's
		// view it enters on one side and leaves on the other.
		const obs = { lat: 41.65, lon: -4.72 };
		const local = localCircumstances(obs);
		const before = skyGeometry(local.c1!.t, obs);
		const after = skyGeometry(local.c4!.t, obs);
		expect(Math.sign(before.offsetRight)).not.toBe(Math.sign(after.offsetRight));
	});
});

describe('shadow path across the Earth', () => {
	it('tracks from Greenland through Iceland to Spain', () => {
		const at = (utc: string) => centralLinePoint(utcToT(new Date(utc)));

		const greenland = at('2026-08-12T17:10:00Z');
		expect(greenland).not.toBeNull();
		expect(greenland!.lat).toBeGreaterThan(70);

		const iceland = at('2026-08-12T17:46:00Z');
		expect(iceland!.lat).toBeGreaterThan(63);
		expect(iceland!.lat).toBeLessThan(67);

		const spain = at('2026-08-12T18:30:00Z');
		expect(spain!.lat).toBeGreaterThan(40);
		expect(spain!.lat).toBeLessThan(45);
		expect(spain!.lon).toBeGreaterThan(-9);
		expect(spain!.lon).toBeLessThan(0);
	});

	it('produces a closed umbra outline over land', () => {
		const ring = umbraOutline(utcToT(new Date('2026-08-12T18:30:00Z')));
		expect(ring).not.toBeNull();
		expect(ring!.length).toBeGreaterThan(50);
	});

	it('has the umbra move eastward over Spain', () => {
		const a = centralLinePoint(utcToT(new Date('2026-08-12T18:25:00Z')))!;
		const b = centralLinePoint(utcToT(new Date('2026-08-12T18:32:00Z')))!;
		expect(b.lon).toBeGreaterThan(a.lon);
	});

	it('has no shadow on Earth well before or after the eclipse', () => {
		expect(centralLinePoint(utcToT(new Date('2026-08-12T14:00:00Z')))).toBeNull();
		expect(centralLinePoint(utcToT(new Date('2026-08-12T21:00:00Z')))).toBeNull();
	});
});
