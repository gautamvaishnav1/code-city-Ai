import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";

type Saved = { x: number; y: number; w: number; h: number };

const key = (id: string) => `cc-panel-${id}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function loadSaved(id: string): Saved | null {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    const ok = Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.w) && Number.isFinite(s.h);
    if (!ok) return null;
    // clamp against the CURRENT viewport — a position saved on a 4K monitor
    // must never strand the panel off-screen on a laptop
    return {
      w: s.w,
      h: s.h,
      x: clamp(s.x, 48 - s.w, window.innerWidth - 48),
      y: clamp(s.y, 0, Math.max(0, window.innerHeight - 40)),
    };
  } catch {
    return null;
  }
}

/**
 * Makes any HUD panel draggable + resizable.
 *
 * - Docked (default): renders children inside the original layout classes.
 * - Free: once dragged, the panel becomes fixed-positioned where the user put it;
 *   position + size persist in localStorage across reloads.
 * - Drag via the ⠿ grip, or any child marked with a `data-drag` attribute (panel headers).
 * - Resize via the ◢ corner handle (free mode).
 * - Double-click the grip to dock the panel back to its original spot.
 * - Window event "cc-panels-reset" docks every panel back.
 */
export function DraggablePanel({
  id,
  children,
  className = "",
  minW = 140,
  minH = 60,
  resizable = true,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  minW?: number;
  minH?: number;
  resizable?: boolean;
}) {
  // read the saved layout once via lazy initializers (no ref access in render)
  const [free, setFree] = useState<boolean>(() => {
    const s = loadSaved(id);
    return !!s;
  });
  const [box, setBox] = useState(() => {
    const s = loadSaved(id);
    return {
      x: s?.x ?? 40,
      y: s?.y ?? 40,
      w: s?.w ?? 320,
      h: s?.h ?? 200,
    };
  });
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef(box);
  const freeRef = useRef(free);
  // mirror latest state into refs for the pointer handlers (synced in an
  // effect, never during render)
  useEffect(() => {
    boxRef.current = box;
    freeRef.current = free;
  }, [box, free]);

  useEffect(() => {
    const onReset = () => {
      setFree(false);
      try {
        localStorage.removeItem(key(id));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("cc-panels-reset", onReset);
    return () => window.removeEventListener("cc-panels-reset", onReset);
  }, [id]);

  // keep free panels inside the viewport when the window shrinks
  useEffect(() => {
    if (!free) return;
    const onResize = () =>
      setBox((b) => ({
        ...b,
        x: clamp(b.x, 48 - b.w, window.innerWidth - 48),
        y: clamp(b.y, 0, Math.max(0, window.innerHeight - 40)),
      }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [free]);

  const save = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const s: Saved = { x: r.left, y: r.top, w: r.width, h: r.height };
    try {
      localStorage.setItem(key(id), JSON.stringify(s));
    } catch {
      /* private mode */
    }
  };

  /** 4px threshold — a plain click never flips a docked panel to free mode
      (phantom "invisible grip" clicks were teleporting HUD blocks around) */
  const startDrag = (e: RPointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("button,a,input,textarea,select,label,[data-nodrag]")) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const x0 = freeRef.current ? boxRef.current.x : r.left;
    const y0 = freeRef.current ? boxRef.current.y : r.top;
    const px = e.clientX;
    const py = e.clientY;
    let armed = freeRef.current; // already-free panels move immediately
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!armed) {
        if (Math.hypot(ev.clientX - px, ev.clientY - py) < 4) return;
        armed = true;
        moved = true;
        setBox({ x: r.left, y: r.top, w: r.width, h: r.height });
        setFree(true);
      }
      moved = true;
      setBox((b) => ({
        ...b,
        x: clamp(x0 + ev.clientX - px, 48 - b.w, window.innerWidth - 48),
        y: clamp(y0 + ev.clientY - py, 0, window.innerHeight - 40),
      }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) save();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (e: RPointerEvent) => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    const w0 = r.width;
    const h0 = r.height;
    const px = e.clientX;
    const py = e.clientY;
    const move = (ev: PointerEvent) => {
      setBox((b) => ({
        ...b,
        w: clamp(w0 + ev.clientX - px, minW, Math.max(minW, window.innerWidth - b.x - 8)),
        h: Math.max(minH, h0 + ev.clientY - py),
      }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      save();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const reset = () => {
    setFree(false);
    try {
      localStorage.removeItem(key(id));
    } catch {
      /* ignore */
    }
  };

  // drag also starts from any child marked data-drag (panel header bars)
  const onWrapperPointerDown = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-drag]")) startDrag(e);
  };

  const grip = (
    <span
      onPointerDown={startDrag}
      onDoubleClick={reset}
      title="Drag to move · double-click to dock back"
      className="pointer-events-none absolute -left-2.5 -top-2.5 z-50 grid h-6 w-6 cursor-move select-none place-items-center rounded-full border-[1.5px] border-black-ink bg-paper text-[11px] leading-none text-black-ink/60 opacity-0 shadow-[2px_2px_0_rgba(0,0,0,.3)] transition-opacity group-hover/dp:pointer-events-auto group-hover/dp:opacity-100 touch-none"
    >
      ⠿
    </span>
  );

  if (!free) {
    const pos = /absolute|fixed/.test(className) ? "" : "relative";
    return (
      <div ref={ref} onPointerDown={onWrapperPointerDown} className={`group/dp ${pos} ${className}`.trim()}>
        {children}
        {grip}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      onPointerDown={onWrapperPointerDown}
      className="group/dp fixed z-40"
      style={{ left: box.x, top: box.y, width: box.w, height: resizable ? box.h : undefined }}
    >
      {/* scroll container is INSIDE so the grip/resize handles never get clipped */}
      <div className="pointer-events-auto h-full w-full overflow-auto">{children}</div>
      {grip}
      {resizable && (
        <span
          onPointerDown={startResize}
          title="Drag to resize"
          className="pointer-events-none absolute -bottom-2 -right-2 z-50 grid h-5 w-5 cursor-nwse-resize select-none place-items-center rounded-sm border-[1.5px] border-black-ink bg-paper text-[8px] leading-none text-black-ink/60 opacity-0 shadow-[2px_2px_0_rgba(0,0,0,.3)] group-hover/dp:pointer-events-auto group-hover/dp:opacity-100 touch-none"
        >
          ◢
        </span>
      )}
    </div>
  );
}
