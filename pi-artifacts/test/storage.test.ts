import { describe, expect, it } from "vitest";
import { deriveUserKey } from "../worker/storage/keys.ts";
import { normalisePath, PathError } from "../worker/storage/paths.ts";
import { UserFiles } from "../worker/storage/user-files.ts";

const MASTER = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

describe("normalisePath", () => {
  it("accepts ordinary relative paths", () => {
    expect(normalisePath("uploads/prices.csv")).toBe("uploads/prices.csv");
    expect(normalisePath("out/report v2.json")).toBe("out/report v2.json");
  });

  it.each([
    ["../bob/files/secret.txt"],
    ["uploads/../../bob"],
    ["./a"],
    ["/users/bob/files/a"],
    ["uploads//a"],
    ["%2e%2e/bob"],
    ["uploads\\..\\bob"],
    ["uploads/ａ.txt"], // full-width letter
    ["a\u0000b"],
    ["x".repeat(201)],
    [""],
  ])("rejects %j", (path) => {
    expect(() => normalisePath(path)).toThrow(PathError);
  });

  it("allows an empty folder only when asked", () => {
    expect(normalisePath("", { allowEmpty: true })).toBe("");
    expect(normalisePath("uploads/", { allowEmpty: true })).toBe("uploads/");
  });
});

describe("deriveUserKey", () => {
  it("gives each user a different, stable 256-bit key", async () => {
    const ada1 = new Uint8Array(await deriveUserKey(MASTER, "ada"));
    const ada2 = new Uint8Array(await deriveUserKey(MASTER, "ada"));
    const bob = new Uint8Array(await deriveUserKey(MASTER, "bob"));
    expect(ada1.byteLength).toBe(32);
    expect(ada1).toEqual(ada2);
    expect(ada1).not.toEqual(bob);
  });

  it("refuses a short master secret", async () => {
    await expect(deriveUserKey(Buffer.from("short").toString("base64"), "ada")).rejects.toThrow("32 random bytes");
  });
});

/** Records what UserFiles asks of R2. */
function fakeBucket(objects: string[] = []) {
  const calls: { op: string; key?: string; prefix?: string; ssecKey?: unknown }[] = [];
  const bucket = {
    list: async (o: { prefix: string }) => {
      calls.push({ op: "list", prefix: o.prefix });
      return { objects: objects.filter((k) => k.startsWith(o.prefix)).map((key) => ({ key, size: 1, uploaded: new Date(0) })), truncated: false };
    },
    get: async (key: string, o: { ssecKey: unknown }) => {
      calls.push({ op: "get", key, ssecKey: o.ssecKey });
      return null;
    },
    put: async (key: string, _body: unknown, o: { ssecKey: unknown }) => {
      calls.push({ op: "put", key, ssecKey: o.ssecKey });
    },
  };
  return { bucket: bucket as unknown as R2Bucket, calls };
}

describe("UserFiles", () => {
  it("builds every key under the user's own folder and sends the user's key", async () => {
    const key = await deriveUserKey(MASTER, "ada");
    const { bucket, calls } = fakeBucket();
    const files = new UserFiles(bucket, "ada", key);
    await files.put("uploads/a.csv", "x");
    await files.get("uploads/a.csv");
    expect(calls).toEqual([
      { op: "put", key: "users/ada/files/uploads/a.csv", ssecKey: key },
      { op: "get", key: "users/ada/files/uploads/a.csv", ssecKey: key },
    ]);
  });

  it("cannot be steered into another user's folder", async () => {
    const { bucket, calls } = fakeBucket();
    const files = new UserFiles(bucket, "ada", await deriveUserKey(MASTER, "ada"));
    for (const path of ["../bob/files/a", "/users/bob/files/a", "uploads/../../bob/files/a"]) {
      await expect(files.get(path)).rejects.toThrow(PathError);
      await expect(files.put(path, "x")).rejects.toThrow(PathError);
    }
    expect(calls).toHaveLength(0);
  });

  it("lists only the user's folder, even when another uid starts with the same letters", async () => {
    const { bucket, calls } = fakeBucket(["users/ada/files/a.txt", "users/adam/files/secret.txt", "users/ada/files/uploads/b.txt"]);
    const files = new UserFiles(bucket, "ada", await deriveUserKey(MASTER, "ada"));
    expect((await files.list()).map((e) => e.path)).toEqual(["a.txt", "uploads/b.txt"]);
    expect((await files.list("uploads")).map((e) => e.path)).toEqual(["uploads/b.txt"]);
    expect(calls.map((c) => c.prefix)).toEqual(["users/ada/files/", "users/ada/files/uploads/"]);
  });
});
