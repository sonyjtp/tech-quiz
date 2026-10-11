import { NextResponse } from "next/server";
import { dbConfigured, getStats } from "@/lib/db";
import { StatsRequest } from "@/lib/api-schemas";

export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  const parsed = StatsRequest.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    return NextResponse.json({ stats: await getStats(parsed.data.ids) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Can't reach the history database. Is it running? (docker compose up -d)" }, { status: 503 });
  }
}
