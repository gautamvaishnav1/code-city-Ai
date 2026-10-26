import { useEffect, useState } from "react";
import { apiFetch, useAuth } from "../../lib/auth";
import { useUi } from "../../store/useUi";
import { pushLog, LOG_BUFFER } from "../logFeed";
import { DraggablePanel } from "../DraggablePanel";

export function LogPanel() {
  const hidePanel = useUi((s) => s.hidePanel);
  const [, force] = useState(0);
  const token = useAuth((s) => s.token);
  /** one-time SSE ticket (EventSource cannot set an Authorization header —
   *  the backend hands out a single-use ticket instead of a long-lived JWT in
   *  the URL). Re-minted a few times if the live connection later drops. */
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [renew, setRenew] = useState(0);
  useEffect(() => {
    if (!token) {
      setStreamUrl(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch("/logs/stream-ticket", { method: "POST" });
        const j = (await r.json()) as { data?: { streamUrl?: string } };
        const u = j?.data?.streamUrl;
        if (alive && r.ok && typeof u === "string") setStreamUrl(u);
      } catch {
        /* SSE is optional — the panel still shows the local buffer */
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, renew]);

  useEffect(() => {
    const bump = () => force((v) => v + 1);
    window.addEventListener("cc-log", bump);
    // authenticated stream only: with no session the endpoint answers 401 and
    // EventSource would reconnect in a loop (three console errors per reload
    // while signed out). Never retry after a failure either — a consumed
    // ticket would just 401 forever.
    if (!token || !streamUrl) return () => window.removeEventListener("cc-log", bump);
    let es: EventSource | null = null;
    let opened = false;
    try {
      es = new EventSource(streamUrl);
      es.onopen = () => {
        opened = true;
      };
      es.onmessage = (m) => {
        try {
          const d = JSON.parse(m.data) as { message?: string; level?: string };
          const level = d.level === "warn" || d.level === "error" || d.level === "ok" ? d.level : "info";
          if (d.message) pushLog("be", d.message, level);
        } catch {
          /* keep-alive comments etc. */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        // a drop AFTER a healthy connection means the ticket/session moved on:
        // ask for a fresh ticket a couple of times, then stop for good
        if (opened) setRenew((n) => (n < 3 ? n + 1 : n));
      };
    } catch {
      /* SSE optional */
    }
    return () => {
      es?.close();
      window.removeEventListener("cc-log", bump);
    };
  }, [token, streamUrl, renew]);
  const colorOf = (l: string) =>
    l === "error" ? "text-red-600" : l === "warn" ? "text-amber-600" : l === "ok" ? "text-emerald-700" : "text-black-ink/75";
  const errCount = LOG_BUFFER.filter((l) => l.level === "error").length;
  return (
    <DraggablePanel id="log" className="pointer-events-auto absolute bottom-16 left-3 max-lg:hidden" resizable={false}>
      <div className="w-[420px] max-w-[90vw] rounded-xl border-[1.5px] border-black-ink bg-[#101418]/97 p-0 text-[11px] leading-snug shadow-[4px_4px_0_rgba(0,0,0,.4)]">
        <div className="flex items-center justify-between border-b border-white/15 px-3 py-2" data-drag>
          <span className="caption-caps font-bold text-white/85">SYSTEM LOG · FE + BE</span>
          <span className="flex items-center gap-2">
            {errCount > 0 && (
              <span className="rounded-sm bg-red-600 px-1.5 text-[9px] font-bold text-white">{errCount} ERR</span>
            )}
            <button onClick={() => hidePanel("log")} aria-label="Close log panel" className="text-white/50 hover:text-white">
              ✕
            </button>
          </span>
        </div>
        <div className="max-h-56 overflow-y-auto px-3 py-2 font-mono" data-nodrag>
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
    </DraggablePanel>
  );
}
