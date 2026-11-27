import { initTables, query, queryOne } from "@/lib/db";
import { deriveTopicCoverage } from "@/lib/topics";

const MCQ_LETTERS = ["A", "B", "C", "D"];

async function insertSources(exampleId, stateId, sources, username, now) {
  for (const src of sources) {
    await query(
      `INSERT INTO grounding_sources (example_id, state_id, source_type, source_name, source_ref, source_text, added_by, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [exampleId, stateId, src.source_type || "unknown", src.source_name || "", src.source_ref || "", src.source_text || "", username, now]
    );
  }
}

async function bumpConcepts(concepts, now) {
  for (const concept of concepts) {
    if (concept.trim()) {
      await query(
        `INSERT INTO concept_registry (concept, usage_count, last_used_at)
         VALUES ($1, 1, $2)
         ON CONFLICT (concept) DO UPDATE SET usage_count = concept_registry.usage_count + 1, last_used_at = $2`,
        [concept.trim(), now]
      );
    }
  }
}

function normalizeConcepts(content, concept_coverage, sources) {
  const normalizedConceptCoverage = deriveTopicCoverage({
    concepts: [...(content?.concept_coverage || []), ...concept_coverage],
    question: content?.question,
    grounding: content?.grounding || [],
    sources,
  });
  return {
    normalizedConceptCoverage,
    normalizedContent: { ...(content || {}), concept_coverage: normalizedConceptCoverage },
  };
}

export async function createExample(username, {
  title, account_label, task_type = "itops_reasoning",
  content, reasoning_trace, ai_conclusion, change_note,
  model_name, sources = [], concept_coverage = []
}) {
  await initTables();
  const now = new Date().toISOString();
  const { normalizedConceptCoverage, normalizedContent } = normalizeConcepts(content, concept_coverage, sources);

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

  await insertSources(exampleId, stResult[0].id, sources, username, now);
  await bumpConcepts(normalizedConceptCoverage, now);
  return { id: exampleId };
}

export async function addExampleVersion(username, id, {
  content, reasoning_trace, ai_conclusion, change_note,
  model_name, sources = [], concept_coverage = []
}) {
  await initTables();
  const now = new Date().toISOString();
  const { normalizedConceptCoverage, normalizedContent } = normalizeConcepts(content, concept_coverage, sources);

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
  await insertSources(id, stateId, sources, username, now);
  await bumpConcepts(normalizedConceptCoverage, now);
  return { version: nextVersion, stateId };
}

export async function getLatestState(id) {
  await initTables();
  const example = await queryOne("SELECT * FROM dataset_examples WHERE id = $1", [id]);
  if (!example) return null;
  const state = await queryOne(
    "SELECT * FROM dataset_states WHERE example_id = $1 ORDER BY version DESC LIMIT 1",
    [id]
  );
  const sources = state
    ? await query("SELECT * FROM grounding_sources WHERE state_id = $1 ORDER BY id ASC", [state.id])
    : [];
  let content = {};
  try {
    content = JSON.parse(state?.content_json || "{}");
  } catch { /* malformed */ }
  return { example, state, content, sources };
}

// Turns a raw LLM draft into the saved content shape, mirroring the Create page.
export function draftToContent(draft, sources = []) {
  const qtype = Number(draft.qtype ?? 1);
  const choices = qtype === 0
    ? (Array.isArray(draft.choices) && draft.choices.length === 4
      ? draft.choices.map(String)
      : MCQ_LETTERS.map((l) => String(draft[l] || "")))
    : [];
  const answer = String(draft.answer || "").trim();

  return {
    id: String(draft.id || "auto").trim(),
    question: String(draft.question || "").trim(),
    qtype,
    choices,
    A: choices[0] || "",
    B: choices[1] || "",
    C: choices[2] || "",
    D: choices[3] || "",
    answer,
    model_answer: answer,
    annotator_verdict: "",
    annotator_answer: "",
    answer_source: "model_pending_review",
    solution: String(draft.solution || "").trim(),
    reasoning_thought: String(draft.reasoning_thought || "").trim(),
    concept_coverage: Array.isArray(draft.concept_coverage) ? draft.concept_coverage : [],
    grounding: sources.map((s) => ({ type: s.source_type, title: s.source_name, url: s.source_ref })),
  };
}

function normalizeQuestion(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Duplicate key. Multi-select variants share a stem, so their option set is part of the identity.
export function contentKey(content) {
  const q = normalizeQuestion(content?.question);
  if (!q) return "";
  if (Number(content.qtype) === 3) {
    return `${q}||${(content.choices || []).map(normalizeQuestion).join("|")}`;
  }
  return q;
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((x, i) => x === b[i]);

function checkMultiSelect(c, errors, warnings) {
  const choices = Array.isArray(c.choices) ? c.choices : [];
  if (choices.length < 3 || choices.length > 10) errors.push("multi-select requires 3-10 choices");
  if (choices.some((x) => !String(x || "").trim())) errors.push("choices must be non-empty");

  const labels = choices.map((_, i) => String.fromCharCode(65 + i));
  if (c.choice_labels && !sameList(c.choice_labels, labels)) {
    errors.push(`choice_labels must be ${labels.join(",")}`);
  }

  const answer = Array.isArray(c.answer) ? c.answer : null;
  if (!answer || answer.length === 0) {
    errors.push("multi-select answer must be a non-empty array of labels");
  } else {
    if (answer.some((l) => !labels.includes(l))) errors.push("answer contains invalid labels");
    if (new Set(answer).size !== answer.length) errors.push("answer contains duplicate labels");
    if (!sameList(answer, [...answer].sort())) errors.push("answer must be in displayed label order");
    if (answer.length < 2) errors.push("multi-select needs at least 2 correct options");
    if (answer.length === choices.length) errors.push("every option is correct; nothing to discriminate");
  }
  if (c.correct_answers && !sameList(c.correct_answers, answer)) errors.push("correct_answers differs from answer");
  if (c.answer_count != null && answer && c.answer_count !== answer.length) errors.push("answer_count differs from answer length");

  if (Array.isArray(c.options)) {
    if (c.options.length !== choices.length) {
      errors.push("options length differs from choices");
    } else {
      c.options.forEach((o, i) => {
        if (o.label !== labels[i]) errors.push(`options[${i}].label should be ${labels[i]}`);
        if (o.text !== choices[i]) errors.push(`options[${i}].text differs from choices[${i}]`);
        if (!String(o.explanation || "").trim()) warnings.push(`option ${labels[i]} has no explanation`);
      });
      // is_correct is the authored key; after an annotator override it is kept as model_answer.
      const keyed = c.options.filter((o) => o.is_correct).map((o) => o.label);
      const authored = c.annotator_verdict === "no" ? c.model_answer : answer;
      if (authored && !sameList(keyed, authored)) errors.push("options marked is_correct differ from the authored answer");
    }
  }

  if (c.variant_ref) {
    const v = c.variant_ref;
    if (v.question_id !== c.id) errors.push("variant_ref.question_id differs from id");
    if (c.family_id && v.family_id !== c.family_id) errors.push("variant_ref.family_id differs from family_id");
    if (c.variant != null && v.variant !== c.variant) errors.push("variant_ref.variant differs from variant");
    if (!/^sha256:[0-9a-f]{64}$/.test(String(v.option_set_id || ""))) errors.push("variant_ref.option_set_id must be sha256:<64 hex>");
  }

  if (Array.isArray(c.evidence) && c.evidence.length) {
    for (const e of c.evidence) {
      if (!String(c.question || "").includes(e.observation)) {
        errors.push(`evidence ${e.id} is not shown in the question text`);
      }
    }
  }
}

/**
 * Structural + quality checks for a content object. Mirrors the Create page's
 * save rules (qtype 0-2), adds multi-select rules (qtype 3) and duplicate
 * detection. `requireVerdict` enforces the annotation fields.
 */
export function checkContent(content, { requireVerdict = false, seenQuestions = null } = {}) {
  const errors = [];
  const warnings = [];
  const c = content || {};
  const qtype = Number(c.qtype);

  if (!String(c.id || "").trim()) errors.push("id is required");
  if (!String(c.question || "").trim()) errors.push("question is required");
  if (!String(c.solution || "").trim()) errors.push("solution is required");
  if (![0, 1, 2, 3].includes(qtype)) errors.push("qtype must be 0 (MCQ), 1 (QA), 2 (multi-step) or 3 (multi-select)");

  if (qtype === 3) {
    checkMultiSelect(c, errors, warnings);
  } else if (!String(c.model_answer || c.answer || "").trim()) {
    errors.push("model_answer (or answer) is required");
  }

  if (qtype === 0) {
    const choices = Array.isArray(c.choices) ? c.choices : [];
    if (choices.length !== 4 || choices.some((x) => !String(x || "").trim())) {
      errors.push("MCQ requires 4 non-empty choices");
    }
    const ans = String(c.model_answer || c.answer || "").trim().toUpperCase();
    if (ans && !MCQ_LETTERS.includes(ans)) errors.push("MCQ answer must be one of A/B/C/D");
    if (c.annotator_verdict === "no" && c.annotator_answer
      && !MCQ_LETTERS.includes(String(c.annotator_answer).trim().toUpperCase())) {
      errors.push("MCQ annotator_answer must be one of A/B/C/D");
    }
  }

  const verdict = c.annotator_verdict;
  if (verdict && verdict !== "yes" && verdict !== "no") errors.push("annotator_verdict must be 'yes' or 'no'");
  if (verdict === "no" && !String(c.annotator_answer || "").trim()) {
    errors.push("annotator_answer is required when annotator_verdict is 'no'");
  }
  if (requireVerdict && !verdict) errors.push("annotator_verdict is required");

  if (qtype !== 3 && (!Array.isArray(c.concept_coverage) || c.concept_coverage.length === 0)) {
    warnings.push("concept_coverage is empty");
  }
  if (!Array.isArray(c.grounding) || c.grounding.length === 0) {
    warnings.push("no grounding sources recorded");
  } else if (c.grounding.some((g) => !g.url)) {
    warnings.push("a grounding source has no url");
  }
  if (String(c.question || "").trim().length > 0 && String(c.question).trim().length < 20) {
    warnings.push("question is very short");
  }

  if (seenQuestions) {
    const key = contentKey(c);
    if (key && seenQuestions.has(key)) warnings.push(`duplicate question (matches ${seenQuestions.get(key)})`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

// Map of contentKey -> "example #id" for duplicate detection across the dataset.
export async function loadQuestionIndex() {
  await initTables();
  const rows = await query(
    `SELECT e.id, (SELECT content_json FROM dataset_states WHERE example_id = e.id ORDER BY version DESC LIMIT 1) as latest_content
     FROM dataset_examples e`
  );
  const index = new Map();
  for (const row of rows) {
    try {
      const key = contentKey(JSON.parse(row.latest_content || "{}"));
      if (key) index.set(key, `example #${row.id}`);
    } catch { /* skip malformed */ }
  }
  return index;
}

// Applies an annotator verdict and resolves the final answer the same way the Create page does.
export function applyVerdict(content, verdict, annotatorAnswer = "") {
  if (Number(content.qtype) === 3) {
    const modelAnswer = content.model_answer || content.answer || [];
    const corrected = String(annotatorAnswer || "").toUpperCase().match(/[A-J]/g) || [];
    const final = verdict === "no" ? [...new Set(corrected)].sort() : modelAnswer;
    return {
      ...content,
      model_answer: modelAnswer,
      annotator_verdict: verdict,
      annotator_answer: verdict === "no" ? final : "",
      answer: final,
      correct_answers: final,
      answer_count: final.length,
      answer_source: verdict === "no" ? "annotator_override" : "model_approved",
    };
  }
  const modelAnswer = String(content.model_answer || content.answer || "").trim();
  const corrected = String(annotatorAnswer || "").trim();
  return {
    ...content,
    model_answer: modelAnswer,
    annotator_verdict: verdict,
    annotator_answer: verdict === "no" ? corrected : "",
    answer: verdict === "no" ? corrected : modelAnswer,
    answer_source: verdict === "no" ? "annotator_override" : "model_approved",
  };
}
