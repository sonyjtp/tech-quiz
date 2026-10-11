import "server-only";
import { Pool } from "pg";
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

CREATE INDEX IF NOT EXISTS attempts_question_idx ON attempts (question_id, created_at DESC);
`;

/** Create tables on first use. Safe to run repeatedly. */
async function ready(): Promise<Pool> {
  const p = pool();
  globalForDb.quizSchema ??= p.query(SCHEMA).then(() => undefined);
  try {
    await globalForDb.quizSchema;
  } catch (err) {
    globalForDb.quizSchema = undefined; // retry next time (e.g. the container wasn't up yet)
    throw err;
  }
  return p;
}

const STATS_SQL = `
SELECT question_id,
       count(*)::int                                         AS attempts,
       count(*) FILTER (WHERE verdict = 'correct')::int      AS correct,
       count(*) FILTER (WHERE verdict = 'partial')::int      AS partial,
       (array_agg(verdict ORDER BY created_at DESC))[1]      AS last_verdict,
       max(created_at)                                       AS last_attempted_at
FROM attempts
WHERE question_id = ANY($1)
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

export async function getStats(ids: string[]): Promise<Record<string, QuestionStats>> {
  if (!ids.length) return {};
  const { rows } = await (await ready()).query<StatsRow>(STATS_SQL, [ids]);
  return Object.fromEntries(rows.map((r) => [r.question_id, toStats(r)]));
}

export async function recordAttempt(input: {
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
      `INSERT INTO attempts (question_id, score, verdict, evaluation) VALUES ($1, $2, $3, $4)`,
      [q.id, input.score, input.verdict, input.evaluation],
    );
    const { rows } = await client.query<StatsRow>(STATS_SQL, [[q.id]]);
    await client.query("COMMIT");
    return toStats(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
