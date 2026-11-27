import { getUser, unauthorized } from "@/lib/auth";
import { searchKnowledge } from "@/lib/knowledge";

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    const body = await request.json();
    if (!body.query?.trim()) {
      return Response.json({ error: "Query required" }, { status: 400 });
    }

    const hits = await searchKnowledge(body);
    return Response.json(hits);
  } catch (err) {
    console.error("Search error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
