import { initTables, query, queryOne } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/auth";
import { deriveTopicCoverage } from "@/lib/topics";

export async function GET(request, { params }) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  await initTables();

  const { id } = await params;
  const example = await queryOne("SELECT * FROM dataset_examples WHERE id = $1", [id]);
  if (!example) return Response.json({ error: "Not found" }, { status: 404 });

  const states = await query(
    "SELECT * FROM dataset_states WHERE example_id = $1 ORDER BY version DESC",
    [id]
  );

  const latestState = states[0];
  let sources = [];
  if (latestState) {
    sources = await query(
      "SELECT * FROM grounding_sources WHERE state_id = $1 ORDER BY id ASC",
      [latestState.id]
    );
  }

  return Response.json({ example, states, sources });
}

export async function PUT(request, { params }) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  await initTables();

  const { id } = await params;
  const body = await request.json();
  const {
    content, reasoning_trace, ai_conclusion, change_note,
    model_name, sources = [], concept_coverage = []
  } = body;

  const now = new Date().toISOString();
  const username = user.sub;
  const normalizedConceptCoverage = deriveTopicCoverage({
    concepts: [...(content?.concept_coverage || []), ...concept_coverage],
    question: content?.question,
    grounding: content?.grounding || [],
    sources,
  });
  const normalizedContent = {
    ...(content || {}),
    concept_coverage: normalizedConceptCoverage,
  };

  const maxVersion = await queryOne(
    "SELECT COALESCE(MAX(version), 0) as max_v FROM dataset_states WHERE example_id = $1",
    [id]
  );
  const nextVersion = (maxVersion?.max_v || 0) + 1;

  const stResult = await query(
    `INSERT INTO dataset_states (example_id, version, content_json, reasoning_trace, ai_conclusion, change_note, modified_by, modified_at, model_name, concept_coverage)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [id, nextVersion, JSON.stringify(normalizedContent), reasoning_trace || "", ai_conclusion || "", change_note || "", username, now, model_name || "manual_edit", JSON.stringify(normalizedConceptCoverage)]
  );
  const stateId = stResult[0].id;

  await query("UPDATE dataset_examples SET updated_at = $1 WHERE id = $2", [now, id]);

  for (const src of sources) {
    await query(
      `INSERT INTO grounding_sources (example_id, state_id, source_type, source_name, source_ref, source_text, added_by, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, stateId, src.source_type || "unknown", src.source_name || "", src.source_ref || "", src.source_text || "", username, now]
    );
  }

  for (const concept of normalizedConceptCoverage) {
    if (concept.trim()) {
      await query(
        `INSERT INTO concept_registry (concept, usage_count, last_used_at)
         VALUES ($1, 1, $2)
         ON CONFLICT (concept) DO UPDATE SET usage_count = concept_registry.usage_count + 1, last_used_at = $2`,
        [concept.trim(), now]
      );
    }
  }

  return Response.json({ version: nextVersion, stateId });
}

export async function DELETE(request, { params }) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  await initTables();

  const { id } = await params;
  await query("DELETE FROM dataset_examples WHERE id = $1", [id]);
  return Response.json({ ok: true });
}
