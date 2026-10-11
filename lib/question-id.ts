import "server-only";
import { createHash } from "node:crypto";

/**
 * Stable question ID derived from its content, so history in the database stays attached
 * to the same question even if questions are added, removed or reordered in the file.
 * Editing a question's text makes it a new question.
 */
export function questionId(subject: string, topic: string, prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update(`${subject}/${topic}\n${normalized}`).digest("hex").slice(0, 16);
  return `${subject}/${topic}/${hash}`;
}
