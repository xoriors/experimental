/**
 * Turn a caller's path into a safe relative path inside a user's folder, or
 * throw. R2 keys are literal strings, so ".." could never climb out of a
 * prefix, but rejecting anything unusual keeps keys predictable and stops
 * look-alike names.
 */
export function normalisePath(path: string, { allowEmpty = false } = {}): string {
  if (typeof path !== "string") throw new PathError("Path must be a string.");
  const nfc = path.normalize("NFC").trim();
  if (nfc === "") {
    if (allowEmpty) return "";
    throw new PathError("Path is empty.");
  }
  if (nfc.length > 200) throw new PathError("Path is longer than 200 characters.");
  if (!/^[A-Za-z0-9 ._\-/]+$/.test(nfc)) {
    throw new PathError(`Invalid path "${path}": use letters, digits, spaces, . - _ and /.`);
  }
  if (nfc.startsWith("/")) throw new PathError(`Invalid path "${path}": it must be relative.`);
  const segments = nfc.split("/");
  const last = segments.length - 1;
  for (const [i, segment] of segments.entries()) {
    // A trailing slash (an empty last segment) names a folder, as a list prefix does.
    if (segment === "" && !(i === last && allowEmpty)) throw new PathError(`Invalid path "${path}": empty path segment.`);
    if (segment === "." || segment === "..") throw new PathError(`Invalid path "${path}": "." and ".." are not allowed.`);
  }
  return nfc;
}

export class PathError extends Error {}
