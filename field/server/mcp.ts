import type { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { executeTool, jsonSchemaFor, tools } from "./tools.ts";
import { sessions } from "./session.ts";
import { config } from "./config.ts";

/**
 * MCP server (Streamable HTTP, stateless) at /mcp — the ONLY way tools are executed.
 * FieldPilot's own agent loop (voice + text) is an MCP client of this server; so is any external client
 * (MCP Inspector, Claude Desktop, Agora llm.mcp_servers). Same tools, same guardrails, same live console.
 *
 * Origin: requests carrying the internal agent header are treated as the voice agent (subject to the
 * explicit-yes check); everything else is an external MCP client.
 */
export const INTERNAL_HEADER = "x-fieldpilot-agent";

function buildServer(origin: "agent" | "mcp") {
  const server = new Server({ name: "fieldpilot-enterprise", version: "2.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => {
      const risk = typeof t.risk === "function" ? "medium+" : t.risk;
      return {
        name: t.name,
        title: t.label,
        description: `[${t.system} · ${t.kind}${t.kind === "write" ? ` · risk ${risk}` : ""}] ${t.description}`,
        inputSchema: jsonSchemaFor(t) as any,
        annotations: {
          title: t.label,
          readOnlyHint: t.kind === "read",
          destructiveHint: t.kind === "write" && risk !== "low",
          idempotentHint: t.kind === "read",
          openWorldHint: false,
        },
      };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const callId = typeof req.params._meta?.callId === "string" ? (req.params._meta.callId as string) : undefined;
    const result = await executeTool(req.params.name, req.params.arguments ?? {}, { session: sessions.current(), origin, callId });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result && typeof result === "object" && !Array.isArray(result) ? result : undefined,
      isError: Boolean(result?.error),
    };
  });
  return server;
}

export async function handleMcp(req: Request, res: Response) {
  const origin = req.headers[INTERNAL_HEADER] === config.llmProxySecret ? "agent" : "mcp";
  const server = buildServer(origin);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req as any, res as any, req.body);
}
