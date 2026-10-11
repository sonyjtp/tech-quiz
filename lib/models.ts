import type { TokenUsage } from "./types";

export interface ModelOption {
  id: string;
  label: string;
  note: string;
  /** USD per million tokens. Cache writes are billed at 1.25× input. */
  price: { input: number; output: number; cacheRead: number };
}

/** Models offered in the picker. Prices are USD per million input / output tokens. */
export const MODELS: ModelOption[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Recommended · $4 / $20", price: { input: 4, output: 20, cacheRead: 0.2 } },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Fast, about half the cost · $2 / $10", price: { input: 2, output: 10, cacheRead: 0.2 } },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Fastest and cheapest · $0.10 / $0.50", price: { input: 0.1, output: 0.5, cacheRead: 0.01 } },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: "Most capable, slowest · $10 / $50", price: { input: 10, output: 50, cacheRead: 0.25 } },
];

export const MODEL_IDS = MODELS.map((m) => m.id) as [string, ...string[]];
export const DEFAULT_MODEL = "claude-opus-5-5";

/** Estimated USD cost of one call, or null for a model without a known price. */
export function estimateCost(u: TokenUsage): number | null {
  const p = MODELS.find((m) => m.id === u.model)?.price;
  if (!p) return null;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.input * 1.25) / 1_000_000;
}
