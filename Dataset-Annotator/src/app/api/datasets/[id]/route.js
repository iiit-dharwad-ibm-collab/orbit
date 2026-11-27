import { initTables, query, queryOne } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/auth";
import { addExampleVersion } from "@/lib/dataset_service";

export async function GET(request, { params }) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  await initTables();

  const { id } = await params;
  const example = await queryOne("SELECT * FROM dataset_examples WHERE id = $1", [id]);
  if (!example) return Response.json({ error: "Not found" }, { status: 404 });

  const states = await query(
    "SELECT * FROM dataset_states WHERE example_id = $1 ORDER BY version DESC",
    [id]
  );

  const latestState = states[0];
  let sources = [];
  if (latestState) {
    sources = await query(
      "SELECT * FROM grounding_sources WHERE state_id = $1 ORDER BY id ASC",
      [latestState.id]
    );
  }

  return Response.json({ example, states, sources });
}

export async function PUT(request, { params }) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  const { id } = await params;
  const body = await request.json();
  const result = await addExampleVersion(user.sub, id, body);
  return Response.json(result);
}

export async function DELETE(request, { params }) {
  const user = await getUser(request);
  if (!user) return unauthorized();
  await initTables();

  const { id } = await params;
  await query("DELETE FROM dataset_examples WHERE id = $1", [id]);
  return Response.json({ ok: true });
}
