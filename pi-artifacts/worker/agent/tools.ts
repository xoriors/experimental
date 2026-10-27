import { Type } from "@earendil-works/pi-ai";
import { exports } from "cloudflare:workers";
import { defineExtension, defineTool, section, type Extension } from "@earendil-works/pi-durable";
import type { ArtifactManifest, ArtifactMeta } from "../../shared/protocol.ts";
import { checkManifest, MAX_HTML_BYTES, publishVersion, readHtml, readMeta } from "../artifacts/store.ts";
import type { McpHub } from "../mcp/hub.ts";
import type { ToolInfo } from "../../shared/protocol.ts";

/** What the tools need from the chat they run in. */
export interface ChatScope {
  uid: string;
  chatId: string;
  env: Env;
  hub: McpHub;
  onPublished(artifact: { id: string; title: string; latest: number; updatedAt: number }): Promise<void>;
}

const MAX_TOOL_TEXT = 16_000;

const text = (value: string) => [{ type: "text" as const, text: value }];

function clip(value: string): string {
  return value.length <= MAX_TOOL_TEXT ? value : `${value.slice(0, MAX_TOOL_TEXT)}\n… [${value.length - MAX_TOOL_TEXT} more characters cut]`;
}

/** Tool names the providers accept: the server's name as a slug, then the MCP tool's name. */
export function mcpToolName(server: string, tool: string): string {
  return `${server.toLowerCase().replace(/[^a-z0-9]+/g, "_")}__${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 64);
}

/** One pi tool per MCP tool, calling through the hub the artifacts also use. */
export function mcpExtension(hub: McpHub, catalog: Map<string, ToolInfo[]>): Extension {
  const tools = [];
  for (const [server, serverTools] of catalog) {
    for (const tool of serverTools) {
      const readOnly = tool.annotations?.readOnlyHint === true;
      tools.push(
        defineTool({
          name: mcpToolName(server, tool.name),
          description: `[MCP server "${server}", tool "${tool.name}"${readOnly ? ", read-only" : ""}] ${tool.description}`,
          parameters: Type.Unsafe<Record<string, unknown>>((tool.inputSchema as object) ?? { type: "object" }),
          replay: readOnly ? "safe" : "unsafe",
          execute: async (args) => {
            const result = await hub.call(server, tool.name, args);
            const payload = result.payload ?? result.content;
            return { output: text(clip(typeof payload === "string" ? payload : JSON.stringify(payload, null, 1))) };
          },
        }),
      );
    }
  }
  const servers = [...catalog.entries()].map(([name, serverTools]) => {
    const config = hub.servers().find((s) => s.name === name);
    const list = serverTools.map((t) => `${t.name}${t.annotations?.readOnlyHint ? " (read-only)" : ""} — agent tool ${mcpToolName(name, t.name)}`);
    return `- "${name}": ${config?.description ?? ""}\n  Tools: ${list.join("; ")}`;
  });
  return defineExtension({
    name: "mcp",
    tools,
    sections: [section("mcp_servers", () => `MCP servers connected to this chat. Pages declare them by these exact names:\n${servers.join("\n")}`)],
  });
}

const PATH = /^(?!\/)(?!.*\.\.)[\w .\-/]{1,200}$/;

function filesKey(scope: ChatScope, path: string): string {
  if (!PATH.test(path)) throw new Error(`Invalid path "${path}": use letters, digits, spaces, . - _ and /, no leading / or "..".`);
  return `users/${scope.uid}/files/${path}`;
}

export function filesExtension(scope: ChatScope): Extension {
  const prefix = `users/${scope.uid}/files/`;
  return defineExtension({
    name: "files",
    tools: [
      defineTool({
        name: "files_list",
        description: "List the user's files (uploads and files your scripts saved), with sizes.",
        parameters: Type.Object({ prefix: Type.Optional(Type.String({ description: "Only paths starting with this." })) }),
        replay: "safe",
        execute: async (args) => {
          const listing = await scope.env.FILES.list({ prefix: prefix + (args.prefix ?? ""), limit: 500 });
          const lines = listing.objects.map((o) => `${o.key.slice(prefix.length)}\t${o.size} bytes`);
          return { output: text(lines.length ? lines.join("\n") : "No files.") };
        },
      }),
      defineTool({
        name: "files_read",
        description: "Read one of the user's files as UTF-8 text (first 100 KB).",
        parameters: Type.Object({ path: Type.String() }),
        replay: "safe",
        execute: async (args) => {
          const object = await scope.env.FILES.get(filesKey(scope, args.path), { range: { offset: 0, length: 100_000 } });
          if (!object) throw new Error(`No file "${args.path}".`);
          return { output: text(clip(await object.text())) };
        },
      }),
      defineTool({
        name: "files_write",
        description: "Write a UTF-8 text file into the user's files, replacing any file at that path.",
        parameters: Type.Object({ path: Type.String(), content: Type.String() }),
        execute: async (args) => {
          await scope.env.FILES.put(filesKey(scope, args.path), args.content);
          return { output: text(`Wrote ${args.path} (${args.content.length} characters).`) };
        },
      }),
    ],
  });
}

export function sandboxExtension(scope: ChatScope): Extension {
  return defineExtension({
    name: "sandbox",
    tools: [
      defineTool({
        name: "run_python",
        description:
          "Run a Python 3.13 script (pandas and numpy installed) in an isolated Linux sandbox with no internet, 60 s limit. " +
          "Files you name are copied from the user's files into ./files/; anything the script writes to ./out/ is saved back to the user's files under out/. " +
          "Returns exit code, stdout and stderr.",
        parameters: Type.Object({
          code: Type.String(),
          files: Type.Optional(Type.Array(Type.String(), { description: "Paths of the user's files to copy in." })),
        }),
        execute: async (args) => {
          const inputs = [];
          for (const path of args.files ?? []) {
            const object = await scope.env.FILES.get(filesKey(scope, path));
            if (!object) throw new Error(`No file "${path}".`);
            inputs.push({ name: path.split("/").pop()!, bytes: await object.arrayBuffer() });
          }
          const sandbox = exports.Sandbox.getByName(`${scope.uid}-${scope.chatId}`);
          const run = await sandbox.runPython(args.code, inputs);
          const saved = [];
          for (const output of run.outputs) {
            await scope.env.FILES.put(filesKey(scope, `out/${output.name}`), output.bytes);
            saved.push(`out/${output.name}`);
          }
          const report = [`exit code ${run.exitCode}`, `stdout:\n${run.stdout}`, run.stderr && `stderr:\n${run.stderr}`, saved.length && `saved: ${saved.join(", ")}`];
          return { output: text(clip(report.filter(Boolean).join("\n\n"))), isError: run.exitCode !== 0 };
        },
      }),
    ],
  });
}

/** Check the declaration, store a new version and index it for the user. Throws with what to fix. */
export async function publishArtifact(
  scope: ChatScope,
  input: { title: string; html: string; artifactId?: string; mcp?: { server: string; tools: string[] }[] },
): Promise<ArtifactMeta> {
  if (new TextEncoder().encode(input.html).byteLength > MAX_HTML_BYTES) throw new Error("The page is over 2 MB; summarise the data instead of inlining it.");
  const manifest: ArtifactManifest = input.mcp?.length ? { mcp: { servers: input.mcp } } : {};
  const problems = await checkManifest(scope.hub, manifest);
  if (problems.length) throw new Error(`Not published. Fix the mcp declaration:\n${problems.join("\n")}`);
  const meta = await publishVersion(scope.env.FILES, {
    id: input.artifactId,
    ownerUid: scope.uid,
    chatId: scope.chatId,
    title: input.title,
    html: input.html,
    manifest,
  });
  await scope.onPublished({ id: meta.id, title: meta.title, latest: meta.latest, updatedAt: meta.updatedAt });
  return meta;
}

export function artifactExtension(scope: ChatScope): Extension {
  return defineExtension({
    name: "artifacts",
    tools: [
      defineTool({
        name: "artifact_publish",
        description:
          "Publish an HTML page as an artifact the user sees in the preview panel. Pass artifact_id to publish a new version of an artifact " +
          "you published in this chat; omit it to create a new one. Declare in `mcp` every server and tool the page calls; the page can call nothing else.",
        parameters: Type.Object({
          title: Type.String({ description: "Two to five words." }),
          html: Type.String({ description: "The page: a full HTML document, or a body fragment." }),
          artifact_id: Type.Optional(Type.String()),
          mcp: Type.Optional(
            Type.Array(Type.Object({ server: Type.String(), tools: Type.Array(Type.String()) }), {
              description: 'e.g. [{"server": "CoinGecko", "tools": ["execute"]}]',
            }),
          ),
        }),
        execute: async (args) => {
          const meta = await publishArtifact(scope, { title: args.title, html: args.html, artifactId: args.artifact_id, mcp: args.mcp });
          return {
            output: text(`Published artifact ${meta.id} version ${meta.latest} ("${meta.title}"). The user now sees it in the preview panel.`),
            details: { artifactId: meta.id, version: meta.latest, title: meta.title },
          };
        },
      }),
      defineTool({
        name: "artifact_read",
        description: "Read the HTML of an artifact published in this chat, to revise it.",
        parameters: Type.Object({ artifact_id: Type.String(), version: Type.Optional(Type.Number()) }),
        replay: "safe",
        execute: async (args) => {
          const meta = await readMeta(scope.env.FILES, args.artifact_id);
          if (!meta || meta.chatId !== scope.chatId || meta.ownerUid !== scope.uid) throw new Error(`No artifact ${args.artifact_id} in this chat.`);
          const version = args.version ?? meta.latest;
          const html = await readHtml(scope.env.FILES, meta.id, version);
          if (html === null) throw new Error(`Artifact ${meta.id} has no version ${version}.`);
          const declared = JSON.stringify(meta.versions.find((v) => v.version === version)?.manifest ?? {});
          return { output: text(`Version ${version} of ${meta.latest}, manifest ${declared}:\n\n${html}`) };
        },
      }),
    ],
  });
}
