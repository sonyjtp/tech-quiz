import { NextResponse } from "next/server";
import { currentUser, unauthorized } from "@/lib/auth";
import { aiEnabled, followUpStream } from "@/lib/claude";
import { FollowUpRequest } from "@/lib/api-schemas";

export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await currentUser())) return unauthorized();
  if (!aiEnabled()) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 503 });
  const parsed = FollowUpRequest.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  return new Response(followUpStream(parsed.data, req.signal), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
