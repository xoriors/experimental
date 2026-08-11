import { describe, expect, it } from 'vitest';
import { DEG, elementsAt, utcToT, EPHEMERIS_MERIDIAN_DEG, ELEMENTS } from '../src/lib/eclipse/besselian';
import {
	greenwichSiderealTime,
	planetPositions,
	toHorizon,
	BRIGHT_STARS
} from '../src/lib/sim/sky-objects';
import { localCircumstances, sunPosition } from '../src/lib/eclipse/local';
import { shadowGeometry } from '../src/lib/eclipse/besselian';

const ECLIPSE_MID = new Date('2026-08-12T18:30:00Z');

describe('sidereal time and the Sun', () => {
	it('agrees with the shadow axis declination from the Besselian elements', () => {
		// The shadow axis points at the Sun, so its declination is the Sun's.
		const e = elementsAt(utcToT(ECLIPSE_MID));
		const declination = e.d / DEG;
		expect(declination).toBeGreaterThan(14.5);
		expect(declination).toBeLessThan(15.0);
	});

	it('derives a Sun right ascension consistent with the elements', () => {
		// The axis has Greenwich hour angle mu, so RA = sidereal time - mu.
		const t = utcToT(ECLIPSE_MID);
		const e = elementsAt(t);
		const gst = greenwichSiderealTime(ECLIPSE_MID);
		const ra = ((gst - e.mu / DEG) % 360 + 360) % 360;
		// In mid-August the Sun sits near RA 9h33m = 143 degrees.
		expect(ra).toBeGreaterThan(140);
		expect(ra).toBeLessThan(146);
	});

	it('places the Sun on the horizon consistently in both frames', () => {
		// Compare the Besselian Sun altitude with a sidereal-time computation
		// using the RA/Dec derived above. They should agree closely.
		const obs = { lat: 41.65, lon: -4.72 };
		const t = utcToT(ECLIPSE_MID);
		const e = elementsAt(t);
		const gst = greenwichSiderealTime(ECLIPSE_MID);
		const ra = ((gst - e.mu / DEG) % 360 + 360) % 360;
		const viaStars = toHorizon({ ra, dec: e.d / DEG }, ECLIPSE_MID, obs.lat, obs.lon);
		const viaBessel = sunPosition(shadowGeometry(t, obs), obs);
		expect(viaStars.altitude).toBeCloseTo(viaBessel.altitude, 4);
		expect(viaStars.azimuth).toBeCloseTo(viaBessel.azimuth, 4);
	});
});

describe('planets during the eclipse', () => {
	const planets = planetPositions(ECLIPSE_MID);
	const byName = Object.fromEntries(planets.map((p) => [p.name, p]));

	it('returns all five naked-eye planets', () => {
		expect(Object.keys(byName).sort()).toEqual([
			'Jupiter',
			'Mars',
			'Mercury',
			'Saturn',
			'Venus'
		]);
	});

	it('gives Venus and Jupiter sensible brightnesses', () => {
		expect(byName.Venus.magnitude).toBeLessThan(-3);
		expect(byName.Venus.magnitude).toBeGreaterThan(-5);
		expect(byName.Jupiter.magnitude).toBeLessThan(-1);
		expect(byName.Jupiter.magnitude).toBeGreaterThan(-3);
	});

	it('keeps the inner planets near the Sun', () => {
		const e = elementsAt(utcToT(ECLIPSE_MID));
		const gst = greenwichSiderealTime(ECLIPSE_MID);
		const sunRa = ((gst - e.mu / DEG) % 360 + 360) % 360;
		const sunDec = e.d / DEG;

		const separation = (p: { ra: number; dec: number }) => {
			const d1 = sunDec * DEG;
			const d2 = p.dec * DEG;
			const dRa = (p.ra - sunRa) * DEG;
			return (
				Math.acos(
					Math.min(1, Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dRa))
				) / DEG
			);
		};

		// Mercury and Venus can never stray far from the Sun.
		expect(separation(byName.Mercury)).toBeLessThan(28);
		expect(separation(byName.Venus)).toBeLessThan(47);
		// Report the actual geometry so the site can describe it honestly.
		for (const p of planets) {
			// eslint-disable-next-line no-console
			console.log(p.name.padEnd(8), 'sep from Sun =', separation(p).toFixed(1) + ' deg', 'mag', p.magnitude.toFixed(2));
		}
	});
});

describe('star catalogue', () => {
	it('has Regulus close to the Sun on eclipse day', () => {
		const regulus = BRIGHT_STARS.find((s) => s.name === 'Regulus')!;
		const e = elementsAt(utcToT(ECLIPSE_MID));
		const gst = greenwichSiderealTime(ECLIPSE_MID);
		const sunRa = ((gst - e.mu / DEG) % 360 + 360) % 360;
		// Regulus is at RA 152.1, the Sun near 143: under 10 degrees apart.
		expect(Math.abs(regulus.ra - sunRa)).toBeLessThan(12);
	});

	it('has plausible coordinate ranges throughout', () => {
		for (const s of BRIGHT_STARS) {
			expect(s.ra).toBeGreaterThanOrEqual(0);
			expect(s.ra).toBeLessThan(360);
			expect(Math.abs(s.dec)).toBeLessThanOrEqual(90);
		}
	});
});

describe('the ephemeris meridian correction is actually applied', () => {
	it('shifts mu by about a quarter of a degree', () => {
		expect(EPHEMERIS_MERIDIAN_DEG).toBeCloseTo(0.315, 3);
		const raw = ELEMENTS.mu[0];
		expect(elementsAt(0).mu / DEG).toBeCloseTo(raw - EPHEMERIS_MERIDIAN_DEG, 9);
	});

	it('is what puts Bilbao inside the path and Madrid outside', () => {
		// A regression guard: these two flip if the correction is dropped.
		expect(localCircumstances({ lat: 43.263, lon: -2.935, elevation: 19 }).isTotal).toBe(true);
		expect(localCircumstances({ lat: 40.4168, lon: -3.7038, elevation: 650 }).isTotal).toBe(false);
	});
});
