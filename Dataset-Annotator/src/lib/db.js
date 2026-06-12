import path from "path";
import { neon } from "@neondatabase/serverless";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

let _backend = null;
let _sql = null;
let _sqlite = null;

function resolveBackend() {
  if (_backend) return _backend;
  _backend = process.env.DATABASE_URL ? "postgres" : "sqlite";
  return _backend;
}

export function getDbBackend() {
  return resolveBackend();
}

export function getSQL() {
  if (resolveBackend() !== "postgres") {
    throw new Error("Neon SQL client is unavailable in sqlite fallback mode");
  }
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

async function getSQLite() {
  if (_sqlite) return _sqlite;
  const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), "dataset_generator.sqlite3");
  _sqlite = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });
  await _sqlite.exec("PRAGMA foreign_keys = ON");
  await _sqlite.exec("PRAGMA journal_mode = WAL");
  await _sqlite.exec("PRAGMA busy_timeout = 3000");
  return _sqlite;
}

function convertPgParamsToSqlite(text, params) {
  const values = [];
  const sql = text.replace(/\$(\d+)/g, (_, indexStr) => {
    const index = Number.parseInt(indexStr, 10) - 1;
    values.push(params[index]);
    return "?";
  });
  return { sql, values };
}

function normalizeSqlForSqlite(text) {
  return text
    .replace(/\bILIKE\b/gi, "LIKE")
    .replace(/::vector/gi, "")
    .replace(/::jsonb/gi, "")
    .replace(/\bTIMESTAMPTZ\b/gi, "TEXT")
    .replace(/\bSERIAL\s+PRIMARY\s+KEY\b/gi, "INTEGER PRIMARY KEY AUTOINCREMENT")
    .replace(/\bDEFAULT\s+NOW\(\)/gi, "DEFAULT CURRENT_TIMESTAMP")
    .replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP");
}

async function queryPostgres(text, params) {
  const sql = getSQL();
  const parts = text.split(/\$(\d+)/);
  const strings = [];
  const values = [];

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      strings.push(parts[i]);
    } else {
      values.push(params[Number.parseInt(parts[i], 10) - 1]);
    }
  }

  const templateStrings = Object.assign([...strings], { raw: [...strings] });
  Object.freeze(templateStrings);
  return sql(templateStrings, ...values);
}

async function querySqlite(text, params) {
  const db = await getSQLite();
  const normalized = normalizeSqlForSqlite(text);
  const { sql, values } = convertPgParamsToSqlite(normalized, params);
  const isReadQuery = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);
  const hasReturning = /\bRETURNING\b/i.test(sql);

  if (isReadQuery || hasReturning) {
    return db.all(sql, values);
  }

  await db.run(sql, values);
  return [];
}

export async function query(text, params = []) {
  return resolveBackend() === "postgres"
    ? queryPostgres(text, params)
    : querySqlite(text, params);
}

export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function initTables() {
  if (resolveBackend() === "postgres") {
    const sql = getSQL();

    await sql`CREATE EXTENSION IF NOT EXISTS vector`;

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS dataset_examples (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        account_label TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'itops_reasoning',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS dataset_states (
        id SERIAL PRIMARY KEY,
        example_id INTEGER NOT NULL REFERENCES dataset_examples(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        reasoning_trace TEXT,
        ai_conclusion TEXT,
        change_note TEXT,
        modified_by TEXT NOT NULL,
        modified_at TEXT NOT NULL,
        model_name TEXT,
        concept_coverage TEXT DEFAULT '[]',
        UNIQUE(example_id, version)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS grounding_sources (
        id SERIAL PRIMARY KEY,
        example_id INTEGER NOT NULL REFERENCES dataset_examples(id) ON DELETE CASCADE,
        state_id INTEGER NOT NULL REFERENCES dataset_states(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_name TEXT,
        source_ref TEXT,
        source_text TEXT,
        added_by TEXT NOT NULL,
        added_at TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS concept_registry (
        concept TEXT PRIMARY KEY,
        usage_count INTEGER NOT NULL DEFAULT 1,
        last_used_at TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS wiki_documents (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        source_ref TEXT,
        content_text TEXT NOT NULL DEFAULT '',
        added_by TEXT NOT NULL,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'wiki',
        title TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        chunk_index INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        embedding vector(3072),
        metadata JSONB DEFAULT '{}'::jsonb
      )
    `;

    try {
      await sql`CREATE INDEX IF NOT EXISTS idx_chunks_source ON document_chunks (source)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON document_chunks (doc_id)`;
    } catch {
      // indexes may already exist
    }
    return;
  }

  const db = await getSQLite();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dataset_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      account_label TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'itops_reasoning',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dataset_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      example_id INTEGER NOT NULL REFERENCES dataset_examples(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      reasoning_trace TEXT,
      ai_conclusion TEXT,
      change_note TEXT,
      modified_by TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      model_name TEXT,
      concept_coverage TEXT DEFAULT '[]',
      UNIQUE(example_id, version)
    );

    CREATE TABLE IF NOT EXISTS grounding_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      example_id INTEGER NOT NULL REFERENCES dataset_examples(id) ON DELETE CASCADE,
      state_id INTEGER NOT NULL REFERENCES dataset_states(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_name TEXT,
      source_ref TEXT,
      source_text TEXT,
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS concept_registry (
      concept TEXT PRIMARY KEY,
      usage_count INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      source_ref TEXT,
      content_text TEXT NOT NULL DEFAULT '',
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'wiki',
      title TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      embedding TEXT,
      metadata TEXT DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_source ON document_chunks (source);
    CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON document_chunks (doc_id);
  `);
}
