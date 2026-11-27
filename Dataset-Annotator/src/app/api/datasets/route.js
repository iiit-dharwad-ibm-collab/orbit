import { initTables, query } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/auth";
import { createExample } from "@/lib/dataset_service";

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  await initTables();

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope"); // "mine" or "all"
  const username = user.sub;

  let examples;
  if (scope === "mine") {
    examples = await query(
      `SELECT e.*, 
        (SELECT content_json FROM dataset_states WHERE example_id = e.id ORDER BY version DESC LIMIT 1) as latest_content
       FROM dataset_examples e WHERE e.account_label = $1 ORDER BY e.updated_at DESC`,
      [username]
    );
  } else {
    examples = await query(
      `SELECT e.*, 
        (SELECT content_json FROM dataset_states WHERE example_id = e.id ORDER BY version DESC LIMIT 1) as latest_content
       FROM dataset_examples e ORDER BY e.updated_at DESC`
    );
  }

  return Response.json(examples);
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    const body = await request.json();
    const result = await createExample(user.sub, body);
    return Response.json(result, { status: 201 });
  } catch (err) {
    console.error("Create dataset error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
