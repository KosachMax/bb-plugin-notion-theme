import { useCallback, useEffect, useState } from "react";
import { useComposer, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import type { LimitState } from "./limits";

const PROVIDER_NAMES: Record<string, string> = { "claude-code": "Claude", codex: "Codex", anthropic: "Claude", openai: "OpenAI" };
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const ru = () => (document.documentElement.lang || navigator.language).toLowerCase().startsWith("ru");

function text(s: LimitState) {
  const isRu = ru();
  const who = (s.providerId && PROVIDER_NAMES[s.providerId]) ?? s.providerId ?? (isRu ? "провайдера" : "the provider");
  const window = s.label ? (isRu ? `${s.label} ` : `${s.label} `) : "";
  if (isRu) {
    const head = `Закончился ${window}лимит ${who}.`;
    const reset = s.resetsAtMs ? ` Сбросится в ${time(s.resetsAtMs)}.` : "";
    return { head: head + reset, action: s.retryScheduledAt ? `Отправится в ${time(s.retryScheduledAt)}` : s.resetsAtMs ? `Повторить в ${time(s.resetsAtMs)}` : "Повторить", dismiss: "Скрыть" };
  }
  const head = `You've hit your ${window}${who} limit.`;
  const reset = s.resetsAtMs ? ` Resets at ${time(s.resetsAtMs)}.` : "";
  return { head: head + reset, action: s.retryScheduledAt ? `Sending at ${time(s.retryScheduledAt)}` : s.resetsAtMs ? `Retry at ${time(s.resetsAtMs)}` : "Retry", dismiss: "Dismiss" };
}

// Notion-style notice that sits on top of the prompt box when a limit blocks the thread.
export function LimitBanner() {
  const { scope } = useComposer();
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<LimitState | null>(null);

  const load = useCallback(() => {
    if (!threadId) { setState(null); return; }
    rpc.call("limit_get", { threadId }).then(setState, () => setState(null));
  }, [rpc, threadId]);
  useEffect(load, [load]);
  useRealtime("limits-changed", (p) => {
    if (p && typeof p === "object" && (p as { threadId?: unknown }).threadId === threadId) load();
  });
  // Hide by itself once the window resets.
  useEffect(() => {
    if (!state?.resetsAtMs || state.retryScheduledAt) return;
    const ms = state.resetsAtMs - Date.now();
    if (ms <= 0) { setState(null); return; }
    const t = window.setTimeout(() => setState(null), Math.min(ms, 2 ** 31 - 1));
    return () => window.clearTimeout(t);
  }, [state]);

  if (!state || !threadId) return null;
  const t = text(state);
  return (
    <div className="nt-limit" role="status">
      <svg className="nt-limit-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" /><path d="M8 11.5V4.8M5.2 7.4 8 4.6l2.8 2.8" /></svg>
      <span className="nt-limit-text">{t.head}{" "}
        {state.retryScheduledAt
          ? <span className="nt-limit-done">{t.action}.</span>
          : <button type="button" className="nt-limit-link" onClick={() => rpc.call("limit_retry", { threadId }).then(setState, () => {})}>{t.action}</button>}
      </span>
      <button type="button" className="nt-limit-close" aria-label={t.dismiss} title={t.dismiss}
        onClick={() => rpc.call("limit_dismiss", { threadId }).then(() => setState(null), () => {})}>×</button>
    </div>
  );
}
