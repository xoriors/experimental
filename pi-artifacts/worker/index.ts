import { exports } from "cloudflare:workers";
import { ID_PATTERN, UID_PATTERN, type ProxyRequest } from "../shared/protocol.ts";
import { artifactResponse } from "./artifacts/serve.ts";
import { newId, readHtml, readMeta } from "./artifacts/store.ts";

export { ChatAgent } from "./chat-agent.ts";
export { Sandbox } from "./sandbox.ts";
export { UserDirectory } from "./users.ts";

const COOKIE = "pi_uid";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      return json({ error: "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const uid = readUid(request);

  // The artifact page itself. Served to anyone with the link, framed by the viewer.
  const page = path.match(/^\/u\/([a-z0-9]+)\/v(\d+)$/);
  if (page && method === "GET") {
    const html = ID_PATTERN.test(page[1]) ? await readHtml(env.FILES, page[1], Number(page[2])) : null;
    return html === null ? new Response("Not found", { status: 404 }) : artifactResponse(html);
  }

  if (path === "/api/session" && method === "POST") {
    const { name } = await request.json<{ name?: string }>();
    const slug = String(name ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    if (!UID_PATTERN.test(slug)) return json({ error: "Pick a name of 2–32 letters or digits." }, 400);
    return json({ uid: slug }, 200, { "set-cookie": cookie(url, slug, 60 * 60 * 24 * 365) });
  }
  if (path === "/api/session" && method === "DELETE") {
    return json({}, 200, { "set-cookie": cookie(url, "", 0) });
  }
  if (path === "/api/me" && method === "GET") {
    return uid ? json({ uid }) : json({ error: "Not signed in" }, 401);
  }

  // Artifact metadata and the MCP proxy: open to any viewer with the link, signed in or not.
  const artifact = path.match(/^\/api\/artifacts\/([a-z0-9]+)(\/mcp|\/tools)?$/);
  if (artifact && ID_PATTERN.test(artifact[1])) {
    const meta = await readMeta(env.FILES, artifact[1]);
    if (!meta) return json({ error: "No such artifact" }, 404);
    const chat = exports.ChatAgent.getByName(`${meta.ownerUid}:${meta.chatId}`);
    if (!artifact[2] && method === "GET") {
      const { chatId: _chatId, ...visible } = meta;
      return json({ ...visible, isOwner: uid === meta.ownerUid });
    }
    if (artifact[2] === "/tools" && method === "GET") {
      return json(await chat.artifactTools(meta.id, Number(url.searchParams.get("version"))));
    }
    if (artifact[2] === "/mcp" && method === "POST") {
      const body = await request.json<ProxyRequest>();
      if (typeof body?.server !== "string" || typeof body.tool !== "string" || !Number.isInteger(body.version) || !["read", "call"].includes(body.mode)) {
        return json({ ok: false, error: { code: "bad_request", message: "Expected {version, mode, server, tool, input}." } }, 400);
      }
      return json(await chat.artifactCall({ artifactId: meta.id, viewer: uid ?? "anonymous", request: body }));
    }
  }

  if (!uid) return json({ error: "Not signed in" }, 401);
  const directory = exports.UserDirectory.getByName(uid);

  if (path === "/api/chats" && method === "GET") return json(await directory.listChats());
  if (path === "/api/chats" && method === "POST") return json(await directory.createChat(newId()));
  if (path === "/api/artifacts" && method === "GET") return json(await directory.listArtifacts());

  const socket = path.match(/^\/api\/chats\/([a-z0-9]+)\/ws$/);
  if (socket) {
    if (request.headers.get("upgrade") !== "websocket") return json({ error: "Expected a WebSocket upgrade" }, 426);
    if (!ID_PATTERN.test(socket[1]) || !(await directory.hasChat(socket[1]))) return json({ error: "No such chat" }, 404);
    return exports.ChatAgent.getByName(`${uid}:${socket[1]}`).fetch(request);
  }

  // Publish a page without the model, to try the live-data path locally. Set DEV_TOOLS=true in .dev.vars.
  const devPublish = path.match(/^\/api\/dev\/chats\/([a-z0-9]+)\/publish$/);
  if (devPublish && method === "POST" && env.DEV_TOOLS === "true") {
    if (!(await directory.hasChat(devPublish[1]))) return json({ error: "No such chat" }, 404);
    try {
      return json(await exports.ChatAgent.getByName(`${uid}:${devPublish[1]}`).devPublish(await request.json()));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (path === "/api/files" && method === "GET") {
    const prefix = `users/${uid}/files/`;
    const listing = await env.FILES.list({ prefix, limit: 500 });
    return json(listing.objects.map((o) => ({ path: o.key.slice(prefix.length), size: o.size, uploaded: o.uploaded })));
  }
  if (path === "/api/files" && method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Expected a file field" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: "Files are limited to 10 MB" }, 413);
    const name = file.name.replace(/[^\w .-]/g, "_").replace(/^\.+/, "").slice(0, 120) || "upload";
    await env.FILES.put(`users/${uid}/files/uploads/${name}`, file.stream(), { httpMetadata: { contentType: file.type } });
    return json({ path: `uploads/${name}` });
  }

  return json({ error: "Not found" }, 404);
}

function readUid(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match && UID_PATTERN.test(match[1]) ? match[1] : undefined;
}

function cookie(url: URL, value: string, maxAge: number): string {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}
