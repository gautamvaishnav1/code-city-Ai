import { useMemo, useState } from "react";
import { Waves } from "lucide-react";
import { apiFetch } from "../lib/auth";
import { allFlows, flowAuth, flowsThrough, useCityLayout } from "../lib/city";
import { startFlow } from "../lib/flowRunner";
import { useCity } from "../store/useCity";
import { pushLog } from "./logFeed";
import { DraggablePanel } from "./DraggablePanel";
import { MissionStrip } from "./MissionStrip";
import { useCityShortcuts } from "./shortcuts";
import { useAsyncAction } from "./useAsyncAction";
import { useRepoAnalysis } from "./hooks/useRepoAnalysis";
import { MainMenu } from "./Mainmenu";
import { FlowEdgeCard } from "./FlowEdgeCard";
import { RecentProjects } from "./RecentProjects";
import { RepoLoader } from "./RepoLoader";
import { UserChip } from "./UserChip";
import { AlertStack } from "./panels/AlertStack";
import { BottlenecksPanel } from "./panels/BottlenecksPanel";
import { WeatherPanel } from "./panels/WeatherPanel";
import { LogPanel } from "./panels/LogPanel";
import { ImprovementGuide } from "./panels/ImprovementGuide";
import { RequestFlowButton } from "./panels/ApiWorkflows";
import { LegendPanel } from "./panels/LegendPanel";

