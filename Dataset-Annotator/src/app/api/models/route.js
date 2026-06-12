import { getUser, unauthorized } from "@/lib/auth";

const GEMINI_DECODER_MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
];

const GEMINI_EMBED_MODELS = [
  "gemini-embedding-001",
];

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

async function fetchOllamaModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.models || []).map((m) => m.name).filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  const ollamaModels = await fetchOllamaModels();
  const embedOllama = ollamaModels.filter((m) => /embed|embedding|granite-embedding/i.test(m));

  return Response.json({
    decoder: {
      gemini: GEMINI_DECODER_MODELS,
      ollama: ollamaModels,
    },
    embedding: {
      gemini: GEMINI_EMBED_MODELS,
      ollama: embedOllama.length ? embedOllama : ["granite-embedding:278m"],
    },
  });
}
