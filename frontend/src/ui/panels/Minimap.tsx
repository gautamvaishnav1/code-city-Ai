import { useEffect, useRef } from "react";
import { useCity } from "../../store/useCity";
import { useCityLayout } from "../../lib/city";
import { DraggablePanel } from "../DraggablePanel";

/* shared minimap projection — plate painter, live layer and click handler
   all use the same numbers so they can never drift apart */
const S = 164;
const K = S / 200;
const OX = S / 2;
const OZ = 30 * K;
const X = (wx: number) => OX + wx * K;
const Z = (wz: number) => OZ + wz * K;

/* ── starlight engine: bottom-left minimap — cached plate + dynamic overlay ── */
export function Minimap() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const focus = useCity((st) => st.focus);
  const healthEvents = useCity((st) => st.healthEvents);
  const LAYOUT = useCityLayout();
  const plateRef = useRef<HTMLCanvasElement | null>(null);

  // draw the static plate ONCE per layout — streets, river, blocks don't change
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const g = c.getContext("2d")!;

    // paper ground
    g.fillStyle = "#f2efe3";
    g.fillRect(0, 0, S, S);

    // faint baseline grid
    g.strokeStyle = "rgba(20,20,20,.08)";
    g.lineWidth = 1;
    g.beginPath();
    for (let wx = -75; wx <= 75; wx += 25) {
      g.moveTo(X(wx), 0);
      g.lineTo(X(wx), S);
    }
    for (let wz = -55; wz <= 125; wz += 30) {
      g.moveTo(0, Z(wz));
      g.lineTo(S, Z(wz));
    }
    g.stroke();

    // river wash between hairlines
    g.fillStyle = "rgba(34,120,150,.18)";
    g.fillRect(X(-5), Z(-77), 10 * K, 110 * K);
    g.strokeStyle = "rgba(20,20,20,.28)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(X(-5), Z(-77));
    g.lineTo(X(-5), Z(33));
    g.moveTo(X(5), Z(-77));
    g.lineTo(X(5), Z(33));
    g.stroke();

    // streets — thin ink; highways heavy; bridges dashed
    g.lineCap = "round";
    for (const r of LAYOUT.roads) {
      if (r.kind === "road") {
        g.strokeStyle = "rgba(20,20,20,.38)";
        g.lineWidth = Math.max(1, r.w * K * 0.4);
        g.setLineDash([]);
      } else {
        g.strokeStyle = "#141414";
        g.lineWidth = Math.max(1.5, r.w * K * 0.62);
        g.setLineDash(r.kind === "highway" ? [] : [4, 3]);
      }
      g.beginPath();
      g.moveTo(X(r.a[0]), Z(r.a[1]));
      g.lineTo(X(r.b[0]), Z(r.b[1]));
      g.stroke();
    }
    g.setLineDash([]);

    // districts — outlined blocks, light tint
    for (const d of LAYOUT.districts) {
      const w = d.stack === "database" ? 46 : 24;
      const h = d.stack === "database" ? 14 : 20;
      g.fillStyle = "rgba(20,20,20,.07)";
      g.fillRect(X(d.center[0] - w / 2), Z(d.center[1] - h / 2), w * K, h * K);
      g.strokeStyle = "rgba(20,20,20,.55)";
      g.lineWidth = 1;
      g.strokeRect(X(d.center[0] - w / 2), Z(d.center[1] - h / 2), w * K, h * K);
    }

    // buildings — set in ink
    g.fillStyle = "rgba(20,20,20,.85)";
    for (const b of LAYOUT.buildings) g.fillRect(X(b.pos[0]) - 1, Z(b.pos[2]) - 1, 2.2, 2.2);

    // toll plaza mark — red square on the west approach
    g.fillStyle = "#e30613";
    g.fillRect(X(LAYOUT.toll.x) - 2, Z(LAYOUT.toll.z) - 2, 4, 4);

    // plate furniture — corner ticks + north arrow
    g.strokeStyle = "rgba(20,20,20,.5)";
    g.lineWidth = 1;
    const T = 7;
    const m = 4;
    g.beginPath();
    g.moveTo(m, m + T);
    g.lineTo(m, m);
    g.lineTo(m + T, m);
    g.moveTo(S - m - T, m);
    g.lineTo(S - m, m);
    g.lineTo(S - m, m + T);
    g.moveTo(m, S - m - T);
    g.lineTo(m, S - m);
    g.lineTo(m + T, S - m);
    g.moveTo(S - m - T, S - m);
    g.lineTo(S - m, S - m);
    g.lineTo(S - m, S - m - T);
    g.stroke();
    g.fillStyle = "#141414";
    g.beginPath();
    g.moveTo(S - 13, 26);
    g.lineTo(S - 16, 34);
    g.lineTo(S - 10, 34);
    g.closePath();
    g.fill();
    g.font = "700 7px Archivo, Helvetica, sans-serif";
    g.textAlign = "center";
    g.fillText("N", S - 13, 42);

    plateRef.current = c;
  }, [LAYOUT]);

  // dynamic layer: focus pulse + incident pins — throttled to ~12fps, tiny redraw
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 80) return; // 12fps is plenty for a pulsing dot
      last = t;
      const view = canvas.current;
      const plate = plateRef.current;
      if (!view || !plate || document.hidden) return; // sleep when tab hidden
      const g = view.getContext("2d")!;
      g.clearRect(0, 0, view.width, view.height);
      g.drawImage(plate, 0, 0);

      const SIGNAL = "#e30613";

      // incident pins — amber warn / red error
      for (const ev of healthEvents) {
        const b = LAYOUT.byId.get(ev.buildingId);
        if (!b) continue;
        g.fillStyle = ev.kind === "error" ? SIGNAL : "#f59e0b";
        g.beginPath();
        g.arc(X(b.pos[0]), Z(b.pos[2]), 3, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = "#141414";
        g.lineWidth = 0.75;
        g.beginPath();
        g.arc(X(b.pos[0]), Z(b.pos[2]), 3, 0, Math.PI * 2);
        g.stroke();
      }

      // focus — signal red with misregistration ghost + pulse
      const fx = focus ? X(focus.x) : X(0);
      const fz = focus ? Z(focus.z) : Z(0);
      const tt = performance.now() / 1000;
      g.globalAlpha = 0.5;
      g.fillStyle = SIGNAL;
      g.beginPath();
      g.arc(fx - 1, fz + 1, 2.5, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(fx, fz, 2.5, 0, Math.PI * 2);
      g.fill();
      if (!reduced) {
        g.strokeStyle = SIGNAL;
        g.lineWidth = 1;
        g.globalAlpha = 0.62 - 0.28 * Math.sin(tt * 2.4);
        g.beginPath();
        g.arc(fx, fz, 5.5 + Math.sin(tt * 2.4) * 1.5, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [focus, LAYOUT, healthEvents]);

  return (
    <DraggablePanel
      id="minimap"
      className="pointer-events-auto absolute bottom-[118px] left-3 w-[179px] select-none max-lg:hidden"
      resizable={false}
    >
      {/* plate frame — printed pass around the map */}
      <div className="border-[1.5px] border-black-ink bg-paper-deep p-1.5 shadow-[4px_4px_0_rgba(0,0,0,.35)]">
        <div className="mb-1.5 flex items-center justify-between border-b-[1.5px] border-black-ink px-1 pb-1">
          <span className="caption-caps font-bold text-black-ink">City Plan</span>
          <span aria-hidden className="inline-block h-[7px] w-[7px] bg-signal" />
        </div>
        <canvas
          ref={canvas}
          width={S}
          height={S}
          className="block w-full cursor-crosshair"
          onClick={(e) => {
            const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
            const sx = r.width / S;
            const sy = r.height / S;
            useCity
              .getState()
              .setFocus(
                (e.clientX - r.left - OX * sx) / (K * sx),
                (e.clientY - r.top - OZ * sy) / (K * sy),
              );
          }}
          aria-label="City minimap — click to move the camera"
        />
      </div>
      <p className="caption-caps mt-1.5 text-[9px] leading-none text-black-ink/60">
        Fig. 05 — click to navigate · pins = incidents
      </p>
    </DraggablePanel>
  );
}
