export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * mcq      – single correct option
 * multi    – select all that apply
 * short    – one short exact answer (e.g. "what does this print?")
 * freetext – explanation / code, graded by Claude against a reference answer
 */
export const QUESTION_TYPES = ["mcq", "multi", "short", "freetext"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  multi: "Select all",
  short: "Short answer",
  freetext: "Explain / write code",
};

/** Points a fully correct answer is worth, by difficulty. */
export const POINTS: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

export interface Question {
  id: string;
  subject: string; // subject slug
  topic: string; // topic slug
  difficulty: Difficulty;
  type: QuestionType;
  prompt: string; // markdown
  options: string[]; // mcq / multi only
  correct: number[]; // indices into options
  answer: string; // reference answer (shown after answering)
  accept: string[]; // extra accepted answers for "short"
  explanation: string;
  rubric: string; // grading hints for freetext
  source: "file" | "ai";
}

export interface Topic {
  slug: string;
  name: string;
  focus: string[]; // focus areas that steer AI generation
  notes: string; // free markdown before the first question, passed to the AI as context
  questions: Question[];
}

export interface Subject {
  slug: string;
  name: string;
  topics: Topic[];
}

export type Answer = { kind: "options"; selected: number[] } | { kind: "text"; text: string };

/** "pending" = manual evaluation, waiting for the learner to grade themselves. */
export type Verdict = "correct" | "partial" | "incorrect" | "revealed" | "pending";

export type Evaluation = "manual" | "ai";
export type Source = "file" | "ai";

export interface GradeResult {
  score: number; // 0..1, multiplied by POINTS[difficulty]
  verdict: Verdict;
  feedback: string; // what was right / wrong
  mistakes: string[];
  improvements: string[]; // what would make the answer better
  referenceNote?: string; // AI thinks the answer key itself may be wrong
  gradedBy: "key" | "ai" | "self";
  failed?: boolean; // grading request errored; can be retried
  usage?: TokenUsage; // when graded by Claude
}

/** What the UI sends to /api/generate for each selected topic. */
export interface TopicBrief {
  slug: string;
  name: string;
  focus: string[];
  notes: string;
}

/** One turn of a follow-up conversation about a graded question. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  error?: boolean; // the request failed; excluded from history sent to Claude
  usage?: TokenUsage; // assistant replies
}

/** Tokens used by one Claude API call. Thinking tokens are included in `output`. */
export interface TokenUsage {
  model: string; // model that served the request
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** History of a question across all quizzes, from the database. */
export interface QuestionStats {
  attempts: number;
  correct: number;
  partial: number;
  lastVerdict: Verdict;
  lastAttemptedAt: string; // ISO timestamp
}
