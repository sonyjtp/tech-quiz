import { NextResponse } from "next/server";
import { dbConfigured, recordAttempt } from "@/lib/db";
import { AttemptRequest } from "@/lib/api-schemas";

export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  const parsed = AttemptRequest.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    return NextResponse.json({ stats: await recordAttempt(parsed.data) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Can't reach the history database. Is it running? (docker compose up -d)" }, { status: 503 });
  }
}
