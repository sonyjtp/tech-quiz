import { NextResponse } from "next/server";
import { dbConfigured, getStats } from "@/lib/db";
import { StatsRequest } from "@/lib/api-schemas";
import { currentUser, unauthorized } from "@/lib/auth";
import { DB_DOWN } from "@/lib/api-errors";

export async function POST(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  const user = await currentUser();
  if (!user) return unauthorized();
  const parsed = StatsRequest.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    return NextResponse.json({ stats: await getStats(user.id, parsed.data.ids) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: DB_DOWN }, { status: 503 });
  }
}
