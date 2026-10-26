import { API_BASE, useAuth } from "./auth";
import { flowAuth, type FlowAuth } from "./city";
import type { CityJSON } from "../types";
import type { FlowProbeResult, FlowSendMode } from "../three/missionTypes";
import { useCity } from "../store/useCity";
import { pushLog } from "../ui/logFeed";

/**
 * REQUEST RUNNER — decides what a traced request is allowed to do, and fires
 * the real HTTP call when it is allowed to.
 *
 * Every route can be run TWO ways (the buttons in the REQUEST FLOW panel), so
 * the difference between an authenticated and an unauthenticated call is
 * something you can SEE, not something you read about:
 *
 *   • "without JWT" → the request is sent with NO Authorization header, even
 *     for a guarded route. The server answers 401 and the courier delivers it.
 *   • "with JWT"    → sent WITH `Authorization: Bearer <access token>`; needs
 *     a session (sign in, or open the demo for a guest token).
 *   • default/auto  → the route's own policy straight off the server's route
 *     table: protected + no token is stopped at the toll and never sent;
 *     public routes are always sent with no header — that's the proof.
 *
 * Probes carry an empty JSON body so the backend's zod validators reject them
 * (400) before any DB write, OTP mail or charge can happen — a trace can never
 * mutate anything. Cookies are never involved (`credentials: "omit"`); auth is
 * header-only, and the refresh token stays in storage for silent re-mints.
 */
const PROBE_TIMEOUT_MS = 6000;

