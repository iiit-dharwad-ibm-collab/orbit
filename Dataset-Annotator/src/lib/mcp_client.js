import { api } from "@/lib/api";

let nextId = 1;

// Minimal browser client for the app's own stateless MCP endpoint (JSON-RPC over POST).
export async function callTool(name, args = {}) {
  const res = await api("/api/mcp", {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "MCP error");
  const text = data.result?.content?.[0]?.text || "{}";
  if (data.result?.isError) {
    // Input validation failures come back as plain text, not JSON.
    let message = text;
    try { message = JSON.parse(text).error || text; } catch { /* plain text */ }
    throw new Error(message);
  }
  return JSON.parse(text);
}

export async function listTools() {
  const res = await api("/api/mcp", {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/list" }),
  });
  const data = await res.json();
  return data.result?.tools || [];
}
