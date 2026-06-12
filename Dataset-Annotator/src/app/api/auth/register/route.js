import { initTables, query, queryOne } from "@/lib/db";
import { hashPassword, signToken } from "@/lib/auth";

export async function POST(request) {
  try {
    await initTables();
    const { username, password } = await request.json();
    if (!username?.trim() || !password?.trim()) {
      return Response.json({ error: "Username and password required" }, { status: 400 });
    }

    const existing = await queryOne("SELECT id FROM users WHERE username = $1", [username.trim()]);
    if (existing) {
      return Response.json({ error: "Username already taken" }, { status: 409 });
    }

    const hash = await hashPassword(password);
    await query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2)",
      [username.trim(), hash]
    );

    const token = await signToken({ sub: username.trim() });
    return Response.json({ token, username: username.trim() }, { status: 201 });
  } catch (err) {
    console.error("Register error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
