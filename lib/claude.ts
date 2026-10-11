import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  DIFFICULTIES,
  QUESTION_TYPES,
  type Answer,
  type ChatMessage,
  type Difficulty,
  type GradeResult,
  type Question,
  type QuestionType,
  type TokenUsage,
  type TopicBrief,
} from "./types";

import { DEFAULT_MODEL, MODEL_IDS } from "./models";
import { errorMessage } from "./api-errors";
import { questionId } from "./question-id";

/** Default for the model picker; overridable with CLAUDE_MODEL. */
export const defaultModel = () =>
  process.env.CLAUDE_MODEL && MODEL_IDS.includes(process.env.CLAUDE_MODEL) ? process.env.CLAUDE_MODEL : DEFAULT_MODEL;

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

function toUsage(fallbackModel: string, msg: Anthropic.Beta.BetaMessage): TokenUsage {
  return {
    model: msg.model || fallbackModel,
    input: msg.usage.input_tokens,
    output: msg.usage.output_tokens,
    cacheRead: msg.usage.cache_read_input_tokens ?? 0,
    cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
  };
}

let client: Anthropic | undefined;
const getClient = () => (client ??= new Anthropic());

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

type Effort = "low" | "medium" | "high";

async function structured<S extends z.ZodType>(opts: {
  model: string;
  schema: S;
  system: string;
  prompt: string;
  effort: Effort;
  maxTokens: number;
}): Promise<{ data: z.infer<S>; usage: TokenUsage }> {
  // Streaming avoids HTTP timeouts on large max_tokens; finalMessage() still parses the output.
  const response = await getClient().beta.messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens,
    ...(FALLBACK_MODELS.has(opts.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  }).finalMessage();

  if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's response was cut off. Try fewer questions.");
  if (!response.parsed_output) throw new Error("Could not parse Claude's response.");
  return { data: response.parsed_output as z.infer<S>, usage: toUsage(opts.model, response) };
}

// ---------------------------------------------------------------- generation

const GeneratedSchema = z.object({
  questions: z.array(
    z.object({
      topic: z.string().describe("Slug of the topic this question belongs to"),
      difficulty: z.enum(DIFFICULTIES),
      type: z.enum(QUESTION_TYPES),
      prompt: z.string().describe("Markdown question text; put code in fenced ```kotlin blocks (or the subject's language)"),
      options: z.array(z.string()).describe("Answer options for mcq/multi; empty otherwise"),
      correct: z.array(z.number().int()).describe("0-based indices of correct options; empty for short/freetext"),
      answer: z.string().describe("Reference answer. For short: the exact expected answer. For freetext: a model answer"),
      accept: z.array(z.string()).describe("Other exact answers accepted for short questions; empty otherwise"),
      explanation: z.string().describe("Why the answer is correct, and the misconception each wrong option targets"),
      rubric: z.string().describe("For freetext: the key points a full-credit answer must contain; empty otherwise"),
    }),
  ),
});

const GENERATE_SYSTEM = `You write quiz questions for a developer who is actively studying a subject and wants to find the gaps in their understanding.

Difficulty levels:
- easy: recall and recognition — definitions, syntax, what a keyword does.
- medium: application — read code and predict output or compile errors, choose the right construct for a situation.
- hard: subtle edge cases, combining several concepts, explaining *why* the language is designed a certain way, spotting non-obvious bugs.

Question types:
- mcq: exactly one correct option, 4 options. Wrong options should be plausible misconceptions, not filler.
- multi: "select all that apply", 4–5 options, at least two correct.
- short: a single unambiguous short answer (a value, keyword, type, or a program's exact output). List reasonable alternative spellings in "accept".
- freetext: asks the learner to explain a concept or write a small piece of code. Give a model answer and a rubric of the key points.

Rules:
- Every question must be technically correct for current stable versions. If code is shown, make sure it compiles (unless the question is about a compile error) and that the stated output is exactly right.
- Make questions self-contained. Don't reference "the notes" or "the previous question".
- Vary what each question tests; don't ask the same idea twice, and don't repeat any question listed under "avoid".
- Keep the correct option's position and length varied so it can't be guessed from formatting.`;

