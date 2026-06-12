import path from "path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

let _db = null;
let _ready = false;

function getDbPath() {
  return process.env.SQLITE_PATH || path.join(process.cwd(), "dataset_generator.sqlite3");
}

function ensureDb() {
  if (_db) return _db;
  _db = new Database(getDbPath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("busy_timeout = 3000");
  sqliteVec.load(_db);
  return _db;
}

export function initSqliteVec() {
  if (_ready) return;
  const db = ensureDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_vector_map (
      chunk_id TEXT PRIMARY KEY,
      vec_rowid INTEGER NOT NULL UNIQUE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS document_chunk_vec USING vec0(
      embedding float[3072]
    );
  `);

  _ready = true;
}

export function upsertChunkVector(chunkId, vector) {
  initSqliteVec();
  const db = ensureDb();

  const existing = db.prepare("SELECT vec_rowid FROM chunk_vector_map WHERE chunk_id = ?").get(chunkId);
  if (existing?.vec_rowid) {
    db.prepare("DELETE FROM document_chunk_vec WHERE rowid = ?").run(existing.vec_rowid);
  }

  const insertVec = db.prepare("INSERT INTO document_chunk_vec(embedding) VALUES (?)");
  const result = insertVec.run(new Float32Array(vector));
  const rowid = Number(result.lastInsertRowid);

  db.prepare(
    `INSERT INTO chunk_vector_map (chunk_id, vec_rowid)
     VALUES (?, ?)
     ON CONFLICT(chunk_id) DO UPDATE SET vec_rowid = excluded.vec_rowid`
  ).run(chunkId, rowid);
}

export function removeChunkVectors(chunkIds) {
  if (!Array.isArray(chunkIds) || chunkIds.length === 0) return;
  initSqliteVec();
  const db = ensureDb();

  const selectMap = db.prepare("SELECT vec_rowid FROM chunk_vector_map WHERE chunk_id = ?");
  const delVec = db.prepare("DELETE FROM document_chunk_vec WHERE rowid = ?");
  const delMap = db.prepare("DELETE FROM chunk_vector_map WHERE chunk_id = ?");

  const tx = db.transaction((ids) => {
    for (const id of ids) {
      const row = selectMap.get(id);
      if (row?.vec_rowid) delVec.run(row.vec_rowid);
      delMap.run(id);
    }
  });

  tx(chunkIds);
}

export function removeVectorsByDocAndSource(docId, source) {
  initSqliteVec();
  const db = ensureDb();

  const rows = db
    .prepare("SELECT id FROM document_chunks WHERE doc_id = ? AND source = ?")
    .all(String(docId), source);

  removeChunkVectors(rows.map((r) => r.id));
}

export function searchVectors(vector, limit = 10) {
  initSqliteVec();
  const db = ensureDb();

  const rows = db
    .prepare(
      `SELECT m.chunk_id, v.distance
       FROM document_chunk_vec AS v
       JOIN chunk_vector_map AS m ON m.vec_rowid = v.rowid
       WHERE vec_distance_l2(v.embedding, ?) >= 0
       ORDER BY v.distance ASC
       LIMIT ?`
    )
    .all(new Float32Array(vector), Number(limit));

  return rows.map((r) => ({
    chunk_id: r.chunk_id,
    distance: Number(r.distance || 0),
    similarity: 1 / (1 + Number(r.distance || 0)),
  }));
}
