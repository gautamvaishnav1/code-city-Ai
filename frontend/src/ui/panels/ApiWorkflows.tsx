import { useEffect, useMemo, useRef, useState } from "react";
import { Workflow, X } from "lucide-react";
import { allFlows, flowAuth, useCityLayout } from "../../lib/city";
import { startFlow } from "../../lib/flowRunner";
import { API_BASE, useAuth } from "../../lib/auth";
import { useCity } from "../../store/useCity";
import { useUi } from "../../store/useUi";
import type { FlowSendMode, FlowResult } from "../../three/missionTypes";

const METHOD_TINT: Record<string, string> = {
  POST: "bg-emerald-600/90 text-paper",
  PATCH: "bg-amber-600/90 text-paper",
  PUT: "bg-amber-600/90 text-paper",
  DELETE: "bg-red-600/90 text-paper",
  GET: "bg-sky-600/90 text-paper",
  TRACE: "bg-black-ink/80 text-paper",
};

const KIND_TINT: Record<FlowResult["kind"], string> = {
  ok: "border-emerald-600 bg-emerald-600/10 text-emerald-700",
  denied: "border-red-600 bg-red-600/10 text-red-700",
  rejected: "border-amber-600 bg-amber-600/10 text-amber-700",
  unreachable: "border-black-ink/40 bg-black-ink/5 text-black-ink/70",
  none: "border-black-ink/30 bg-black-ink/5 text-black-ink/60",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="caption-caps mb-1 mt-3 first:mt-0 font-bold text-black-ink/55">{children}</div>;
}

/** Access-token facts for the info block — decoded from the JWT in memory,
 *  never printed in full (it's a bearer credential). */
function useTokenFacts() {
  const token = useAuth((s) => s.token);
  const refreshToken = useAuth((s) => s.refreshToken);
  const user = useAuth((s) => s.user);
  return useMemo(() => {
    let expLabel = "";
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
          exp?: number;
          guest?: boolean;
        };
        const left = (payload.exp ?? 0) * 1000 - Date.now();
        expLabel = left > 0 ? `expires in ${Math.max(1, Math.round(left / 60000))}m` : "EXPIRED — will be silently refreshed";
      } catch {
        expLabel = "unreadable";
      }
    }
    return {
      hasToken: !!token,
      hasRefresh: !!refreshToken,
      guest: user?.provider === "guest" || false,
      expLabel,
    };
  }, [token, refreshToken, user]);
}

/**
 * REQUEST FLOW — the same dropdown pattern as the ☰ MENU. Lists every request
 * the loaded app sends (login, signup, payments, … derived from the repo's
 * route components).
 *
 * A row EXPANDS instead of firing: it shows the request that would go out
 * (method, URL, headers, body, token state) and offers the two runs side by
 * side — **without JWT** and **with JWT** — so the 401 and the authorized
 * response can be compared directly. Both answers are archived under the row.
 */
