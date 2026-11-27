import { getUser, unauthorized } from "@/lib/auth";
import { generateDraft } from "@/lib/generator";

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    const body = await request.json();
    if (!body.objective?.trim()) {
      return Response.json({ error: "Objective is required" }, { status: 400 });
    }

    const result = await generateDraft({ model: "gemini-3-flash-preview", ...body });
    return Response.json(result);
  } catch (err) {
    console.error("Generate error:", err);
    if (err.raw) {
      return Response.json({ error: err.message, raw: err.raw }, { status: 500 });
    }
    return Response.json({ error: err.message }, { status: 500 });
  }
}
