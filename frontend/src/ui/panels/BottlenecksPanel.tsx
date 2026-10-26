import { useCity } from "../../store/useCity";
import { useCityLayout } from "../../lib/city";
import { pushLog } from "../logFeed";
import type { LaidBuilding } from "../../lib/layout";

/* ── BOTTLENECKS — the actionable list behind the BOTTLENECKS stat card.
      Every building the analyzer flags (complexity >= 60 critical,
      >= 40 elevated), sorted critical-first. Click a row → the camera
      flies to that building and the inspector opens on it. ── */

function Row({ b, onPick }: { b: LaidBuilding; onPick: (id: string) => void }) {
  const critical = b.health === "error";
  return (
    <button
      onClick={() => onPick(b.id)}
      className={`block w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
        critical
          ? "border-signal/70 bg-signal/5 hover:border-signal hover:bg-signal/10"
          : "border-[#f59e0b]/60 bg-[#f59e0b]/5 hover:border-[#f59e0b] hover:bg-[#f59e0b]/10"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-bold">
          {critical ? "⛔" : "⚠"} {b.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-black-ink/70">
          cx {b.complexity ?? "?"}/100
        </span>
      </span>
      <span className="mt-0.5 block text-[10px] text-black-ink/60">
        {b.kind} · {b.districtName} · {b.loc} LOC
      </span>
      <span className="mt-0.5 block text-[10px] italic text-black-ink/55">
        {critical
          ? "critical hub — split responsibilities, extract helpers"
          : "elevated complexity — candidate for extraction"}
      </span>
    </button>
  );
}

export function BottlenecksPanel({ onClose }: { onClose: () => void }) {
  const L = useCityLayout();
  const select = useCity((s) => s.select);
  const setFocus = useCity((s) => s.setFocus);

  const flagged = L.buildings.filter((b) => b.health !== "ok");
  const rank = (b: LaidBuilding) => (b.health === "error" ? 0 : 1);
  const sorted = [...flagged].sort(
    (a, b) => rank(a) - rank(b) || (b.complexity ?? 0) - (a.complexity ?? 0),
  );
  const critical = sorted.filter((b) => b.health === "error");
  const elevated = sorted.filter((b) => b.health === "warn");

  const pick = (id: string) => {
    const b = L.byId.get(id);
    if (!b) return;
    select(id);
    setFocus(b.pos[0], b.pos[2]);
    pushLog("fe", `inspect ${b.name}`, "info");
  };

  return (
    <div id="cc-bottlenecks" className="mt-2 rounded-xl border-[1.5px] border-black-ink bg-paper/97 shadow-[4px_4px_0_rgba(0,0,0,.3)]">
      <div className="flex items-center justify-between border-b-[1.5px] border-black-ink px-3 py-2" data-drag>
        <span className="caption-caps font-bold">
          BOTTLENECKS <span className="text-signal">({sorted.length})</span>
        </span>
        <button
          onClick={onClose}
          aria-label="Close bottlenecks"
          className="text-black-ink/45 transition-colors hover:text-signal"
        >
          ✕
        </button>
      </div>

      <div className="max-h-[45vh] space-y-1 overflow-y-auto p-2">
        {sorted.length === 0 && (
          <p className="px-1 py-2 text-xs text-emerald-700">
            ✓ No bottlenecks — every building is below 40 complexity.
          </p>
        )}

        {critical.length > 0 && (
          <>
            <div className="caption-caps px-1 pt-0.5 text-[9px] font-bold text-signal">
              CRITICAL ({critical.length})
            </div>
            {critical.map((b) => (
              <Row key={b.id} b={b} onPick={pick} />
            ))}
          </>
        )}

        {elevated.length > 0 && (
          <>
            <div className="caption-caps px-1 pt-1.5 text-[9px] font-bold text-[#b45309]">
              ELEVATED ({elevated.length})
            </div>
            {elevated.map((b) => (
              <Row key={b.id} b={b} onPick={pick} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
