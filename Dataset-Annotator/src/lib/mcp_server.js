import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { initTables, query } from "@/lib/db";
import { isUsefulTopic } from "@/lib/topics";
import { generateDraft } from "@/lib/generator";
import { searchKnowledge } from "@/lib/knowledge";
import { buildVariantRecord, checkFamily } from "@/lib/mcq_variants";
import {
  addExampleVersion,
  applyVerdict,
  checkContent,
  contentKey,
  createExample,
  draftToContent,
  getLatestState,
  loadQuestionIndex,
} from "@/lib/dataset_service";

const GENERATE_CONCURRENCY = 4;

function json(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function summarize(results) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

function hitsToSources(hits) {
  return hits.map((h) => ({
    source_type: h.source === "wiki" ? "wiki_chunk" : h.source,
    source_name: h.title,
    source_ref: h.source_ref || h.url || h.doc_id,
    source_text: h.chunk,
  }));
}

// Grounding entries in content ({type,title,url}) -> grounding_sources rows.
function groundingToSources(grounding = []) {
  return grounding.map((g) => ({
    source_type: g.type || "unknown",
    source_name: g.title || "",
    source_ref: g.url || "",
    source_text: "",
  }));
}

function rowTitle(content) {
  return `${content.id} | ${String(content.title || content.question || "").slice(0, 60)}`;
}

// QA/MCQ items get the Create page's derived fields; multi-select records are stored as given.
function buildContent(item) {
  const { sources, task_type, ...rest } = item;
  if (Number(rest.qtype) === 3) return rest;

  const choices = Number(rest.qtype) === 0 ? (rest.choices || []) : [];
  const base = {
    ...rest,
    choices,
    A: choices[0] || "", B: choices[1] || "", C: choices[2] || "", D: choices[3] || "",
    reasoning_thought: rest.reasoning_thought || "",
    concept_coverage: rest.concept_coverage || [],
    grounding: rest.grounding || (sources || []).map((s) => ({ type: s.source_type, title: s.source_name, url: s.source_ref })),
  };
  const modelAnswer = rest.model_answer || rest.answer;
  return rest.annotator_verdict
    ? applyVerdict({ ...base, model_answer: modelAnswer }, rest.annotator_verdict, rest.annotator_answer)
    : { ...base, model_answer: modelAnswer, answer: modelAnswer, annotator_verdict: "", annotator_answer: "", answer_source: "model_pending_review" };
}

// Validates then saves a list of content objects in order, so duplicate detection
// also sees earlier items of the same batch.
async function saveBatch(username, entries, { requireVerdict = false, dryRun = false, changeNote, modelName }) {
  const questionIndex = await loadQuestionIndex();
  const results = [];
  for (const { index, content, sources, extra = {} } of entries) {
    const check = checkContent(content, { requireVerdict, seenQuestions: questionIndex });
    if (!check.ok) { results.push({ index, id: content.id, status: "invalid", ...check, ...extra }); continue; }
    if (dryRun) {
      questionIndex.set(contentKey(content), `batch item ${index}`);
      results.push({ index, id: content.id, status: "dry_run", ...check, ...extra });
      continue;
    }
    try {
      const { id } = await createExample(username, {
        title: rowTitle(content),
        task_type: Number(content.qtype) === 3 ? "itops_multi_select" : undefined,
        content,
        reasoning_trace: content.reasoning_thought || "",
        ai_conclusion: typeof content.solution === "string" ? content.solution : "",
        change_note: changeNote,
        model_name: extra.model || modelName,
        sources: sources || groundingToSources(content.grounding),
        concept_coverage: content.concept_coverage || [],
      });
      questionIndex.set(contentKey(content), `example #${id}`);
      results.push({ index, id: content.id, status: "saved", example_id: id, warnings: check.warnings, ...extra });
    } catch (err) {
      results.push({ index, id: content.id, status: "failed", errors: [err.message] });
    }
  }
  return results;
}

const sourceSchema = z.object({
  source_type: z.string(),
  source_name: z.string().optional(),
  source_ref: z.string().optional(),
  source_text: z.string().optional(),
});

const contentSchema = z.object({
  id: z.string().describe("Dataset row id, e.g. 'itops-0042'"),
  question: z.string(),
  qtype: z.number().int().min(0).max(3).describe("0=MCQ, 1=QA, 2=multi-step, 3=multi-select"),
  choices: z.array(z.string()).optional().describe("4 for MCQ; 3-10 for multi-select"),
  model_answer: z.string().optional().describe("Proposed answer for qtype 0-2 (A-D letter for MCQ)"),
  answer: z.union([z.string(), z.array(z.string())]).optional().describe("Label array for multi-select"),
  solution: z.string(),
  annotator_verdict: z.enum(["yes", "no"]).optional(),
  annotator_answer: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough();

const optionSchema = z.object({
  concept_id: z.string().describe("Role tag, e.g. cause, fix, check, verify, original_proposal, misconception_1"),
  text: z.string(),
  is_correct: z.boolean(),
  explanation: z.string(),
});

const familySchema = z.object({
  family_id: z.string(),
  title: z.string(),
  domain: z.string(),
  source_cluster_id: z.string().optional(),
  user_prompt: z.string().describe("The on-call engineer's request"),
  evidence: z.array(z.object({ id: z.string(), observation: z.string() })).min(1),
  // Empty shape + passthrough keeps the caller's key order (declared keys would be hoisted).
  grounding: z.array(z.object({}).passthrough().refine((g) => typeof g.url === "string" && g.url, "grounding entries need a url")).min(1),
  options: z.array(optionSchema).min(3).max(10).describe("Candidate pool shared by all variants"),
  variants: z.array(z.object({
    variant: z.number().int().min(1),
    question_id: z.string(),
    concept_order: z.array(z.string()).min(3).describe("Option concept_ids in display order"),
    option_set_id: z.string().optional().describe("Keep an existing fingerprint; computed otherwise"),
  })).min(1).max(20),
}).passthrough();

export function createMcpServer(user) {
  const username = user.sub;
  const server = new McpServer({ name: "dataset-annotator", version: "1.0.0" });

  server.registerTool("list_topics", {
    description: "List the topic registry (concept usage counts). Use it to spread new examples across under-covered topics.",
    inputSchema: {},
  }, async () => {
    await initTables();
    const rows = await query(
      "SELECT concept, usage_count, last_used_at FROM concept_registry ORDER BY usage_count DESC, concept ASC"
    );
    return json(rows.filter((r) => isUsefulTopic(r.concept)));
  });

  server.registerTool("search_knowledge", {
    description: "Semantic search over the knowledge base (wiki/doc chunks).",
    inputSchema: {
      query: z.string(),
      n_results: z.number().int().min(1).max(20).default(5),
    },
  }, async ({ query: q, n_results }) => json(await searchKnowledge({ query: q, n_results })));

  server.registerTool("generate_drafts", {
    description: "Generate many dataset drafts in parallel with the configured LLM. Optionally ground each in the knowledge base, and with save=true validate and save every passing draft in the same call (saved drafts await review).",
    inputSchema: {
      items: z.array(z.object({
        objective: z.string().describe("What the example should test"),
        qtype: z.number().int().min(0).max(2).default(1),
        dataset_id: z.string().optional(),
        topics: z.array(z.string()).optional().describe("Must-include topics"),
        sources: z.array(sourceSchema).optional().describe("Explicit grounding sources"),
      })).min(1).max(20),
      ground_with_knowledge: z.boolean().default(true).describe("Auto-retrieve top KB chunks per objective"),
      provider: z.enum(["gemini", "ollama"]).default("gemini"),
      model: z.string().optional(),
      save: z.boolean().default(false),
    },
  }, async ({ items, ground_with_knowledge, provider, model, save }) => {
    await initTables();
    const registry = await query("SELECT concept FROM concept_registry ORDER BY usage_count DESC LIMIT 50");

    const generated = await mapLimit(items, GENERATE_CONCURRENCY, async (item, index) => {
      try {
        let sources = item.sources || [];
        if (ground_with_knowledge && sources.length === 0) {
          try {
            sources = hitsToSources(await searchKnowledge({ query: item.objective, n_results: 3 }));
          } catch { /* KB unavailable: generate ungrounded */ }
        }
        const result = await generateDraft({
          objective: item.objective,
          qtype: item.qtype,
          dataset_id: item.dataset_id || "auto",
          grounding_sources: sources,
          provider,
          model,
          existing_concepts: registry,
          selected_concepts: item.topics || [],
        });
        const content = draftToContent(result.draft, sources);
        if (item.dataset_id) content.id = item.dataset_id;
        return { index, content, sources, extra: { model: `${result.provider}:${result.model}` } };
      } catch (err) {
        return { index, failed: err.message };
      }
    });

    const failed = generated.filter((g) => g.failed).map((g) => ({ index: g.index, status: "failed", errors: [g.failed] }));
    const ok = generated.filter((g) => !g.failed);
    const saved = await saveBatch(username, ok, {
      dryRun: !save,
      changeNote: "MCP batch generation (pending review)",
    });
    const drafts = save ? {} : Object.fromEntries(ok.map((g) => [g.index, g.content]));
    const results = [...failed, ...saved.map((r) => (save ? r : { ...r, status: r.status === "dry_run" ? "draft" : r.status, draft: drafts[r.index] }))]
      .sort((a, b) => a.index - b.index);
    return json({ summary: summarize(results), results });
  });

  server.registerTool("create_examples", {
    description: "Validate and save many dataset examples at once (QA, MCQ or multi-select records). Invalid items are skipped with reasons; valid ones are saved. Use dry_run to validate only.",
    inputSchema: {
      items: z.array(contentSchema.extend({
        sources: z.array(sourceSchema).optional(),
      })).min(1).max(50),
      require_verdict: z.boolean().default(false).describe("Reject items without an annotator_verdict"),
      dry_run: z.boolean().default(false),
    },
  }, async ({ items, require_verdict, dry_run }) => {
    const entries = items.map((item, index) => ({ index, content: buildContent(item), sources: item.sources }));
    const results = await saveBatch(username, entries, {
      requireVerdict: require_verdict,
      dryRun: dry_run,
      changeNote: "MCP batch creation",
      modelName: "mcp",
    });
    return json({ summary: summarize(results), results });
  });

  server.registerTool("expand_families", {
    description: "Expand authored incident families into multi-select variant records: each variant shows a chosen subset/order of the family's option pool. Builds question text, answer key, solution and variant_ref, validates, and saves unless dry_run.",
    inputSchema: {
      families: z.array(familySchema).min(1).max(10),
      dry_run: z.boolean().default(false),
      return_records: z.boolean().default(false).describe("Include the built records in the response"),
    },
  }, async ({ families, dry_run, return_records }) => {
    const entries = [];
    const familyErrors = [];
    let index = 0;
    for (const family of families) {
      const errors = checkFamily(family);
      if (errors.length) {
        familyErrors.push({ family_id: family.family_id, status: "invalid_family", errors });
        continue;
      }
      const { variants, ...familyBody } = family;
      for (const v of variants) {
        try {
          const record = buildVariantRecord(familyBody, v);
          entries.push({ index: index++, content: record, extra: return_records ? { record } : {} });
        } catch (err) {
          familyErrors.push({ family_id: family.family_id, variant: v.variant, status: "invalid_variant", errors: [err.message] });
        }
      }
    }
    const results = await saveBatch(username, entries, {
      dryRun: dry_run,
      changeNote: "MCP family expansion",
      modelName: "mcp:expand_families",
    });
    const all = [...familyErrors, ...results];
    return json({ summary: summarize(all), results: all });
  });

  server.registerTool("validate_examples", {
    description: "Run validation checks on many saved examples (by id) and/or inline content. Read-only; reports errors, warnings and duplicates.",
    inputSchema: {
      example_ids: z.array(z.number().int()).max(100).optional(),
      items: z.array(contentSchema).max(50).optional(),
      require_verdict: z.boolean().default(false),
    },
  }, async ({ example_ids = [], items = [], require_verdict }) => {
    const index = await loadQuestionIndex();
    const results = [];

    for (const id of example_ids) {
      const latest = await getLatestState(id);
      if (!latest) { results.push({ example_id: id, status: "not_found" }); continue; }
      // Don't flag a row as a duplicate of itself.
      const key = contentKey(latest.content);
      const own = index.get(key) === `example #${id}`;
      if (own) index.delete(key);
      const check = checkContent(latest.content, { requireVerdict: require_verdict, seenQuestions: index });
      if (own) index.set(key, `example #${id}`);
      results.push({
        example_id: id,
        id: latest.content.id,
        version: latest.state?.version,
        status: check.ok ? "valid" : "invalid",
        review: latest.content.annotator_verdict || "pending",
        ...check,
      });
    }

    for (const [i, item] of items.entries()) {
      const content = buildContent(item);
      const check = checkContent(content, { requireVerdict: require_verdict, seenQuestions: index });
      index.set(contentKey(content), `batch item ${i}`);
      results.push({ index: i, id: content.id, status: check.ok ? "valid" : "invalid", ...check });
    }

    return json({ summary: summarize(results), results });
  });

  server.registerTool("review_examples", {
    description: "Record annotator verdicts on many saved examples. verdict 'no' requires annotator_answer (the correction; labels like 'B,D' for multi-select). Each review creates a new version.",
    inputSchema: {
      reviews: z.array(z.object({
        example_id: z.number().int(),
        verdict: z.enum(["yes", "no"]),
        annotator_answer: z.string().optional(),
        note: z.string().optional(),
      })).min(1).max(50),
    },
  }, async ({ reviews }) => {
    const results = [];
    for (const r of reviews) {
      try {
        const latest = await getLatestState(r.example_id);
        if (!latest) { results.push({ example_id: r.example_id, status: "not_found" }); continue; }
        const content = applyVerdict(latest.content, r.verdict, r.annotator_answer);
        const check = checkContent(content, { requireVerdict: true });
        if (!check.ok) { results.push({ example_id: r.example_id, status: "invalid", ...check }); continue; }
        const { version } = await addExampleVersion(username, r.example_id, {
          content,
          reasoning_trace: latest.state?.reasoning_trace,
          ai_conclusion: latest.state?.ai_conclusion,
          change_note: r.note || `MCP review: ${r.verdict}`,
          model_name: latest.state?.model_name,
          sources: latest.sources,
          concept_coverage: content.concept_coverage,
        });
        results.push({ example_id: r.example_id, status: "reviewed", verdict: r.verdict, version, answer: content.answer });
      } catch (err) {
        results.push({ example_id: r.example_id, status: "failed", errors: [err.message] });
      }
    }
    return json({ summary: summarize(results), results });
  });

  server.registerTool("get_example", {
    description: "Fetch the latest version of a dataset example.",
    inputSchema: { example_id: z.number().int() },
  }, async ({ example_id }) => {
    const latest = await getLatestState(example_id);
    if (!latest) return { ...json({ error: "Not found" }), isError: true };
    return json({ example: latest.example, version: latest.state?.version, content: latest.content });
  });

  return server;
}
