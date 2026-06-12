import { GoogleGenAI } from "@google/genai";

const GEMINI_DEFAULT_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
const OLLAMA_DEFAULT_MODEL = process.env.OLLAMA_EMBED_MODEL || "granite-embedding:278m";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const DEFAULT_PROVIDER = (process.env.EMBEDDING_PROVIDER || "gemini").toLowerCase();

const EMBED_DIM = 3072;
const BATCH_SIZE = 100;

export const EMBEDDING_MODELS = [
  { id: "gemini-embedding-001", provider: "gemini", label: "Gemini Embedding" },
  { id: "gemma4:e4b", provider: "ollama", label: "Gemma 4 e4b (Ollama)" },
  { id: "granite-embedding:278m", provider: "ollama", label: "Granite Embedding 278m (Ollama)" },
];

function resolveProvider(model, provider) {
  if (provider) return provider;
  if (model?.startsWith("gemini")) return "gemini";
  if (model) return "ollama";
  return DEFAULT_PROVIDER;
}

function normalizeEmbedding(values, targetDim = EMBED_DIM) {
  const out = Array.isArray(values) ? values.map((v) => Number(v) || 0) : [];
  if (out.length === targetDim) return out;
  if (out.length > targetDim) return out.slice(0, targetDim);
  while (out.length < targetDim) out.push(0);
  return out;
}

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenAI({ apiKey: key });
}

async function geminiEmbedBatch(texts, model) {
  const client = getClient();
  const result = await client.models.embedContent({
    model,
    contents: texts,
  });
  if (result?.embeddings) {
    return result.embeddings.map((emb) => normalizeEmbedding(emb?.values || []));
  }
  throw new Error("Gemini embedding returned no data");
}

async function ollamaEmbedBatch(texts, model) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embed failed: ${response.status}`);
  }

  const data = await response.json();
  const embeddings = Array.isArray(data?.embeddings)
    ? data.embeddings
    : (Array.isArray(data?.embedding) ? [data.embedding] : []);

  if (!embeddings.length) {
    throw new Error("Ollama embedding returned no vectors");
  }

  return embeddings.map((vec) => normalizeEmbedding(vec));
}

async function embedSingleWithFallback(text, model, provider) {
  const normalizedProvider = resolveProvider(model, provider);
  const effectiveModel = model || (normalizedProvider === "gemini" ? GEMINI_DEFAULT_MODEL : OLLAMA_DEFAULT_MODEL);

  if (normalizedProvider === "gemini") {
    const rows = await geminiEmbedBatch([text], effectiveModel);
    return rows[0] || null;
  }

  const rows = await ollamaEmbedBatch([text], effectiveModel);
  return rows[0] || null;
}

export async function embedText(text, options = {}) {
  const row = await embedSingleWithFallback(text.trim(), options.model, options.provider);
  if (!row) throw new Error("Embedding returned no data");
  return row;
}

export async function embedBatch(texts, options = {}) {
  const provider = resolveProvider(options.model, options.provider);
  const model = options.model || (provider === "gemini" ? GEMINI_DEFAULT_MODEL : OLLAMA_DEFAULT_MODEL);
  const results = new Array(texts.length).fill(null);

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const validIndices = [];
    const validTexts = [];

    batch.forEach((t, i) => {
      const stripped = t?.trim();
      if (stripped) {
        validIndices.push(start + i);
        validTexts.push(stripped);
      }
    });

    if (validTexts.length === 0) continue;

    try {
      const vectors = provider === "gemini"
        ? await geminiEmbedBatch(validTexts, model)
        : await ollamaEmbedBatch(validTexts, model);
      vectors.forEach((vec, idx) => {
        results[validIndices[idx]] = vec;
      });
    } catch (err) {
      // Fallback to sequential
      for (let i = 0; i < validTexts.length; i++) {
        try {
          results[validIndices[i]] = await embedSingleWithFallback(validTexts[i], model, provider);
        } catch {
          // skip failed
        }
      }
    }
  }

  return results;
}

export function embeddingToDbValue(vector, backend) {
  return backend === "postgres"
    ? `[${vector.join(",")}]`
    : JSON.stringify(vector);
}

export function parseEmbeddingFromDb(value) {
  if (!value) return null;
  if (Array.isArray(value)) return normalizeEmbedding(value);
  if (typeof value === "string") {
    try {
      return normalizeEmbedding(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return null;
}

export { EMBED_DIM };
