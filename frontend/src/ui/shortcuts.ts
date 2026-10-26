import { useEffect } from "react";
import { anyOverlayOpen, useUi } from "../store/useUi";
import { useCity } from "../store/useCity";

/** Single source of truth for city keyboard shortcuts — the global handler
    AND the legend both read this list, so they can never drift apart. */
export interface Shortcut {
  /** lowercase KeyboardEvent.key */
  key: string;
  /** legend label */
  label: string;
  run: () => void;
}

export const SHORTCUTS: Shortcut[] = [
  {
    key: "/",
    label: "search",
    run: () => {
      // search lives inside the ☰ menu now — open it, then focus the field
      useUi.getState().setMenuOpen(true);
      window.setTimeout(() => document.querySelector<HTMLInputElement>("#city-search")?.focus(), 0);
    },
  },
  {
    key: "t",
    label: "traffic",
    run: () => {
      const st = useCity.getState();
      st.patch({ traffic: !st.traffic });
    },
  },
  {
    key: "u",
    label: "pipes",
    run: () => {
      const st = useCity.getState();
      st.patch({ underground: !st.underground });
    },
  },
  {
    key: "k",
    label: "links",
    run: () => {
      const st = useCity.getState();
      st.patch({ links: !st.links });
    },
  },
  {
    key: "f",
    label: "follow",
    run: () => {
      const st = useCity.getState();
      st.patch({ following: !st.following });
    },
  },
  {
    key: "o",
    label: "showcase",
    run: () => {
      const st = useCity.getState();
      const next = !st.showcase;
      st.patch({ showcase: next, following: next ? false : st.following });
    },
  },
  {
    key: "escape",
    label: "close",
    run: () => useCity.getState().select(null),
  },
];

/** Global keyboard handler. Stands down while typing in inputs or while an
    overlay (command palette / auth modal) is open. */
export function useCityShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) {
        if (e.key === "Escape") t!.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (anyOverlayOpen()) return;
      const hit = SHORTCUTS.find((sc) => sc.key === e.key.toLowerCase());
      if (!hit) return;
      e.preventDefault();
      hit.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
