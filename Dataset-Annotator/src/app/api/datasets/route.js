import { initTables, query, queryOne } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/auth";
import { deriveTopicCoverage } from "@/lib/topics";

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  await initTables();

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope"); // "mine" or "all"
  const username = user.sub;

  let examples;
  if (scope === "mine") {
    examples = await query(
      `SELECT e.*, 
        (SELECT content_json FROM dataset_states WHERE example_id = e.id ORDER BY version DESC LIMIT 1) as latest_content
       FROM dataset_examples e WHERE e.account_label = $1 ORDER BY e.updated_at DESC`,
      [username]
    );
  } else {
    examples = await query(
      `SELECT e.*, 
        (SELECT content_json FROM dataset_states WHERE example_id = e.id ORDER BY version DESC LIMIT 1) as latest_content
       FROM dataset_examples e ORDER BY e.updated_at DESC`
    );
  }

  return Response.json(examples);
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    await initTables();
    const body = await request.json();
    const {
      title, account_label, task_type = "itops_reasoning",
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

    const exResult = await query(
      `INSERT INTO dataset_examples (title, account_label, task_type, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [title, account_label || username, task_type, username, now, now]
    );
    const exampleId = exResult[0].id;

    const stResult = await query(
      `INSERT INTO dataset_states (example_id, version, content_json, reasoning_trace, ai_conclusion, change_note, modified_by, modified_at, model_name, concept_coverage)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [exampleId, JSON.stringify(normalizedContent), reasoning_trace || "", ai_conclusion || "", change_note || "", username, now, model_name || "manual", JSON.stringify(normalizedConceptCoverage)]
    );
    const stateId = stResult[0].id;

    for (const src of sources) {
      await query(
        `INSERT INTO grounding_sources (example_id, state_id, source_type, source_name, source_ref, source_text, added_by, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [exampleId, stateId, src.source_type || "unknown", src.source_name || "", src.source_ref || "", src.source_text || "", username, now]
      );
    }

    // Concept registry
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

    return Response.json({ id: exampleId }, { status: 201 });
  } catch (err) {
    console.error("Create dataset error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
