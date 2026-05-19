import type { Activity, FusedHour, Verdict } from './types';

type HourShape = {
	tempC: number;
	windKn: number;
	gustKn: number;
	rainMmH: number;
	precipMmH: number;
	pop: number;
	waveHsM: number | null;
	visKm: number;
	uv?: number;
	cloudPct: number;
};

type Rule = { when: (h: HourShape) => boolean; verdict: Verdict };

const verdictRank: Record<Verdict, number> = { good: 3, ok: 2, poor: 1, unsafe: 0 };

export const rules: Record<Activity, Rule[]> = {
	swimming: [
		{ when: (h) => (h.waveHsM ?? 0) > 0.8 || h.tempC < 16, verdict: 'unsafe' },
		{ when: (h) => h.tempC < 20 || h.precipMmH > 1 || h.gustKn > 22, verdict: 'poor' },
		{ when: (h) => h.tempC >= 23 && h.windKn < 12 && h.precipMmH < 0.3, verdict: 'good' }
	],
	sunbathing: [
		{ when: (h) => h.precipMmH > 0.5 || h.cloudPct > 80, verdict: 'poor' },
		{ when: (h) => (h.uv ?? 0) >= 9, verdict: 'poor' },
		{ when: (h) => h.cloudPct < 40 && h.precipMmH < 0.1 && h.tempC >= 22, verdict: 'good' }
	],
	hiking: [
		{ when: (h) => h.precipMmH > 5 || h.gustKn > 35 || h.visKm < 1, verdict: 'unsafe' },
		{ when: (h) => h.precipMmH > 2 || h.windKn > 25 || h.tempC > 32 || h.tempC < 0, verdict: 'poor' },
		{ when: (h) => h.precipMmH < 0.5 && h.windKn < 18 && h.visKm > 5 && h.tempC >= 10 && h.tempC <= 28, verdict: 'good' }
	],
	kayaking: [
		{ when: (h) => (h.waveHsM ?? 0) > 1 || h.gustKn > 22, verdict: 'unsafe' },
		{ when: (h) => (h.waveHsM ?? 0) > 0.6 || h.windKn > 15 || h.precipMmH > 3, verdict: 'poor' },
		{ when: (h) => (h.waveHsM ?? 0) < 0.5 && h.windKn < 12 && h.precipMmH < 1, verdict: 'good' }
	],
	ferryOrBoat: [
		{ when: (h) => (h.waveHsM ?? 0) > 2.5 || h.gustKn > 35, verdict: 'unsafe' },
		{ when: (h) => (h.waveHsM ?? 0) > 1.5 || h.gustKn > 28 || h.visKm < 1, verdict: 'poor' },
		{ when: (h) => (h.waveHsM ?? 0) < 1 && h.gustKn < 22 && h.visKm > 3, verdict: 'good' }
	],
	photography: [
		{ when: (h) => h.precipMmH > 2 || h.visKm < 3, verdict: 'poor' },
		{ when: (h) => h.visKm > 10 && h.cloudPct >= 20 && h.cloudPct <= 70, verdict: 'good' }
	],
	sightseeing: [
		{ when: (h) => h.precipMmH > 5 || h.gustKn > 35, verdict: 'unsafe' },
		{ when: (h) => h.precipMmH > 2 || h.windKn > 20, verdict: 'poor' },
		{ when: (h) => h.precipMmH < 0.5 && h.windKn < 18 && h.visKm > 3, verdict: 'good' }
	]
};

export function scoreHour(h: FusedHour): Record<Activity, Verdict> {
	const shape: HourShape = {
		tempC: h.tempC,
		windKn: h.windKn,
		gustKn: h.gustKn,
		rainMmH: h.rainMmH,
		precipMmH: h.precipMmH,
		pop: h.pop,
		waveHsM: h.waveHsM,
		visKm: h.visKm,
		uv: h.uv,
		cloudPct: h.cloudPct
	};

	const out = {} as Record<Activity, Verdict>;
	for (const [activity, ruleSet] of Object.entries(rules) as [Activity, Rule[]][]) {
		let verdict: Verdict = 'ok';
		for (const r of ruleSet) {
			if (!r.when(shape)) continue;
			if (r.verdict === 'unsafe') {
				verdict = 'unsafe';
			} else if (r.verdict === 'poor' && verdict !== 'unsafe') {
				verdict = 'poor';
			} else if (r.verdict === 'good' && verdict === 'ok') {
				verdict = 'good';
			}
		}
		out[activity] = verdict;
	}
	return out;
}

const LABELS: Record<Activity, string> = {
	swimming: 'swimming',
	sunbathing: 'sunbathing',
	hiking: 'hiking',
	kayaking: 'kayaking',
	ferryOrBoat: 'ferry/boat trips',
	photography: 'photography',
	sightseeing: 'sightseeing'
};

export function summariseHour(h: FusedHour): string {
	const verdicts = scoreHour(h);
	const good: string[] = [];
	const avoid: string[] = [];
	for (const [a, v] of Object.entries(verdicts) as [Activity, Verdict][]) {
		if (v === 'good') good.push(LABELS[a]);
		else if (v === 'unsafe' || v === 'poor') avoid.push(LABELS[a]);
	}
	const parts: string[] = [];
	if (good.length) parts.push(`Good for ${good.join(', ')}.`);
	if (avoid.length) parts.push(`Avoid ${avoid.slice(0, 3).join(', ')}.`);
	if (!parts.length) parts.push('Mixed conditions.');
	return parts.join(' ');
}
