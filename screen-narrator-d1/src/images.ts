export interface ParsedDataUrl {
	mediaType: string;
	/** Base64, without the `data:…;base64,` prefix. */
	data: string;
}

/** Split a `data:<type>;base64,<data>` URL. Null when it isn't one. */
export function parseDataUrl(url: string): ParsedDataUrl | null {
	const m = /^data:([\w.+/-]+);base64,(.+)$/s.exec(url);
	return m ? { mediaType: m[1]!, data: m[2]! } : null;
}

/** PNG bytes (e.g. a Pair.before / after file) as a `data:image/png;base64,…` URL. */
export const pngBytesDataUrl = (png: Buffer): string => `data:image/png;base64,${png.toString("base64")}`;

/**
 * Liquid's image tokens: 1.5 per 32×32 patch, rounded up per image. The docs say images are charged again for every
 * question, but measured `usage.input_tokens` counts them once per request (see the dry-run estimate in run.ts).
 */
export const imageTokens = (width: number, height: number): number => Math.ceil(Math.ceil(width / 32) * Math.ceil(height / 32) * 1.5);