export async function generateQuestions(input: {
  model: string;
  subjectSlug: string;
  subjectName: string;
  topics: TopicBrief[];
  count: number;
  difficulty: Difficulty | "mixed";
  types: QuestionType[];
  avoid: string[];
}): Promise<{ questions: Question[]; usage: TokenUsage }> {
  const topicsText = input.topics
    .map((t) => {
      const parts = [`- ${t.name} (slug: ${t.slug})`];
      if (t.focus.length) parts.push(`  Focus areas: ${t.focus.join("; ")}`);
      if (t.notes) parts.push(`  Learner's notes:\n${t.notes.replace(/^/gm, "    ")}`);
      return parts.join("\n");
    })
    .join("\n");

  const difficultyText =
    input.difficulty === "mixed"
      ? "Mix difficulties: roughly 30% easy, 40% medium, 30% hard."
      : `All questions must be ${input.difficulty}.`;

  const prompt = `Subject: ${input.subjectName}

Topics (spread the questions across them):
${topicsText}

Write exactly ${input.count} questions.
${difficultyText}
Allowed question types: ${input.types.join(", ")}. Use a mix of them.
${input.avoid.length ? `\nAvoid these questions, which the learner already has:\n${input.avoid.map((a) => `- ${a.slice(0, 200)}`).join("\n")}` : ""}`;

  const { data: result, usage } = await structured({
    model: input.model,
    schema: GeneratedSchema,
    system: GENERATE_SYSTEM,
    prompt,
    effort: "medium",
    maxTokens: 32000,
  });

  const slugs = new Set(input.topics.map((t) => t.slug));
  const byName = new Map(input.topics.map((t) => [t.name.toLowerCase(), t.slug]));

  const questions = result.questions
    .filter((q) => input.types.includes(q.type))
    .map((q): Question => {
      const isChoice = q.type === "mcq" || q.type === "multi";
      const topic = slugs.has(q.topic) ? q.topic : (byName.get(q.topic.toLowerCase()) ?? input.topics[0].slug);
      return {
        id: questionId(input.subjectSlug, topic, q.prompt),
        subject: input.subjectSlug,
        topic,
        difficulty: q.difficulty,
        type: q.type,
        prompt: q.prompt,
        options: isChoice ? q.options : [],
        correct: isChoice ? q.correct.filter((c) => c >= 0 && c < q.options.length) : [],
        answer: q.answer || (isChoice ? q.correct.map((c) => q.options[c]).join(", ") : ""),
        accept: q.accept,
        explanation: q.explanation,
        rubric: q.rubric,
        source: "ai",
      };
    })
    .filter((q) => (q.type === "mcq" ? q.options.length >= 2 && q.correct.length === 1 : true))
    .filter((q) => (q.type === "multi" ? q.options.length >= 2 && q.correct.length >= 1 : true))
    .filter((q, i, all) => all.findIndex((x) => x.id === q.id) === i); // drop exact duplicates
  return { questions, usage };
}

// ------------------------------------------------------------------- grading

const GradeSchema = z.object({
  score: z.number().describe("0 to 1. Use 0, 0.25, 0.5, 0.75 or 1"),
  feedback: z
    .string()
    .describe("2–4 sentences to the learner: what they got right, and how their answer differs from the reference answer"),
  mistakes: z
    .array(z.string())
    .describe("Each statement in the learner's answer that contradicts the reference, and each required key point that is missing. Empty if none"),
  improvements: z
    .array(z.string())
    .describe("Concrete suggestions that would bring the answer up to the reference answer (precision, a missing example, clearer wording). Empty if nothing to add"),
  reference_note: z
    .string()
    .describe("Empty unless you are confident the reference answer itself is factually wrong; then say why in one sentence"),
});

const GRADE_SYSTEM = `You grade a learner's answer to a quiz question against the answer key they were given.

The reference answer (and the rubric, when present) is the source of truth:
- Award credit for the key points of the reference answer that the learner's answer contains, and only for those.
- Don't add requirements the reference doesn't contain, and don't penalize the learner for leaving out things the reference doesn't mention.
- Count something as a mistake when it contradicts the reference or is factually wrong, even if the rest of the answer is good.
- Judge meaning, not wording. Accept synonyms, equivalent explanations, different variable names, and minor typos. For code, judge whether it does what the reference does; ignore style unless the rubric asks for it.
- Scale strictness to the difficulty. For easy questions, the core idea of the reference is enough. For hard questions, require the specific reasoning the reference or rubric names.
- If you are confident the reference answer itself is wrong, still grade against it, and explain the problem in reference_note.

Scores: 1 = matches every key point of the reference; 0.75 = minor gap; 0.5 = about half the key points; 0.25 = one relevant idea; 0 = wrong or off-topic.

Address the learner as "you". Name exact misconceptions; don't just say "incomplete".`;

