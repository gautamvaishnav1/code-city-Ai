import { ArrowRight, X } from "lucide-react";
import { useCityLayout } from "../lib/city";
import { useCity } from "../store/useCity";
import type { EdgeNode } from "../types";

/** plain-English label for each connection kind — the card answers
 *  "which modules talk to each other, and HOW?" */
const KIND: Record<EdgeNode["kind"], { label: string; how: string; dot: string }> = {
  http: { label: "API REQUEST", how: "sends an HTTP request to", dot: "bg-cyan-500" },
  import: { label: "MODULE IMPORT", how: "imports code from", dot: "bg-violet-500" },
  query: { label: "DATABASE QUERY", how: "reads / writes data through", dot: "bg-emerald-500" },
};

/** One endpoint of a data flow — module scope so React never sees a
 *  component being created during render (react-hooks rule). */
function End({
  id,
  name,
  meta,
  onOpen,
}: {
  id: string;
  name: string;
  meta: string;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onOpen(id)}
      title="Open this module's inspector"
      className="flex w-full items-center gap-2 rounded-lg border border-black-ink/25 bg-paper-deep px-2 py-1.5 text-left transition-colors hover:border-signal hover:bg-signal/10"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold">{name}</span>
        <span className="block truncate text-[10px] text-black-ink/55">{meta}</span>
      </span>
    </button>
  );
}

/**
 * FLOW EDGE INSPECTOR — opened by clicking a data-flow bubble in the 3D city.
 * Names both endpoints (with their districts), says how they communicate, and
 * links straight into each building's inspector.
 */
export function FlowEdgeCard() {
  const edge = useCity((s) => s.selectedEdge);
  const selectEdge = useCity((s) => s.selectEdge);
  const select = useCity((s) => s.select);
  const setFocus = useCity((s) => s.setFocus);
  const layout = useCityLayout();

  if (!edge) return null;
  const a = layout.byId.get(edge.from);
  const b = layout.byId.get(edge.to);
  if (!a || !b) return null;

  const kind = KIND[edge.kind];
  const routes = ([a, b] as const).filter((n) => n.route);

  const open = (id: string) => {
    const t = layout.byId.get(id);
    if (!t) return;
    select(id);
    setFocus(t.pos[0], t.pos[2]);
  };

  return (
    <div className="rounded-xl border-[1.5px] border-black-ink bg-paper p-3 text-xs shadow-[4px_4px_0_rgba(0,0,0,.35)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider">
          <span className={`inline-block h-2 w-2 rounded-full ${kind.dot}`} />
          Data flow · {kind.label}
        </div>
        <button
          onClick={() => selectEdge(null)}
          aria-label="Close data flow card"
          className="-mt-0.5 shrink-0 text-black-ink/45 transition-colors hover:text-signal"
        >
          <X size={13} />
        </button>
      </div>

      <p className="mt-1.5 leading-relaxed text-black-ink/75">
        <b>{a.name}</b> {kind.how} <b>{b.name}</b>.
      </p>

      <div className="mt-2 grid gap-1">
        <End
          id={a.id}
          name={a.name}
          meta={`${a.districtName} · ${a.kind}`}
          onOpen={open}
        />
        <div className="flex items-center gap-1 pl-2 text-[10px] text-black-ink/45">
          <ArrowRight size={11} className="rotate-90" /> sends to
        </div>
        <End
          id={b.id}
          name={b.name}
          meta={`${b.districtName} · ${b.kind}`}
          onOpen={open}
        />
      </div>

      {routes.length > 0 && (
        <div className="mt-2 grid gap-1">
          {routes.map((n) => (
            <div
              key={n.id}
              className="rounded-lg border border-black-ink/20 bg-black-ink px-2 py-1.5 font-mono text-[10px] text-paper"
              title={n.route?.handler ? `handler: ${n.route.handler}` : undefined}
            >
              <span className="text-paper/55">{n.name}</span>{" "}
              {n.route!.method} {n.route!.path}
              {n.route!.guarded !== undefined && (
                <span className={`ml-1 ${n.route!.guarded ? "text-signal" : "text-emerald-400"}`}>
                  {n.route!.guarded ? "· JWT" : "· NO JWT"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-black-ink/55">
        Click a module above to inspect it · click empty ground to close.
      </p>
    </div>
  );
}
