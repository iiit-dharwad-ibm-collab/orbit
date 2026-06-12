const STOP_TOPICS = new Set([
  "api",
  "api docs",
  "apis",
  "answer",
  "answers",
  "documentation",
  "docs",
  "doc",
  "dimensions",
  "end",
  "glossary",
  "ibm",
  "page",
  "pages",
  "planner",
  "point",
  "product",
  "product docs",
  "products",
  "profile",
  "question",
  "questions",
  "rest",
  "source",
  "sources",
  "top answers",
  "type",
  "types",
  "wiki",
  "wiki pages",
]);

const KNOWN_TOPICS = [
  { canonical: "instana", aliases: ["instana"] },
  { canonical: "concert", aliases: ["concert"] },
  { canonical: "cloudability", aliases: ["cloudability"] },
  { canonical: "ns1", aliases: ["ns1"] },
  { canonical: "terraform", aliases: ["terraform"] },
  { canonical: "watsonx-orchestrate", aliases: ["watsonx orchestrate", "watsonx-orchestrate"] },
  { canonical: "turbonomic", aliases: ["turbonomic"] },
  { canonical: "infragraph", aliases: ["infragraph"] },
  { canonical: "consul", aliases: ["consul"] },
  { canonical: "boundary", aliases: ["boundary"] },
  { canonical: "packer", aliases: ["packer"] },
  { canonical: "hashicorp", aliases: ["hashicorp"] },
  { canonical: "azure", aliases: ["azure"] },
  { canonical: "aws", aliases: ["aws", "amazon web services"] },
  { canonical: "kubernetes", aliases: ["kubernetes", "k8s"] },
  { canonical: "openshift", aliases: ["openshift"] },
  { canonical: "observability", aliases: ["observability"] },
  { canonical: "monitoring", aliases: ["monitoring"] },
  { canonical: "grafana", aliases: ["grafana"] },
  { canonical: "finops", aliases: ["finops"] },
  { canonical: "rightsizing", aliases: ["rightsizing"] },
  { canonical: "utilization", aliases: ["utilization"] },
  { canonical: "roi", aliases: ["roi"] },
  { canonical: "sbom", aliases: ["sbom", "cyclonedx"] },
  { canonical: "security", aliases: ["security"] },
];

function normalizeSpaces(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9+\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addTopic(target, seen, topic) {
  const normalized = normalizeSpaces(topic);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  target.push(topic);
}

function extractKnownTopicsFromText(text) {
  const normalized = ` ${normalizeSpaces(text)} `;
  const matches = [];

  for (const topic of KNOWN_TOPICS) {
    if (topic.aliases.some((alias) => normalized.includes(` ${normalizeSpaces(alias)} `))) {
      matches.push(topic.canonical);
    }
  }

  return matches;
}

function isUsefulFallbackTopic(rawValue) {
  const raw = String(rawValue || "").trim().toLowerCase();
  const normalized = normalizeSpaces(raw);
  if (!normalized) return false;
  if (STOP_TOPICS.has(normalized)) return false;
  if (raw.includes("_")) return false;
  if (/\d/.test(raw)) return false;
  if (normalized.split(" ").length > 3) return false;
  if (normalized.length < 3) return false;
  if (!/[a-z]/.test(normalized)) return false;
  if (normalized.split(" ").length === 1 && normalized.length > 18) return false;
  if (/(collection|config|details|endpoint|info|input|request|response|status|view)$/.test(normalized)) return false;
  return true;
}

function coerceGroundingTexts(items = []) {
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    return [item.title, item.url, item.source_name, item.source_ref].filter(Boolean);
  });
}

export function deriveTopicCoverage({
  concepts = [],
  question = "",
  grounding = [],
  sources = [],
} = {}) {
  const topics = [];
  const seen = new Set();
  const conceptList = Array.isArray(concepts) ? concepts : [];
  const textPool = [
    ...conceptList,
    question,
    ...coerceGroundingTexts(grounding),
    ...coerceGroundingTexts(sources),
  ].filter(Boolean);

  for (const text of textPool) {
    for (const topic of extractKnownTopicsFromText(text)) {
      addTopic(topics, seen, topic);
    }
  }

  for (const concept of conceptList) {
    const normalized = normalizeSpaces(concept);
    if (STOP_TOPICS.has(normalized)) continue;
    if (isUsefulFallbackTopic(concept)) {
      addTopic(topics, seen, normalized);
    }
  }

  return topics.slice(0, 5);
}

export function isUsefulTopic(value) {
  const raw = String(value || "").trim().toLowerCase();
  const normalized = normalizeSpaces(raw);
  if (!normalized) return false;
  if (STOP_TOPICS.has(normalized)) return false;
  if (extractKnownTopicsFromText(raw).length > 0) return true;
  return isUsefulFallbackTopic(raw);
}

export function filterKnownTopics(values = []) {
  const topics = [];
  const seen = new Set();
  const list = Array.isArray(values) ? values : [values];

  for (const value of list) {
    for (const topic of extractKnownTopicsFromText(value)) {
      addTopic(topics, seen, topic);
    }
  }

  if (topics.length > 0) return topics;

  for (const value of list) {
    if (!isUsefulTopic(value)) continue;
    addTopic(topics, seen, value);
  }

  return topics;
}
