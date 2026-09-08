import { useMemo, useState } from "react";
import { ChevronDown, Workflow } from "lucide-react";
import { allFlows, FLOW_META, useCityLayout } from "../../lib/city";
import { useCity } from "../../store/useCity";
import { pushLog } from "../logFeed";
import { DraggablePanel } from "../DraggablePanel";

const METHOD_TINT: Record<string, string> = {
  POST: "bg-emerald-600/90 text-paper",
  PATCH: "bg-amber-600/90 text-paper",
  GET: "bg-sky-600/90 text-paper",
  RUN: "bg-black-ink/80 text-paper",
};

/**
 * API WORKFLOWS — the live replacement for the hardcoded RUN PAYMENT / RUN
 * CART buttons. Lists every runnable flow: the curated demo lanes plus every
 * endpoint derived from the loaded repo's route components. Clicking a row
 * dispatches a courier that drives the full call chain.
 */
export function ApiWorkflows() {
  const [open, setOpen] = useState(true);
  const city = useCity((s) => s.city);
  const dispatchMission = useCity((s) => s.dispatchMission);
  const notifyFn = useCity((s) => s.notify);
  const L = useCityLayout();

  const flows = useMemo(() => allFlows(city), [city]);

  const rows = useMemo(
    () =>
      Object.entries(flows)
        .map(([key, chain]) => {
          const meta = FLOW_META[key];
          const names = (chain as string[])
            .map((id) => L.byId.get(id)?.name ?? id)
            .filter((n, i, a) => a.indexOf(n) === i);
          return {
            key,
            label: meta ? `${meta.label} — ${meta.path}` : L.byId.get(key.slice(5))?.name ?? key,
            method: meta?.method ?? "RUN",
            chain: names.join(" → "),
            count: names.length,
          };
        })
        .sort((a, b) => (a.key.startsWith("auto:") ? 1 : 0) - (b.key.startsWith("auto:") ? 1 : 0)),
    [flows, L],
  );

  const run = (key: string, label: string) => {
    dispatchMission(key);
    notifyFn(`🚗 Dispatched ${label} — courier en route`, undefined, "info");
    pushLog("fe", `RUN ▸ courier dispatched · ${key}`, "info");
  };

  return (
    <DraggablePanel id="apis" className="pointer-events-auto" resizable={false}>
      {open ? (
        <div className="w-full rounded-xl border-[1.5px] border-black-ink bg-paper/97 shadow-[4px_4px_0_rgba(0,0,0,.3)]">
          <div className="flex items-center justify-between border-b-[1.5px] border-black-ink px-3 py-2">
            <span className="caption-caps flex items-center gap-1.5 font-bold">
              <Workflow size={12} />
              API WORKFLOWS · {rows.length}
            </span>
            <button onClick={() => setOpen(false)} aria-label="Collapse API workflows" className="text-black-ink/45 hover:text-signal">
              <ChevronDown size={13} />
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto p-1.5">
            {rows.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-black-ink/60">
                No API flows yet — analyze a repo with routes.
              </p>
            )}
            {rows.map((r) => (
              <button
                key={r.key}
                onClick={() => run(r.key, r.label)}
                title={`Dispatch a courier along: ${r.chain}`}
                className="group mb-1 block w-full rounded-lg border border-black-ink/30 bg-paper-deep px-2 py-1.5 text-left transition-colors hover:border-signal"
              >
                <div className="flex items-center gap-2">
                  <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-black tracking-wide ${METHOD_TINT[r.method] ?? METHOD_TINT.RUN}`}>
                    {r.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-black-ink group-hover:text-signal">
                    {r.label}
                  </span>
                  <span className="text-[9px] text-black-ink/55">{r.count} hops ▸</span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[9px] text-black-ink/55">{r.chain}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="flex items-center gap-2 rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 text-xs font-bold text-black-ink/75 hover:border-signal"
        >
          <Workflow size={12} />
          API Workflows · {rows.length}
        </button>
      )}
    </DraggablePanel>
  );
}
