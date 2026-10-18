import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createUser, dbConfigured } from "@/lib/db";
import { SignupRequest } from "@/lib/api-schemas";
import {
  PASSWORD_MIN,
  USERNAME_RULE,
  hashPassword,
  normalizeUsername,
  reservedUsername,
  signupCode,
  startSession,
  validUsername,
} from "@/lib/auth";
import { DB_DOWN } from "@/lib/api-errors";

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

const sameCode = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  const parsed = SignupRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Enter a username and password.");
  const { username, password, code } = parsed.data;

  const required = signupCode();
  if (required && !sameCode(code?.trim() ?? "", required)) return bad("That sign-up code isn't right.");
  if (!validUsername(username)) return bad(`Usernames are ${USERNAME_RULE}`);
  if (reservedUsername(username)) return bad("Usernames starting with “testuser-” are reserved.");
  if (password.length < PASSWORD_MIN) return bad(`Passwords need at least ${PASSWORD_MIN} characters.`);

  try {
    const user = await createUser(normalizeUsername(username), username.trim(), await hashPassword(password));
    if (!user) return NextResponse.json({ error: "That username is taken." }, { status: 409 });
    await startSession(user.id);
    return NextResponse.json({ user: { id: user.id, displayName: user.displayName } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: DB_DOWN }, { status: 503 });
  }
}
