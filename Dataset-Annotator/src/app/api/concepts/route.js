import { getUser, unauthorized } from "@/lib/auth";
import { initTables, query } from "@/lib/db";
import { isUsefulTopic } from "@/lib/topics";

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    await initTables();
    const rows = await query(
      "SELECT concept, usage_count, last_used_at FROM concept_registry ORDER BY usage_count DESC, concept ASC"
    );
    return Response.json(rows.filter((row) => isUsefulTopic(row.concept)));
  } catch {
    // Table might not exist yet
    return Response.json([]);
  }
}
