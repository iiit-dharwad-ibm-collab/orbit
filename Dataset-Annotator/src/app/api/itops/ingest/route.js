import fs from "fs/promises";
import path from "path";
import { getUser, unauthorized } from "@/lib/auth";
import { chunkText } from "@/lib/chunker";
import { embedBatch, embeddingToDbValue } from "@/lib/embeddings";
import { extractTextFromHtml } from "@/lib/doc_parser";
import { getDbBackend, initTables, query, queryOne } from "@/lib/db";
import { removeVectorsByDocAndSource, upsertChunkVector } from "@/lib/sqlite_vec";

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDocsRoot() {
  const candidates = [
    process.env.ITOPSGRAPH_DOCS_PATH,
    path.resolve(process.cwd(), "itopsgraph_docs"),
    path.resolve(process.cwd(), "../itopsgraph_docs"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function toSafeFilePath(rootPath, relativePath) {
  const full = path.resolve(rootPath, relativePath);
  if (!full.startsWith(rootPath)) {
    throw new Error(`Invalid path: ${relativePath}`);
  }
  return full;
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    await initTables();

    const body = await request.json();
    const {
      files = [],
      tags = "itopsgraph_docs",
      embed_model,
      embed_provider,
    } = body || {};

    if (!Array.isArray(files) || files.length === 0) {
      return Response.json({ error: "files array is required" }, { status: 400 });
    }

    const docsRoot = await resolveDocsRoot();
    if (!docsRoot) {
      return Response.json({ error: "itopsgraph_docs folder not found" }, { status: 404 });
    }

    const backend = getDbBackend();
    const now = new Date().toISOString();

    let processedFiles = 0;
    let chunksStored = 0;
    const failed = [];

    for (const relativeFile of files) {
      try {
        const absPath = toSafeFilePath(docsRoot, relativeFile);
        const html = await fs.readFile(absPath, "utf8");
        const title = path.basename(relativeFile, ".html").replaceAll("_", " ");
        const normalizedRef = `itopsgraph_docs/${relativeFile.replaceAll(path.sep, "/")}`;

        const text = extractTextFromHtml(html, title).slice(0, 200_000);
        if (!text.trim()) {
          failed.push({ file: relativeFile, error: "No extractable text" });
          continue;
        }

        const existing = await queryOne("SELECT id FROM wiki_documents WHERE source_ref = $1", [normalizedRef]);
        let docId;

        if (existing?.id) {
          docId = existing.id;
          await query(
            `UPDATE wiki_documents
             SET title = $1, tags = $2, content_text = $3, updated_at = $4
             WHERE id = $5`,
            [title, tags, text, now, docId]
          );
        } else {
          const inserted = await query(
            `INSERT INTO wiki_documents (title, tags, source_ref, content_text, added_by, added_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [title, tags, normalizedRef, text, user.sub, now, now]
          );
          docId = inserted[0].id;
        }

        const chunks = chunkText(text, title);
        const vectors = await embedBatch(chunks, {
          model: embed_model,
          provider: embed_provider,
        });

        try {
          if (backend === "sqlite") removeVectorsByDocAndSource(String(docId), "itopsgraph_docs");
        } catch (vecErr) {
          console.warn("sqlite-vec cleanup skipped:", vecErr.message);
        }
        await query(
          "DELETE FROM document_chunks WHERE doc_id = $1 AND source = $2",
          [String(docId), "itopsgraph_docs"]
        );

        for (let i = 0; i < chunks.length; i++) {
          const vec = vectors[i];
          if (!vec) continue;

          const chunkId = `itops_${docId}_chunk_${i}`;
          const metadata = JSON.stringify({
            wiki_id: docId,
            source_file: normalizedRef,
            embed_model: embed_model || null,
            embed_provider: embed_provider || null,
          });

          await query(
            `INSERT INTO document_chunks (id, doc_id, source, title, tags, chunk_index, content, embedding, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE
             SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata`,
            [
              chunkId,
              String(docId),
              "itopsgraph_docs",
              title,
              tags,
              i,
              chunks[i],
              embeddingToDbValue(vec, backend),
              metadata,
            ]
          );
          try {
            if (backend === "sqlite") upsertChunkVector(chunkId, vec);
          } catch (vecErr) {
            // vec0 index insert failed — chunk is still stored in document_chunks
          }
          chunksStored += 1;
        }

        processedFiles += 1;
      } catch (err) {
        failed.push({ file: relativeFile, error: err.message });
      }
    }

    return Response.json({
      ok: true,
      processed_files: processedFiles,
      requested_files: files.length,
      chunks_stored: chunksStored,
      failed,
      backend,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