export async function gradeAnswer(model: string, q: Question, answer: Answer): Promise<GradeResult> {
  const given =
    answer.kind === "text" ? answer.text : answer.selected.map((i) => q.options[i]).join("\n") || "(no answer)";

  const prompt = `Difficulty: ${q.difficulty}
Question type: ${q.type}

<question>
${q.prompt}
</question>

<reference_answer>
${q.answer}
</reference_answer>
${q.accept.length ? `\n<also_accepted>${q.accept.join(" | ")}</also_accepted>\n` : ""}${q.rubric ? `\n<rubric>\n${q.rubric}\n</rubric>\n` : ""}${q.explanation ? `\n<explanation>\n${q.explanation}\n</explanation>\n` : ""}
<learner_answer>
${given}
</learner_answer>`;

  const { data: r, usage } = await structured({ model, schema: GradeSchema, system: GRADE_SYSTEM, prompt, effort: "low", maxTokens: 8000 });
  const score = Math.min(1, Math.max(0, r.score));
  return {
    score,
    verdict: score >= 1 ? "correct" : score <= 0 ? "incorrect" : "partial",
    feedback: r.feedback,
    mistakes: r.mistakes,
    improvements: r.improvements,
    referenceNote: r.reference_note.trim() || undefined,
    gradedBy: "ai",
    usage,
  };
}

// ---------------------------------------------------------------- follow-ups

const FOLLOW_UP_SYSTEM = `You are a patient tutor. The learner just answered a quiz question and got it graded. Now they're asking follow-up questions about it.

The context below has the question, the answer key, the learner's answer, and the grade and feedback they received. The answer key is the reference for what's correct.

- Answer what they actually asked. Explain the underlying concept, why their answer was graded the way it was, or how the correct answer works.
- Use a small code example (in a fenced block) when it makes the idea clearer. Keep code compiling and correct.
- Keep replies focused: a few short paragraphs, not an essay. Use markdown.
- If they dispute the grade and, judged against the answer key, they have a point, say so honestly. You can't change the score, but they can use "Try again" to answer again.
- If you're confident the answer key itself is wrong, say so and explain why.
- If they ask for practice, give one new question at a time and wait for their answer before revealing the solution.`;

export function followUpStream(
  input: {
    model: string;
    topicName: string;
    question: Question;
    answer: Answer | null;
    result: Pick<GradeResult, "score" | "verdict" | "feedback" | "mistakes" | "improvements">;
    messages: Pick<ChatMessage, "role" | "content">[];
  },
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const q = input.question;
  const given = !input.answer
    ? "(no answer)"
    : input.answer.kind === "text"
      ? input.answer.text
      : input.answer.selected.map((i) => q.options[i]).join("\n") || "(no answer)";
  const r = input.result;

  const context = `<topic>${input.topicName} (${q.difficulty})</topic>

<question>
${q.prompt}
${q.options.length ? `\nOptions:\n${q.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}` : ""}
</question>

<answer_key>
${q.answer}
${q.explanation ? `\nExplanation: ${q.explanation}` : ""}${q.rubric ? `\nRubric: ${q.rubric}` : ""}
</answer_key>

<learner_answer>
${given}
</learner_answer>

<grade>
Verdict: ${r.verdict}, score ${r.score} of 1
${r.feedback ? `Feedback: ${r.feedback}\n` : ""}${r.mistakes.length ? `Mistakes:\n${r.mistakes.map((m) => `- ${m}`).join("\n")}\n` : ""}${r.improvements.length ? `Improvements:\n${r.improvements.map((m) => `- ${m}`).join("\n")}` : ""}
</grade>`;

  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      try {
        const stream = getClient().beta.messages.stream(
          {
            model: input.model,
            max_tokens: 16000,
            ...(FALLBACK_MODELS.has(input.model)
              ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
              : {}),
            output_config: { effort: "medium" },
            system: [{ type: "text", text: FOLLOW_UP_SYSTEM }, { type: "text", text: context }],
            messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
          },
          { signal },
        );
        stream.on("text", (delta) => send(delta));
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") send("\n\n_Claude declined to answer this._");
        if (final.stop_reason === "max_tokens") send("\n\n_(Reply was cut off.)_");
        send(`\u0001${JSON.stringify(toUsage(input.model, final))}`); // SOH marks the trailing usage record
      } catch (err) {
        if (!signal.aborted) {
          console.error(err);
          send(`\u0000${errorMessage(err)}`); // NUL marks an error for the client
        }
      } finally {
        controller.close();
      }
    },
  });
}
