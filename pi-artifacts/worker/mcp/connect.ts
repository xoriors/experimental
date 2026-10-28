import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { ToolInfo } from "../../shared/protocol.ts";
import { McpFailure, type McpConnection, type RawToolResult } from "./hub.ts";
import type { McpServerConfig } from "./servers.ts";

const CALL_TIMEOUT_MS = 60_000;

/**
 * The failure a page or the agent sees when the user has not signed in to a
 * server, or their sign-in expired. `signInUrl` is a link in this app that
 * starts the sign-in; the agent passes it on to the user.
 */
export function signInRequired(server: string, signInUrl?: string): McpFailure {
  const how = signInUrl ? ` To sign in, open ${signInUrl} then ask again.` : "";
  return new McpFailure({ code: "auth_required", server, message: `Not signed in to ${server}.${how}` });
}

/**
 * Opens a Streamable HTTP session with the MCP SDK. Workers cannot run Ajv, so
 * validation uses @cfworker/json-schema. With `authProvider`, the SDK adds the
 * user's token to every request and refreshes it when it expires.
 */
export async function connectStreamableHttp(server: McpServerConfig, authProvider?: OAuthClientProvider, options: { signInUrl?: string } = {}): Promise<McpConnection> {
  // The SDK reports a missing or rejected sign-in as UnauthorizedError; everything else passes through.
  const signedIn = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw error instanceof UnauthorizedError ? signInRequired(server.name, options.signInUrl) : error;
    }
  };
  const client = new Client(
    { name: "pi-artifacts", version: "0.1.0" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  await signedIn(() => client.connect(new StreamableHTTPClientTransport(new URL(server.url), { authProvider })));

  const connection: McpConnection = {
    instructions: client.getInstructions(),
    async listTools() {
      const tools: ToolInfo[] = [];
      let cursor: string | undefined;
      do {
        const page = await signedIn(() => client.listTools(cursor ? { cursor } : undefined));
        for (const tool of page.tools) {
          tools.push({
            name: tool.name,
            description: tool.description ?? "",
            annotations: tool.annotations
              ? { readOnlyHint: tool.annotations.readOnlyHint, destructiveHint: tool.annotations.destructiveHint }
              : undefined,
            inputSchema: tool.inputSchema,
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    },
    async callTool(name, args) {
      const result = await signedIn(() =>
        client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> }, undefined, { timeout: CALL_TIMEOUT_MS }),
      );
      return result as RawToolResult;
    },
    close: () => client.close(),
  };
  return connection;
}
