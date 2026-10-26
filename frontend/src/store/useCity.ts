import { create } from "zustand";
import type { CityJSON, EdgeNode } from "../types";
import type { Weather } from "../three/env";
import type { FlowProbeResult, FlowResults } from "../three/missionTypes";

/** First-run state: NO fake preloaded city — the user builds the real one. */
export const EMPTY_CITY: CityJSON = {
  project: { name: "No city yet", stack: "—" },
  districts: [],
  edges: [],
  flows: {},
};

export interface HealthEvent {
  id: number;
  buildingId: string;
  name: string;
  kind: "error" | "warn" | "recovered";
  detail: string;
  at: number;
}

/** a dispatched request — one car drives a full API flow through the city.
 *  `blocked` = the route needs a JWT and none is attached: the courier is
 *  stopped at the toll plaza and reports 401 instead of driving on.
 *  `probe` = verdict of the real HTTP call the trace fired (lib/flowRunner). */
export interface Mission {
  flow: string;
  startedAt: number;
  blocked?: boolean;
  probe?: FlowProbeResult | null;
}

/** bottom-center mission strip state — which hop the courier is at */
export interface MissionHud {
  flow: string;
  idx: number;
  total: number;
  title: string;
  verb: string;
  detail: string[];
  /** 0..1 progress along the lane */
  progress: number;
}

interface S {
  city: CityJSON;
  selectedId: string | null;
  selectedFn: string | null;
  /** selected data-flow connection — set when the user clicks a flow bubble/tube,
   *  cleared when they pick a building or click empty space. Drives the
   *  "these two modules talk to each other" card in the HUD. */
  selectedEdge: EdgeNode | null;
  focus: { x: number; z: number; key: number } | null;
  traffic: boolean;
  underground: boolean;
  following: boolean;
  /** cinematic showcase orbit — slow auto-orbit showing off the whole world */
  showcase: boolean;
  failing: boolean;
  links: boolean;
  /** REAL round-trip latency of the last API call, in ms */
  apiLatencyMs: number | null;
  /** derived traffic speed preset — kept for car speeds */
  latency: "fast" | "medium" | "slow";
  // weather / time-of-day (starlight engine)
  weather: Weather;
  time: number;
  autoCycle: boolean;
  live: boolean;
  sound: boolean;
  // main-branch additions (auth shell, analyzer, traces)
  analyzing: boolean;
  failingId: string | null;
  traceSteps: string[];
  traceStep: number;
  notifications: {
    id: number;
    text: string;
    target?: string;
    type: "info" | "success" | "error";
  }[];
  /** broken-pipeline feed — powers top-right alert dialogs + floating pins */
  healthEvents: HealthEvent[];
  /** dispatched request missions — each spawns one slow courier car with info cards */
  mission: Mission | null;
  /** last recorded send per flow, keyed by flow key — lets the REQUEST FLOW
   *  panel show the 401 (no JWT) and the 200 (with JWT) side by side */
  flowResults: Record<string, FlowResults>;
  /** live hop info for the bottom-center mission strip (null = no mission) */
  missionHud: MissionHud | null;
  /** runtime fast-forward for mission verification (2× button / ?fm=1) */
  fastForward: boolean;
  /** post-build CTA — "how can I improve your system?" card in the right rail */
  guideCta: boolean;
  select: (id: string | null, fn?: string | null) => void;
  /** select/clear a data-flow connection (clicking a bubble) */
  selectEdge: (e: EdgeNode | null) => void;
  setFocus: (x: number, z: number) => void;
  patch: (p: Partial<S>) => void;
  dispatchMission: (flow: string, opts?: { blocked?: boolean }) => void;
  endMission: () => void;
  notify: (text: string, target?: string, type?: "info" | "success" | "error") => void;
  dismiss: (id: number) => void;
  setCity: (city: CityJSON) => void;
  recordLatency: (ms: number) => void;
  pushHealth: (e: Omit<HealthEvent, "id" | "at">) => void;
}

let nid = 1;
let hid = 1;

const speedFor = (ms: number | null): "fast" | "medium" | "slow" =>
  ms == null ? "fast" : ms < 250 ? "fast" : ms < 900 ? "medium" : "slow";

/** derive broken-pipeline events from a city's building health flags.
 *  Only `error` (complexity >= 60) raises an alert — `warn` buildings are
 *  listed in the Bottlenecks panel instead, so the stack never gets spammed. */
function healthFromCity(city: CityJSON): HealthEvent[] {
  const out: HealthEvent[] = [];
  for (const d of city.districts) {
    for (const b of d.buildings) {
      if (b.health !== "error") continue;
      out.push({
        id: hid++,
        buildingId: b.id,
        name: b.name,
        kind: "error",
        detail: `critical bottleneck · complexity ${b.complexity ?? "?"}/100 · ${d.name}`,
        at: Date.now(),
      });
    }
  }
  return out;
}

export const useCity = create<S>()((set) => ({
  city: EMPTY_CITY,
  selectedId: null,
  selectedFn: null,
  selectedEdge: null,
  focus: null,
  traffic: true,
  underground: false,
  following: false,
  showcase: false,
  failing: false,
  links: true,
  apiLatencyMs: null,
  latency: "fast",
  weather: "clear",
  time: 19.5,
  autoCycle: false,
  live: false,
  sound: false,
  analyzing: false,
  failingId: null,
  traceSteps: [],
  traceStep: -1,
  notifications: [],
  healthEvents: healthFromCity(EMPTY_CITY),
  mission: null,
  missionHud: null,
  flowResults: {},
  guideCta: false,
  fastForward: typeof location !== "undefined" && new URLSearchParams(location.search).has("fm"),
  // picking a building dismisses a picked flow bubble (and vice-versa) so the
  // HUD never shows two overlapping inspectors
  select: (id, fn = null) => set({ selectedId: id, selectedFn: fn, selectedEdge: null }),
  selectEdge: (e) => set({ selectedEdge: e }),
  setFocus: (x, z) =>
    set((s) => ({ focus: { x, z, key: (s.focus?.key ?? 0) + 1 } })),
  patch: (p) => set(p),
  dispatchMission: (flow, opts) =>
    // re-dispatch = restart the courier from the door (fresh key remounts the car)
    set((s) => ({
      mission: { flow, blocked: opts?.blocked ?? false, startedAt: (s.mission?.startedAt ?? 0) + 1 },
      missionHud: null,
    })),
  endMission: () => set({ mission: null, missionHud: null }),
  recordLatency: (ms) =>
    set({ apiLatencyMs: Math.round(ms), latency: speedFor(ms) }),
  pushHealth: (e) =>
    set((s) => ({
      healthEvents: [...s.healthEvents.slice(-11), { ...e, id: hid++, at: Date.now() }],
    })),
  notify: (text, target, type = "info") => {
    const id = nid++;
    set((s) => ({
      notifications: [...s.notifications.slice(-4), { id, text, target, type }],
    }));
    setTimeout(() => {
      set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
    }, 6000);
  },
  dismiss: (id: number) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
      healthEvents: s.healthEvents.filter((n) => n.id !== id),
    })),
  setCity: (city) =>
    set({
      city,
      selectedId: null,
      selectedFn: null,
      selectedEdge: null,
      focus: null,
      failing: false,
      failingId: null,
      following: false,
      traceSteps: [],
      traceStep: -1,
      missionHud: null,
      flowResults: {},
      healthEvents: healthFromCity(city),
      guideCta: false,
    }),
}));

export const followTarget = { active: false, x: 0, z: 0, tx: 1, tz: 0, dwell: false, mission: false };
