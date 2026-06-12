const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

export function chunkText(text, title = "") {
  if (!text?.trim()) return [];

  let clean = text;

  // If text looks like HTML, extract text content
  if (text.includes("<") && text.includes(">")) {
    clean = stripHtml(text, title);
  }

  const chunks = chunkSmart(clean);
  return chunks.length > 0 ? chunks : chunkSimple(clean);
}

function stripHtml(html, title = "") {
  // Remove script/style/nav tags and their content
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Convert headings to markdown-style
  clean = clean.replace(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi, "\n## $1\n");

  // Convert pre/code blocks
  clean = clean.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

  // Convert list items
  clean = clean.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");

  // Strip remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, " ");

  // Decode common entities
  clean = clean
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Collapse whitespace
  clean = clean.replace(/\s+/g, " ").trim();

  return title ? `${title}\n\n${clean}` : clean;
}

function chunkSmart(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text.trim()) return [];

  const sentences = text.split(/(?<=[.!?\n])\s+/);
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;

    if (current.length + s.length + 1 > size && current) {
      chunks.push(current.trim());
      if (overlap > 0) {
        const words = current.split(/\s+/);
        const overlapWords = words.slice(-Math.floor(overlap / 4));
        current = overlapWords.join(" ") + " " + s;
      } else {
        current = s;
      }
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function chunkSimple(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text.trim()) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

export { CHUNK_SIZE, CHUNK_OVERLAP };
