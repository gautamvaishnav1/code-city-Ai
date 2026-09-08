import { useCity } from "../../store/useCity";
import { useCityLayout } from "../../lib/city";

/* ── broken-pipeline ALERTS — top-right dialogs + floating map pins feed off
      store.healthEvents; clicking one flies you to the broken building.
      Card = plain div; inspect + dismiss are SIBLING buttons (never nested
      interactive elements). ── */
export function AlertStack() {
  const events = useCity((s) => s.healthEvents);
  const dismiss = useCity((s) => s.dismiss);
  const pick = useCity((s) => s.select);
  const setFocus = useCity((s) => s.setFocus);
  const L = useCityLayout();
  const shown = events.slice(-3);
  if (shown.length === 0) return null;
  return (
    <div className="pointer-events-auto grid w-full gap-2">
      {shown.map((ev) => {
        const b = L.byId.get(ev.buildingId);
        return (
          <div
            key={ev.id}
            className={`relative rounded-xl border-[1.5px] bg-paper/97 p-3 text-xs shadow-[4px_4px_0_rgba(0,0,0,.35)] ${
              ev.kind === "error" ? "border-signal" : ev.kind === "warn" ? "border-[#f59e0b]" : "border-emerald-600"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <button
                onClick={() => {
                  if (b) {
                    pick(b.id);
                    setFocus(b.pos[0], b.pos[2]);
                  }
                }}
                className="min-w-0 flex-1 text-left font-bold"
              >
                <span className="block">
                  {ev.kind === "error" ? "⛔ PIPELINE DOWN" : ev.kind === "warn" ? "⚠ DEGRADED" : "✓ RECOVERED"} ·{" "}
                  <span className="text-signal">{ev.name}</span>
                </span>
                <span className="mt-0.5 block font-normal text-black-ink/65">
                  {ev.detail} — click to inspect &amp; ask AI how to fix it.
                </span>
              </button>
              <button
                onClick={() => dismiss(ev.id)}
                aria-label="Dismiss alert"
                className="shrink-0 text-black-ink/40 hover:text-signal"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
      <div className="caption-caps text-right text-[9px] text-black-ink/60">
        {events.length} OPEN INCIDENT{events.length === 1 ? "" : "S"}
      </div>
    </div>
  );
}
