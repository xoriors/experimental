import { describe, expect, it } from "vitest";
import type { ProxyRequest, ProxyResponse } from "../shared/protocol.ts";
import { ArtifactBroker } from "../src/artifact/broker.ts";

/** A broker on a fake clock, with a fake port standing in for the iframe's end. */
function setup(answer: (request: ProxyRequest, now: number) => ProxyResponse) {
  let now = 1_000_000;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextTimer = 0;
  const requests: ProxyRequest[] = [];
  const posted: any[] = [];
  const port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: (m: unknown) => posted.push(m), close() {} };

  const broker = new ArtifactBroker({
    artifactId: "abc12345",
    version: 1,
    cacheNamespace: "ann",
    transport: async (request) => {
      requests.push(request);
      return answer(request, now);
    },
    describe: async () => [],
    now: () => now,
    random: () => 0,
    setTimer: (fn, ms) => {
      const id = ++nextTimer;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  broker.connect(port as unknown as MessagePort);

  const send = (data: unknown) => port.onmessage!({ data });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Advance the clock, firing due timers in order. */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.fn();
      await flush();
    }
    now = end;
  };
  const events = (watchId: number) => posted.filter((m) => m.type === "watch" && m.watchId === watchId).map((m) => m.event);
  return { broker, send, flush, advance, requests, events, timers, clock: () => now };
}

const fresh = (now: number, staleMs = 30_000): ProxyResponse => ({
  ok: true,
  result: { content: [{ type: "text", text: "{}" }], payload: { at: now } },
  storedAt: now,
  nextRefreshAt: now + staleMs,
});

describe("ArtifactBroker watches", () => {
  it("fetches on registration, then polls just after the server's hint", async () => {
    const t = setup((_, now) => fresh(now));
    t.send({ type: "watch", watchId: 1, server: "CoinGecko", tool: "execute", input: { code: "x" }, refetchInterval: 30_000 });
    await t.flush();
    expect(t.requests).toEqual([{ version: 1, mode: "read", server: "CoinGecko", tool: "execute", input: { code: "x" }, staleMs: 30_000 }]);
    expect(t.events(1)).toHaveLength(1);

    await t.advance(30_000);
    expect(t.requests).toHaveLength(1); // the hint is +30 s, and the poll goes out 250 ms after it
    await t.advance(300);
    expect(t.requests).toHaveLength(2);
  });

  it("aligns to an older server copy instead of waiting a whole interval", async () => {
    // The Durable Object's copy was produced 20 s before this viewer asked.
    const t = setup((_, now) => ({ ...fresh(now - 20_000), result: { content: [], cache: { storedAt: now - 20_000, revalidating: false } } }));
    t.send({ type: "watch", watchId: 1, server: "S", tool: "t", input: {}, refetchInterval: 30_000 });
    await t.flush();
    await t.advance(10_300);
    expect(t.requests).toHaveLength(2);
  });

  it("clamps polling to 30 s and shares one request between identical watches", async () => {
    const t = setup((_, now) => fresh(now));
    t.send({ type: "watch", watchId: 1, server: "S", tool: "t", input: { a: 1, b: 2 }, refetchInterval: 1_000 });
    await t.flush();
    t.send({ type: "watch", watchId: 2, server: "S", tool: "t", input: { b: 2, a: 1 }, refetchInterval: 5_000 });
    await t.flush();
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].staleMs).toBe(30_000);
    expect(t.events(2)[0].result.cache.revalidating).toBe(false); // replayed from the first watch's result
  });

  it("pauses while hidden and catches up when visible", async () => {
    const t = setup((_, now) => fresh(now));
    t.send({ type: "watch", watchId: 1, server: "S", tool: "t", input: {}, refetchInterval: 30_000 });
    await t.flush();
    t.broker.setHidden(true);
    await t.advance(120_000);
    expect(t.requests).toHaveLength(1);
    t.broker.setHidden(false);
    await t.advance(0);
    expect(t.requests).toHaveLength(2);
  });

  it("retries a retryable error once, then falls back to the interval", async () => {
    const t = setup(() => ({ ok: false, error: { code: "server_unavailable", message: "down", retryable: true, retryAfterMs: 5_000 } }));
    t.send({ type: "watch", watchId: 1, server: "S", tool: "t", input: {}, refetchInterval: 30_000 });
    await t.flush();
    await t.advance(5_000);
    expect(t.requests).toHaveLength(2);
    await t.advance(29_000);
    expect(t.requests).toHaveLength(2);
    await t.advance(1_000);
    expect(t.requests).toHaveLength(3);
    expect(t.events(1).every((e: any) => e.type === "error")).toBe(true);
  });

  it("stops polling on a denial", async () => {
    const t = setup(() => ({ ok: false, error: { code: "not_in_manifest", message: "nope" } }));
    t.send({ type: "watch", watchId: 1, server: "S", tool: "t", input: {}, refetchInterval: 30_000 });
    await t.flush();
    await t.advance(300_000);
    expect(t.requests).toHaveLength(1);
    expect(t.timers).toHaveLength(0);
  });

  it("stops the timer when the last watcher leaves", async () => {
    const t = setup((_, now) => fresh(now));
    t.send({ type: "watch", watchId: 1, server: "S", tool: "t", input: {}, refetchInterval: 30_000 });
    await t.flush();
    t.send({ type: "unwatch", watchId: 1 });
    expect(t.timers).toHaveLength(0);
  });
});

describe("ArtifactBroker calls", () => {
  it("sends one-shot calls uncached and replies on the port", async () => {
    const t = setup((_, now) => fresh(now));
    t.send({ type: "request", id: 7, method: "call", params: { server: "S", tool: "t", input: { x: 1 } } });
    await t.flush();
    expect(t.requests[0]).toMatchObject({ mode: "call", staleMs: 0 });
  });
});
