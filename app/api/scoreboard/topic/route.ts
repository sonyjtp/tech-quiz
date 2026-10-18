import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { TopicQuestionsRequest } from "@/lib/api-schemas";
import { currentUser, unauthorized } from "@/lib/auth";
import { topicQuestions } from "@/lib/scoreboard";
import { DB_DOWN } from "@/lib/api-errors";

/** Every saved question in a topic, with one person's attempts and correct answers on each. */
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  if (!(await currentUser())) return unauthorized();
  const parsed = TopicQuestionsRequest.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const { userId, subject, topic } = parsed.data;
    return NextResponse.json(await topicQuestions(userId, subject, topic));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: DB_DOWN }, { status: 503 });
  }
}
