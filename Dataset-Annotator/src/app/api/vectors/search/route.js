import { getDbBackend, initTables, query, queryOne } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/auth";
import { embedText } from "@/lib/embeddings";
import { searchVectors } from "@/lib/sqlite_vec";

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return {};
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    await initTables();
    const {
      query: searchQuery,
      n_results = 5,
      source_filter = null,
      min_score = 0,
      embed_model,
      embed_provider,
    } = await request.json();
    if (!searchQuery?.trim()) {
      return Response.json({ error: "Query required" }, { status: 400 });
    }

    const backend = getDbBackend();
    const queryVec = await embedText(searchQuery.trim(), {
      model: embed_model,
      provider: embed_provider,
    });

    if (backend === "postgres") {
      const vecStr = `[${queryVec.join(",")}]`;

      let sql = `
        SELECT id, doc_id, source, title, tags, chunk_index, content, metadata,
               1 - (embedding <=> $1::vector) AS similarity
        FROM document_chunks
      `;
      const params = [vecStr];

      if (source_filter) {
        sql += ` WHERE source = $2`;
        params.push(source_filter);
      }

      sql += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length + 1}`;
      params.push(n_results);

      const rows = await query(sql, params);

      const hits = rows
        .map((row) => ({
          doc_id: row.doc_id,
          title: row.title || "",
          tags: row.tags || "",
          chunk: row.content || "",
          score: Math.round(parseFloat(row.similarity || 0) * 10000) / 10000,
          chunk_index: row.chunk_index || 0,
          source: row.source || "wiki",
          ...parseMetadata(row.metadata),
        }))
        .filter((h) => h.score >= min_score);

      return Response.json(hits);
    }

    const candidates = searchVectors(queryVec, Math.max(Number(n_results || 5) * 4, 20));
    const hits = [];

    for (const c of candidates) {
      const row = await queryOne(
        "SELECT id, doc_id, source, title, tags, chunk_index, content, metadata FROM document_chunks WHERE id = $1",
        [c.chunk_id]
      );
      if (!row) continue;
      if (source_filter && row.source !== source_filter) continue;

      const item = {
        doc_id: row.doc_id,
        title: row.title || "",
        tags: row.tags || "",
        chunk: row.content || "",
        score: Math.round(c.similarity * 10000) / 10000,
        chunk_index: row.chunk_index || 0,
        source: row.source || "wiki",
        ...parseMetadata(row.metadata),
      };
      if (item.score >= min_score) {
        hits.push(item);
      }
      if (hits.length >= n_results) break;
    }

    return Response.json(hits);
  } catch (err) {
    console.error("Search error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
