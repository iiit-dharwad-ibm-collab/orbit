import { GoogleGenAI } from "@google/genai";
import { getUser, unauthorized } from "@/lib/auth";

const SO_API_BASE = "https://api.stackexchange.com/2.3";
const SO_MODEL = "gemini-3-flash-preview";
const MAX_SOURCE_CHARS = 4000;
const MAX_QUESTION_EXCERPT = 500;
const MAX_ANSWER_EXCERPT = 900;

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTagList(tags) {
  return [...new Set(
    String(tags || "")
      .split(/[,\s]+/)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  )].slice(0, 5);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function extractJsonObject(rawText) {
  if (!rawText?.trim()) return null;
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return JSON.parse(rawText.slice(start, end + 1));
}

async function buildSearchPlan(query, tags) {
  const manualTags = parseTagList(tags);
  const client = getClient();
  if (!client) {
    return {
      model_assisted: false,
      queries: [query.trim()],
      tags: manualTags,
      rationale: "Gemini API key not configured, using direct Stack Overflow search.",
    };
  }

  const prompt = `Return exactly one JSON object with keys primary_query, alternate_queries, tags, rationale.

Task: plan a Stack Overflow search for a technical retrieval workflow.
Rules:
- primary_query must be a concise Stack Overflow search string.
- alternate_queries must contain up to 3 variations.
- tags must contain up to 5 lowercase Stack Overflow-style tags.
- prefer product names, technologies, error keywords, and operator terms.
- do not include markdown or extra text.

USER_QUERY:
${query}

MANUAL_TAG_HINTS:
${manualTags.join(", ") || "none"}`;

  try {
    const response = await client.models.generateContent({
      model: SO_MODEL,
      contents: prompt,
    });
    const parsed = extractJsonObject(response.text || "");
    return {
      model_assisted: true,
      queries: uniqueStrings([
        parsed?.primary_query,
        ...(Array.isArray(parsed?.alternate_queries) ? parsed.alternate_queries : []),
        query.trim(),
      ]).slice(0, 4),
      tags: uniqueStrings([
        ...manualTags,
        ...(Array.isArray(parsed?.tags) ? parsed.tags : []),
      ]).slice(0, 5),
      rationale: String(parsed?.rationale || "Gemini expanded the Stack Overflow search plan."),
    };
  } catch (err) {
    console.error("SO model planning error:", err);
    return {
      model_assisted: false,
      queries: [query.trim()],
      tags: manualTags,
      rationale: "Fell back to direct Stack Overflow search after model planning failed.",
    };
  }
}

async function fetchStackOverflow(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SO API error: ${response.status}`);
  }
  return response.json();
}

async function searchQuestions(query, tags, pagesize) {
  const tagParam = tags.length > 0
    ? `&tagged=${encodeURIComponent(tags.join(";"))}`
    : "";

  const url =
    `${SO_API_BASE}/search/advanced` +
    `?order=desc&sort=relevance&site=stackoverflow&filter=withbody` +
    `&pagesize=${pagesize}` +
    `${tagParam}` +
    `&q=${encodeURIComponent(query)}`;

  const data = await fetchStackOverflow(url);
  return data.items || [];
}

async function safeSearchQuestions(query, tags, pagesize) {
  try {
    return await searchQuestions(query, tags, pagesize);
  } catch (err) {
    console.error(`SO direct search failed for query "${query}":`, err);
    return [];
  }
}

async function fetchRelatedQuestions(questionIds, pagesize) {
  if (questionIds.length === 0) return [];
  const url =
    `${SO_API_BASE}/questions/${questionIds.join(";")}/related` +
    `?order=desc&sort=relevance&site=stackoverflow&filter=withbody` +
    `&pagesize=${pagesize}`;
  const data = await fetchStackOverflow(url);
  return data.items || [];
}

async function fetchAnswers(questionIds, pagesize) {
  if (questionIds.length === 0) return {};
  const url =
    `${SO_API_BASE}/questions/${questionIds.join(";")}/answers` +
    `?order=desc&sort=votes&site=stackoverflow&filter=withbody` +
    `&pagesize=${pagesize}`;

  const data = await fetchStackOverflow(url);
  const grouped = {};

  for (const answer of data.items || []) {
    const qid = String(answer.question_id);
    if (!grouped[qid]) grouped[qid] = [];
    grouped[qid].push(answer);
  }

  for (const qid of Object.keys(grouped)) {
    grouped[qid].sort((a, b) => {
      return Number(Boolean(b.is_accepted)) - Number(Boolean(a.is_accepted))
        || (b.score || 0) - (a.score || 0);
    });
  }

  return grouped;
}

async function safeFetchRelatedQuestions(questionIds, pagesize) {
  try {
    return await fetchRelatedQuestions(questionIds, pagesize);
  } catch (err) {
    console.error("SO related-questions fetch failed:", err);
    return [];
  }
}

async function safeFetchAnswers(questionIds, pagesize) {
  try {
    return await fetchAnswers(questionIds, pagesize);
  } catch (err) {
    console.error("SO answers fetch failed:", err);
    return {};
  }
}

function upsertCandidate(map, item, isRelated) {
  const key = String(item.question_id);
  const existing = map.get(key);
  const bodyText = stripHtml(item.body || "");

  if (existing) {
    existing.search_hits += 1;
    existing.is_related = existing.is_related && isRelated;
    existing.question_score = Math.max(existing.question_score, item.score || 0);
    existing.answer_count = Math.max(existing.answer_count, item.answer_count || 0);
    return;
  }

  map.set(key, {
    question_id: item.question_id,
    title: item.title || `Question #${item.question_id}`,
    link: item.link || `https://stackoverflow.com/q/${item.question_id}`,
    body_text: bodyText,
    tags: item.tags || [],
    question_score: item.score || 0,
    answer_count: item.answer_count || 0,
    is_related: isRelated,
    search_hits: 1,
    top_answers: [],
    relevance_reason: "",
  });
}

