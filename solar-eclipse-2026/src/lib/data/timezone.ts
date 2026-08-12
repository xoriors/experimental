/**
 * Which time zone applies at a given point on Earth.
 *
 * The simulator has to show contact times in the local time of the place being
 * simulated, not of the browser: someone in California planning a trip to
 * Palencia needs to read "20:29 CEST", and someone comparing Reykjavík with
 * Valencia needs each in its own zone. Deriving the zone from the coordinates
 * means it can never fall out of step with the position, however that position
 * was chosen — search, map click, geolocation or typed latitude and longitude.
 */

import tzlookup from 'tz-lookup';

/**
 * IANA time zone for a position. Falls back to UTC rather than throwing, so a
 * point in the middle of an ocean or an out-of-range coordinate still renders.
 */
export function timeZoneFor(lat: number, lon: number): string {
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'UTC';
	try {
		// tz-lookup wants latitude in [-90, 90] and longitude in [-180, 180].
		const clampedLat = Math.max(-90, Math.min(90, lat));
		const wrappedLon = ((((lon + 180) % 360) + 360) % 360) - 180;
		return tzlookup(clampedLat, wrappedLon);
	} catch {
		return 'UTC';
	}
}

/**
 * A readable form of an IANA name for display: "Europe/Madrid" reads better as
 * "Europe/Madrid", but the Etc/GMT zones used out at sea are clearer as an
 * offset than as a name nobody recognises.
 */
export function describeTimeZone(timeZone: string): string {
	if (timeZone.startsWith('Etc/GMT')) {
		// Etc/GMT+2 is two hours *behind* UTC, which trips people up, so state it
		// the way the rest of the world writes offsets.
		const sign = timeZone.includes('+') ? '-' : '+';
		const hours = timeZone.replace(/^Etc\/GMT[+-]?/, '');
		return hours === '' || hours === '0' ? 'UTC' : `UTC${sign}${hours}`;
	}
	return timeZone.replace(/_/g, ' ');
}
