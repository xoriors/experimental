import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { ToolInfo } from "../../shared/protocol.ts";
import type { Connector, McpConnection, RawToolResult } from "./hub.ts";

const CALL_TIMEOUT_MS = 60_000;

/** Opens a Streamable HTTP session with the MCP SDK. Workers cannot run Ajv, so validation uses @cfworker/json-schema. */
export const connectStreamableHttp: Connector = async (server) => {
  const client = new Client(
    { name: "pi-artifacts", version: "0.1.0" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));

  const connection: McpConnection = {
    async listTools() {
      const tools: ToolInfo[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
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
      const result = await client.callTool(
        { name, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        { timeout: CALL_TIMEOUT_MS },
      );
      return result as RawToolResult;
    },
    close: () => client.close(),
  };
  return connection;
};
