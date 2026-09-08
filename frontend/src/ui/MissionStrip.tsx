import { useCity } from "../store/useCity";
import type { Verb } from "../three/missionTypes";

const VERB_COLOR: Record<string, string> = {
  dispatch: "#0891b2",
  gate: "#d97706",
  arrive: "#ea580c",
  work: "#db2777",
  verify: "#7c3aed",
  query: "#059669",
  done: "#16a34a",
};

/**
 * Bottom-center mission strip — hop cards are anchored to NOTHING in 3D, so
 * they can never collide with district labels, tooltips or the right rail.
 * The courier car keeps a small beacon; this strip explains what's happening
 * and exposes the (previously hidden ?fm=1) 2× verification button.
 */
export function MissionStrip() {
  const hud = useCity((s) => s.missionHud);
  const ff = useCity((s) => s.fastForward);
  const patch = useCity((s) => s.patch);
  if (!hud) return null;
  const pct = Math.round(hud.progress * 100);
  return (
    /* mobile: sits BELOW the hero controls — the controls lift to
       max-md:bottom-32 while a mission runs, so they never collide */
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 -translate-x-1/2 max-md:bottom-3">
      <div className="ms-wrap w-[19rem] max-w-[92vw] rounded-none border-[1.5px] border-black-ink bg-paper/95 shadow-[4px_4px_0_rgba(20,20,20,.45)]">
        <div className="flex items-center gap-1.5 border-b-[1.5px] border-black-ink px-2 py-1" style={{ background: VERB_COLOR[hud.verb] ?? "#0891b2" }}>
          <span className="font-mono text-[9px] font-black uppercase tracking-wider text-white">{hud.verb}</span>
          <span className="ml-auto font-mono text-[9px] text-white/85">step {hud.idx + 1}/{hud.total} · {pct}%</span>
        </div>
        <div className="px-2 py-1.5">
          <div className="font-mono text-[11px] font-bold text-black-ink">{hud.title}</div>
          {hud.detail.map((line, i) => (
            <div key={i} className="font-mono text-[9.5px] leading-snug text-black-ink/75">{line}</div>
          ))}
          <div className="mt-1 flex h-1 items-stretch gap-1">
            {Array.from({ length: hud.total }, (_, i) => (
              <span key={i} className="h-full flex-1" style={{ background: i <= hud.idx ? VERB_COLOR[hud.verb] ?? "#0891b2" : "rgba(20,20,20,.15)" }} />
            ))}
          </div>
        </div>
      </div>
      <button
        onClick={() => patch({ fastForward: !ff })}
        title={ff ? "Back to real-time pace" : "Fast-forward the mission (~2× cruise, snap dwells)"}
        className={`mt-1 ml-auto block rounded-none border-[1.5px] border-black-ink px-2 py-0.5 font-mono text-[9px] font-bold transition-colors ${
          ff ? "bg-signal text-paper" : "bg-paper/95 text-black-ink/70 hover:bg-signal hover:text-paper"
        }`}
      >
        {ff ? "▶▶ 2× ON" : "▶▶ 2×"}
      </button>
    </div>
  );
}

export type { Verb };
