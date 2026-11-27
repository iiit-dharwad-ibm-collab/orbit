import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getUser, unauthorized } from "@/lib/auth";
import { createMcpServer } from "@/lib/mcp_server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stateless Streamable HTTP: a fresh server + transport per request, authenticated
// with the same Bearer JWT as the REST API.
async function handle(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  const server = createMcpServer(user);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // Responses are fully buffered in JSON mode, so it is safe to tear down.
    transport.close().catch(() => {});
    server.close().catch(() => {});
  }
}

export async function POST(request) {
  return handle(request);
}

export async function GET() {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this MCP server is stateless; use POST." }, id: null },
    { status: 405 }
  );
}

export async function DELETE() {
  return GET();
}
