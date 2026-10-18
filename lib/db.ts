import "server-only";
import { randomInt } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { QuestionStats, Verdict } from "./types";

// Reuse one pool across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { quizPool?: Pool; quizSchema?: Promise<void> };

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  globalForDb.quizPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return globalForDb.quizPool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,      -- lowercase, used to log in
  display_name   TEXT NOT NULL,             -- as typed at sign-up, shown in the UI
  password_hash  TEXT,                      -- NULL = can't log in (e.g. testuser- accounts)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,             -- sha256 of the cookie value; the raw token is never stored
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,
  topic       TEXT NOT NULL,
  source      TEXT NOT NULL,
  difficulty  TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attempts (
  id           BIGSERIAL PRIMARY KEY,
  question_id  TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  score        REAL NOT NULL,
  verdict      TEXT NOT NULL,
  evaluation   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added with login. Attempts made before it are assigned to testuser- accounts (see assignLegacyAttempts).
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS attempts_question_idx ON attempts (question_id, created_at DESC);
CREATE INDEX IF NOT EXISTS attempts_user_question_idx ON attempts (user_id, question_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
`;

const LEGACY_USER_COUNT = 3;
const ADJECTIVES = ["amber", "brisk", "cobalt", "dusty", "eager", "fuzzy", "gentle", "hazel", "ivory", "jolly", "keen", "lunar", "mellow", "nimble", "olive", "plucky", "quiet", "rusty", "sunny", "tidy"];
const ANIMALS = ["falcon", "otter", "badger", "heron", "lynx", "marmot", "newt", "ocelot", "puffin", "quokka", "raven", "seal", "tapir", "urchin", "vole", "walrus", "yak", "zebra", "gecko", "ibis"];
const randomTestName = () =>
  `testuser-${ADJECTIVES[randomInt(ADJECTIVES.length)]}-${ANIMALS[randomInt(ANIMALS.length)]}`;

/**
 * Attempts saved before login existed have no user. Create a few testuser-<random> accounts
 * (which can't log in) and give each of those attempts to one of them at random.
 * Does nothing once every attempt has a user.
 */
async function assignLegacyAttempts(client: PoolClient) {
  const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM attempts WHERE user_id IS NULL");
  if (rows[0].n === 0) return;
  const ids: number[] = [];
  while (ids.length < LEGACY_USER_COUNT) {
    const name = randomTestName();
    const res = await client.query<{ id: string }>(
      `INSERT INTO users (username, display_name) VALUES ($1, $1) ON CONFLICT (username) DO NOTHING RETURNING id`,
      [name],
    );
    if (res.rows[0]) ids.push(Number(res.rows[0].id));
  }
  // random() is evaluated per row, so every attempt gets its own pick.
  await client.query(
    `UPDATE attempts SET user_id = ($1::bigint[])[1 + floor(random() * $2)::int] WHERE user_id IS NULL`,
    [ids, ids.length],
  );
}

/**
 * Create or upgrade the tables in one transaction, holding an advisory lock so two server
 * processes starting at once don't both run it.
 */
async function migrate(p: Pool) {
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(4747)");
    await client.query(SCHEMA);
    await assignLegacyAttempts(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Create tables and run migrations on first use. Safe to run repeatedly. */
async function ready(): Promise<Pool> {
  const p = pool();
  globalForDb.quizSchema ??= migrate(p);
  try {
    await globalForDb.quizSchema;
  } catch (err) {
    globalForDb.quizSchema = undefined; // retry next time (e.g. the container wasn't up yet)
    throw err;
  }
  return p;
}

// ------------------------------------------------------------------ users and sessions

export interface User {
  id: number;
  username: string;
  displayName: string;
}

type UserRow = { id: string; username: string; display_name: string };
const toUser = (r: UserRow): User => ({ id: Number(r.id), username: r.username, displayName: r.display_name });

/** Returns null if the username is taken. */
export async function createUser(username: string, displayName: string, passwordHash: string): Promise<User | null> {
  const { rows } = await (await ready()).query<UserRow>(
    `INSERT INTO users (username, display_name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO NOTHING RETURNING id, username, display_name`,
    [username, displayName, passwordHash],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findUserForLogin(username: string): Promise<(User & { passwordHash: string | null }) | null> {
  const { rows } = await (await ready()).query<UserRow & { password_hash: string | null }>(
    `SELECT id, username, display_name, password_hash FROM users WHERE username = $1`,
    [username],
  );
  return rows[0] ? { ...toUser(rows[0]), passwordHash: rows[0].password_hash } : null;
}

export async function createSession(userId: number, tokenHash: string, expiresAt: Date) {
  const db = await ready();
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, [tokenHash, userId, expiresAt]);
}

export async function getSessionUser(tokenHash: string): Promise<User | null> {
  const { rows } = await (await ready()).query<UserRow>(
    `SELECT u.id, u.username, u.display_name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function deleteSession(tokenHash: string) {
  await (await ready()).query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

// ------------------------------------------------------------------ per-question history

const STATS_SQL = `
SELECT question_id,
       count(*)::int                                         AS attempts,
       count(*) FILTER (WHERE verdict = 'correct')::int      AS correct,
       count(*) FILTER (WHERE verdict = 'partial')::int      AS partial,
       (array_agg(verdict ORDER BY created_at DESC))[1]      AS last_verdict,
       max(created_at)                                       AS last_attempted_at
FROM attempts
WHERE user_id = $1 AND question_id = ANY($2)
GROUP BY question_id`;

type StatsRow = {
  question_id: string;
  attempts: number;
  correct: number;
  partial: number;
  last_verdict: Verdict;
  last_attempted_at: Date;
};

const toStats = (r: StatsRow): QuestionStats => ({
  attempts: r.attempts,
  correct: r.correct,
  partial: r.partial,
  lastVerdict: r.last_verdict,
  lastAttemptedAt: r.last_attempted_at.toISOString(),
});

/** One user's history with each of the given questions. */
export async function getStats(userId: number, ids: string[]): Promise<Record<string, QuestionStats>> {
  if (!ids.length) return {};
  const { rows } = await (await ready()).query<StatsRow>(STATS_SQL, [userId, ids]);
  return Object.fromEntries(rows.map((r) => [r.question_id, toStats(r)]));
}

export async function recordAttempt(input: {
  userId: number;
  question: { id: string; subject: string; topic: string; source: string; difficulty: string; prompt: string };
  score: number;
  verdict: Verdict;
  evaluation: string;
}): Promise<QuestionStats> {
  const db = await ready();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const q = input.question;
    await client.query(
      `INSERT INTO questions (id, subject, topic, source, difficulty, prompt)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET difficulty = EXCLUDED.difficulty`,
      [q.id, q.subject, q.topic, q.source, q.difficulty, q.prompt],
    );
    await client.query(
      `INSERT INTO attempts (question_id, user_id, score, verdict, evaluation) VALUES ($1, $2, $3, $4, $5)`,
      [q.id, input.userId, input.score, input.verdict, input.evaluation],
    );
    const { rows } = await client.query<StatsRow>(STATS_SQL, [input.userId, [q.id]]);
    await client.query("COMMIT");
    return toStats(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------ scoreboard

/** Every user's totals for every question they've attempted. */
export interface UserQuestionStats {
  userId: number;
  displayName: string;
  questionId: string;
  subject: string;
  topic: string;
  source: string;
  attempts: number;
  correct: number;
  partial: number;
  wrong: number; // incorrect + revealed
  lastAttemptedAt: string;
}

export async function getAllUserQuestionStats(filter?: { userId?: number; subject?: string; topic?: string }): Promise<UserQuestionStats[]> {
  const { rows } = await (await ready()).query<{
    user_id: string;
    display_name: string;
    question_id: string;
    subject: string;
    topic: string;
    source: string;
    attempts: number;
    correct: number;
    partial: number;
    wrong: number;
    last_attempted_at: Date;
  }>(
    `SELECT a.user_id, u.display_name, a.question_id, q.subject, q.topic, q.source,
            count(*)::int                                                      AS attempts,
            count(*) FILTER (WHERE a.verdict = 'correct')::int                 AS correct,
            count(*) FILTER (WHERE a.verdict = 'partial')::int                 AS partial,
            count(*) FILTER (WHERE a.verdict IN ('incorrect', 'revealed'))::int AS wrong,
            max(a.created_at)                                                  AS last_attempted_at
     FROM attempts a
     JOIN users u     ON u.id = a.user_id
     JOIN questions q ON q.id = a.question_id
     WHERE ($1::bigint IS NULL OR a.user_id = $1)
       AND ($2::text IS NULL OR q.subject = $2)
       AND ($3::text IS NULL OR q.topic = $3)
     GROUP BY a.user_id, u.display_name, a.question_id, q.subject, q.topic, q.source`,
    [filter?.userId ?? null, filter?.subject ?? null, filter?.topic ?? null],
  );
  return rows.map((r) => ({
    userId: Number(r.user_id),
    displayName: r.display_name,
    questionId: r.question_id,
    subject: r.subject,
    topic: r.topic,
    source: r.source,
    attempts: r.attempts,
    correct: r.correct,
    partial: r.partial,
    wrong: r.wrong,
    lastAttemptedAt: r.last_attempted_at.toISOString(),
  }));
}
