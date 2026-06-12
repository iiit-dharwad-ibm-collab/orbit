import { getDbBackend, initTables, query } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/auth";

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");

  try {
    await initTables();
    let countResult;
    if (source) {
      countResult = await query("SELECT COUNT(*) as count FROM document_chunks WHERE source = $1", [source]);
    } else {
      countResult = await query("SELECT COUNT(*) as count FROM document_chunks");
    }

    return Response.json({
      total_chunks: parseInt(countResult[0]?.count || 0),
      ok: true,
      backend: getDbBackend(),
    });
  } catch (err) {
    return Response.json({ total_chunks: 0, ok: false, backend: getDbBackend(), error: err.message });
  }
}
