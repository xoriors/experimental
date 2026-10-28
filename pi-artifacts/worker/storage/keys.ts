/**
 * Each user's files are encrypted at rest with their own key (R2 SSE-C).
 * The key is derived, never stored: HKDF-SHA-256 over one master secret,
 * with the uid as context. Reading an object with another user's key fails
 * inside R2, so a mistake in a prefix can't turn into a leak.
 */
export async function deriveUserKey(masterSecret: string, uid: string): Promise<ArrayBuffer> {
  const ikm = decodeMaster(masterSecret);
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("pi-artifacts/user-files/v1"), info: new TextEncoder().encode(uid) },
    base,
    256,
  );
}

/** The master secret is 32+ random bytes, base64-encoded. */
function decodeMaster(secret: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(secret.trim()), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("FILES_MASTER_KEY is not valid base64.");
  }
  if (bytes.byteLength < 32) throw new Error("FILES_MASTER_KEY must be at least 32 random bytes.");
  return bytes;
}
