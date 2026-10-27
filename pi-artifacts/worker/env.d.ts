// cloudflare.config.ts binds these Durable Objects by Worker name (they live in
// this same Worker), so the generated Env types them as untyped namespaces.
// Narrow them to their classes for typed RPC.
declare namespace Cloudflare {
  interface Env {
    CHAT: DurableObjectNamespace<import("./chat-agent.ts").ChatAgent>;
    USERS: DurableObjectNamespace<import("./users.ts").UserDirectory>;
    SANDBOX: DurableObjectNamespace<import("./sandbox.ts").Sandbox>;
  }
}
