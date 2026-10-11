import { NextResponse } from "next/server";
import { aiEnabled, generateQuestions } from "@/lib/claude";
import { GenerateRequest } from "@/lib/api-schemas";
import { errorResponse } from "@/lib/api-errors";

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!aiEnabled()) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 503 });
  const parsed = GenerateRequest.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  try {
    return NextResponse.json(await generateQuestions(parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
