// Notion Theme backend: the content-font setting, and the provider-limit
// banner's state (what limit a thread hit and when it resets).
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { limitFromFailure, limitStateSchema, type LimitState } from "./src/limits";

export const FONTS = ["default", "serif", "mono"] as const;
const fontSchema = z.enum(FONTS);
const threadId = z.string().min(1).max(200);

export const LIMITS_CHANNEL = "limits-changed";
export const FONT_CHANNEL = "font-changed";

export const rpcContract = defineRpcContract({
  font_get: { input: z.object({}).strict(), output: z.object({ font: fontSchema }) },
  font_set: { input: z.object({ font: fontSchema }).strict(), output: z.object({ font: fontSchema }) },
  limit_get: { input: z.object({ threadId }).strict(), output: limitStateSchema.nullable() },
  limit_retry: { input: z.object({ threadId }).strict(), output: limitStateSchema.nullable() },
  limit_dismiss: { input: z.object({ threadId }).strict(), output: z.null() },
});

export default async function plugin(bb: BbPluginApi) {
  // The content font lives in plugin storage, not in bb's settings form, so
  // the settings page shows only the Ag tiles.
  const readFont = async () => { const f = fontSchema.safeParse(await bb.storage.kv.get("font")); return f.success ? f.data : "default"; };

  const key = (id: string) => `limit:${id}`;
  async function read(id: string): Promise<LimitState | null> {
    const parsed = limitStateSchema.safeParse(await bb.storage.kv.get(key(id)));
    if (!parsed.success) return null;
    // A window that has already reset needs no banner, unless a retry is pending.
    const s = parsed.data;
    if (s.resetsAtMs !== null && s.resetsAtMs <= Date.now() && s.retryScheduledAt === null) return null;
    return s;
  }
  async function write(id: string, state: LimitState | null) {
    if (state) await bb.storage.kv.set(key(id), state);
    else await bb.storage.kv.delete(key(id));
    bb.realtime.publish(LIMITS_CHANNEL, { threadId: id });
  }

  bb.events.on("turn.failed", async (e) => {
    const state = limitFromFailure({
      threadId: e.threadId,
      requestId: e.requestId,
      rateLimits: e.rateLimits,
      errorCategory: e.errorInfo?.category ?? null,
    });
    if (state) await write(e.threadId, state);
  });
  // A turn that finished means the limit no longer blocks this thread.
  bb.events.on("thread.idle", async ({ thread }) => {
    if (await bb.storage.kv.get(key(thread.id))) await write(thread.id, null);
  });
  bb.events.on("thread.deleted", async ({ thread }) => { await bb.storage.kv.delete(key(thread.id)); });

  bb.rpc.register(rpcContract, {
    font_get: async () => ({ font: await readFont() }),
    font_set: async ({ font }) => {
      await bb.storage.kv.set("font", font);
      bb.realtime.publish(FONT_CHANNEL, { font });
      return { font };
    },
    limit_get: ({ threadId }) => read(threadId),
    limit_retry: async ({ threadId }) => {
      const s = await read(threadId);
      if (!s) return null;
      const sendAt = s.resetsAtMs !== null && s.resetsAtMs > Date.now() ? s.resetsAtMs : undefined;
      await bb.sdk.threads.retry({ threadId, turnRequestId: s.requestId, sendAt });
      const next = { ...s, retryScheduledAt: sendAt ?? Date.now() };
      await write(threadId, next);
      return next;
    },
    limit_dismiss: async ({ threadId }) => { await write(threadId, null); return null; },
  });
}
