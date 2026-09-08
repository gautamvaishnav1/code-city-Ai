import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, GitBranch, LogOut, Play, Radio, Search, Video, Waves } from "lucide-react";
import { apiFetch, useAuth } from "../lib/auth";
import { useCityLayout } from "../lib/city";
import { useCity } from "../store/useCity";
import { pushLog } from "./logFeed";
import { DraggablePanel } from "./DraggablePanel";
import { MissionStrip } from "./MissionStrip";
import { useCityShortcuts } from "./shortcuts";
import { useAsyncAction } from "./useAsyncAction";
import { useRepoAnalysis } from "./hooks/useRepoAnalysis";
import { AlertStack } from "./panels/AlertStack";
import { FloatingNotifs } from "./panels/FloatingNotifs";
import { WeatherPanel } from "./panels/WeatherPanel";
import { LogPanel } from "./panels/LogPanel";
import { ImprovementGuide } from "./panels/ImprovementGuide";
import { ApiWorkflows } from "./panels/ApiWorkflows";
import { Minimap } from "./panels/Minimap";
import { LegendPanel } from "./panels/LegendPanel";

function UserChip() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  if (!user) return null;
  return (
    <div className="flex items-center gap-2 rounded-none border-[1.5px] border-black-ink bg-paper/95 px-2.5 py-2">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-black-ink text-[10px] font-bold text-paper">
        {user.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="hidden max-w-[90px] truncate font-mono text-[11px] text-black-ink/75 lg:block">{user.name}</span>
      <button onClick={signOut} title="Sign out" aria-label="Sign out" className="text-black-ink/45 transition-colors hover:text-signal">
        <LogOut size={13} />
      </button>
    </div>
  );
}

function RepoLoader() {
  const [q, setQ] = useState("");
  const { busy, analyze } = useRepoAnalysis();

  // auto-load a repo requested from the landing page hero form
  useEffect(() => {
    const pending = localStorage.getItem("cc-pending-repo");
    if (!pending) return;
    localStorage.removeItem("cc-pending-repo");
    const id = window.setTimeout(() => void analyze(pending), 0);
    return () => clearTimeout(id);
  }, [analyze]);

  return (
    <div className="relative flex items-center">
      <GitBranch size={14} className="absolute left-3 top-3 text-black-ink/55" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void analyze(q)}
        placeholder="github.com/owner/repo"
        aria-label="Repository URL"
        className="w-44 pl-8 pr-2 py-2 rounded-xl bg-paper/95 border-[1.5px] border-black-ink text-sm outline-none focus:border-signal lg:w-56"
      />
      <button
        onClick={() => void analyze(q)}
        disabled={busy}
        title={busy ? "Analysis in progress…" : "Analyze the repo and build its city"}
        className={`ml-1 px-3 py-2 rounded-xl border text-xs font-bold ${
          busy
            ? "bg-black-ink/15 border-[1.5px] border-black-ink/40 text-black-ink/50 cursor-wait"
            : "bg-signal text-paper border-[1.5px] border-black-ink shadow-[3px_3px_0_rgba(20,20,20,.35)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_rgba(20,20,20,.35)] transition-all"
        }`}
      >
        {busy ? "Building…" : "Build City"}
      </button>
      <button
        onClick={() => void analyze("demo://beach-resort")}
        disabled={busy}
        title="Analyze the bundled Beach Resort demo project (full-stack MERN, no download)"
        className="ml-1 px-3 py-2 rounded-xl border-[1.5px] border-black-ink bg-paper/95 text-xs font-bold hover:bg-black-ink hover:text-paper transition-colors disabled:opacity-50"
      >
        <Waves size={12} className="mr-1 inline" />
        Demo
      </button>
    </div>
  );
}