/** real HTTP round-trip for one flow. Never throws. */
async function probeFlow(
  info: FlowAuth,
  key: string,
  token: string | null,
  mode: FlowSendMode = "auto",
): Promise<FlowProbeResult> {
  // The header is chosen by the RUN MODE first, then by the route: an explicit
  // "without JWT" run never carries one (that is the whole experiment), an
  // explicit "with JWT" run always does, and the default follows the route —
  // a public route stays header-less even when a JWT sits in localStorage.
  const withJwt = mode === "no-jwt" ? false : mode === "with-jwt" ? true : info.requiresAuth && !!token;

  // derived flows: static analysis can't recover the URL — trace only
  if (!info.path) {
    return {
      flow: key,
      sent: false,
      withJwt: false,
      status: null,
      ms: 0,
      kind: "none",
      note: "no URL recovered for this route — trace only, nothing was sent",
    };
  }

  // Replace every `:param` segment (`:id`, `:room_id`, `:token`…) with a
  // placeholder — a literal ":room_id" in the URL would miss the real route and
  // bounce off the gateway instead of reaching the handler.
  const url = `${API_BASE}${info.path
    .replace(/^\/api\/v1/, "")
    .replace(/:[A-Za-z0-9_]+/g, "trace-demo")}`;
  const method = (info.method ?? "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (hasBody) headers["Content-Type"] = "application/json";
    // ← the whole point: the header is attached ONLY when the route needs it
    if (withJwt) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? "{}" : undefined,
      signal: ctrl.signal,
      credentials: "omit",
    });
    const ms = Math.round(performance.now() - started);
    const text = await res.text().catch(() => "");
    let serverMsg = "";
    try {
      serverMsg = JSON.parse(text)?.message ?? "";
    } catch {
      /* non-JSON body (SPA fallback / proxy miss) — handled below */
    }
    const status = res.status;

    let note: string;
    let kind: FlowProbeResult["kind"];
    const forcedNoJwt = mode === "no-jwt";
    const forcedJwt = mode === "with-jwt";
    if (!withJwt) {
      if (status === 401) {
        kind = "denied";
        note = forcedNoJwt
          ? "401 Unauthorized — sent exactly like an unauthenticated client: NO Authorization header, and the server turned it away. This is the response the app gives anyone who never signed in."
          : // Honest about the ambiguity: the request WAS sent with no header, and
            // the running backend's own API-gateway wall (`router.use(requireAuth)`
            // on the /api/v1 routers) answers 401 for any path it doesn't serve.
            `401 — sent with NO Authorization header, and the server demanded one anyway: either this route is really guarded (static analysis read it as public), or the URL isn't served here and the API gateway's auth wall answered for it`;
      } else if (status === 404) {
        kind = "rejected";
        note = `404 — no such route on the running backend; nothing to call`;
      } else if (status >= 200 && status < 300) {
        kind = "ok";
        note = `${status} — accepted with NO Authorization header: this route is public${
          forcedNoJwt ? " (your \"without JWT\" run passed anyway)" : ""
        }`;
      } else {
        kind = "rejected";
        note = `${status}${serverMsg ? ` — ${serverMsg}` : ""} · answered with no JWT attached, and no 401: the route never required auth`;
      }
    } else {
      if (status === 401) {
        kind = "denied";
        note = `401 — the server rejected the attached JWT (expired or invalid); sign in again`;
      } else if (status === 404) {
        kind = "rejected";
        note = `404 — no such route on the running backend; the JWT crossed the gate anyway`;
      } else if (status >= 200 && status < 300) {
        kind = "ok";
        note = `${status} — accepted with the JWT attached${
          !info.requiresAuth
            ? " (route is public, so here the header was optional)"
            : forcedJwt
              ? " — this is the authorized response"
              : ""
        }`;
      } else {
        kind = "rejected";
        note = `${status}${serverMsg ? ` — ${serverMsg}` : ""} — reached the server with a valid JWT`;
      }
    }
    return { flow: key, sent: true, withJwt, status, ms, kind, note };
  } catch {
    return {
      flow: key,
      sent: false,
      withJwt,
      status: null,
      ms: Math.round(performance.now() - started),
      kind: "unreachable",
      note: "backend unreachable — the courier traced the road anyway",
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface StartResult {
  blocked: boolean;
}

/**
 * The ONE entry point for running a request flow — used by the REQUEST FLOW
 * dropdown (both options) and by the building sidebar, so all of them behave
 * identically. `mode` picks WHICH of the two runs to perform; the default
 * follows the route's own policy.
 */
export function startFlow(key: string, city: CityJSON, mode: FlowSendMode = "auto"): StartResult {
  const info = flowAuth(key, city);
  const token = useAuth.getState().token;
  const { dispatchMission, notify } = useCity.getState();

  // ── "with JWT" chosen but this session holds no access token ─────────────
  // Nothing to attach, so the run stops at the toll exactly like a 401 would —
  // signing in (or opening the demo, which mints a guest token) unblocks it.
  if (mode === "with-jwt" && !token) {
    dispatchMission(key, { blocked: true });
    notify(
      `⛔ NO ACCESS TOKEN — "${info.label} with JWT" needs a session. Sign in (or open the demo for a guest token) and run it again.`,
      undefined,
      "error",
    );
    pushLog(
      "be",
      `401 ${info.method} ${info.path || key} — "with JWT" requested but this session has no access token`,
      "error",
    );
    return { blocked: true };
  }

  // ── default run: protected route, no JWT → the request is stopped before it is sent ──
  if (mode === "auto" && info.requiresAuth && !token) {
    dispatchMission(key, { blocked: true });
    notify(
      `⛔ JWT MISSING — 401 Unauthorized. ${info.label} sits behind requireAuth(); the request was never sent. Sign in and run it again.`,
      undefined,
      "error",
    );
    pushLog("be", `401 ${info.method} ${info.path || key} — no Authorization header, request never sent`, "error");
    return { blocked: true };
  }

  dispatchMission(key);
  const authNote =
    mode === "no-jwt"
      ? "WITHOUT JWT — no Authorization header"
      : mode === "with-jwt"
        ? "WITH JWT — Authorization: Bearer <access token>"
        : info.requiresAuth
          ? "JWT attached"
          : "sent with NO JWT — public route";
  notify(`▶ ${info.method} ${info.path || key} — ${authNote}`, undefined, "info");
  pushLog("fe", `TRACE ▸ ${info.method} ${info.path || key} — ${authNote}`, "info");

  void probeFlow(info, key, token, mode).then((res) => {
    // attach the verdict to the running mission (drop it if the mission ended)
    useCity.setState((s) => (s.mission?.flow === key ? { mission: { ...s.mission, probe: res } } : {}));
    // and archive it per flow + mode so the panel can show both answers later
    useCity.setState((s) => ({
      flowResults: {
        ...s.flowResults,
        [key]: { ...s.flowResults[key], [mode]: { ...res, mode, at: Date.now() } },
      },
    }));
    if (res.sent) {
      const level = res.kind === "ok" ? "ok" : res.kind === "denied" ? "error" : "warn";
      pushLog("be", `${res.status ?? "—"} ${info.method} ${info.path} · ${res.ms}ms — ${res.note}`, level);
    }
  });

  return { blocked: false };
}
