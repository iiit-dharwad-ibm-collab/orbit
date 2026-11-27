import crypto from "crypto";

// Builds multi-select (qtype 3) variant records from an authored incident family:
// one stem + evidence + a pool of tagged candidate options, rendered as several
// option subsets/orders. Output matches the schema used by 1000_mcq.html.

const EVIDENCE_LEAD = "Treat the following observations and constraints as given.";
const QUESTION_FOOTER = "Select ALL statements or recommended actions that are justified by the supplied evidence and constraints. Some options describe checks or desired recovery outcomes, not the current state. Judge each complete option; an unsupported guarantee or incorrect clause makes the option incorrect. More than one option is correct.";

export const VARIANT_DEFAULTS = {
  difficulty: "hard_intended_not_calibrated",
  schema_version: "variant_order_v2",
  scoring: {
    method: "variant_then_ordered_exact_match",
    max_score: 1,
    rule: "Verify the complete variant_ref against the assigned question first. Then require selected_labels to exactly equal the ordered correct label array, with no duplicates, omissions, extra or invalid labels. Missing or mismatched variant metadata scores zero; a correct set in the wrong order also scores zero.",
    reasoning_rubric: "rubrics.md",
    reasoning_is_separately_reviewed: true,
  },
  response_instructions: "Resolve the exact variant_ref first by checking its question_id, family_id, variant number and option_set_id against the presented item. Judge every displayed option against the supplied evidence and constraints. Return one JSON object with: variant_ref (copied exactly after checking); selected_labels (all and only correct labels, once each, in displayed A-to-G order); option_judgments (one entry per option in displayed order, with label, verdict=\"select\" or \"reject\", evidence_ids such as [\"E1\",\"E3\"], and a concise justification); causal_summary (the mechanism linking evidence to the incident); and uncertainty (what the evidence does not establish). Use concise explanations of the decisive facts, not a transcript of internal deliberation. Do not invent telemetry. The label order is presentation order, not a sequence of operational actions.",
  provenance: {
    scenario_origin: "synthetic_source_grounded",
    derivation: "Authored incident family expanded into option-set variants via the Dataset Annotator MCP expand_families tool.",
    review_status: "author_reviewed_draft_requires_independent_expert_validation",
    model_input_fields: ["id", "variant_ref", "question", "choices", "choice_labels", "response_instructions"],
    leakage_warning: "Keep the entire incident family and both open-ended and MCQ forms in the same split. Options recur across related variants.",
  },
};

// Our fingerprint for a variant: family + ordered concept ids. Callers importing
// records with an existing option_set_id pass it through instead.
export function optionSetFingerprint(familyId, conceptOrder) {
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify({ family_id: familyId, options: conceptOrder }))
    .digest("hex");
  return `sha256:${digest}`;
}

export function renderQuestion(userPrompt, evidence) {
  const lines = evidence.map((e) => `${e.id}. ${e.observation}`).join("\n");
  return `${userPrompt}\n\n${EVIDENCE_LEAD}\n\n${lines}\n\n${QUESTION_FOOTER}`;
}

/**
 * family: { family_id, title, domain, source_cluster_id, user_prompt, evidence[],
 *           grounding[], options[{concept_id, text, is_correct, explanation}],
 *           provenance?, difficulty?, scoring?, response_instructions?, schema_version? }
 * variant: { variant, question_id, concept_order[], option_set_id? }
 */
export function buildVariantRecord(family, variant) {
  const pool = new Map(family.options.map((o) => [o.concept_id, o]));
  const missing = variant.concept_order.filter((cid) => !pool.has(cid));
  if (missing.length) throw new Error(`unknown concept_id(s): ${missing.join(", ")}`);
  if (new Set(variant.concept_order).size !== variant.concept_order.length) {
    throw new Error("concept_order repeats an option");
  }

  const options = variant.concept_order.map((cid, i) => {
    const o = pool.get(cid);
    return {
      label: String.fromCharCode(65 + i),
      concept_id: cid,
      text: o.text,
      is_correct: Boolean(o.is_correct),
      explanation: o.explanation,
    };
  });
  const labels = options.map((o) => o.label);
  const answer = options.filter((o) => o.is_correct).map((o) => o.label);
  const optionSetId = variant.option_set_id || optionSetFingerprint(family.family_id, variant.concept_order);
  const variantRef = {
    question_id: variant.question_id,
    family_id: family.family_id,
    variant: variant.variant,
    option_set_id: optionSetId,
  };

  const solution = [
    `Variant: ${family.family_id} / ${variant.variant} / ${optionSetId}\nOrdered correct options: ${answer.join(", ")}.`,
    ...options.map((o) => `${o.label} — ${o.is_correct ? "Correct" : "Incorrect"}: ${o.explanation}`),
  ].join("\n\n");

  const d = { ...VARIANT_DEFAULTS, ...family };

  return {
    id: variant.question_id,
    family_id: family.family_id,
    source_cluster_id: family.source_cluster_id,
    variant: variant.variant,
    variant_type: "different_option_subset_and_order",
    title: family.title,
    domain: family.domain,
    qtype: 3,
    question_type: "multi_select",
    user_prompt: family.user_prompt,
    question: renderQuestion(family.user_prompt, family.evidence),
    choices: options.map((o) => o.text),
    choice_labels: labels,
    options,
    answer,
    correct_answers: answer,
    answer_count: answer.length,
    scoring: d.scoring,
    solution,
    evidence: family.evidence,
    grounding: family.grounding || [],
    difficulty: d.difficulty,
    provenance: d.provenance,
    schema_version: d.schema_version,
    variant_ref: variantRef,
    response_instructions: d.response_instructions,
    expected_response: { variant_ref: variantRef, selected_labels: answer },
    answer_order: "displayed_label_order",
  };
}

// Family-level sanity: the pool must contain both valid and invalid options, each explained.
export function checkFamily(family) {
  const errors = [];
  const opts = family.options || [];
  if (!family.family_id) errors.push("family_id is required");
  if (!String(family.user_prompt || "").trim()) errors.push("user_prompt is required");
  if (!Array.isArray(family.evidence) || family.evidence.length === 0) errors.push("evidence is required");
  if (opts.filter((o) => o.is_correct).length < 2) errors.push("pool needs at least 2 correct options");
  if (opts.filter((o) => !o.is_correct).length < 1) errors.push("pool needs at least 1 incorrect option");
  if (new Set(opts.map((o) => o.concept_id)).size !== opts.length) errors.push("concept_id values must be unique");
  if (opts.some((o) => !String(o.explanation || "").trim())) errors.push("every option needs an explanation");
  if (!Array.isArray(family.grounding) || family.grounding.length === 0) errors.push("grounding is required");
  return errors;
}