export function RequestFlowButton() {
  const open = useUi((s) => !s.hiddenPanels.apis);
  const showPanel = useUi((s) => s.showPanel);
  const hidePanel = useUi((s) => s.hidePanel);

  const city = useCity((s) => s.city);
  const results = useCity((s) => s.flowResults);
  const L = useCityLayout();
  const facts = useTokenFacts();
  const [openRow, setOpenRow] = useState<string | null>(null);

  const flows = useMemo(() => allFlows(city), [city]);

  const rows = useMemo(
    () =>
      Object.entries(flows)
        .map(([key, chain]) => {
          const info = flowAuth(key, city);
          const names = (chain as string[])
            .map((id) => L.byId.get(id)?.name ?? id)
            .filter((n, i, a) => a.indexOf(n) === i);
          return {
            key,
            label: info.path ? `${info.label} — ${info.path}` : info.label,
            method: (info.method ?? "TRACE").toUpperCase(),
            requiresAuth: info.requiresAuth,
            path: info.path,
            guard: info.guard,
            chain: names.join(" → "),
            count: names.length,
            curated: !key.startsWith("auto:"),
          };
        })
        .sort((a, b) => Number(b.curated) - Number(a.curated)),
    [flows, L, city],
  );

  const wrap = useRef<HTMLDivElement>(null);

  // outside click + Esc close — identical popup behaviour to the main menu
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) hidePanel("apis");
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") hidePanel("apis");
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, hidePanel]);

  /** fire one of the two runs — the panel STAYS open so the response lands here */
  const send = (key: string, mode: FlowSendMode) => startFlow(key, city, mode);

  const Row = ({ r }: { r: (typeof rows)[number] }) => {
    const expanded = openRow === r.key;
    const res = results[r.key] as Partial<Record<FlowSendMode, FlowResult>> | undefined;
    const noJwt = res?.["no-jwt"];
    const withJwt = res?.["with-jwt"];
    const url = r.path ? `${API_BASE}${r.path.replace(/^\/api\/v1/, "")}` : "(URL not recovered — trace only)";

    const Chip = ({ m, data }: { m: FlowSendMode; data?: FlowResult }) => (
      <div className={`rounded-md border px-1.5 py-1 ${data ? KIND_TINT[data.kind] : "border-dashed border-black-ink/30 text-black-ink/45"}`}>
        <div className="flex items-center justify-between gap-2 font-mono text-[9px] font-black uppercase tracking-wide">
          <span>{m === "no-jwt" ? "without JWT" : "with JWT"}</span>
          <span>{data ? (data.sent ? `${data.status ?? "—"} · ${data.ms}ms` : "not sent") : "not run yet"}</span>
        </div>
        {data && (
          <div className="mt-0.5 font-mono text-[9px] leading-snug normal-case tracking-normal opacity-80">
            {data.withJwt ? "Authorization: Bearer ✓" : "no Authorization header"}
          </div>
        )}
      </div>
    );

    return (
      <div className="rounded-lg hover:bg-black-ink/5">
        <button
          role="menuitem"
          aria-expanded={expanded}
          onClick={() => setOpenRow(expanded ? null : r.key)}
          title={`Request info + send options: ${r.chain}${r.requiresAuth ? " · requires JWT" : " · public — no JWT"}`}
          className="flex min-h-[36px] w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs font-bold"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-black tracking-wide ${METHOD_TINT[r.method] ?? METHOD_TINT.TRACE}`}>
              {r.method}
            </span>
            <span className="truncate">{r.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              className={`rounded-sm px-1 py-0.5 font-mono text-[8px] font-black tracking-wide ${
                r.requiresAuth ? "bg-black-ink text-paper" : "border border-emerald-600 text-emerald-700"
              }`}
              title={r.requiresAuth ? "Behind requireAuth() — needs a JWT or the car stops at the toll" : "Public route — sent with NO Authorization header"}
            >
              {r.requiresAuth ? "JWT" : "NO JWT"}
            </span>
            <span className="text-black-ink/45">{r.count} hops ▸</span>
          </span>
        </button>

        {expanded && (
          <div className="mx-1.5 mb-2 grid gap-1.5 rounded-lg border border-black-ink/25 bg-paper-deep p-2">
            {/* ── what would actually go on the wire ── */}
            <div className="font-mono text-[9.5px] leading-snug">
              <div className="caption-caps mb-1 font-bold text-black-ink/55">Request info</div>
              <div className="break-all text-black-ink">
                <b>{r.method}</b> {url}
              </div>
              <div className="mt-1 text-black-ink/70">headers:</div>
              <div className="pl-2 text-black-ink/70">Accept: application/json</div>
              {r.method !== "GET" && <div className="pl-2 text-black-ink/70">Content-Type: application/json</div>}
              <div className={facts.hasToken ? "pl-2 text-black-ink/70" : "pl-2 text-black-ink/45"}>
                Authorization: {facts.hasToken ? "Bearer <access token>" : "(not sent — no session)"}
              </div>
              <div className="mt-1 text-black-ink/55">body: {"{}"} · credentials: omit (cookies never sent)</div>
              {r.guard && <div className="mt-1 truncate text-black-ink/55" title={r.guard}>guard: {r.guard}</div>}
            </div>

            {/* ── where the credentials come from ── */}
            <div className="font-mono text-[9.5px] leading-snug text-black-ink/60">
              <div className="caption-caps mb-0.5 font-bold text-black-ink/55">Token</div>
              <div>
                access:{" "}
                {facts.hasToken ? (
                  <span className="text-emerald-700">present · {facts.expLabel}</span>
                ) : (
                  <span className="text-red-700">none — sign in to send with JWT</span>
                )}
                {facts.guest && <span className="text-black-ink/45"> · guest session (demo only)</span>}
              </div>
              <div>refresh: {facts.hasRefresh ? "present — used to re-mint silently" : "absent"}</div>
              <div className="text-black-ink/45">stored in localStorage cc-token / cc-refresh · no cookies</div>
            </div>

            {/* ── the two options ── */}
            <div className="mt-0.5 grid grid-cols-2 gap-1.5">
              <button
                onClick={() => send(r.key, "no-jwt")}
                title="Fire this request with NO Authorization header and show the real response"
                className="rounded-md border-[1.5px] border-black-ink bg-paper px-2 py-1.5 font-mono text-[9.5px] font-black uppercase tracking-wide transition-colors hover:bg-black-ink hover:text-paper"
              >
                ▶ without JWT
              </button>
              <button
                onClick={() => send(r.key, "with-jwt")}
                disabled={!facts.hasToken}
                title={facts.hasToken ? "Fire this request with Authorization: Bearer <access token>" : "No session yet — sign in (or open the demo) first"}
                className="rounded-md border-[1.5px] border-black-ink bg-signal px-2 py-1.5 font-mono text-[9.5px] font-black uppercase tracking-wide text-paper transition-colors enabled:hover:bg-black-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                ▶ with JWT
              </button>
            </div>
            <p className="font-mono text-[9px] leading-snug text-black-ink/55">
              Same request, one difference: the Authorization header. Expect <b>401</b> on the left for a guarded route and{" "}
              <b>2xx</b> on the right — the courier drives the chain and reports the real round-trip.
            </p>

            {/* ── the answers ── */}
            <div className="grid grid-cols-2 gap-1.5">
              <Chip m="no-jwt" data={noJwt} />
              <Chip m="with-jwt" data={withJwt} />
            </div>
            {(noJwt?.note || withJwt?.note) && (
              <div className="rounded-md bg-black-ink px-2 py-1 font-mono text-[9px] leading-snug text-paper/90">
                {withJwt?.note ?? noJwt?.note}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const curated = rows.filter((r) => r.curated);
  const derived = rows.filter((r) => !r.curated);

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => (open ? hidePanel("apis") : showPanel("apis"))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="request-flow-panel"
        aria-label="Request flow"
        title="Request flow — open a route and send it with or without a JWT"
        className={`grid h-9 min-h-[36px] place-items-center rounded-xl border-[1.5px] border-black-ink px-2.5 shadow-[3px_3px_0_rgba(20,20,20,.35)] transition-colors sm:px-3 ${
          open ? "bg-black-ink text-paper" : "bg-paper/95 text-black-ink hover:text-signal"
        }`}
      >
        <Workflow size={15} className="sm:mr-1.5 sm:inline" />
        <span className="hidden text-xs font-bold sm:inline">REQUEST FLOW</span>
      </button>

      {open && (
        <div
          id="request-flow-panel"
          role="menu"
          aria-label="Request flow"
          className="absolute left-0 top-11 z-50 max-h-[calc(100vh-72px)] w-[min(92vw,400px)] max-sm:-left-11 overflow-y-auto rounded-xl border-[1.5px] border-black-ink bg-paper p-3 shadow-[6px_6px_0_rgba(0,0,0,.35)]"
        >
          <div className="flex items-center justify-between">
            <span className="caption-caps flex items-center gap-1.5 font-bold">
              <Workflow size={12} /> REQUEST FLOW · {rows.length}
            </span>
            <button onClick={() => hidePanel("apis")} aria-label="Close request flow" className="text-black-ink/45 hover:text-signal">
              <X size={14} />
            </button>
          </div>

          <SectionTitle>Open a route → send it twice: without JWT (401) · with JWT (2xx)</SectionTitle>

          {rows.length === 0 && (
            <p className="px-2 py-3 text-center text-[11px] text-black-ink/60">
              No API flows yet — analyze a repo with routes.
            </p>
          )}
          {curated.length > 0 && <SectionTitle>Curated flows</SectionTitle>}
          {curated.map((r) => (
            <Row key={r.key} r={r} />
          ))}
          {derived.length > 0 && <SectionTitle>Derived from repo</SectionTitle>}
          {derived.map((r) => (
            <Row key={r.key} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
