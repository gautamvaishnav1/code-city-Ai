import { useMemo, useState } from "react";
import { Keyboard } from "lucide-react";
import { KIND_COLOR } from "../../lib/layout";
import { useCityLayout } from "../../lib/city";
import { SHORTCUTS } from "../shortcuts";
import { DraggablePanel } from "../DraggablePanel";

const keyLabel = (k: string) => (k === "escape" ? "Esc" : k === "/" ? "/" : k.toUpperCase());

export function LegendPanel() {
  const layout = useCityLayout();
  const [open, setOpen] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    layout.buildings.forEach((b) => m.set(b.kind, (m.get(b.kind) ?? 0) + 1));
    return m;
  }, [layout]);

  if (!open)
    return (
      <DraggablePanel id="legend" className="pointer-events-auto absolute bottom-4 left-3 max-md:bottom-40" resizable={false}>
        <button
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 text-xs text-black-ink/75 hover:border-signal"
        >
          ☰ Legend &amp; keys
        </button>
      </DraggablePanel>
    );

  return (
    <DraggablePanel id="legend" className="pointer-events-auto absolute bottom-4 left-3 max-md:bottom-40" resizable={false}>
      <div className="w-56 rounded-none border-[1.5px] border-black-ink bg-paper/95 p-3 text-xs">
        <div className="flex items-start justify-between">
          <div className="mb-2 font-bold text-black-ink/75">BUILDING LEGEND</div>
          <button onClick={() => setOpen(false)} aria-label="Close legend" className="text-black-ink/45 hover:text-black-ink">
            ✕
          </button>
        </div>
        <div className="grid grid-cols-2 gap-y-1">
          {(Object.keys(KIND_COLOR) as (keyof typeof KIND_COLOR)[]).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: KIND_COLOR[k] }} />
              <span className="text-black-ink/75">{k}</span>
              <span className="text-black-ink/60">×{counts.get(k) ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 border-t border-black-ink/30 pt-2 text-[10px] leading-relaxed text-black-ink/65">
          <Keyboard size={10} className="mr-1 inline" />
          {SHORTCUTS.map((s, i) => (
            <span key={s.key}>
              <b>{keyLabel(s.key)}</b> {s.label}
              {i < SHORTCUTS.length - 1 ? " · " : ""}
            </span>
          ))}
        </div>
      </div>
    </DraggablePanel>
  );
}
