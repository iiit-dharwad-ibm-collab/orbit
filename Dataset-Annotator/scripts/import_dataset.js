const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value.startsWith("--")) {
      const key = value;
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else if (!args._) {
      args._ = [value];
    } else {
      args._.push(value);
    }
  }
  return args;
}

function ensureTables(db) {
  db.exec(`
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
  `);
}

function buildTitle(record) {
  const id = String(record.id || "untitled");
  const question = String(record.question || "").trim();
  const preview = question.length > 80 ? `${question.slice(0, 77)}...` : question;
  return preview ? `${id} | ${preview}` : id;
}

function normalizeSources(grounding) {
  if (!Array.isArray(grounding)) return [];
  return grounding.map((src) => ({
    source_type: String(src.type || "unknown"),
    source_name: String(src.title || ""),
    source_ref: String(src.url || ""),
    source_text: "",
  }));
}

function main() {
  const args = parseArgs(process.argv);
  const jsonPath = args["--json"] || (args._ && args._[0]);
  if (!jsonPath) {
    console.error("Missing --json <path-to-current_dataset.json>");
    process.exit(1);
  }

  const dbPath = args["--db"] || path.join(process.cwd(), "dataset_generator.sqlite3");
  const createdBy = args["--created-by"] || "import";
  const accountLabel = args["--account-label"] || createdBy;
  const taskType = args["--task-type"] || "itops_reasoning";
  const modelName = args["--model-name"] || "manual_import";
  const changeNote = args["--change-note"] || "imported";
  const skipDuplicates = String(args["--skip-duplicates"] || "true") !== "false";
  const dryRun = Boolean(args["--dry-run"]);

  const raw = fs.readFileSync(jsonPath, "utf8");
  const records = JSON.parse(raw);
  if (!Array.isArray(records)) {
    throw new Error("Expected a JSON array of records");
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 3000");
  ensureTables(db);

  const selectExisting = db.prepare(
    "SELECT e.id FROM dataset_examples e JOIN dataset_states s ON s.example_id = e.id WHERE s.content_json LIKE ? LIMIT 1"
  );

  const insertExample = db.prepare(
    `INSERT INTO dataset_examples (title, account_label, task_type, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const insertState = db.prepare(
    `INSERT INTO dataset_states (
      example_id, version, content_json, reasoning_trace, ai_conclusion, change_note,
      modified_by, modified_at, model_name, concept_coverage
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertSource = db.prepare(
    `INSERT INTO grounding_sources (
      example_id, state_id, source_type, source_name, source_ref, source_text, added_by, added_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const upsertConcept = db.prepare(
    `INSERT INTO concept_registry (concept, usage_count, last_used_at)
     VALUES (?, 1, ?)
     ON CONFLICT(concept) DO UPDATE SET usage_count = usage_count + 1, last_used_at = excluded.last_used_at`
  );

  const now = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;

  const tx = db.transaction((items) => {
    for (const record of items) {
      const recordId = String(record.id || "");
      const pattern = `%\"id\":\"${recordId}\"%`;
      if (skipDuplicates && recordId && selectExisting.get(pattern)) {
        skipped += 1;
        continue;
      }

      const title = buildTitle(record);
      if (!dryRun) {
        const ex = insertExample.run(title, accountLabel, taskType, createdBy, now, now);
        const exampleId = Number(ex.lastInsertRowid);
        const contentJson = JSON.stringify(record);
        const reasoningTrace = String(record.reasoning_thought || "");
        const aiConclusion = String(record.answer || "");
        const conceptCoverage = JSON.stringify(record.concept_coverage || []);
        const st = insertState.run(
          exampleId,
          contentJson,
          reasoningTrace,
          aiConclusion,
          changeNote,
          createdBy,
          now,
          modelName,
          conceptCoverage
        );

        const stateId = Number(st.lastInsertRowid);
        const sources = normalizeSources(record.grounding);
        for (const src of sources) {
          insertSource.run(
            exampleId,
            stateId,
            src.source_type,
            src.source_name,
            src.source_ref,
            src.source_text,
            createdBy,
            now
          );
        }

        const concepts = Array.isArray(record.concept_coverage) ? record.concept_coverage : [];
        for (const concept of concepts) {
          const normalized = String(concept || "").trim();
          if (normalized) {
            upsertConcept.run(normalized, now);
          }
        }
      }

      inserted += 1;
    }
  });

  tx(records);

  console.log(
    JSON.stringify(
      {
        inserted,
        skipped,
        total: records.length,
        dryRun,
        dbPath,
        jsonPath,
      },
      null,
      2
    )
  );
}

main();
