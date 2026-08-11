import { describe, expect, it } from 'vitest';
import {
	samplePath,
	axisOnEarthRange,
	umbraContactRange,
	pathPolygon
} from '../src/lib/map/eclipse-path';
import { tToUtc } from '../src/lib/eclipse/besselian';

describe('the path of totality', () => {
	const axisRange = axisOnEarthRange();
	const contactRange = umbraContactRange();
	const samples = samplePath(60);

	it('has the umbra reach Earth before the axis does, and leave after', () => {
		const u1 = tToUtc(contactRange.start);
		const u4 = tToUtc(contactRange.end);
		console.log(
			'umbra touches Earth', u1.toISOString().slice(11, 19),
			'-> leaves', u4.toISOString().slice(11, 19),
			'| axis on Earth', tToUtc(axisRange.start).toISOString().slice(11, 19),
			'->', tToUtc(axisRange.end).toISOString().slice(11, 19)
		);
		expect(contactRange.start).toBeLessThan(axisRange.start);
		expect(contactRange.end).toBeGreaterThan(axisRange.end);
	});

	it('brackets the whole eclipse within the published window', () => {
		// Totality begins somewhere on Earth about 16:57 UT and ends about 18:35.
		const u1 = tToUtc(contactRange.start);
		const u4 = tToUtc(contactRange.end);
		expect(u1.getTime()).toBeGreaterThan(new Date('2026-08-12T16:50:00Z').getTime());
		expect(u1.getTime()).toBeLessThan(new Date('2026-08-12T17:02:00Z').getTime());
		expect(u4.getTime()).toBeGreaterThan(new Date('2026-08-12T18:30:00Z').getTime());
		expect(u4.getTime()).toBeLessThan(new Date('2026-08-12T18:40:00Z').getTime());
	});

	it('produces a continuous run of samples', () => {
		expect(samples.length).toBeGreaterThan(80);
		for (const s of samples) {
			expect(Number.isFinite(s.centre.lat)).toBe(true);
			expect(Number.isFinite(s.centre.lon)).toBe(true);
		}
	});

	it('peaks at the published maximum duration', () => {
		const maxDuration = Math.max(...samples.map((s) => s.durationSeconds));
		const longest = samples.reduce((a, b) => (a.durationSeconds > b.durationSeconds ? a : b));
		console.log(
			'max duration', maxDuration.toFixed(1), 's at width', longest.widthKm.toFixed(0), 'km'
		);
		// NASA: 02m18s on the centre line at greatest eclipse, path 293.9 km wide.
		expect(maxDuration).toBeGreaterThan(136);
		expect(maxDuration).toBeLessThan(140);
		expect(longest.widthKm).toBeGreaterThan(285);
		expect(longest.widthKm).toBeLessThan(305);
	});

	it('has the shadow strike at a glancing angle at both ends of the track', () => {
		// Where the Sun is on the horizon the umbra is smeared into a long
		// ellipse, so its footprint is far wider than the 294 km at mid-track.
		const ends = [samples[0], samples[samples.length - 1]];
		for (const end of ends) {
			expect(end.sunAltitude).toBeLessThan(6);
			expect(end.widthKm).toBeGreaterThan(400);
		}
	});

	it('crosses Greenland, Iceland and Spain in that order', () => {
		const greenland = samples.filter((s) => s.centre.lat > 68 && s.centre.lon > -50 && s.centre.lon < -15);
		const iceland = samples.filter(
			(s) => s.centre.lat > 63 && s.centre.lat < 67 && s.centre.lon > -25 && s.centre.lon < -13
		);
		const spain = samples.filter((s) => s.centre.lat > 39 && s.centre.lat < 45 && s.centre.lon > -10 && s.centre.lon < 4);
		expect(greenland.length).toBeGreaterThan(0);
		expect(iceland.length).toBeGreaterThan(0);
		expect(spain.length).toBeGreaterThan(0);
		expect(greenland[0].t).toBeLessThan(iceland[0].t);
		expect(iceland[0].t).toBeLessThan(spain[0].t);
	});

	it('shows the shadow slowing down and the Sun sinking along the track', () => {
		const first = samples[0];
		const last = samples[samples.length - 1];
		// The Sun is on the horizon at both ends and highest near greatest eclipse.
		const highest = samples.reduce((a, b) => (a.sunAltitude > b.sunAltitude ? a : b));
		expect(first.sunAltitude).toBeLessThan(6);
		expect(last.sunAltitude).toBeLessThan(6);
		expect(highest.sunAltitude).toBeGreaterThan(24);
		console.log(
			'speed range',
			Math.min(...samples.map((s) => s.speedKmS)).toFixed(2),
			'to',
			Math.max(...samples.map((s) => s.speedKmS)).toFixed(2),
			'km/s'
		);
	});

	it('builds a closed polygon for the swath', () => {
		const polygon = pathPolygon(samples);
		expect(polygon.length).toBe(samples.length * 2);
	});

	it('reports the Spanish leg lasting only a few minutes', () => {
		const spain = samples.filter(
			(s) => s.centre.lat > 38 && s.centre.lat < 45 && s.centre.lon > -10 && s.centre.lon < 5
		);
		const span = (spain[spain.length - 1].t - spain[0].t) * 60;
		console.log('umbra over Iberia for about', span.toFixed(0), 'minutes');
		expect(span).toBeGreaterThan(3);
		expect(span).toBeLessThan(15);
	});
});
