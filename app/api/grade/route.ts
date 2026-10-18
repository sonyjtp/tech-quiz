import { NextResponse } from "next/server";
import { currentUser, unauthorized } from "@/lib/auth";
import { aiEnabled, gradeAnswer } from "@/lib/claude";
import { GradeRequest } from "@/lib/api-schemas";
import { errorResponse } from "@/lib/api-errors";

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!(await currentUser())) return unauthorized();
  if (!aiEnabled()) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 503 });
  const parsed = GradeRequest.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  try {
    return NextResponse.json({ result: await gradeAnswer(parsed.data.model, parsed.data.question, parsed.data.answer) });
  } catch (err) {
    return errorResponse(err);
  }
}
