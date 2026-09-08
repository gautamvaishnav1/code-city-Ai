import { useEffect, useState } from "react";
import { Ruler } from "lucide-react";
import { apiFetch } from "../../lib/auth";
import { useCityLayout } from "../../lib/city";
import { useCity } from "../../store/useCity";
import { DraggablePanel } from "../DraggablePanel";
import { useAsyncAction } from "../useAsyncAction";

/* ── AI improvement guide — repo-wide advice panel.
       Closed state renders as a launcher INSIDE the right rail (flows with
       alerts/inspector/weather, no magic viewport offsets). ── */
export function ImprovementGuide() {
  const [open, setOpen] = useState(false);
  const L = useCityLayout();
  const edges = useCity((s) => s.city.edges);

  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener("cc-open-guide", openIt);
    return () => window.removeEventListener("cc-open-guide", openIt);
  }, []);

  const scan = useAsyncAction(async () => {
    const hotspots = L.buildings
      .slice()
      .sort((a: (typeof L.buildings)[number], b: (typeof L.buildings)[number]) => b.loc - a.loc)
      .slice(0, 8)
      .map((b) => ({ id: b.id, name: b.name, kind: b.kind, loc: b.loc, health: b.health }));
    const broken = L.buildings.filter((b) => b.health !== "ok").map((b) => ({ id: b.id, name: b.name, health: b.health }));
    const res = await apiFetch(`/insights/improvements`, {
      method: "POST",
      body: JSON.stringify({
        stats: { buildings: L.buildings.length, districts: L.districts.length },
        hotspots,
        broken,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
    return (json.data?.guide ?? JSON.stringify(json.data)) as string;
  });

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-2 self-start rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 text-xs font-bold hover:border-signal"
      >
        <Ruler size={12} />
        Improvement Guide
      </button>
    );

  return (
    <DraggablePanel id="guide" className="pointer-events-auto fixed inset-x-4 top-16 bottom-16 z-40 mx-auto max-w-xl" minW={320} minH={240}>
      <div className="flex h-full flex-col overflow-hidden rounded-xl border-[1.5px] border-black-ink bg-paper/98 shadow-[6px_6px_0_rgba(0,0,0,.4)]">
        <div className="flex touch-none items-center justify-between border-b-[1.5px] border-black-ink px-4 py-3" data-drag>
          <span className="caption-caps flex items-center gap-2 font-bold">
            <Ruler size={13} />
            AI IMPROVEMENT GUIDE — {L.buildings.length} BUILDINGS SCANNED
          </span>
          <button onClick={() => setOpen(false)} aria-label="Close improvement guide" className="text-black-ink/45 hover:text-signal">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed">
          {!scan.text && !scan.busy && (
            <>
              <p className="mb-3 text-black-ink/70">
                The architect reads your whole city — sizes ({L.buildings.reduce((a: number, b) => a + b.loc, 0).toLocaleString()} LOC),
                districts, {edges.length} connections and {L.buildings.filter((b) => b.health !== "ok").length} unhealthy buildings —
                then returns:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-black-ink/80">
                <li>
                  Broken or risky code and <b>how to fix each one</b>
                </li>
                <li>Refactors: split oversized files, extract shared services</li>
                <li>Better patterns for your framework &amp; stack</li>
                <li>Architecture-level moves (caching, queues, boundaries)</li>
              </ul>
            </>
          )}
          {scan.busy && <p className="animate-pulse text-black-ink/55">Reading the whole city… this can take ~20s.</p>}
          {scan.text && <div className="whitespace-pre-wrap">{scan.text}</div>}
        </div>
        <div className="border-t-[1.5px] border-black-ink p-3">
          <button
            onClick={() => void scan.run()}
            disabled={scan.busy}
            className="w-full rounded-xl border-[1.5px] border-black-ink bg-black-ink py-2 text-sm font-bold text-paper hover:text-signal disabled:opacity-50"
          >
            {scan.busy ? "SCANNING…" : scan.text ? "REGENERATE" : "SCAN CITY WITH AI"}
          </button>
        </div>
      </div>
    </DraggablePanel>
  );
}
