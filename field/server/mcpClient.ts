import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "./config.ts";
import { INTERNAL_HEADER } from "./mcp.ts";

/**
 * The agent loop's MCP client. Voice (Agora) and text chat both discover and execute every tool
 * through FieldPilot's own /mcp endpoint — the same surface external MCP clients use.
 */
let url = `http://127.0.0.1:${config.port}/mcp`;
let client: Client | null = null;
let connecting: Promise<Client> | null = null;
let toolCache: { name: string; description?: string; inputSchema: Record<string, unknown> }[] | null = null;

export function setMcpUrl(u: string) {
  url = u;
  client = null;
  connecting = null;
  toolCache = null;
}

async function getClient() {
  if (client) return client;
  connecting ??= (async () => {
    const c = new Client({ name: "fieldpilot-agent", version: "2.0.0" });
    const t = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { [INTERNAL_HEADER]: config.llmProxySecret } } });
    await c.connect(t);
    client = c;
    return c;
  })().finally(() => (connecting = null));
  return connecting;
}

export async function mcpListTools() {
  if (toolCache) return toolCache;
  const c = await getClient();
  const { tools } = await c.listTools();
  toolCache = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> }));
  return toolCache;
}

/** OpenAI function-calling view of the MCP tool list. */
export async function mcpToolsForLlm() {
  return (await mcpListTools()).map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema } }));
}

export async function mcpCallTool(name: string, args: unknown, callId?: string): Promise<any> {
  const attempt = async () => {
    const c = await getClient();
    const r: any = await c.callTool({ name, arguments: (args ?? {}) as Record<string, unknown>, _meta: callId ? { callId } : undefined });
    if (r.structuredContent) return r.structuredContent;
    const text = r.content?.find((x: any) => x.type === "text")?.text;
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { result: text };
    }
  };
  try {
    return await attempt();
  } catch (e: any) {
    // Transport hiccup: reconnect once.
    client = null;
    try {
      return await attempt();
    } catch (e2: any) {
      return { error: `Tool gateway (MCP) unreachable: ${e2?.message ?? e?.message}` };
    }
  }
}
