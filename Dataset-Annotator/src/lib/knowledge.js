import { getDbBackend, initTables, query, queryOne } from "@/lib/db";
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

function toHit(row, score) {
  return {
    doc_id: row.doc_id,
    title: row.title || "",
    tags: row.tags || "",
    chunk: row.content || "",
    score: Math.round(score * 10000) / 10000,
    chunk_index: row.chunk_index || 0,
    source: row.source || "wiki",
    ...parseMetadata(row.metadata),
  };
}

// Semantic search over document_chunks; shared by /api/vectors/search and the MCP server.
export async function searchKnowledge({
  query: searchQuery,
  n_results = 5,
  source_filter = null,
  min_score = 0,
  embed_model,
  embed_provider,
}) {
  await initTables();
  const queryVec = await embedText(searchQuery.trim(), {
    model: embed_model,
    provider: embed_provider,
  });

  if (getDbBackend() === "postgres") {
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
    return rows
      .map((row) => toHit(row, parseFloat(row.similarity || 0)))
      .filter((h) => h.score >= min_score);
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

    const item = toHit(row, c.similarity);
    if (item.score >= min_score) {
      hits.push(item);
    }
    if (hits.length >= n_results) break;
  }

  return hits;
}
