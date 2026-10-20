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

