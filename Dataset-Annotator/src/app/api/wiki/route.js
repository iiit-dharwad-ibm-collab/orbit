import { getDbBackend, initTables, query, queryOne } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/auth";
import { chunkText } from "@/lib/chunker";
import { embedBatch, embeddingToDbValue } from "@/lib/embeddings";
import { removeVectorsByDocAndSource, upsertChunkVector } from "@/lib/sqlite_vec";

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  await initTables();

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search");

  let docs;
  if (search?.trim()) {
    const pattern = `%${search.trim()}%`;
    docs = await query(
      `SELECT id, title, tags, source_ref, added_by, added_at, updated_at, LENGTH(content_text) as content_length
       FROM wiki_documents
       WHERE title ILIKE $1 OR tags ILIKE $1 OR content_text ILIKE $1
       ORDER BY updated_at DESC`,
      [pattern]
    );
  } else {
    docs = await query(
      `SELECT id, title, tags, source_ref, added_by, added_at, updated_at, LENGTH(content_text) as content_length
       FROM wiki_documents ORDER BY updated_at DESC`
    );
  }

  return Response.json(docs);
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    await initTables();
    const body = await request.json();
    const { title, tags = "", source_ref = "", content_text, embed_model, embed_provider } = body;

    if (!title?.trim() || !content_text?.trim()) {
      return Response.json({ error: "Title and content required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const truncated = content_text.slice(0, 120_000);

    const result = await query(
      `INSERT INTO wiki_documents (title, tags, source_ref, content_text, added_by, added_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [title.trim(), tags.trim(), source_ref.trim(), truncated, user.sub, now, now]
    );
    const wikiId = result[0].id;

    // Auto-embed into pgvector
    let chunksStored = 0;
    try {
      const backend = getDbBackend();
      const chunks = chunkText(truncated, title.trim());
      if (chunks.length > 0) {
        const embeddings = await embedBatch(chunks, {
          model: embed_model,
          provider: embed_provider,
        });
        const prefix = `wiki_${wikiId}`;

        // Delete old chunks
        try {
          if (backend === "sqlite") removeVectorsByDocAndSource(String(wikiId), "wiki");
        } catch (vecErr) {
          console.warn("sqlite-vec cleanup skipped:", vecErr.message);
        }
        await query("DELETE FROM document_chunks WHERE doc_id = $1 AND source = $2", [String(wikiId), "wiki"]);

        // Insert new
        for (let i = 0; i < chunks.length; i++) {
          if (!embeddings[i]) continue;
          const chunkId = `${prefix}_chunk_${i}`;
          const meta = JSON.stringify({ wiki_id: wikiId });

          await query(
            `INSERT INTO document_chunks (id, doc_id, source, title, tags, chunk_index, content, embedding, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata`,
            [
              chunkId,
              String(wikiId),
              "wiki",
              title.trim(),
              tags.trim(),
              i,
              chunks[i],
              embeddingToDbValue(embeddings[i], backend),
              meta,
            ]
          );
          try {
            if (backend === "sqlite") upsertChunkVector(chunkId, embeddings[i]);
          } catch (vecErr) {
            // vec0 index insert failed — chunk is still stored in document_chunks
          }
          chunksStored++;
        }
      }
    } catch (embedErr) {
      console.error("Embedding error:", embedErr);
    }

    return Response.json({ id: wikiId, chunks: chunksStored }, { status: 201 });
  } catch (err) {
    console.error("Wiki create error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
