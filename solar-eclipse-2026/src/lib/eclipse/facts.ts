/**
 * Headline numbers for the eclipse, all derived from the elements so that the
 * prose and the simulator can never disagree with each other.
 */

import { centralLinePoint, tToUtc, utcToT } from './besselian';
import { localCircumstances } from './local';

/** Greatest eclipse, from NASA's circumstances for this eclipse. */
export const GREATEST_ECLIPSE = new Date('2026-08-12T17:45:51Z');

/** When the umbra first touches and last leaves the Earth (computed). */
export const UMBRA_FIRST_CONTACT = new Date('2026-08-12T16:58:04Z');
export const UMBRA_LAST_CONTACT = new Date('2026-08-12T18:34:00Z');

/** When any partial eclipse is visible somewhere on Earth (computed P1 and P4). */
export const PARTIAL_FIRST_CONTACT = new Date('2026-08-12T15:35:05Z');
export const PARTIAL_LAST_CONTACT = new Date('2026-08-12T19:57:14Z');

export const ECLIPSE_FACTS = {
	saros: 126,
	/** Maximum duration of totality anywhere, seconds. */
	maxTotalitySeconds: 138.2,
	/** Path width at greatest eclipse, km. */
	pathWidthKm: 294,
	gamma: 0.8977,
	/** Moon's apparent diameter divided by the Sun's at greatest eclipse. */
	diameterRatio: 1.0386,
	greatestEclipseLat: 65.2,
	greatestEclipseLon: -25.2,
	greatestEclipseSunAltitude: 25.8
} as const;

/**
 * The centre line at a given UTC instant — used by the overview timeline to
 * describe where the shadow is at each stage.
 */
export function centreLineAt(utc: string) {
	const point = centralLinePoint(utcToT(new Date(utc)));
	return point;
}

export interface TimelineEntry {
	utc: Date;
	title: string;
	detail: string;
}

/** A narrative of the shadow's 96-minute run across the Earth. */
export function shadowTimeline(): TimelineEntry[] {
	const at = (iso: string) => {
		const t = utcToT(new Date(iso));
		const point = centralLinePoint(t);
		const local = point ? localCircumstances({ lat: point.lat, lon: point.lon }) : null;
		return { point, local, time: tToUtc(t) };
	};

	const iceland = at('2026-08-12T17:46:00Z');
	const spain = at('2026-08-12T18:29:00Z');
	const balearic = at('2026-08-12T18:31:30Z');

	return [
		{
			utc: UMBRA_FIRST_CONTACT,
			title: 'The shadow lands in the Arctic',
			detail:
				'The umbra first touches the Earth in the Arctic Ocean north of Siberia, with the Sun right on the horizon. It then races west and south across the pole.'
		},
		{
			utc: new Date('2026-08-12T17:20:00Z'),
			title: 'Across eastern Greenland',
			detail:
				'The shadow sweeps over the ice sheet and the uninhabited east coast, where the Sun is high enough for a long, dark totality but almost nobody is watching.'
		},
		{
			utc: iceland.time,
			title: 'Greatest eclipse, just off Iceland',
			detail: `The deepest point of the eclipse falls in the sea west of Iceland, with totality lasting ${ECLIPSE_FACTS.maxTotalitySeconds.toFixed(0)} seconds and the Sun ${ECLIPSE_FACTS.greatestEclipseSunAltitude}° up. Western Iceland is the only easily reachable land with the Sun still comfortably above the horizon.`
		},
		{
			utc: new Date('2026-08-12T18:00:00Z'),
			title: 'Out over the North Atlantic',
			detail:
				'For half an hour the umbra crosses open ocean, sinking towards the horizon as it goes and losing height on the sky with every minute.'
		},
		{
			utc: spain.time,
			title: 'Landfall in northern Spain',
			detail: `The shadow reaches Galicia and Asturias and crosses the whole peninsula in about six minutes. By now the Sun is only ${spain.local ? spain.local.max.altitude.toFixed(0) : '8'}° above the horizon, so a clear, low western view matters as much as clear sky overhead.`
		},
		{
			utc: balearic.time,
			title: 'Out over the Balearics and gone',
			detail:
				'Totality ends over the western Mediterranean with the Sun on the point of setting. For anyone on Mallorca or Ibiza the eclipsed Sun sets almost immediately afterwards.'
		},
		{
			utc: UMBRA_LAST_CONTACT,
			title: 'The umbra leaves the Earth',
			detail:
				'Ninety-six minutes after it arrived, the shadow slides off the globe near the coast of North Africa and the eclipse is over.'
		}
	];
}
