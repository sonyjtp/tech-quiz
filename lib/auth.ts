import "server-only";
import { cache } from "react";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createSession, dbConfigured, deleteSession, getSessionUser, type User } from "./db";

export type { User };

/** Must match the name checked in proxy.ts. */
export const SESSION_COOKIE = "sq_session";
const SESSION_DAYS = 30;

// ------------------------------------------------------------------ passwords

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Stored as scrypt$N$r$p$salt$hash (base64), so parameters can change later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, N, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

/** A hash of a random password, compared against when the username doesn't exist so timing doesn't reveal it. */
let dummyHash: Promise<string> | undefined;
export const dummyPasswordHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

// ------------------------------------------------------------------ usernames

export const USERNAME_RULE = "3–32 characters: letters, numbers, dots, dashes or underscores, starting with a letter or number.";
export const PASSWORD_MIN = 8;

export const normalizeUsername = (name: string) => name.trim().toLowerCase();
export const validUsername = (name: string) => /^[a-z0-9][a-z0-9._-]{2,31}$/i.test(name.trim());
/** testuser- accounts hold the attempts saved before login existed; nobody can sign up as one. */
export const reservedUsername = (name: string) => normalizeUsername(name).startsWith("testuser-");

/** When SIGNUP_CODE is set, creating an account requires it. */
export const signupCode = () => process.env.SIGNUP_CODE?.trim() || null;

// ------------------------------------------------------------------ sessions

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Create a session for the user and set its cookie. Call from a route handler. */
export async function startSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await createSession(userId, hashToken(token), expiresAt);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token && dbConfigured()) await deleteSession(hashToken(token)).catch((err) => console.error(err));
  store.delete(SESSION_COOKIE);
}

/**
 * The logged-in user, or null. Checks the session against the database, so it's the real
 * authorization check (proxy.ts only looks for the cookie). Cached for the rest of the request.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !dbConfigured()) return null;
  try {
    return await getSessionUser(hashToken(token));
  } catch (err) {
    console.error(err);
    return null;
  }
});

/** For pages: the logged-in user, or a redirect to /login (coming back to `next` afterwards). */
export async function requireUser(next = "/"): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** For API routes: `const user = await currentUser(); if (!user) return unauthorized();` */
export const unauthorized = () => NextResponse.json({ error: "You're not logged in." }, { status: 401 });

/** Only allow redirects to paths on this site, e.g. "/kotlin", never "//evil.com" or "https://...". */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