async function rankCandidates(objective, candidates) {
  const client = getClient();
  const fallbackRanked = [...candidates].sort((a, b) => {
    const aScore = (a.is_related ? 0 : 1000) + (a.search_hits * 25) + (a.answer_count * 5) + (a.question_score || 0);
    const bScore = (b.is_related ? 0 : 1000) + (b.search_hits * 25) + (b.answer_count * 5) + (b.question_score || 0);
    return bScore - aScore;
  });

  if (!client || candidates.length === 0) {
    return fallbackRanked;
  }

  const prompt = `Return exactly one JSON object with keys ranked_ids and reasons.

Goal: rank Stack Overflow questions for retrieval relevance.
Rules:
- ranked_ids must be an ordered array of the candidate ids below.
- reasons must be an object mapping candidate id to a short plain-text reason.
- prefer candidates that best match the user's technical need.
- top answers matter heavily when ranking.
- do not include markdown or extra text.

USER_OBJECTIVE:
${objective}

CANDIDATES:
${candidates.map((candidate) => {
  const answerPreview = candidate.top_answers[0]
    ? stripHtml(candidate.top_answers[0].body || "").slice(0, 280)
    : "No answers available.";
  return JSON.stringify({
    id: `q${candidate.question_id}`,
    relation: candidate.is_related ? "related" : "direct",
    title: candidate.title,
    tags: candidate.tags,
    question_score: candidate.question_score,
    answer_count: candidate.answer_count,
    question_excerpt: candidate.body_text.slice(0, 260),
    top_answer_excerpt: answerPreview,
  });
}).join("\n")}`;

  try {
    const response = await client.models.generateContent({
      model: SO_MODEL,
      contents: prompt,
    });
    const parsed = extractJsonObject(response.text || "");
    const rankedIds = Array.isArray(parsed?.ranked_ids) ? parsed.ranked_ids.map((id) => String(id)) : [];
    const reasonMap = parsed?.reasons && typeof parsed.reasons === "object" ? parsed.reasons : {};
    const byId = new Map(candidates.map((candidate) => [`q${candidate.question_id}`, candidate]));
    const ranked = [];

    for (const id of rankedIds) {
      const candidate = byId.get(id);
      if (!candidate) continue;
      candidate.relevance_reason = String(reasonMap[id] || "");
      ranked.push(candidate);
      byId.delete(id);
    }

    for (const leftover of byId.values()) {
      ranked.push(leftover);
    }

    return ranked;
  } catch (err) {
    console.error("SO model ranking error:", err);
    return fallbackRanked;
  }
}

