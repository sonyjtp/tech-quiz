import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

/** A message that's safe and useful to show the learner. */
export function errorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid Anthropic API key.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Claude API. Try again shortly.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : "Unknown error";
}

export function errorResponse(err: unknown) {
  console.error(err);
  const status =
    err instanceof Anthropic.RateLimitError ? 429 : err instanceof Anthropic.APIError ? 502 : 500;
  return NextResponse.json({ error: errorMessage(err) }, { status });
}
