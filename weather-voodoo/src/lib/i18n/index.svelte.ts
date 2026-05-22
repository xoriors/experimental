import { en, type Dict } from './en';
import { th } from './th';
import { ro } from './ro';

export type Locale = 'en' | 'th' | 'ro';
export const LOCALES: Locale[] = ['en', 'th', 'ro'];
export const LOCALE_NAMES: Record<Locale, string> = {
	en: 'English',
	th: 'ไทย',
	ro: 'Română'
};

export function isLocale(x: unknown): x is Locale {
	return x === 'en' || x === 'th' || x === 'ro';
}

const DICTS: Record<Locale, Dict> = { en, th, ro };

export const i18n = $state<{ locale: Locale }>({ locale: 'en' });

export function setLocale(l: Locale): void {
	i18n.locale = l;
}

function lookup(dict: Dict, key: string): string | undefined {
	const parts = key.split('.');
	let cur: unknown = dict;
	for (const p of parts) {
		if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
			cur = (cur as Record<string, unknown>)[p];
		} else {
			return undefined;
		}
	}
	return typeof cur === 'string' ? cur : undefined;
}

function format(s: string, vars?: Record<string, string | number>): string {
	if (!vars) return s;
	return s.replace(/\{(\w+)\}/g, (_, k) => {
		const v = vars[k];
		return v === undefined || v === null ? '' : String(v);
	});
}

export function t(key: string, vars?: Record<string, string | number>): string {
	const value = lookup(DICTS[i18n.locale], key) ?? lookup(en, key) ?? key;
	return format(value, vars);
}
