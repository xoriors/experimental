import { Type } from "@earendil-works/pi-ai";
import { exports } from "cloudflare:workers";
import { defineExtension, defineTool, section, type Extension } from "@earendil-works/pi-durable";
import { createTwoFilesPatch } from "diff";
import type { ArtifactManifest, ArtifactMeta } from "../../shared/protocol.ts";
import { checkManifest, MAX_HTML_BYTES } from "../artifacts/manifest.ts";
import type { McpHub } from "../mcp/hub.ts";
import type { SandboxFile, SandboxRun } from "../sandbox.ts";
import type { ArtifactStore, UserFiles } from "../storage/index.ts";
import type { ToolInfo } from "../../shared/protocol.ts";

/** What the tools need from the chat they run in. */
export interface ChatScope {
  uid: string;
  chatId: string;
  hub: McpHub;
  artifacts: ArtifactStore;
  /** This chat's user's files: scoped to the uid and encrypted with that user's key. */
  files: () => Promise<UserFiles>;
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

/** What one MCP server told the chat about itself. */
export interface ServerCatalog {
  tools: ToolInfo[];
  instructions?: string;
}

/**
 * One pi tool per MCP tool, calling through the hub the artifacts also use.
 * The agent knows only what the servers say about themselves. Servers that
 * could not be listed (down, or the user has not signed in) are named in the
 * prompt with the reason, so the agent can tell the user.
 */
export function mcpExtension(hub: McpHub, catalog: Map<string, ServerCatalog>, unavailable = new Map<string, string>()): Extension {
  const tools = [];
  for (const [server, { tools: serverTools }] of catalog) {
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
  const servers = [...catalog.entries()].map(([name, { tools: serverTools, instructions }]) => {
    const list = serverTools.map((t) => `${t.name}${t.annotations?.readOnlyHint ? " (read-only)" : ""} — agent tool ${mcpToolName(name, t.name)}`);
    const about = instructions?.trim() ? `\n  Says about itself: ${instructions.trim().replace(/\s+/g, " ").slice(0, 1_500)}` : "";
    return `- "${name}"${about}\n  Tools: ${list.join("; ")}`;
  });
  return defineExtension({
    name: "mcp",
    tools,
    sections: [
      section("mcp_servers", () => {
        const connected =
          "MCP servers connected to this chat. Pages declare them by these exact names. Use the servers and tools the user names; " +
          "when they don't, pick by the tool descriptions. A server whose tools start with portal_ is a Cloudflare MCP portal: its " +
          "portal_* tools list the servers behind it and turn them on, and may answer with a link the user must open to sign in to one; " +
          `pass such links on as they are.\n${servers.join("\n")}`;
        if (unavailable.size === 0) return connected;
        const missing = [...unavailable].map(([name, reason]) => `- "${name}": ${reason}`);
        return `${connected}\n\nServers this chat cannot use right now. If the user asks for one, say why, and pass on any sign-in link exactly:\n${missing.join("\n")}`;
      }),
    ],
  });
}

export function filesExtension(scope: ChatScope): Extension {
  return defineExtension({
    name: "files",
    tools: [
      defineTool({
        name: "files_list",
        description: "List the user's files (uploads and files your scripts saved), with sizes.",
        parameters: Type.Object({ folder: Type.Optional(Type.String({ description: "Only files in this folder, e.g. uploads." })) }),
        replay: "safe",
        execute: async (args) => {
          const entries = await (await scope.files()).list(args.folder ?? "");
          const lines = entries.map((e) => `${e.path}\t${e.size} bytes`);
          return { output: text(lines.length ? lines.join("\n") : "No files.") };
        },
      }),
      defineTool({
        name: "files_read",
        description: "Read one of the user's files as UTF-8 text (first 100 KB).",
        parameters: Type.Object({ path: Type.String() }),
        replay: "safe",
        execute: async (args) => {
          const object = await (await scope.files()).get(args.path, { offset: 0, length: 100_000 });
          if (!object) throw new Error(`No file "${args.path}".`);
          return { output: text(clip(await object.text())) };
        },
      }),
      defineTool({
        name: "files_write",
        description: "Write a UTF-8 text file into the user's files, replacing any file at that path.",
        parameters: Type.Object({ path: Type.String(), content: Type.String() }),
        execute: async (args) => {
          await (await scope.files()).put(args.path, args.content, "text/plain; charset=utf-8");
          return { output: text(`Wrote ${args.path} (${args.content.length} characters).`) };
        },
      }),
    ],
  });
}

const SANDBOX_FILES =
  "Files you name are copied from the user's files into ./files/; anything written to ./out/ (top level, not subfolders) is saved back to the user's files under out/. " +
  "Each run starts with fresh ./files and ./out; other files under the working directory stay while the sandbox is up (10 minutes after the last run). " +
  "Returns exit code, stdout and stderr.";

/**
 * Copy the named user files in, run in this chat's sandbox, save ./out back to
 * the user's files. The files go through the user's UserFiles, so they are
 * decrypted on the way in and encrypted with the user's key on the way out.
 */
async function runInSandbox(scope: ChatScope, paths: string[] | undefined, run: (sandbox: ReturnType<typeof exports.Sandbox.getByName>, inputs: SandboxFile[]) => Promise<SandboxRun>) {
  const files = await scope.files();
  const inputs: SandboxFile[] = [];
  for (const path of paths ?? []) {
    const object = await files.get(path);
    if (!object) throw new Error(`No file "${path}".`);
    inputs.push({ name: path.split("/").pop()!, bytes: await object.arrayBuffer() });
  }
  const result = await run(exports.Sandbox.getByName(`${scope.uid}-${scope.chatId}`), inputs);
  const saved = [];
  for (const output of result.outputs) {
    await files.put(`out/${output.name}`, output.bytes);
    saved.push(`out/${output.name}`);
  }
  const report = [`exit code ${result.exitCode}`, `stdout:\n${result.stdout}`, result.stderr && `stderr:\n${result.stderr}`, saved.length && `saved: ${saved.join(", ")}`];
  return { output: text(clip(report.filter(Boolean).join("\n\n"))), isError: result.exitCode !== 0 };
}

const inputFiles = Type.Optional(Type.Array(Type.String(), { description: "Paths of the user's files to copy in." }));

export function sandboxExtension(scope: ChatScope): Extension {
  return defineExtension({
    name: "sandbox",
    tools: [
      defineTool({
        name: "run_python",
        description: `Run a Python 3.13 script (pandas and numpy installed) in this chat's isolated Linux sandbox: no internet, 60 s limit. ${SANDBOX_FILES}`,
        parameters: Type.Object({ code: Type.String(), files: inputFiles }),
        execute: async (args) => runInSandbox(scope, args.files, (sandbox, inputs) => sandbox.runPython(args.code, inputs)),
      }),
      defineTool({
        name: "run_bash",
        description:
          "Run a bash script in the same sandbox as run_python (Debian with coreutils, grep, sed, awk, tar, gzip, python3): no internet, so no package installs or downloads; 60 s limit. " +
          `Runs as written; start with set -e to stop at the first failing command. ${SANDBOX_FILES}`,
        parameters: Type.Object({ script: Type.String(), files: inputFiles }),
        execute: async (args) => runInSandbox(scope, args.files, (sandbox, inputs) => sandbox.runBash(args.script, inputs)),
      }),
    ],
  });
}

/** Check the declaration, store a new version and index it for the user. Throws with what to fix. */
export async function publishArtifact(
  scope: ChatScope,
  input: { title: string; html: string; artifactId?: string; mcp?: { server: string; tools: string[] }[]; message?: string },
): Promise<ArtifactMeta> {
  if (new TextEncoder().encode(input.html).byteLength > MAX_HTML_BYTES) throw new Error("The page is over 2 MB; summarise the data instead of inlining it.");
  const manifest: ArtifactManifest = input.mcp?.length ? { mcp: { servers: input.mcp } } : {};
  const problems = await checkManifest(scope.hub, manifest);
  if (problems.length) throw new Error(`Not published. Fix the mcp declaration:\n${problems.join("\n")}`);
  const meta = await scope.artifacts.publishVersion({
    id: input.artifactId,
    ownerUid: scope.uid,
    chatId: scope.chatId,
    title: input.title,
    html: input.html,
    manifest,
    message: input.message,
  });
  await scope.onPublished({ id: meta.id, title: meta.title, latest: meta.latest, updatedAt: meta.updatedAt });
  return meta;
}

/** An artifact this chat published. Anything else reads as missing. */
async function ownArtifact(scope: ChatScope, id: string): Promise<ArtifactMeta> {
  const meta = await scope.artifacts.readMeta(id);
  if (!meta || meta.chatId !== scope.chatId || meta.ownerUid !== scope.uid) throw new Error(`No artifact ${id} in this chat.`);
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
          message: Type.Optional(
            Type.String({ description: "One line on what this version changes, e.g. \"Add a 7-day sparkline\". It becomes the version's commit message." }),
          ),
          mcp: Type.Optional(
            Type.Array(Type.Object({ server: Type.String(), tools: Type.Array(Type.String()) }), {
              description: 'e.g. [{"server": "CoinGecko", "tools": ["execute"]}]',
            }),
          ),
        }),
        execute: async (args) => {
          const meta = await publishArtifact(scope, { title: args.title, html: args.html, artifactId: args.artifact_id, mcp: args.mcp, message: args.message });
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
          const meta = await ownArtifact(scope, args.artifact_id);
          const version = args.version ?? meta.latest;
          const html = await scope.artifacts.readHtml(meta.id, version);
          if (html === null) throw new Error(`Artifact ${meta.id} has no version ${version}.`);
          const declared = JSON.stringify(meta.versions.find((v) => v.version === version)?.manifest ?? {});
          return { output: text(`Version ${version} of ${meta.latest}, manifest ${declared}:\n\n${html}`) };
        },
      }),
      defineTool({
        name: "artifact_history",
        description: "List the versions of an artifact published in this chat: when each was published and what it changed.",
        parameters: Type.Object({ artifact_id: Type.String() }),
        replay: "safe",
        execute: async (args) => {
          const meta = await ownArtifact(scope, args.artifact_id);
          const lines = meta.versions.map((v) => `v${v.version}  ${new Date(v.publishedAt).toISOString()}  ${v.message ?? "(no message)"}`);
          return { output: text(`"${meta.title}", ${meta.latest} versions, newest last:\n${lines.join("\n")}`) };
        },
      }),
      defineTool({
        name: "artifact_diff",
        description: "Show what changed in an artifact's page between two versions, as a unified diff. Defaults to the latest version against the one before.",
        parameters: Type.Object({ artifact_id: Type.String(), from: Type.Optional(Type.Number()), to: Type.Optional(Type.Number()) }),
        replay: "safe",
        execute: async (args) => {
          const meta = await ownArtifact(scope, args.artifact_id);
          const to = args.to ?? meta.latest;
          const from = args.from ?? to - 1;
          const [before, after] = await Promise.all([scope.artifacts.readHtml(meta.id, from), scope.artifacts.readHtml(meta.id, to)]);
          if (before === null || after === null) throw new Error(`Artifact ${meta.id} has versions 1 to ${meta.latest}.`);
          const patch = createTwoFilesPatch(`v${from}/index.html`, `v${to}/index.html`, before, after, undefined, undefined, { context: 3 });
          return { output: text(clip(patch)) };
        },
      }),
    ],
  });
}