/** one stat tile in the telemetry panel */
function Stat({ label, value, tone = "signal" }: { label: string; value: string | number; tone?: "signal" | "good" | "warn" | "muted" }) {
  const color =
    tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-[#f59e0b]" : tone === "muted" ? "text-black-ink/45" : "text-signal";
  return (
    <div className="rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 text-xs">
      <div className="text-black-ink/60">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

/**
 * HUD — after a build the screen is JUST the 3D city plus the ☰ MENU (build,
 * search, view options, panel toggles all live there) and the REQUEST FLOW
 * button. Contextual pieces (post-build CTA, incidents, inspector, toasts)
 * appear on their own; everything else is a closable popup opened from the
 * menu (✕ hides any panel, menu re-opens it).
 */
export function HUD() {
  const layout = useCityLayout();
  const { busy: building, analyze, progress } = useRepoAnalysis();
  // granular selectors — no whole-store subscription (time ticks etc.
  // must not re-render the whole HUD)
  const projectName = useCity((s) => s.city.project.name);
  const healthScore = useCity((s) => s.city.healthScore);
  const city = useCity((s) => s.city);
  const cityEdges = useCity((s) => s.city.edges);
  const guideCta = useCity((s) => s.guideCta);
  const notifications = useCity((s) => s.notifications);
  const selectedId = useCity((s) => s.selectedId);
  const selectedFnName = useCity((s) => s.selectedFn);

  const patch = useCity((s) => s.patch);
  const select = useCity((s) => s.select);
  const setFocus = useCity((s) => s.setFocus);

  useCityShortcuts(true);

  const [bnOpen, setBnOpen] = useState(false);
  const sel = layout.byId.get(selectedId ?? "");
  const selFn = sel?.functions.find((f) => f.name === selectedFnName);
  const hasCity = layout.buildings.length > 0;
  const lines = layout.buildings.reduce((a, b) => a + b.loc, 0);
  const bnCount = layout.buildings.filter((b) => b.health !== "ok").length;

  const pick = (id: string) => {
    const b = layout.byId.get(id);
    if (!b) return;
    select(id);
    setFocus(b.pos[0], b.pos[2]);
    pushLog("fe", `inspect ${b.name}`, "info");
  };

  // memoized connections for the inspector (was filtered 6× per render)
  const conn = useMemo(() => {
    if (!selectedId) return null;
    return {
      callers: cityEdges.filter((e) => e.to === selectedId),
      calls: cityEdges.filter((e) => e.from === selectedId),
    };
  }, [cityEdges, selectedId]);

  // JWT policy per building — "NO JWT" only when every flow through the
  // building is public; one protected flow and the badge reads JWT.
  const flows = useMemo(() => allFlows(city), [city]);
  const authOf = useMemo(() => {
    const map = new Map<string, "JWT" | "PUBLIC">();
    for (const [key, chain] of Object.entries(flows)) {
      const req = flowAuth(key, city).requiresAuth;
      for (const id of chain) {
        if (req) map.set(id, "JWT");
        else if (!map.has(id)) map.set(id, "PUBLIC");
      }
    }
    return map;
  }, [flows, city]);
  const selFlows = useMemo(() => (selectedId ? flowsThrough(city, selectedId) : []), [city, selectedId]);

  const AuthBadge = ({ id }: { id: string }) => {
    const pub = authOf.get(id) === "PUBLIC";
    return (
      <span
        className={`ml-auto shrink-0 rounded-sm px-1 font-mono text-[8px] font-black ${
          pub ? "border border-emerald-600 text-emerald-700" : "bg-black-ink text-paper"
        }`}
        title={pub ? "Public route — requests reach it with NO Authorization header" : "Behind requireAuth() — needs a valid JWT"}
      >
        {pub ? "NO JWT" : "JWT"}
      </span>
    );
  };

  // local static explanation (instant, no network)
  const explain = (b: NonNullable<typeof sel>, fn: NonNullable<typeof selFn>) =>
    `${fn.name}(${fn.args}) — ${fn.purpose}. It receives (${fn.args}) and returns ${fn.returns}. ` +
    `In the city, it lives inside the "${b.name}" building (${b.districtName} district). ` +
    `Requests reaching it arrive from ${
      conn?.callers.map((e) => layout.byId.get(e.from)?.name).join(", ") || "the client"
    } and continue to ${conn?.calls.map((e) => layout.byId.get(e.to)?.name).join(", ") || "nothing"}.`;

  // AI deep analysis of the selected building (backend LLM)
  const ai = useAsyncAction(async (b: NonNullable<typeof sel>) => {
    pushLog("fe", `AI analyze ${b.name}…`, "info");
    const res = await apiFetch(`/insights/building`, {
      method: "POST",
      body: JSON.stringify({
        building: { id: b.id, name: b.name, kind: b.kind, loc: b.loc, health: b.health, district: b.districtName, stack: b.stack },
        connections: [...(conn?.callers ?? []), ...(conn?.calls ?? [])],
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
    pushLog("fe", `AI analysis ready for ${b.name}`, "ok");
    return (json.data?.analysis ?? JSON.stringify(json.data)) as string;
  });

  const notifHover = {
    info: "hover:bg-black-ink/10",
    success: "hover:bg-emerald-500/20",
    error: "hover:bg-red-500/20",
  } as const;

  return (
    <div className="absolute inset-0 pointer-events-none text-black-ink font-mono">
      {/* FIRST RUN (no city) — just the essentials: logo, build, account */}
      {!hasCity && (
        <div className="absolute left-0 right-0 top-0 flex flex-wrap items-center gap-2 p-3 pointer-events-auto">
          <button
            onClick={() => {
              location.hash = "";
            }}
            title="Back to landing page"
            className="shrink-0 cursor-pointer rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 font-bold transition-colors hover:text-signal"
          >
            🏙<span className="hidden sm:inline"> CODECITY AI</span>
          </button>
          <RepoLoader busy={building} analyze={analyze} progress={progress} />
          <UserChip />
        </div>
      )}

      {/* CITY MODE — the whole chrome is ☰ MENU + REQUEST FLOW, nothing else */}
      {hasCity && (
        <div className="pointer-events-auto absolute left-3 top-3 z-50 flex items-start gap-2">
          <MainMenu busy={building} analyze={analyze} progress={progress} />
          <RequestFlowButton />
        </div>
      )}

      {/* contextual top-right — picked data flow, post-build next step + incidents */}
      <div className="pointer-events-auto absolute right-3 top-3 z-40 flex w-80 max-w-[calc(100vw-24px)] flex-col gap-2">
        <FlowEdgeCard />
        {guideCta && (
          <div className="relative rounded-xl border-[1.5px] border-signal bg-signal/10 p-3 text-xs shadow-[4px_4px_0_rgba(0,0,0,.35)]">
            <div className="flex items-start justify-between gap-2">
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("cc-open-guide"));
                  patch({ guideCta: false });
                }}
                className="flex-1 text-left font-bold"
              >
                📐 HOW CAN I IMPROVE YOUR SYSTEM?
                <span className="mt-0.5 block font-normal text-black-ink/70">
                  The AI architect reads your whole city and writes a prioritized fix list — open the
                  improvement guide →
                </span>
              </button>
              <button
                onClick={() => patch({ guideCta: false })}
                aria-label="Dismiss improvement suggestion"
                className="shrink-0 text-black-ink/45 transition-colors hover:text-signal"
              >
                ✕
              </button>
            </div>
          </div>
        )}
        <AlertStack />
      </div>

      {/* telemetry — ☰ → Panels → Telemetry stats */}
      <DraggablePanel id="telemetry" className="absolute left-3 top-32 pointer-events-auto lg:top-16" resizable={false}>
        {hasCity && (
          <div data-drag className="mb-2 max-w-[240px] truncate font-mono text-[11px] text-black-ink/70" title={projectName}>
            {projectName}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-nodrag>
          <Stat label="FILES" value={layout.buildings.length} />
          <Stat label="LINES" value={lines} />
          <Stat label="DISTRICTS" value={layout.districts.length} />
          <Stat
            label="HEALTH"
            value={healthScore ?? "—"}
            tone={healthScore == null ? "muted" : healthScore >= 80 ? "good" : healthScore >= 60 ? "warn" : "signal"}
          />
          <button
            onClick={() => setBnOpen((o) => !o)}
            aria-expanded={bnOpen}
            aria-controls="cc-bottlenecks"
            title={bnCount > 0 ? "Show which buildings are bottlenecks" : "No bottlenecks flagged"}
            className={`rounded-xl border-[1.5px] px-3 py-2 text-left text-xs transition-colors ${
              bnCount > 0 ? "border-signal bg-signal/5 hover:bg-signal/15" : "border-black-ink bg-paper/95 hover:border-emerald-600"
            } ${bnOpen ? "ring-1 ring-black-ink" : ""}`}
          >
            <div className="text-black-ink/60">BOTTLENECKS</div>
            <div className={`text-lg font-bold ${bnCount > 0 ? "text-signal" : "text-emerald-600"}`}>{bnCount}</div>
          </button>
        </div>
        {bnOpen && <BottlenecksPanel onClose={() => setBnOpen(false)} />}
      </DraggablePanel>

      {/* first-run empty state — no fake preloaded city, just clear guidance */}
      {!building && !hasCity && (
        <div className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-4">
          <div className="pointer-events-auto mx-auto max-w-md rounded-xl border-[1.5px] border-black-ink bg-paper/95 p-5 text-center shadow-[6px_6px_0_rgba(0,0,0,.35)]">
            <div className="text-3xl">🏙</div>
            <div className="mt-1 font-bold">No city yet</div>
            <p className="mt-2 text-xs leading-relaxed text-black-ink/70">
              Paste a <b>github.com/owner/repo</b> URL in the top bar and press <b>BUILD CITY</b> — CodeCity
              downloads the repo, reads every file and builds its living 3D twin.
            </p>
            <button
              onClick={() => void analyze("demo://beach-resort")}
              disabled={building}
              title="Analyze the bundled Beach Resort demo project (full-stack MERN, no download)"
              className="mt-3 min-h-[36px] rounded-xl border-[1.5px] border-black-ink bg-paper-deep px-3 py-2 text-xs font-bold transition-colors hover:bg-black-ink hover:text-paper disabled:opacity-50"
            >
              <Waves size={12} className="mr-1 inline" />
              or explore the Beach Resort demo →
            </button>
            <div className="mt-4 border-t border-black-ink/20 pt-3 text-left">
              <div className="caption-caps mb-1.5 font-bold text-black-ink/55">Your previous projects</div>
              <RecentProjects />
            </div>
          </div>
        </div>
      )}

      {/* notifications bottom-right — capped at 3, ✕ (panel) hides them */}
      {notifications.length > 0 && (
        <DraggablePanel id="notifs" className="pointer-events-auto absolute bottom-4 right-3 z-30 max-md:bottom-44 max-md:left-3 max-md:right-3" resizable={false}>
          <div className="grid w-72 gap-2 max-md:w-auto">
            {(() => {
              const shown = notifications.slice(-3);
              const hidden = notifications.length - shown.length;
              return (
                <>
                  {hidden > 0 && (
                    <button
                      onClick={() => notifications.slice(0, hidden).forEach((n) => useCity.getState().dismiss(n.id))}
                      className="rounded-xl border-[1.5px] border-black-ink/50 bg-paper-deep px-3 py-1 text-left text-[10px] font-bold text-black-ink/60 hover:border-signal hover:text-signal"
                    >
                      ＋{hidden} MORE — dismiss
                    </button>
                  )}
                  {shown.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        if (n.target) pick(n.target);
                      }}
                      className={`rounded-xl border-[1.5px] border-black-ink bg-paper px-3 py-2 text-left text-xs ${notifHover[n.type]}`}
                    >
                      {n.text}
                    </button>
                  ))}
                </>
              );
            })()}
          </div>
        </DraggablePanel>
      )}

      {/* inspector — contextual popup, only while a building is selected */}
      {sel && conn && (
        <DraggablePanel
          id="inspector"
          className="pointer-events-auto fixed right-3 top-1/2 z-40 w-80 max-w-[calc(100vw-24px)] -translate-y-1/2"
          resizable={false}
        >
          <div className="max-h-[72vh] w-full overflow-auto rounded-xl border-[1.5px] border-black-ink bg-paper/97 p-4 text-sm shadow-[4px_4px_0_rgba(0,0,0,.3)]">
            <div data-drag className="flex touch-none justify-between items-start">
              <div>
                <div className="font-bold text-signal">{sel.name}</div>
                <div className="text-xs text-black-ink/65">
                  {sel.districtName} · {sel.kind} · {sel.loc} LOC
                  {sel.complexity != null ? ` · cx ${sel.complexity}/100` : ""} ·{" "}
                  <span className={sel.health === "ok" ? "text-black-ink" : "text-signal"}>{sel.health}</span>
                </div>
              </div>
              <button onClick={() => select(null)} aria-label="Close inspector" className="text-black-ink/45 hover:text-black-ink">
                ✕
              </button>
            </div>

            {/* CONNECTIONS */}
            <div className="mt-3 text-xs font-bold text-black-ink/65">CONNECTIONS</div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-black-ink/40 bg-paper-deep p-2">
                <div className="mb-1 font-bold">◀ CALLERS ({conn.callers.length})</div>
                {conn.callers.map((e) => (
                  <button key={e.from + e.to} onClick={() => pick(e.from)} className="flex w-full items-center gap-1 text-left">
                    <span className="min-w-0 truncate underline decoration-dotted hover:text-signal">
                      {layout.byId.get(e.from)?.name ?? e.from}
                    </span>
                    <AuthBadge id={e.from} />
                  </button>
                ))}
                {conn.callers.length === 0 && <span className="text-black-ink/60">client requests only</span>}
              </div>
              <div className="rounded-lg border border-black-ink/40 bg-paper-deep p-2">
                <div className="mb-1 font-bold">CALLS ({conn.calls.length}) ▶</div>
                {conn.calls.map((e) => (
                  <button key={e.from + e.to} onClick={() => pick(e.to)} className="flex w-full items-center gap-1 text-left">
                    <span className="min-w-0 truncate underline decoration-dotted hover:text-signal">
                      {layout.byId.get(e.to)?.name ?? e.to}
                    </span>
                    <AuthBadge id={e.to} />
                  </button>
                ))}
                {conn.calls.length === 0 && <span className="text-black-ink/60">nothing downstream</span>}
              </div>
            </div>

            {/* REQUEST FLOWS that pass through this building */}
            <div className="mt-3 text-xs font-bold text-black-ink/65">REQUEST FLOWS VIA THIS BUILDING</div>
            {selFlows.length === 0 && (
              <div className="text-xs text-black-ink/60">none — no API path runs through it</div>
            )}
            {selFlows.map((key) => {
              const info = flowAuth(key, city);
              const pub = !info.requiresAuth;
              return (
                <div key={key} className="mt-1 flex items-center gap-1.5 rounded border border-black-ink/40 bg-paper-deep px-2 py-1 text-[11px]">
                  <span className="shrink-0 rounded-sm bg-black-ink px-1 py-0.5 font-mono text-[8px] font-black text-paper">
                    {info.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={info.path || `${key} — URL not recoverable by static analysis`}>
                    {info.path || `${info.label} · no URL`}
                  </span>
                  <span
                    className={`shrink-0 rounded-sm px-1 font-mono text-[8px] font-black ${
                      pub ? "border border-emerald-600 text-emerald-700" : "bg-black-ink text-paper"
                    }`}
                    title={pub ? "Public route — the request goes out with NO Authorization header" : "Behind requireAuth() — needs a valid JWT"}
                  >
                    {pub ? "NO JWT" : "JWT"}
                  </span>
                  <button
                    onClick={() => startFlow(key, city)}
                    title={
                      pub
                        ? "Run this request with NO JWT — the car drives the whole road"
                        : info.path
                          ? "Run this request — the car stops at the toll if you're not signed in. Open REQUEST FLOW (top bar) to send it either way: with or without the JWT"
                          : "Trace the chain — no URL recovered, so no HTTP call is sent"
                    }
                    className="shrink-0 rounded border border-black-ink px-1.5 py-0.5 font-mono text-[9px] font-bold hover:bg-signal hover:text-paper"
                  >
                    ▶
                  </button>
                </div>
              );
            })}

            <div className="mt-3 text-xs font-bold text-black-ink/65">FUNCTIONS</div>
            {sel.functions.length === 0 && <div className="text-xs text-black-ink/60">none extracted</div>}
            {sel.functions.map((f) => (
              <button
                key={f.name}
                onClick={() => select(sel.id, f.name)}
                className={`mt-1 block w-full rounded border px-2 py-1 text-left text-xs ${
                  selectedFnName === f.name ? "border-signal bg-signal/10" : "border-black-ink/40"
                }`}
              >
                {f.name}({f.args})
              </button>
            ))}
            {selFn && (
              <div className="mt-3 rounded-lg border-[1.5px] border-black-ink bg-paper-deep p-3 text-xs">
                <div className="mb-1 font-bold text-signal">WHAT THIS DOES</div>
                {explain(sel, selFn)}
              </div>
            )}

            {/* AI GUIDE */}
            <div className="mt-3 rounded-lg border-[1.5px] border-black-ink bg-black-ink p-3 text-xs text-paper">
              <div className="mb-1 caption-caps flex items-center justify-between font-bold">
                <span className="text-signal">AI GUIDE — DEEP ANALYSIS</span>
                <button
                  onClick={() => void ai.run(sel)}
                  disabled={ai.busy}
                  className="rounded border border-paper/40 px-2 py-0.5 text-[10px] font-bold text-paper hover:border-signal hover:text-signal disabled:opacity-50"
                >
                  {ai.busy ? "THINKING…" : "ANALYZE"}
                </button>
              </div>
              {!ai.text && !ai.busy && (
                <p className="text-paper/60">
                  Ask the AI about “{sel.name}”: what it does, how it connects, hidden risks and better patterns.
                </p>
              )}
              {ai.busy && (
                <p className="animate-pulse text-paper/60">
                  Scanning {sel.name}, its {(conn.callers.length ?? 0) + (conn.calls.length ?? 0)} links and district context…
                </p>
              )}
              {ai.text && <p className="whitespace-pre-wrap leading-relaxed text-paper/90">{ai.text}</p>}
            </div>

            {/* improvement guide shortcut */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("cc-open-guide"))}
              className="mt-2 block w-full rounded-lg border-[1.5px] border-black-ink bg-paper-deep px-3 py-2 text-left text-xs font-bold hover:border-signal"
            >
              📐 Open full IMPROVEMENT GUIDE →
            </button>
          </div>
        </DraggablePanel>
      )}

      {/* menu-opened panels — each hides itself until re-opened from the menu */}
      <ImprovementGuide />
      <WeatherPanel />
      <LegendPanel />
      <LogPanel />

      {/* NOTE: FloatingNotifs is a drei <Html> and mounts INSIDE the Canvas
          (CityScene) — rendering it here would throw "Hooks can only be used
          within the Canvas component" the moment a building is selected. */}
      <MissionStrip />
    </div>
  );
}