function buildQuestionSource(question) {
  const combined = `QUESTION: ${question.title}\n\n${question.body_text}`;
  return {
    source_type: question.is_related ? "so_related_question" : "so_relevant_question",
    source_name: question.title,
    source_ref: question.link,
    source_text: combined.slice(0, MAX_SOURCE_CHARS),
  };
}

function buildAnswerSource(question, answer, index) {
  const answerText = stripHtml(answer.body || "");
  const combined = `QUESTION: ${question.title}\n\n${question.body_text}\n\nTOP ANSWER:\n${answerText}`;
  return {
    source_type: "so_top_answer",
    source_name: `${question.title} — Top Answer ${index}`,
    source_ref: `${question.link}#answer-${answer.answer_id}`,
    source_text: combined.slice(0, MAX_SOURCE_CHARS),
  };
}

function mapQuestionToResponse(question) {
  return {
    question_id: question.question_id,
    title: question.title,
    link: question.link,
    question_score: question.question_score,
    answer_count: question.answer_count,
    tags: question.tags,
    is_related: question.is_related,
    relevance_reason: question.relevance_reason,
    preview_text: question.body_text.slice(0, MAX_QUESTION_EXCERPT),
    question_source: buildQuestionSource(question),
    top_answers: question.top_answers.map((answer, index) => ({
      answer_id: answer.answer_id,
      answer_score: answer.score || 0,
      is_accepted: Boolean(answer.is_accepted),
      preview_text: stripHtml(answer.body || "").slice(0, MAX_ANSWER_EXCERPT),
      source: buildAnswerSource(question, answer, index + 1),
    })),
  };
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    const {
      query,
      tags = "",
      max_questions = 5,
      max_answers_per_question = 2,
    } = await request.json();

    if (!query?.trim()) {
      return Response.json({ error: "Query required" }, { status: 400 });
    }

    const baseTags = parseTagList(tags);
    const searchPlan = await buildSearchPlan(query.trim(), tags);
    const questionMap = new Map();
    const plannedQueries = searchPlan.queries?.length > 0 ? searchPlan.queries : [query.trim()];
    const perQueryResults = await Promise.all(
      plannedQueries.map((plannedQuery) => safeSearchQuestions(plannedQuery, searchPlan.tags, 4))
    );

    for (const items of perQueryResults) {
      for (const item of items) {
        upsertCandidate(questionMap, item, false);
      }
    }

    if (questionMap.size === 0) {
      const fallbackQuestions = await safeSearchQuestions(query.trim(), baseTags, Math.max(3, max_questions));
      for (const item of fallbackQuestions) {
        upsertCandidate(questionMap, item, false);
      }
    }

    if (questionMap.size === 0) {
      return Response.json({
        search_plan: {
          ...searchPlan,
          rationale: `${searchPlan.rationale} No Stack Overflow results were returned.`,
        },
        results: [],
      });
    }

    const seedIds = [...questionMap.keys()].slice(0, Math.max(3, max_questions));
    const relatedItems = await safeFetchRelatedQuestions(seedIds, Math.max(6, max_questions));
    for (const item of relatedItems) {
      if (questionMap.has(String(item.question_id))) continue;
      upsertCandidate(questionMap, item, true);
    }

    const questionIds = [...questionMap.keys()];
    const answersByQuestion = await safeFetchAnswers(questionIds, Math.max(12, questionIds.length * max_answers_per_question));

    for (const candidate of questionMap.values()) {
      candidate.top_answers = (answersByQuestion[String(candidate.question_id)] || []).slice(0, max_answers_per_question);
    }

    const ranked = await rankCandidates(query.trim(), [...questionMap.values()]);
    const directResults = ranked.filter((candidate) => !candidate.is_related).slice(0, max_questions);
    const relatedResults = ranked.filter((candidate) => candidate.is_related).slice(0, Math.max(2, Math.ceil(max_questions / 2)));
    const finalResults = [...directResults, ...relatedResults];

    return Response.json({
      search_plan: searchPlan,
      results: finalResults.map(mapQuestionToResponse),
    });
  } catch (err) {
    console.error("SO search error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
