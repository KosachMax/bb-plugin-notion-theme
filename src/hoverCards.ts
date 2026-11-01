// bb's hover cards (context ring, provider usage, ...) are buttons with
// aria-haspopup="dialog" that open a popover on hover. Notion behaviour:
// - hover: closes right after the pointer leaves the button and the card;
// - click: pins the card open until a second click, a click outside or Esc.
const CLOSE_DELAY = 80;
const TRIGGER = 'button[aria-haspopup="dialog"]';

// The open card: by aria-controls when set, else the open dialog in a popper layer.
const cardFor = (trigger: HTMLElement): HTMLElement | null => {
  const id = trigger.getAttribute("aria-controls");
  const byId = id ? document.getElementById(id) : null;
  if (byId) return byId;
  const open = document.querySelectorAll<HTMLElement>("[data-radix-popper-content-wrapper] > [role=\"dialog\"][data-state=\"open\"]");
  return open.length ? open[open.length - 1] : null;
};
const isOpen = (trigger: HTMLElement) => trigger.getAttribute("data-state") === "open";
const closeCard = (card: HTMLElement) =>
  card.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));

export function mountHoverCards(signal: AbortSignal): () => void {
  let active: HTMLElement | null = null;   // trigger whose card is open
  let pinned = false;
  let openedByHover = false;
  let closeTimer: number | undefined;
  // Last press on a trigger: a card that opens right after it was opened by
  // click or keyboard (model picker, menus) and is left alone.
  let lastPress: { el: Element; at: number } | null = null;
  const pressed = (t: HTMLElement) => !!lastPress && lastPress.el === t && performance.now() - lastPress.at < 600;

  const reset = () => { window.clearTimeout(closeTimer); closeTimer = undefined; active = null; pinned = false; openedByHover = false; };
  const inside = (node: EventTarget | null) => {
    if (!active || !(node instanceof Node)) return false;
    const card = cardFor(active);
    return active.contains(node) || !!card?.contains(node);
  };

  // A trigger opening on hover becomes the active one.
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const t = r.target as HTMLElement;
      if (!(t instanceof HTMLElement) || !t.matches(TRIGGER)) continue;
      if (isOpen(t)) {
        if (active === t) continue;
        reset();
        if (pressed(t)) continue;      // click-opened: not ours
        active = t; openedByHover = true;
      }
      else if (t === active) reset();
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ["data-state"], subtree: true });

  // Click on an open hover card's trigger: pin instead of closing; click again to unpin and close.
  const onClick = (e: MouseEvent) => {
    const t = (e.target as Element | null)?.closest?.(TRIGGER) as HTMLElement | null;
    if (t && t === active && isOpen(t)) {
      if (!pinned && openedByHover) { e.preventDefault(); e.stopImmediatePropagation(); pinned = true; window.clearTimeout(closeTimer); return; }
      if (pinned) { pinned = false; }  // let bb close it
      return;
    }
    if (pinned && active && !inside(e.target)) { const card = cardFor(active); if (card) closeCard(card); reset(); }
  };
  // bb closes the card on its own timer once the pointer leaves the button, even
  // on the way to the card. Hide those leaves from bb; onMove closes the card
  // itself, CLOSE_DELAY after the pointer is outside both (enough to cross the gap).
  const onLeave = (e: Event) => {
    if (active && (pinned || openedByHover) && inside(e.target)) e.stopImmediatePropagation();
  };
  // Not pinned: close soon after the pointer is outside both button and card.
  const onMove = (e: PointerEvent) => {
    if (!active || pinned || !openedByHover) return;
    if (inside(e.target)) { window.clearTimeout(closeTimer); closeTimer = undefined; return; }
    if (closeTimer !== undefined) return;
    const trigger = active;
    closeTimer = window.setTimeout(() => {
      closeTimer = undefined;
      const card = cardFor(trigger);
      if (trigger === active && !pinned && card && isOpen(trigger)) closeCard(card);
    }, CLOSE_DELAY);
  };

  const onPress = (e: Event) => {
    const t = (e.target as Element | null)?.closest?.(TRIGGER);
    if (t) lastPress = { el: t, at: performance.now() };
  };
  const opts = { capture: true, signal } as const;
  window.addEventListener("pointerdown", onPress, opts);
  window.addEventListener("keydown", onPress, opts);
  window.addEventListener("click", onClick, opts);
  for (const type of ["pointerout", "pointerleave", "mouseout", "mouseleave"]) window.addEventListener(type, onLeave, opts);
  window.addEventListener("pointermove", onMove, { passive: true, signal });
  return () => { observer.disconnect(); reset(); };
}
