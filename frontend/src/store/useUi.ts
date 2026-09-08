import { create } from "zustand";

/** UI-level overlay gates — lets the global shortcut handler know when to
    stand down (typing in the palette or the auth card must not toggle
    traffic/follow/showcase behind the modal). */
interface UiState {
  paletteOpen: boolean;
  authOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  setAuthOpen: (v: boolean) => void;
}

export const useUi = create<UiState>()((set) => ({
  paletteOpen: false,
  authOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setAuthOpen: (authOpen) => set({ authOpen }),
}));

export const anyOverlayOpen = () =>
  useUi.getState().paletteOpen || useUi.getState().authOpen;

export const togglePalette = () =>
  useUi.setState((s) => ({ paletteOpen: !s.paletteOpen }));
