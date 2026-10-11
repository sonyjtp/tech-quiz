import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { questionId } from "./question-id";
import { DIFFICULTIES, QUESTION_TYPES, type Difficulty, type Question, type QuestionType, type Subject, type Topic } from "./types";

const CONTENT_DIR = path.join(process.cwd(), "content");

const titleCase = (slug: string) =>
  slug.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export function listSubjects(): Subject[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadSubject(d.name))
    .filter((s): s is Subject => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSubject(slug: string): Subject | null {
  const dir = path.join(CONTENT_DIR, slug);
  if (!/^[\w-]+$/.test(slug) || !fs.existsSync(dir)) return null;

  let subjectName = titleCase(slug);
  const topics: (Topic & { order: number })[] = [];

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const topicSlug = file.replace(/\.md$/, "");
    const { data, content } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
    if (typeof data.subject === "string") subjectName = data.subject;
    const { notes, questions } = parseQuestions(content, slug, topicSlug);
    topics.push({
      slug: topicSlug,
      name: typeof data.topic === "string" ? data.topic : titleCase(topicSlug),
      focus: Array.isArray(data.focus) ? data.focus.map(String) : [],
      notes,
      questions,
      order: typeof data.order === "number" ? data.order : 999,
    });
  }

  topics.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return { slug, name: subjectName, topics: topics.map(({ order: _order, ...t }) => t) };
}

const FIELD = /^(type|difficulty|answer|accept|explanation|rubric):\s*(.*)$/i;
const OPTION = /^\s*[-*]\s+\[([ xX])]\s+(.*)$/;

/**
 * Questions start with a "## Q:" heading. Inside a question, outside code fences:
 *   `key: value` lines set fields, `- [ ]` / `- [x]` lines are options,
 *   everything else (including fenced code) is part of the prompt.
 */
export function parseQuestions(markdown: string, subject: string, topic: string) {
  const [notes, ...blocks] = markdown.split(/^##\s+Q:\s*/m);
  const parsed: Question[] = blocks.map((block) => {
    const fields: Record<string, string> = {};
    const options: string[] = [];
    const correct: number[] = [];
    const promptLines: string[] = [];
    let inFence = false;
    let multiline: string | null = null; // field collecting lines after `key: |`

    for (const line of block.split("\n")) {
      const field = !inFence && line.match(FIELD);
      const option = !inFence && line.match(OPTION);
      if (line.trimStart().startsWith("```")) inFence = !inFence;
      if (field) {
        const key = field[1].toLowerCase();
        const value = field[2].trim();
        multiline = value === "|" ? key : null;
        fields[key] = value === "|" ? "" : value;
      } else if (option) {
        multiline = null;
        if (option[1].toLowerCase() === "x") correct.push(options.length);
        options.push(option[2].trim());
      } else if (multiline) {
        fields[multiline] += line + "\n";
      } else promptLines.push(line);
    }
    for (const k of Object.keys(fields)) fields[k] = fields[k].trim();

    const type: QuestionType = QUESTION_TYPES.includes(fields.type as QuestionType)
      ? (fields.type as QuestionType)
      : options.length > 0
        ? correct.length > 1 ? "multi" : "mcq"
        : "freetext";
    const difficulty: Difficulty = DIFFICULTIES.includes(fields.difficulty as Difficulty)
      ? (fields.difficulty as Difficulty)
      : "medium";

    const prompt = promptLines.join("\n").trim();
    return {
      id: questionId(subject, topic, prompt),
      subject,
      topic,
      difficulty,
      type,
      prompt,
      options,
      correct,
      answer: fields.answer ?? correct.map((c) => options[c]).join(", "),
      accept: fields.accept ? fields.accept.split("|").map((s) => s.trim()).filter(Boolean) : [],
      explanation: fields.explanation ?? "",
      rubric: fields.rubric ?? "",
      source: "file" as const,
    };
  });
  // Every saved question must carry its answer: grading (manual or AI) is done against it.
  const questions = parsed.filter((q) => {
    const ok = q.type === "mcq" || q.type === "multi" ? q.correct.length > 0 : q.answer.length > 0;
    if (!ok) console.warn(`Skipping ${q.id}: no answer key (mark options with [x] or add an "answer:" line).`);
    return ok;
  });
  return { notes: notes.replace(/<!--[\s\S]*?-->/g, "").trim(), questions };
}
