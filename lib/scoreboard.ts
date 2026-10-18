import "server-only";
import { listSubjects, loadSubject } from "./content";
import { getAllUserQuestionStats, type UserQuestionStats } from "./db";
import type { Difficulty, QuestionType } from "./types";

/** One row of the scoreboard: one person's totals for one topic. */
export interface ScoreRow {
  userId: number;
  name: string;
  subject: string; // slug
  subjectName: string;
  topic: string; // slug
  topicName: string;
  attempts: number;
  correct: number;
  partial: number;
  wrong: number; // incorrect + answer revealed
  answered: number; // distinct saved questions answered at least once
  total: number; // saved questions in the topic's file right now (0 if the file is gone)
  lastAttemptedAt: string | null; // null = never attempted
}

export interface Scoreboard {
  rows: ScoreRow[];
  users: { id: number; name: string }[];
  subjects: { slug: string; name: string }[];
}

/**
 * Totals per person and topic. Correct, wrong and last attempted count every attempt in the topic,
 * including AI-generated questions; "answered" (for % completed) only counts the saved questions in
 * the topic's markdown file. Only topics a person has attempted get a row.
 */
export async function buildScoreboard(): Promise<Scoreboard> {
  const subjects = listSubjects();
  const fileIds = new Map<string, Set<string>>(); // "subject/topic" → question ids
  const topicNames = new Map<string, { subjectName: string; topicName: string }>();
  for (const s of subjects) {
    for (const t of s.topics) {
      fileIds.set(`${s.slug}/${t.slug}`, new Set(t.questions.map((q) => q.id)));
      topicNames.set(`${s.slug}/${t.slug}`, { subjectName: s.name, topicName: t.name });
    }
  }

  const stats = await getAllUserQuestionStats();
  const users = new Map<number, string>();
  const rows = new Map<string, ScoreRow>();
  const blank = (userId: number, name: string, subject: string, topic: string): ScoreRow => {
    const names = topicNames.get(`${subject}/${topic}`);
    return {
      userId,
      name,
      subject,
      subjectName: names?.subjectName ?? subject,
      topic,
      topicName: names?.topicName ?? `${topic} (removed)`,
      attempts: 0,
      correct: 0,
      partial: 0,
      wrong: 0,
      answered: 0,
      total: fileIds.get(`${subject}/${topic}`)?.size ?? 0,
      lastAttemptedAt: null,
    };
  };

  for (const s of stats) {
    users.set(s.userId, s.displayName);
    const key = `${s.userId}|${s.subject}/${s.topic}`;
    const row = rows.get(key) ?? blank(s.userId, s.displayName, s.subject, s.topic);
    row.attempts += s.attempts;
    row.correct += s.correct;
    row.partial += s.partial;
    row.wrong += s.wrong;
    if (fileIds.get(`${s.subject}/${s.topic}`)?.has(s.questionId)) row.answered += 1;
    if (!row.lastAttemptedAt || s.lastAttemptedAt > row.lastAttemptedAt) row.lastAttemptedAt = s.lastAttemptedAt;
    rows.set(key, row);
  }

  return {
    rows: [...rows.values()],
    users: [...users].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    subjects: subjects.map((s) => ({ slug: s.slug, name: s.name })),
  };
}

/** One saved question in a topic, with one person's history on it. */
export interface QuestionRow {
  id: string;
  preview: string; // first line of the question, markdown
  difficulty: Difficulty;
  type: QuestionType;
  attempts: number;
  correct: number;
  partial: number;
  wrong: number;
  lastAttemptedAt: string | null;
}

export async function topicQuestions(
  userId: number,
  subject: string,
  topic: string,
): Promise<{ questions: QuestionRow[]; aiAttempts: number; removedAttempts: number }> {
  const t = loadSubject(subject)?.topics.find((x) => x.slug === topic);
  const stats = await getAllUserQuestionStats({ userId, subject, topic });
  const byId = new Map<string, UserQuestionStats>(stats.map((s) => [s.questionId, s]));
  const questions: QuestionRow[] = (t?.questions ?? []).map((q) => {
    const s = byId.get(q.id);
    return {
      id: q.id,
      preview: firstLine(q.prompt),
      difficulty: q.difficulty,
      type: q.type,
      attempts: s?.attempts ?? 0,
      correct: s?.correct ?? 0,
      partial: s?.partial ?? 0,
      wrong: s?.wrong ?? 0,
      lastAttemptedAt: s?.lastAttemptedAt ?? null,
    };
  });
  const inFile = new Set(questions.map((q) => q.id));
  const sum = (list: UserQuestionStats[]) => list.reduce((n, s) => n + s.attempts, 0);
  return {
    questions,
    aiAttempts: sum(stats.filter((s) => s.source === "ai")),
    // Attempts on questions that were edited or deleted from the file since.
    removedAttempts: sum(stats.filter((s) => s.source === "file" && !inFile.has(s.questionId))),
  };
}

/** The question's first line of text, skipping code blocks, trimmed to a readable length. */
function firstLine(prompt: string): string {
  const line = prompt.split("\n").find((l) => l.trim() && !l.trimStart().startsWith("```"))?.trim() ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}
