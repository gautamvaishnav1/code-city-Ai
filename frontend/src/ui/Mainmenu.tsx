import { useEffect, useRef } from "react";
import { Menu, Ruler, RotateCcw, Workflow, X } from "lucide-react";
import { useCity } from "../store/useCity";
import { useUi } from "../store/useUi";
import { CitySearch } from "./CitySearch";
import { RecentProjects } from "./RecentProjects";
import { RepoLoader } from "./RepoLoader";
import { UserChip } from "./UserChip";

/** panels the user can show/hide from the menu (DraggablePanel self-hides) */
const PANEL_TOGGLES: [id: string, label: string][] = [
  ["telemetry", "Telemetry stats & bottlenecks"],
  ["apis", "Request flow"],
  ["guide", "AI improvement guide"],
  ["legend", "Legend & keys"],
  ["log", "Console"],
  ["weather", "Atmosphere"],
  ["notifs", "Notifications"],
];

const VIEW_TOGGLES: [key: "traffic" | "underground" | "links" | "following" | "showcase", label: string][] = [
  ["traffic", "Traffic"],
  ["underground", "Underground pipes"],
  ["links", "Links"],
  ["following", "Follow camera"],
  ["showcase", "Showcase orbit"],
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="caption-caps mb-1 mt-3 first:mt-0 font-bold text-black-ink/55">{children}</div>;
}

function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={on}
      onClick={onToggle}
      className="flex min-h-[36px] w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-bold hover:bg-black-ink/10"
    >
      {label}
      <span className={on ? "text-signal" : "text-black-ink/35"}>{on ? "ON" : "OFF"}</span>
    </button>
  );
}

/**
 * ☰ MENU — the single entry point to every HUD feature. The city view itself
 * stays clean (just the 3D city); build, search, view options, panel toggles
 * and actions all live behind this dropdown.
 */
export function MainMenu({ busy, analyze, progress }: { busy: boolean; analyze: (input: string) => Promise<void>; progress: number | null }) {
  const open = useUi((s) => s.menuOpen);
  const setOpen = useUi((s) => s.setMenuOpen);
  const hiddenPanels = useUi((s) => s.hiddenPanels);
  const hidePanel = useUi((s) => s.hidePanel);
  const showPanel = useUi((s) => s.showPanel);

  const traffic = useCity((s) => s.traffic);
  const underground = useCity((s) => s.underground);
  const linksOn = useCity((s) => s.links);
  const following = useCity((s) => s.following);
  const showcase = useCity((s) => s.showcase);
  const apiLatencyMs = useCity((s) => s.apiLatencyMs);
  const speed = useCity((s) => s.latency);
  const patch = useCity((s) => s.patch);
  const notify = useCity((s) => s.notify);

  const wrap = useRef<HTMLDivElement>(null);

  // outside click + Esc close (popup behaviour)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, setOpen]);

  const viewOn = { traffic, underground, links: linksOn, following, showcase } as const;

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open menu"
        title="Menu — build, search, view & panels"
        className={`grid h-9 min-h-[36px] w-9 place-items-center rounded-xl border-[1.5px] border-black-ink shadow-[3px_3px_0_rgba(20,20,20,.35)] transition-colors ${
          open ? "bg-black-ink text-paper" : "bg-paper/95 text-black-ink hover:text-signal"
        }`}
      >
        {open ? <X size={16} /> : <Menu size={16} />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Main menu"
          className="absolute left-0 top-11 z-50 max-h-[calc(100vh-72px)] w-[min(92vw,380px)] overflow-y-auto rounded-xl border-[1.5px] border-black-ink bg-paper p-3 shadow-[6px_6px_0_rgba(0,0,0,.35)]"
        >
          <div className="flex items-center justify-between">
            <span className="caption-caps font-bold">🏙 CODECITY AI — MENU</span>
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="text-black-ink/45 hover:text-signal">
              <X size={14} />
            </button>
          </div>

          <SectionTitle>Build a city</SectionTitle>
          <RepoLoader busy={busy} analyze={analyze} progress={progress} onDone={() => setOpen(false)} />

          <SectionTitle>My projects</SectionTitle>
          <RecentProjects onPicked={() => setOpen(false)} />

          <SectionTitle>Search</SectionTitle>
          <CitySearch onPicked={() => setOpen(false)} />

          <SectionTitle>View</SectionTitle>
          {VIEW_TOGGLES.map(([key, label]) => (
            <ToggleRow
              key={key}
              label={label}
              on={viewOn[key]}
              onToggle={() => patch({ [key]: !viewOn[key] } as never)}
            />
          ))}
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-black-ink/25 bg-paper-deep px-2.5 py-2 text-xs text-black-ink/70">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: apiLatencyMs == null ? "#94a3b8" : apiLatencyMs < 250 ? "#22c55e" : apiLatencyMs < 900 ? "#eab308" : "#ef4444" }} />
            <span className="font-bold tabular-nums">{apiLatencyMs == null ? "— ms" : `${Math.round(apiLatencyMs)} ms`}</span>
            <span>· {speed} traffic</span>
          </div>

          <SectionTitle>Panels</SectionTitle>
          {PANEL_TOGGLES.map(([id, label]) => (
            <ToggleRow
              key={id}
              label={label}
              on={!hiddenPanels[id]}
              onToggle={() => (hiddenPanels[id] ? showPanel(id) : hidePanel(id))}
            />
          ))}
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent("cc-panels-reset"));
              useUi.getState().resetPanels();
              notify("⟲ Panel layout reset");
            }}
            className="mt-2 flex min-h-[36px] w-full items-center gap-2 rounded-lg border border-black-ink/30 px-2.5 py-1.5 text-left text-xs font-bold hover:border-signal"
          >
            <RotateCcw size={12} /> Reset panel layout
          </button>

          <SectionTitle>Actions</SectionTitle>
          <button
            onClick={() => {
              showPanel("apis");
              setOpen(false);
            }}
            className="flex min-h-[36px] w-full items-center gap-2 rounded-lg border border-black-ink/30 px-2.5 py-1.5 text-left text-xs font-bold hover:border-signal"
          >
            <Workflow size={12} /> Open Request flow →
          </button>
          <button
            onClick={() => {
              showPanel("guide");
              window.dispatchEvent(new CustomEvent("cc-open-guide"));
            }}
            className="mt-1 flex min-h-[36px] w-full items-center gap-2 rounded-lg border border-black-ink/30 px-2.5 py-1.5 text-left text-xs font-bold hover:border-signal"
          >
            <Ruler size={12} /> Ask the AI architect →
          </button>

          <SectionTitle>Account</SectionTitle>
          <div className="flex items-center justify-between gap-2">
            <UserChip />
            <button
              onClick={() => {
                location.hash = "";
                setOpen(false);
              }}
              className="min-h-[36px] rounded-xl border-[1.5px] border-black-ink bg-paper-deep px-3 py-2 text-xs font-bold hover:border-signal"
            >
              🏙 Landing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

