import { load } from "cheerio";

/**
 * Docling-style HTML extraction: keep semantic blocks and remove chrome noise.
 */
export function extractTextFromHtml(html, title = "") {
  if (!html?.trim()) return "";

  try {
    const $ = load(html);
    $("script, style, noscript, nav, header, footer, svg, iframe").remove();

    const lines = [];
    $("h1, h2, h3, h4, p, li, pre, code, table").each((_, el) => {
      const tag = el.tagName?.toLowerCase();
      const raw = $(el).text().replace(/\s+/g, " ").trim();
      if (!raw) return;
      if (tag === "li") lines.push(`- ${raw}`);
      else if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") lines.push(`## ${raw}`);
      else lines.push(raw);
    });

    const bodyText = lines.length > 0
      ? lines.join("\n")
      : $("body").text().replace(/\s+/g, " ").trim();

    return title ? `${title}\n\n${bodyText}` : bodyText;
  } catch {
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return title ? `${title}\n\n${stripped}` : stripped;
  }
}
