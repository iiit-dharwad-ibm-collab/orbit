import fs from "fs/promises";
import path from "path";
import { getUser, unauthorized } from "@/lib/auth";

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDocsRoot() {
  const candidates = [
    process.env.ITOPSGRAPH_DOCS_PATH,
    path.resolve(process.cwd(), "itopsgraph_docs"),
    path.resolve(process.cwd(), "../itopsgraph_docs"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function walkHtml(rootPath, relative = "") {
  const current = path.join(rootPath, relative);
  const items = await fs.readdir(current, { withFileTypes: true });
  const out = [];

  for (const item of items) {
    const nextRel = path.join(relative, item.name);
    if (item.isDirectory()) {
      out.push(...await walkHtml(rootPath, nextRel));
      continue;
    }
    if (item.isFile() && item.name.toLowerCase().endsWith(".html")) {
      out.push(nextRel.replaceAll(path.sep, "/"));
    }
  }

  return out;
}

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  const docsRoot = await resolveDocsRoot();
  if (!docsRoot) {
    return Response.json({ exists: false, root: null, files: [] });
  }

  const files = await walkHtml(docsRoot);
  files.sort((a, b) => a.localeCompare(b));

  return Response.json({
    exists: true,
    root: docsRoot,
    files,
    total: files.length,
  });
}
