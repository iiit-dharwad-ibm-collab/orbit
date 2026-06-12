import { initTables } from "@/lib/db";
import { getUser, unauthorized } from "@/lib/auth";

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    await initTables();
    return Response.json({ ok: true, message: "Tables initialized" });
  } catch (err) {
    console.error("Init error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
