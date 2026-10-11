import { z } from "zod";
import { DIFFICULTIES, QUESTION_TYPES } from "./types";
import { MODEL_IDS } from "./models";

const Model = z.enum(MODEL_IDS);

export const QuestionInput = z.object({
  id: z.string(),
  subject: z.string(),
  topic: z.string(),
  difficulty: z.enum(DIFFICULTIES),
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().max(20_000),
  options: z.array(z.string()),
  correct: z.array(z.number().int()),
  answer: z.string(),
  accept: z.array(z.string()),
  explanation: z.string(),
  rubric: z.string(),
  source: z.enum(["file", "ai"]),
});

export const AnswerInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("options"), selected: z.array(z.number().int()) }),
  z.object({ kind: z.literal("text"), text: z.string().max(20_000) }),
]);

export const GradeRequest = z.object({ model: Model, question: QuestionInput, answer: AnswerInput });

export const GenerateRequest = z.object({
  model: Model,
  subjectSlug: z.string(),
  subjectName: z.string(),
  topics: z
    .array(z.object({ slug: z.string(), name: z.string(), focus: z.array(z.string()), notes: z.string().max(20_000) }))
    .min(1),
  count: z.number().int().min(1).max(30),
  difficulty: z.enum([...DIFFICULTIES, "mixed"]),
  types: z.array(z.enum(QUESTION_TYPES)).min(1),
  avoid: z.array(z.string()).max(200),
});

export const FollowUpRequest = z.object({
  model: Model,
  topicName: z.string().max(200),
  question: QuestionInput,
  answer: AnswerInput.nullable(),
  result: z.object({
    score: z.number(),
    verdict: z.enum(["correct", "partial", "incorrect", "revealed", "pending"]),
    feedback: z.string(),
    mistakes: z.array(z.string()),
    improvements: z.array(z.string()),
  }),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20_000) }))
    .min(1)
    .max(40)
    .refine((m) => m[m.length - 1].role === "user", "The last message must be from the user"),
});

export const StatsRequest = z.object({ ids: z.array(z.string().max(200)).max(200) });

export const AttemptRequest = z.object({
  question: QuestionInput.pick({ id: true, subject: true, topic: true, source: true, difficulty: true, prompt: true }),
  score: z.number().min(0).max(1),
  verdict: z.enum(["correct", "partial", "incorrect", "revealed"]),
  evaluation: z.enum(["manual", "ai"]),
});
