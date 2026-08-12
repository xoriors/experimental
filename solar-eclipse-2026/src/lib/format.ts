/** Small formatting helpers shared by the tables, panels and simulator. */

export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '—';
	const total = Math.round(seconds);
	const minutes = Math.floor(total / 60);
	const rest = total % 60;
	if (minutes === 0) return `${rest}s`;
	return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

export function formatClock(date: Date, timeZone: string, withSeconds = false): string {
	const options: Intl.DateTimeFormatOptions = {
		hour: '2-digit',
		minute: '2-digit',
		...(withSeconds ? { second: '2-digit' } : {}),
		hour12: false,
		timeZone
	};
	try {
		return new Intl.DateTimeFormat('en-GB', options).format(date);
	} catch {
		// An unknown zone would otherwise throw and blank the whole panel.
		return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date);
	}
}

/**
 * Short name of the zone at that instant — "CEST", "GMT+1" — so a local time is
 * never ambiguous about which zone it is in. Depends on the date because of
 * summer time.
 */
export function zoneAbbreviation(date: Date, timeZone: string): string {
	try {
		const parts = new Intl.DateTimeFormat('en-GB', {
			timeZone,
			timeZoneName: 'short'
		}).formatToParts(date);
		return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
	} catch {
		return '';
	}
}

export function formatUtc(date: Date, withSeconds = true): string {
	return date.toISOString().slice(11, withSeconds ? 19 : 16);
}

export function formatPercent(value: number, digits = 1): string {
	return `${(value * 100).toFixed(digits)}%`;
}

export function formatDegrees(value: number, digits = 1): string {
	return `${value.toFixed(digits)}°`;
}

/** Compass point for an azimuth in degrees. */
export function compass(azimuth: number): string {
	const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
	return points[Math.round(((azimuth % 360) + 360) % 360 / 22.5) % 16];
}

export function formatCoordinate(lat: number, lon: number): string {
	const ns = lat >= 0 ? 'N' : 'S';
	const ew = lon >= 0 ? 'E' : 'W';
	return `${Math.abs(lat).toFixed(3)}°${ns}, ${Math.abs(lon).toFixed(3)}°${ew}`;
}

/** Break a span of milliseconds into days/hours/minutes/seconds. */
export function countdownParts(ms: number) {
	const clamped = Math.max(0, ms);
	const totalSeconds = Math.floor(clamped / 1000);
	return {
		days: Math.floor(totalSeconds / 86400),
		hours: Math.floor((totalSeconds % 86400) / 3600),
		minutes: Math.floor((totalSeconds % 3600) / 60),
		seconds: totalSeconds % 60,
		expired: clamped <= 0
	};
}
