import { query } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/auth";

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  const examples = await query("SELECT * FROM dataset_examples ORDER BY updated_at DESC");
  const rows = [];

  for (const ex of examples) {
    const latest = await query(
      "SELECT content_json FROM dataset_states WHERE example_id = $1 ORDER BY version DESC LIMIT 1",
      [ex.id]
    );
    if (latest.length > 0) {
      try {
        rows.push(JSON.parse(latest[0].content_json));
      } catch { /* skip malformed */ }
    }
  }

  return new Response(JSON.stringify(rows, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="dataset_export.json"',
    },
  });
}
