import { describe, expect, it } from 'vitest';
import { describeTimeZone, timeZoneFor } from '../src/lib/data/timezone';
import { formatClock, zoneAbbreviation } from '../src/lib/format';
import { ALL_PLACES } from '../src/lib/data/places';
import { localCircumstances } from '../src/lib/eclipse/local';

const ECLIPSE_DAY = new Date('2026-08-12T18:30:00Z');

/** Offset from UTC in minutes that a zone applies at a given instant. */
function offsetMinutes(date: Date, timeZone: string): number {
	const asUtc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
	const asZone = new Date(date.toLocaleString('en-US', { timeZone }));
	return Math.round((asZone.getTime() - asUtc.getTime()) / 60000);
}

describe('resolving a time zone from coordinates', () => {
	it('finds the right zone for places along the path', () => {
		expect(timeZoneFor(42.0096, -4.5288)).toBe('Europe/Madrid'); // Palencia
		expect(timeZoneFor(64.1466, -21.9426)).toBe('Atlantic/Reykjavik');
		expect(timeZoneFor(38.7223, -9.1393)).toBe('Europe/Lisbon');
	});

	it('finds the right zone for places watching the partial eclipse', () => {
		expect(timeZoneFor(51.5072, -0.1276)).toBe('Europe/London');
		expect(timeZoneFor(48.8566, 2.3522)).toBe('Europe/Paris');
		expect(timeZoneFor(33.5731, -7.5898)).toBe('Africa/Casablanca');
	});

	it('separates neighbours that share a border but not a clock', () => {
		// Lisbon and Madrid are an hour apart despite Portugal and Spain adjoining.
		const lisbon = timeZoneFor(38.7223, -9.1393);
		const madrid = timeZoneFor(40.4168, -3.7038);
		expect(lisbon).not.toBe(madrid);
		expect(offsetMinutes(ECLIPSE_DAY, madrid) - offsetMinutes(ECLIPSE_DAY, lisbon)).toBe(60);
	});

	it('falls back to something sensible out at sea and for bad input', () => {
		expect(timeZoneFor(45, -30)).toMatch(/^Etc\/GMT|UTC/);
		expect(timeZoneFor(Number.NaN, 0)).toBe('UTC');
		// Out-of-range values are clamped and wrapped rather than throwing.
		expect(() => timeZoneFor(120, 400)).not.toThrow();
	});
});

describe('the curated place list agrees with the coordinate lookup', () => {
	it('resolves to the same UTC offset for every listed place', () => {
		// The two can use different but equivalent IANA names (America/Nuuk and
		// America/Godthab, for instance), so compare the offset that actually
		// governs the clock rather than the string.
		for (const place of ALL_PLACES) {
			const looked = timeZoneFor(place.lat, place.lon);
			expect(
				offsetMinutes(ECLIPSE_DAY, looked),
				`${place.name}: curated ${place.timeZone} vs looked-up ${looked}`
			).toBe(offsetMinutes(ECLIPSE_DAY, place.timeZone));
		}
	});
});

describe('formatting times in a place, not in the browser', () => {
	it('shows Spanish totality in CEST regardless of the host zone', () => {
		const local = localCircumstances({ lat: 42.0096, lon: -4.5288, elevation: 740 });
		const zone = timeZoneFor(42.0096, -4.5288);
		// Spain is UTC+2 in August, so 18:29 UTC reads as 20:29 locally.
		expect(formatClock(local.c2!.time, zone)).toBe('20:29');
		expect(zoneAbbreviation(local.c2!.time, zone)).toMatch(/GMT\+2|CEST/);
	});

	it('shows the same instant differently in Iceland, which keeps UTC all year', () => {
		const local = localCircumstances({ lat: 64.1466, lon: -21.9426, elevation: 30 });
		const zone = timeZoneFor(64.1466, -21.9426);
		expect(offsetMinutes(ECLIPSE_DAY, zone)).toBe(0);
		expect(formatClock(local.max.time, zone)).toBe(local.max.time.toISOString().slice(11, 16));
	});

	it('gives Reykjavik and Palencia different clock times for their own maxima', () => {
		const iceland = localCircumstances({ lat: 64.1466, lon: -21.9426 });
		const spain = localCircumstances({ lat: 42.0096, lon: -4.5288 });
		const icelandClock = formatClock(iceland.max.time, timeZoneFor(64.1466, -21.9426));
		const spainClock = formatClock(spain.max.time, timeZoneFor(42.0096, -4.5288));
		expect(icelandClock).not.toBe(spainClock);
		// Iceland sees it around 17:49 local; Spain around 20:30 local.
		expect(icelandClock.startsWith('17')).toBe(true);
		expect(spainClock.startsWith('20')).toBe(true);
	});

	it('never throws on an unusable zone', () => {
		expect(formatClock(ECLIPSE_DAY, 'Not/AZone')).toBe('18:30');
		expect(zoneAbbreviation(ECLIPSE_DAY, 'Not/AZone')).toBe('');
	});
});

describe('describing a zone for display', () => {
	it('leaves ordinary names readable', () => {
		expect(describeTimeZone('Europe/Madrid')).toBe('Europe/Madrid');
		expect(describeTimeZone('America/New_York')).toBe('America/New York');
	});

	it('turns the POSIX-signed Etc zones into the offsets people expect', () => {
		// Etc/GMT+2 is two hours behind UTC, which reads backwards to most people.
		expect(describeTimeZone('Etc/GMT+2')).toBe('UTC-2');
		expect(describeTimeZone('Etc/GMT-3')).toBe('UTC+3');
		expect(describeTimeZone('Etc/GMT')).toBe('UTC');
	});
});
