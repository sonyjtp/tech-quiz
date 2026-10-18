import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth";

/** Posted by the "Log out" form in the header. */
export async function POST(req: Request) {
  await endSession();
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
