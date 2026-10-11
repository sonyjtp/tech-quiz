import { POINTS, type Answer, type GradeResult, type Question } from "./types";

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shuffle a choice question's options, remapping the correct indices. */
export function shuffleOptions(q: Question): Question {
  if (q.options.length < 2) return q;
  const order = shuffle(q.options.map((_, i) => i));
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correct: q.correct.map((c) => order.indexOf(c)).sort((x, y) => x - y),
  };
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.;]+$/, "")
    .trim();

export function isAnswered(q: Question, a: Answer | undefined): boolean {
  if (!a) return false;
  return a.kind === "options" ? a.selected.length > 0 : a.text.trim().length > 0;
}

/**
 * Grade against the answer key where that's exact. Returns null when the answer needs
 * judgement (free text, or a short answer that didn't match the key exactly) — that's
 * done by Claude or by the learner, depending on the evaluation mode.
 */
export function gradeLocally(q: Question, a: Answer | undefined): GradeResult | null {
  if (!isAnswered(q, a)) {
    return { score: 0, verdict: "incorrect", feedback: "No answer given.", mistakes: [], improvements: [], gradedBy: "key" };
  }

  if ((q.type === "mcq" || q.type === "multi") && a!.kind === "options") {
    const picked = new Set(a!.selected);
    const right = q.correct.filter((c) => picked.has(c)).length;
    const wrong = [...picked].filter((p) => !q.correct.includes(p)).length;
    // Multi-select: each correct pick earns credit, each wrong pick cancels one.
    const score = q.type === "mcq" ? (wrong === 0 && right === 1 ? 1 : 0) : Math.max(0, (right - wrong) / q.correct.length);
    const mistakes: string[] = [];
    for (const p of picked) if (!q.correct.includes(p)) mistakes.push(`You picked ${q.options[p]}, which is wrong.`);
    for (const c of q.correct) if (!picked.has(c)) mistakes.push(`You missed ${q.options[c]}.`);
    return {
      score,
      verdict: score === 1 ? "correct" : score > 0 ? "partial" : "incorrect",
      feedback: q.explanation,
      mistakes,
      improvements: [],
      gradedBy: "key",
    };
  }

  if (q.type === "short" && a!.kind === "text") {
    const given = normalize(a!.text);
    if ([q.answer, ...q.accept].some((k) => normalize(k) === given)) {
      return { score: 1, verdict: "correct", feedback: q.explanation, mistakes: [], improvements: [], gradedBy: "key" };
    }
  }

  return null;
}

export const revealed = (q: Question): GradeResult => ({
  score: 0,
  verdict: "revealed",
  feedback: q.explanation,
  mistakes: [],
  improvements: [],
  gradedBy: "key",
});

/** Manual evaluation: show the answer key and wait for the learner to grade themselves. */
export const awaitingSelfGrade = (): GradeResult => ({
  score: 0,
  verdict: "pending",
  feedback: "",
  mistakes: [],
  improvements: [],
  gradedBy: "self",
});

export const SELF_GRADES = [
  { score: 1, label: "I got it right" },
  { score: 0.5, label: "Partly right" },
  { score: 0, label: "I got it wrong" },
] as const;

export const selfGraded = (score: number): GradeResult => ({
  score,
  verdict: score >= 1 ? "correct" : score > 0 ? "partial" : "incorrect",
  feedback: "",
  mistakes: [],
  improvements: [],
  gradedBy: "self",
});

export const pointsFor = (q: Question, r: GradeResult | undefined) => (r ? r.score * POINTS[q.difficulty] : 0);
