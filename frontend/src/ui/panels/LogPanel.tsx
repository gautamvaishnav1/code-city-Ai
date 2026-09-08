import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { API_BASE } from "../../lib/auth";
import { pushLog, LOG_BUFFER } from "../logFeed";
import { DraggablePanel } from "../DraggablePanel";

export function LogPanel() {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((v) => v + 1);
    window.addEventListener("cc-log", bump);
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API_BASE}/logs/stream`);
      es.onmessage = (m) => {
        try {
          const d = JSON.parse(m.data) as { message?: string; level?: string };
          const level = d.level === "warn" || d.level === "error" || d.level === "ok" ? d.level : "info";
          if (d.message) pushLog("be", d.message, level);
        } catch {
          /* keep-alive comments etc. */
        }
      };
    } catch {
      /* SSE optional */
    }
    return () => es?.close();
  }, []);
  const colorOf = (l: string) =>
    l === "error" ? "text-red-600" : l === "warn" ? "text-amber-600" : l === "ok" ? "text-emerald-700" : "text-black-ink/75";
  const errCount = LOG_BUFFER.filter((l) => l.level === "error").length;
  return (
    <DraggablePanel id="log" className="pointer-events-auto absolute bottom-16 left-3 max-lg:hidden" resizable={false}>
      {open ? (
        <div className="w-[420px] max-w-[90vw] rounded-xl border-[1.5px] border-black-ink bg-[#101418]/97 p-0 text-[11px] leading-snug shadow-[4px_4px_0_rgba(0,0,0,.4)]">
          <div className="flex items-center justify-between border-b border-white/15 px-3 py-2">
            <span className="caption-caps font-bold text-white/85">SYSTEM LOG · FE + BE</span>
            <span className="flex items-center gap-2">
              {errCount > 0 && (
                <span className="rounded-sm bg-red-600 px-1.5 text-[9px] font-bold text-white">{errCount} ERR</span>
              )}
              <button onClick={() => setOpen(false)} aria-label="Close log panel" className="text-white/50 hover:text-white">
                ✕
              </button>
            </span>
          </div>
          <div className="max-h-56 overflow-y-auto px-3 py-2 font-mono">
            {LOG_BUFFER.length === 0 && <p className="py-4 text-center text-white/35">waiting for activity…</p>}
            {LOG_BUFFER.map((l, i) => (
              <p key={`${l.t}-${i}`} className={`${colorOf(l.level)} whitespace-pre-wrap`}>
                <span className="text-white/50">{new Date(l.t).toLocaleTimeString([], { hour12: false })}</span>{" "}
                <span className={l.src === "fe" ? "text-cyan-400" : "text-violet-400"}>[{l.src.toUpperCase()}]</span>{" "}
                {l.msg}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="relative rounded-xl border-[1.5px] border-black-ink bg-paper/95 px-3 py-2 text-xs text-black-ink/75 hover:border-signal"
        >
          <ScrollText size={12} className="mr-1 inline" />
          Logs
          {errCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-signal text-[9px] font-bold text-paper">
              {errCount}
            </span>
          )}
        </button>
      )}
    </DraggablePanel>
  );
}
