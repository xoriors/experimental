// tz-lookup ships no types. This has to live in a file with no top-level
// import or export, otherwise TypeScript reads it as a module augmentation of
// an already-typed module rather than a declaration for an untyped one.
declare module 'tz-lookup' {
	/** Returns the IANA time zone name covering a latitude/longitude. */
	export default function tzlookup(latitude: number, longitude: number): string;
}
