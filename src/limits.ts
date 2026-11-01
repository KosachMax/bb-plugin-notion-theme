import { z } from "zod";

// What the banner needs about one thread's provider limit.
export const limitStateSchema = z.object({
  threadId: z.string(),
  requestId: z.string(),
  providerId: z.string().nullable(),
  /** "blocked" stops work; "warning" is close to the limit. */
  status: z.enum(["blocked", "warning"]),
  /** Window label from the provider, e.g. "5-hour". */
  label: z.string().nullable(),
  resetsAtMs: z.number().nullable(),
  retryScheduledAt: z.number().nullable(),
});
export type LimitState = z.infer<typeof limitStateSchema>;

type Window = { label: string | null; resetsAtMs: number | null; status: string };
type RateLimits = { providerId: string; status: string; windows: readonly Window[] } | null;

/** Turn a failed turn's report into banner state, or null when no limit was hit. */
export function limitFromFailure(input: {
  threadId: string;
  requestId: string;
  rateLimits: RateLimits;
  errorCategory: string | null;
}): LimitState | null {
  const rl = input.rateLimits;
  const limited = input.errorCategory === "rate-limit" || input.errorCategory === "budget-exceeded" || rl?.status === "blocked";
  if (!limited) return null;
  const windows = rl?.windows ?? [];
  const window = windows.find((w) => w.status === "blocked") ?? windows.find((w) => w.status === "warning") ?? windows[0];
  return {
    threadId: input.threadId,
    requestId: input.requestId,
    providerId: rl?.providerId ?? null,
    status: "blocked",
    label: window?.label ?? null,
    resetsAtMs: window?.resetsAtMs ?? null,
    retryScheduledAt: null,
  };
}
