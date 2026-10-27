// The artifact page runtime, inlined at the top of every published page.
//
// It gives the page `window.pi.use(name)`, the same shape as Claude's
// `window.claude.use(name)`. The page has no network (connect-src 'none'):
// every call goes over a MessagePort to the viewer page that frames it, which
// forwards it to the Worker and on to the chat's Durable Object. The contract
// is documented in runtime/runtime.d.ts.
(() => {
  "use strict";
  if (window.pi) return;

  const CONNECT_TIMEOUT_MS = 10_000;

  // The page says hello; the viewer page that frames it answers with one port, once.
  const session = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.type !== "pi:connect" || !event.ports || !event.ports[0]) return;
      finish({ port: event.ports[0], manifest: data.manifest || {} });
    });
    setTimeout(() => finish(null), CONNECT_TIMEOUT_MS);
    if (window.parent !== window) window.parent.postMessage({ type: "pi:hello" }, "*");
  });

  let mcp;
  function use(name) {
    if (name !== "mcp") return Promise.resolve(null);
    if (!mcp) mcp = session.then((s) => (s ? createMcp(s.port, s.manifest) : null));
    return mcp;
  }

  function mcpError(error) {
    const e = new Error(error.message || error.code);
    for (const key of ["code", "server", "retryable", "retryAfterMs", "result"]) {
      if (error[key] !== undefined) e[key] = error[key];
    }
    return e;
  }

  function badRequest(message) {
    return mcpError({ code: "bad_request", message });
  }

  function checkJson(input) {
    try {
      JSON.stringify(input);
      return true;
    } catch {
      return false;
    }
  }

  function createMcp(port, manifest) {
    let seq = 0;
    const pending = new Map();
    const watchers = new Map();
    const servers = (manifest.mcp && manifest.mcp.servers) || [];

    port.onmessage = (event) => {
      const message = event.data;
      if (!message) return;
      if (message.type === "reply") {
        const call = pending.get(message.id);
        if (!call) return;
        pending.delete(message.id);
        if (message.ok) call.resolve(message.value);
        else call.reject(mcpError(message.error));
      } else if (message.type === "watch") {
        const handler = watchers.get(message.watchId);
        if (!handler) return;
        const ev = message.event;
        try {
          handler(ev.type === "error" ? { type: "error", error: mcpError(ev.error) } : ev);
        } catch (err) {
          console.error(err);
        }
      }
    };

    function request(method, params) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        port.postMessage({ type: "request", id, method, params });
      });
    }

    function callTool(server, tool, input, options) {
      options = options || {};
      if (typeof server !== "string" || typeof tool !== "string") return Promise.reject(badRequest("server and tool must be strings"));
      if (!checkJson(input)) return Promise.reject(badRequest("input must be plain JSON"));
      const call = request("call", { server, tool, input: input === undefined ? {} : input, cache: options.cache });
      const signal = options.signal;
      if (!signal) return call;
      if (signal.aborted) return Promise.reject(mcpError({ code: "cancelled", message: "aborted" }));
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(mcpError({ code: "cancelled", message: "aborted" })), { once: true });
        call.then(resolve, reject);
      });
    }

    function watchTool(server, tool, input, handler, options) {
      if (typeof handler !== "function") throw new TypeError("watchTool needs a handler function");
      options = options || {};
      const watchId = ++seq;
      watchers.set(watchId, handler);
      if (typeof server !== "string" || typeof tool !== "string" || !checkJson(input)) {
        queueMicrotask(() => {
          if (watchers.has(watchId)) handler({ type: "error", error: badRequest("server and tool must be strings and input plain JSON") });
        });
        return () => watchers.delete(watchId);
      }
      port.postMessage({
        type: "watch",
        watchId,
        server,
        tool,
        input: input == null ? {} : input,
        refetchInterval: options.refetchInterval,
        staleTime: options.cache && options.cache.staleTime,
      });
      return () => {
        if (watchers.delete(watchId)) port.postMessage({ type: "unwatch", watchId });
      };
    }

    function invalidate(server, tool, input) {
      if (input !== undefined && (server === undefined || tool === undefined)) {
        return Promise.reject(badRequest("input needs server and tool"));
      }
      return request("invalidate", { server, tool, input });
    }

    function listTools(server) {
      const list = servers
        .filter((s) => server === undefined || s.server === server)
        .map((s) => ({ server: s.server, kind: "connector", authStatus: "connected", tools: s.tools.map((name) => ({ name, description: "" })) }));
      return Promise.resolve({ servers: list });
    }

    function describeTool(server, tool) {
      return request("describe", { server, tool });
    }

    function handle(name) {
      const entry = servers.find((s) => s.server === name);
      if (!entry) return null;
      const methods = {};
      for (const tool of entry.tools) {
        methods[tool] = (input, options) => callTool(name, tool, input, options).then((r) => (r.payload !== undefined ? r.payload : r));
      }
      return Object.freeze(methods);
    }

    function server(name) {
      const h = handle(name);
      return h ? Promise.resolve(h) : Promise.reject(mcpError({ code: "server_not_connected", server: name, message: `${name} is not declared by this page` }));
    }

    const namespace = { callTool, watchTool, invalidate, listTools, describeTool, server };
    // mcp.CoinGecko.execute(input): one property per declared server.
    for (const s of servers) {
      if (!(s.server in namespace)) namespace[s.server] = handle(s.server);
    }
    return Object.freeze(namespace);
  }

  Object.defineProperty(window, "pi", { value: Object.freeze({ use }), enumerable: true });
})();
