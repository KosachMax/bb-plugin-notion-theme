import { useEffect, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { LimitBanner } from "./src/LimitBanner";
import { mountHoverCards } from "./src/hoverCards";
import "./app.css";

type Font = "default" | "serif" | "mono";
const isFont = (v: unknown): v is Font => v === "default" || v === "serif" || v === "mono";

// Current content font, kept in plugin storage and pushed to every window.
function useFont(): Font {
  const rpc = useRpc<typeof rpcContract>();
  const [font, setFont] = useState<Font>("default");
  useEffect(() => { rpc.call("font_get", {}).then((r) => setFont(r.font), () => {}); }, [rpc]);
  useRealtime("font-changed", (p) => { const f = (p as { font?: unknown } | null)?.font; if (isFont(f)) setFont(f); });
  return font;
}

// Marks <html> with the chosen font; themes/notion.css reacts to it.
function FontAttribute() {
  const font = useFont();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.notionFont = font;
    return () => { delete root.dataset.notionFont; };
  }, [font]);
  return null;
}

const TILES: { font: Font; label: string; family: string }[] = [
  { font: "default", label: "Default", family: "ui-sans-serif, -apple-system, sans-serif" },
  { font: "serif", label: "Serif", family: "\"Lyon-Text\", Georgia, serif" },
  { font: "mono", label: "Mono", family: "\"SFMono-Regular\", Menlo, monospace" },
];

function FontPicker() {
  const saved = useFont();
  const rpc = useRpc<typeof rpcContract>();
  const [picked, setPicked] = useState<Font | null>(null);
  const current = picked ?? saved;
  useEffect(() => { if (picked === saved) setPicked(null); }, [picked, saved]);
  return (
    <div className="nt-fonts" role="radiogroup" aria-label="Font">
      {TILES.map((t) => (
        <button key={t.font} type="button" role="radio" aria-checked={current === t.font}
          className="nt-font" data-on={current === t.font || undefined}
          onClick={() => { setPicked(t.font); rpc.call("font_set", { font: t.font }).catch(() => setPicked(null)); }}>
          <span className="nt-font-ag" style={{ fontFamily: t.family }}>Ag</span>
          <span className="nt-font-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "hover-cards", mount: ({ signal }) => mountHoverCards(signal) });
  app.composer.customize({ id: "limit-notice", scopes: ["thread"], banners: [{ id: "limit", chrome: "bare", component: LimitBanner }] });
  app.slots.experimental_appOverlay({ id: "font-attribute", component: FontAttribute });
  app.slots.settingsSection({ id: "font", title: "Font", description: "Applies to messages and the composer.", component: FontPicker });
});
