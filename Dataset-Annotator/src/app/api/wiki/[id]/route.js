import { getDbBackend, initTables, query, queryOne } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/auth";
import { removeVectorsByDocAndSource } from "@/lib/sqlite_vec";

export async function GET(request, { params }) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  await initTables();

  const { id } = await params;
  const doc = await queryOne("SELECT * FROM wiki_documents WHERE id = $1", [id]);
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(doc);
}

export async function DELETE(request, { params }) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    await initTables();

    const { id } = await params;
    try {
      if (getDbBackend() === "sqlite") removeVectorsByDocAndSource(String(id), "wiki");
    } catch (vecErr) {
      console.warn("sqlite-vec cleanup skipped:", vecErr.message);
    }
    await query("DELETE FROM document_chunks WHERE doc_id = $1 AND source = 'wiki'", [String(id)]);
    await query("DELETE FROM wiki_documents WHERE id = $1", [id]);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Wiki delete error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