/* ── REAL latency telemetry — measured from actual API round-trips ── */
function LatencyButtons() {
  const ms = useCity((s) => s.apiLatencyMs);
  const speed = useCity((s) => s.latency);
  const color = ms == null ? "#94a3b8" : ms < 250 ? "#22c55e" : ms < 900 ? "#eab308" : "#ef4444";
  return (
    <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 text-xs">
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="font-bold tabular-nums">{ms == null ? "— ms" : `${Math.round(ms)} ms`}</span>
      <span className="text-black-ink/60">· {speed} traffic</span>
    </div>
  );
}

const TOGGLE_BASE =
  "rounded-xl border px-2 py-2 text-xs min-h-[36px] lg:px-3 min-w-[36px]";
const toggleClass = (on: boolean) =>
  on ? `${TOGGLE_BASE} border-black-ink bg-black-ink text-paper` : `${TOGGLE_BASE} border-[1.5px] border-black-ink/60 bg-paper-deep`;

export function HUD() {
  const layout = useCityLayout();
  // granular selectors — no whole-store subscription (time ticks etc.
  // must not re-render the whole HUD)
  const projectName = useCity((s) => s.city.project.name);
  const cityEdges = useCity((s) => s.city.edges);
  const traffic = useCity((s) => s.traffic);
  const underground = useCity((s) => s.underground);
  const linksOn = useCity((s) => s.links);
  const following = useCity((s) => s.following);
  const showcase = useCity((s) => s.showcase);
  const failing = useCity((s) => s.failing);
  const failingId = useCity((s) => s.failingId);
  const missionActive = useCity((s) => !!s.missionHud);
  const notifications = useCity((s) => s.notifications);
  const selectedId = useCity((s) => s.selectedId);
  const selectedFnName = useCity((s) => s.selectedFn);

  const patch = useCity((s) => s.patch);
  const select = useCity((s) => s.select);
  const setFocus = useCity((s) => s.setFocus);
  const dispatchMission = useCity((s) => s.dispatchMission);
  const notifyFn = useCity((s) => s.notify);
  const pushHealth = useCity((s) => s.pushHealth);

  useCityShortcuts(true);

  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const sel = layout.byId.get(selectedId ?? "");
  const selFn = sel?.functions.find((f) => f.name === selectedFnName);
  const results = useMemo(
    () =>
      q
        ? layout.buildings.filter((b) => (b.name + b.districtName).toLowerCase().includes(q.toLowerCase())).slice(0, 6)
        : [],
    [q, layout],
  );
  // highlight stays in bounds when the filter shrinks (derived, no effect)
  const hiSafe = Math.min(hi, results.length - 1);
  const lines = layout.buildings.reduce((a, b) => a + b.loc, 0);

  const pick = (id: string) => {
    const b = layout.byId.get(id);
    if (!b) return;
    select(id);
    setFocus(b.pos[0], b.pos[2]);
    setQ("");
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
      {/* top bar — wraps on tablet */}
      <div className="absolute left-0 right-0 top-0 flex flex-wrap items-center gap-2 p-3 pointer-events-auto">
        <button
          onClick={() => {
            location.hash = "";
          }}
          title="Back to landing page"
          className="cursor-pointer rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 font-bold transition-colors hover:text-signal"
        >
          🏙 CODECITY AI
        </button>
        <div className="max-w-[160px] truncate rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 text-xs md:max-w-none">{projectName}</div>
        <RepoLoader />
        <div className="relative order-last w-full sm:order-none sm:w-auto sm:flex-1 sm:max-w-md">
          <Search size={14} className="absolute left-3 top-3 text-black-ink/55" />
          <input
            id="city-search"
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHi((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && results[hiSafe]) {
                pick(results[hiSafe].id);
              }
            }}
            placeholder="Find a feature… e.g. payment   (press / )"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="city-search-listbox"
            aria-activedescendant={results[hiSafe] ? `city-opt-${results[hiSafe].id}` : undefined}
            aria-label="Search buildings"
            className="w-full rounded-xl border-[1.5px] border-black-ink bg-paper/95 py-2 pl-8 pr-3 text-sm outline-none focus:border-signal"
          />
          {results.length > 0 && (
            <div id="city-search-listbox" role="listbox" aria-label="Matching buildings" className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border-[1.5px] border-black-ink bg-paper">
              {results.map((b, i) => (
                <button
                  key={b.id}
                  id={`city-opt-${b.id}`}
                  role="option"
                  aria-selected={i === hiSafe}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(b.id)}
                  className={`block w-full px-3 py-2 text-left text-sm ${i === hiSafe ? "bg-black-ink text-paper" : "hover:bg-black-ink/10"}`}
                >
                  {b.name} <span className={i === hi ? "text-paper/60" : "text-black-ink/60"}>· {b.districtName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <UserChip />
        <div className="flex gap-2">
          <button onClick={() => patch({ traffic: !traffic })} aria-pressed={traffic} className={toggleClass(traffic)}>
            <Radio size={12} className="mr-1 inline lg:hidden xl:inline" />
            <span className="hidden lg:inline">Traffic</span>
          </button>
          <button onClick={() => patch({ underground: !underground })} aria-pressed={underground} className={toggleClass(underground)}>
            <span className="hidden lg:inline">Underground</span>
            <span className="lg:hidden">Pipes</span>
          </button>
          <button onClick={() => patch({ links: !linksOn })} aria-pressed={linksOn} className={toggleClass(linksOn)}>
            <span>Links</span>
          </button>
          <button onClick={() => patch({ following: !following })} aria-pressed={following} className={toggleClass(following)}>
            <span className="hidden lg:inline">Follow</span>
            <span className="lg:hidden">Cam</span>
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("cc-panels-reset"))}
            title="Dock all panels back to their default positions"
            className="rounded-xl border-[1.5px] border-black-ink/60 bg-paper-deep px-2 py-2 text-xs min-h-[36px] lg:px-3"
          >
            ⟲<span className="hidden lg:inline"> Reset layout</span>
          </button>
        </div>
      </div>

      {/* telemetry */}
      <DraggablePanel id="telemetry" className="absolute left-3 top-16 pointer-events-auto sm:max-lg:top-28" resizable={false}>
        <div className="grid gap-2 max-sm:grid-cols-4 max-sm:gap-1">
          {(
            [
              ["FILES", layout.buildings.length],
              ["LINES", lines],
              ["DISTRICTS", layout.districts.length],
              ["BOTTLENECKS", layout.buildings.filter((b) => b.health !== "ok").length],
            ] as [string, string | number][]
          ).map(([k, v]) => (
            <div key={k} className="rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 text-xs">
              <div className="text-black-ink/60">{k}</div>
              <div className="text-lg font-bold text-signal">{v}</div>
            </div>
          ))}
        </div>
      </DraggablePanel>

      {/* hero controls — on mobile they lift above the mission strip while a
          courier is running so the two can never overlap */}
      <div
        className={`absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 pointer-events-auto ${
          missionActive ? "max-md:bottom-32" : "max-md:bottom-24"
        }`}
      >
        <LatencyButtons />
        <button
          onClick={() => {
            patch({ traffic: true, showcase: false });
            select(null);
            dispatchMission("login"); // courier car w/ floating info cards + cine cam
            notifyFn("🚗 POST /api/v1/auth/login dispatched — courier en route");
            pushLog("fe", "RUN ▸ courier dispatched · POST /api/v1/auth/login", "info");
          }}
          id="cc-run-btn"
          className="rounded-xl border-[1.5px] border-black-ink bg-black-ink px-3 py-2 text-sm font-bold text-paper shadow-[4px_4px_0_rgba(20,20,20,.35)] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_rgba(20,20,20,.35)] md:px-5 md:py-3"
        >
          <Play size={14} className="mr-1 inline" />
          RUN LOGIN
        </button>
        <button
          onClick={() => {
            const next = !showcase;
            patch({ showcase: next, following: next ? false : following });
            notifyFn(next ? "🎬 Showcase orbit — press O or drag to exit" : "Showcase off");
          }}
          title="Cinematic showcase orbit (O)"
          className={`misreg rounded-xl border-[1.5px] px-3 py-2 text-xs font-bold md:py-3 ${showcase ? "border-black-ink bg-black-ink text-paper" : "border-black-ink bg-paper-deep text-black-ink/80"}`}
        >
          <Video size={12} className="mr-1 inline" />
          <span className="hidden sm:inline"> SHOWCASE</span>
        </button>
        <button
          onClick={() => {
            const next = !failing;
            patch({ failing: next });
            if (next) {
              const failB = layout.byId.get(failingId ?? "") ?? layout.byId.get("be-payctrl");
              notifyFn("❌ Payment pipeline failed — 500", failB?.id, "error");
              if (failB) {
                pushHealth({ buildingId: failB.id, name: failB.name, kind: "error", detail: "payment POST → 500 · circuit open" });
                pushLog("fe", `FAIL ▸ ${failB.name} returns 500`, "error");
                pushLog("be", `[http] POST /api/v1/payments -> 500 (circuit open at ${failB.name})`, "error");
              }
            }
          }}
          id="cc-fail-btn"
          className="misreg rounded-xl border-[1.5px] border-black-ink bg-signal px-3 py-2 text-xs font-bold text-paper md:py-3"
        >
          <Bug size={12} className="mr-1 inline" />
          FAIL PAYMENT
        </button>
      </div>

      {/* notifications bottom-right — capped at 3 so they can never bury the
          rail/panel content; anything older collapses into a +N chip */}
      {notifications.length > 0 && (
        <DraggablePanel id="notifs" className="pointer-events-auto absolute bottom-4 right-3 z-30 max-md:bottom-40 max-md:left-3 max-md:right-3" resizable={false}>
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

      {/* right rail — alerts, inspector, guide and atmosphere stack in one flow
          column so they can never overlap regardless of alert count */}
      <DraggablePanel id="rail" className="pointer-events-none absolute right-3 top-16 z-30 max-md:left-3 max-md:right-3" resizable={false}>
        <div className="flex max-h-[calc(100vh-160px)] w-80 max-w-[calc(100vw-24px)] flex-col items-stretch gap-2 overflow-y-auto max-md:w-auto">
          <AlertStack />
          {/* inspector */}
          {sel && conn && (
            <div className="z-20 max-h-[62vh] w-full overflow-auto rounded-xl border-[1.5px] border-black-ink bg-paper/97 p-4 text-sm pointer-events-auto max-md:max-h-[46vh]">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-signal">{sel.name}</div>
                  <div className="text-xs text-black-ink/65">
                    {sel.districtName} · {sel.kind} · {sel.loc} LOC ·{" "}
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
                    <button key={e.from + e.to} onClick={() => pick(e.from)} className="block w-full truncate text-left underline decoration-dotted hover:text-signal">
                      {layout.byId.get(e.from)?.name ?? e.from}
                    </button>
                  ))}
                  {conn.callers.length === 0 && <span className="text-black-ink/60">client requests only</span>}
                </div>
                <div className="rounded-lg border border-black-ink/40 bg-paper-deep p-2">
                  <div className="mb-1 font-bold">CALLS ({conn.calls.length}) ▶</div>
                  {conn.calls.map((e) => (
                    <button key={e.from + e.to} onClick={() => pick(e.to)} className="block w-full truncate text-left underline decoration-dotted hover:text-signal">
                      {layout.byId.get(e.to)?.name ?? e.to}
                    </button>
                  ))}
                  {conn.calls.length === 0 && <span className="text-black-ink/60">nothing downstream</span>}
                </div>
              </div>

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
          )}
          <ImprovementGuide />
          <ApiWorkflows />
          <WeatherPanel />
        </div>
      </DraggablePanel>
      <LegendPanel />
      <Minimap />
      <LogPanel />
      <FloatingNotifs />
      <MissionStrip />
    </div>
  );
}
