import { beforeEach, describe, expect, it } from "vitest";
import { AccessError, resetAccessKeyCache, verifyAccessJwt } from "../worker/auth/access.ts";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag-123";
const NOW = 1_800_000_000_000;

const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes).toString("base64url");

async function keyPair(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid };
  return { privateKey: pair.privateKey, jwk };
}

async function sign(privateKey: CryptoKey, claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }) {
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(claims));
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(signature)}`;
}

const good = { iss: `https://${TEAM}`, aud: [AUD], sub: "user-1", email: "ada@example.com", exp: NOW / 1000 + 600, iat: NOW / 1000 };

describe("verifyAccessJwt", () => {
  beforeEach(() => resetAccessKeyCache());

  it("accepts a token Access signed for this application", async () => {
    const { privateKey, jwk } = await keyPair("k1");
    const token = await sign(privateKey, good);
    const claims = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, now: () => NOW, fetchKeys: async () => [jwk] });
    expect(claims).toEqual({ sub: "user-1", email: "ada@example.com" });
  });

  const rejects = async (claims: Record<string, unknown>, header?: Record<string, unknown>) => {
    const { privateKey, jwk } = await keyPair("k1");
    const token = await sign(privateKey, claims, header);
    return expect(verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, now: () => NOW, fetchKeys: async () => [jwk] })).rejects.toBeInstanceOf(AccessError);
  };

  it("rejects another application's audience", () => rejects({ ...good, aud: ["someone-else"] }));
  it("rejects another team's issuer", () => rejects({ ...good, iss: "https://evil.cloudflareaccess.com" }));
  it("rejects an expired token", () => rejects({ ...good, exp: NOW / 1000 - 3600 }));
  it("rejects a token without a subject", () => rejects({ ...good, sub: undefined }));
  it("rejects alg none", () => rejects(good, { alg: "none", kid: "k1" }));
  it("rejects HS256", () => rejects(good, { alg: "HS256", kid: "k1" }));

  it("rejects a token signed by a key Access does not publish", async () => {
    const { privateKey } = await keyPair("k1");
    const { jwk: published } = await keyPair("k1");
    const token = await sign(privateKey, good);
    await expect(verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, now: () => NOW, fetchKeys: async () => [published] })).rejects.toThrow(
      "Bad signature",
    );
  });

  it("rejects a tampered payload", async () => {
    const { privateKey, jwk } = await keyPair("k1");
    const [head, , sig] = (await sign(privateKey, good)).split(".");
    const forged = `${head}.${b64url(JSON.stringify({ ...good, sub: "admin" }))}.${sig}`;
    await expect(verifyAccessJwt(forged, { teamDomain: TEAM, aud: AUD, now: () => NOW, fetchKeys: async () => [jwk] })).rejects.toThrow(
      "Bad signature",
    );
  });

  it("refetches the keys once when Access has rotated them", async () => {
    const old = await keyPair("old");
    const rotated = await keyPair("new");
    let fetches = 0;
    const fetchKeys = async () => (++fetches === 1 ? [old.jwk] : [rotated.jwk]);
    const config = { teamDomain: TEAM, aud: AUD, now: () => NOW, fetchKeys };
    await verifyAccessJwt(await sign(old.privateKey, good, { alg: "RS256", kid: "old" }), config);
    await verifyAccessJwt(await sign(rotated.privateKey, good, { alg: "RS256", kid: "new" }), config);
    expect(fetches).toBe(2);
  });
});
