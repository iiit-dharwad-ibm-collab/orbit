import { getUser, unauthorized } from "@/lib/auth";
import { query, initTables } from "@/lib/db";

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return unauthorized();

  try {
    await initTables();
    const rows = await query(
      `SELECT created_by, COUNT(*) AS dataset_points, MAX(updated_at) AS last_activity
       FROM dataset_examples
       GROUP BY created_by
       ORDER BY dataset_points DESC, last_activity DESC`
    );

    const leaderboard = rows.map((r, idx) => ({
      rank: idx + 1,
      user: r.created_by,
      dataset_points: Number.parseInt(r.dataset_points || 0, 10),
      last_activity: r.last_activity,
    }));

    return Response.json(leaderboard);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
