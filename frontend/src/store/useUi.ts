import { create } from "zustand";

/** panels that start CLOSED — the screen after a build is just the 3D city;
    everything opens from the ☰ MENU (or its shortcuts). */
const DEFAULT_HIDDEN: Record<string, boolean> = {
  apis: true, // Request flow — also has its own top button
  telemetry: true,
  legend: true,
  log: true,
  guide: true,
  weather: true, // ATMOSPHERE — hidden per UX review
};

/** UI-level overlay gates — lets the global shortcut handler know when to
    stand down (typing in the menu / palette / auth card must not toggle
    traffic/follow/showcase behind it). */
interface UiState {
  paletteOpen: boolean;
  authOpen: boolean;
  menuOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  setAuthOpen: (v: boolean) => void;
  setMenuOpen: (v: boolean) => void;
  /** panels the user ✕-closed (popup style) — DraggablePanel hides itself,
      the ☰ MENU re-opens. */
  hiddenPanels: Record<string, boolean>;
  hidePanel: (id: string) => void;
  showPanel: (id: string) => void;
  resetPanels: () => void;
}

export const useUi = create<UiState>()((set) => ({
  paletteOpen: false,
  authOpen: false,
  menuOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setAuthOpen: (authOpen) => set({ authOpen }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  hiddenPanels: { ...DEFAULT_HIDDEN },
  hidePanel: (id) => set((s) => ({ hiddenPanels: { ...s.hiddenPanels, [id]: true } })),
  showPanel: (id) => set((s) => ({ hiddenPanels: { ...s.hiddenPanels, [id]: false } })),
  resetPanels: () => set({ hiddenPanels: { ...DEFAULT_HIDDEN } }),
}));

export const anyOverlayOpen = () =>
  useUi.getState().paletteOpen ||
  useUi.getState().authOpen ||
  useUi.getState().menuOpen ||
  !useUi.getState().hiddenPanels.apis; // request-flow dropdown

export const togglePalette = () =>
  useUi.setState((s) => ({ paletteOpen: !s.paletteOpen }));
