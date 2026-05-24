import { describe, it, expect } from 'vitest';
import {
	classifyRelativeWind,
	normalizeDeg180,
	relativeWindDeg,
	worstRelativeWind
} from '../src/lib/wind';

describe('wind', () => {
	it('normalizeDeg180 maps to [-180, 180)', () => {
		expect(normalizeDeg180(0)).toBe(0);
		expect(normalizeDeg180(180)).toBeCloseTo(-180);
		expect(normalizeDeg180(-180)).toBeCloseTo(-180);
		expect(normalizeDeg180(270)).toBe(-90);
		expect(normalizeDeg180(-270)).toBe(90);
		expect(normalizeDeg180(720 + 45)).toBeCloseTo(45);
	});

	it('relativeWindDeg returns 0 for wind directly ahead', () => {
		// Heading east (90°), wind FROM east (90°) → head wind.
		expect(relativeWindDeg(90, 90)).toBe(0);
	});

	it('relativeWindDeg returns ±180 for tail wind', () => {
		// Heading east (90°), wind FROM west (270°) → tail wind.
		const rel = relativeWindDeg(270, 90);
		expect(Math.abs(rel)).toBeCloseTo(180);
	});

	it('relativeWindDeg returns +90 for wind from starboard', () => {
		// Heading north (0°), wind FROM east (90°) → wind on the right (+90°).
		expect(relativeWindDeg(90, 0)).toBe(90);
	});

	it('relativeWindDeg returns -90 for wind from port', () => {
		// Heading north (0°), wind FROM west (270°) → wind on the left (-90°).
		expect(relativeWindDeg(270, 0)).toBe(-90);
	});

	it('classifyRelativeWind buckets across the full range', () => {
		expect(classifyRelativeWind(0)).toBe('head');
		expect(classifyRelativeWind(30)).toBe('head');
		expect(classifyRelativeWind(-30)).toBe('head');
		expect(classifyRelativeWind(45)).toBe('head-cross');
		expect(classifyRelativeWind(-60)).toBe('head-cross');
		expect(classifyRelativeWind(90)).toBe('cross');
		expect(classifyRelativeWind(-119)).toBe('cross');
		expect(classifyRelativeWind(120)).toBe('tail-cross');
		expect(classifyRelativeWind(-149)).toBe('tail-cross');
		expect(classifyRelativeWind(150)).toBe('tail');
		expect(classifyRelativeWind(180)).toBe('tail');
		expect(classifyRelativeWind(-180)).toBe('tail');
	});

	it('worstRelativeWind picks the value with smallest absolute angle', () => {
		expect(worstRelativeWind([170, 50, -20, 90])).toBe(-20);
		expect(worstRelativeWind([180])).toBe(180);
		expect(worstRelativeWind([])).toBeNull();
	});
});
