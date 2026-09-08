import { useEffect, useRef, useState } from "react";

/* ── hooks ───────────────────────────────────────────────────────── */

export function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // static fallback for reduced-motion users — reveal immediately, but
    // deferred a tick so the effect body stays free of synchronous setState
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = window.setTimeout(() => setSeen(true), 0);
      return () => clearTimeout(id);
    }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && setSeen(true)),
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

/** live visibility (fires both on enter AND exit) — for pausing render loops */
export function useOnScreen<T extends Element>(threshold = 0.05) {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // reduced motion: show everything, but set state asynchronously —
      // synchronous setState inside the effect body cascades renders
      const raf = requestAnimationFrame(() => setOn(true));
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => setOn(e.isIntersecting)),
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, on] as const;
}

export function useCountUp(target: number, run: boolean, ms = 1400) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min((t - t0) / ms, 1);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target, ms]);
  return v;
}

export function useScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setP(max > 0 ? h.scrollTop / max : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return p;
}
