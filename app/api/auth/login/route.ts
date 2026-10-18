import { NextResponse } from "next/server";
import { dbConfigured, findUserForLogin } from "@/lib/db";
import { LoginRequest } from "@/lib/api-schemas";
import { dummyPasswordHash, normalizeUsername, startSession, verifyPassword } from "@/lib/auth";
import { DB_DOWN } from "@/lib/api-errors";

export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  const parsed = LoginRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a username and password." }, { status: 400 });

  try {
    const user = await findUserForLogin(normalizeUsername(parsed.data.username));
    // Always run one hash comparison so a missing user takes as long as a wrong password.
    const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !user.passwordHash || !ok) {
      return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
    }
    await startSession(user.id);
    return NextResponse.json({ user: { id: user.id, displayName: user.displayName } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: DB_DOWN }, { status: 503 });
  }
}
