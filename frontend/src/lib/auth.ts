import { create } from "zustand";

/** Sole backend dependency — everything goes through the Express API. */
export const API_BASE = import.meta.env.DEV ? "/api/v1" : `${location.origin}/api/v1`;
const AUTH_URL = `${API_BASE}/auth`;

/** Refresh this long before the access token's `exp` — removes almost all 401 round-trips. */
const REFRESH_MARGIN_MS = 30_000;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  provider?: string;
}

export type BeginResult =
  | { status: "signed-in"; token: string; user: AuthUser }
  | { status: "otp-required"; email: string; devCode?: string };

interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

type ApiErrorWithDetails = Error & {
  status?: number;
  /** Session ended by the refresh layer — callers must NOT surface it
   *  (no "invalid/expired token" toasts, ever). */
  silent?: boolean;
  details?: { needsVerification?: boolean; email?: string; devCode?: string };
};

function readStoredUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem("cc-user") ?? "null") as AuthUser | null;
  } catch {
    return null;
  }
}

/** base64url-decode a JWT payload without verification — only reads `exp`. */
function tokenExpiryMs(token: string): number | null {
  try {
    const b64 = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64)) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isExpiringSoon(token: string): boolean {
  const exp = tokenExpiryMs(token);
  return exp !== null && exp - Date.now() < REFRESH_MARGIN_MS;
}

function persist(token: string, user: AuthUser, refreshToken: string | null) {
  localStorage.setItem("cc-token", token);
  localStorage.setItem("cc-user", JSON.stringify(user));
  if (refreshToken) localStorage.setItem("cc-refresh", refreshToken);
  else localStorage.removeItem("cc-refresh");
}

function applySession(token: string, user: AuthUser, refreshToken: string | null) {
  persist(token, user, refreshToken);
  useAuth.setState({ token, user, refreshToken });
}

function endSession() {
  localStorage.removeItem("cc-token");
  localStorage.removeItem("cc-user");
  localStorage.removeItem("cc-refresh");
  useAuth.setState({ token: null, user: null, refreshToken: null });
}

function sessionExpiredError(): ApiErrorWithDetails {
  const err = new Error("Session expired") as ApiErrorWithDetails;
  err.status = 401;
  err.silent = true;
  return err;
}

/* ----------------------- refresh-token rotation layer ---------------------- */

let refreshInFlight: Promise<string | null> | null = null;

async function postRefresh(body: Record<string, string>): Promise<string | null> {
  const res = await fetch(`${AUTH_URL}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // OAuth redirect users carry the rotated token in the httpOnly cc_rt cookie
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<{
    user: AuthUser;
    token: string;
    refreshToken?: string;
  }>;
  if (!json.data?.token) return null;
  applySession(json.data.token, json.data.user, json.data.refreshToken ?? null);
  return json.data.token;
}

/** Exchange the refresh token (localStorage copy, falling back to the httpOnly
 *  cookie) for a fresh access token pair. Single-flight: the backend keeps one
 *  active refresh token per user, so concurrent rotations would invalidate each
 *  other — all callers share one in-flight rotation. Never throws; returns the
 *  new access token, or null after silently ending the session when the
 *  backend explicitly rejects the refresh (network errors keep the session). */
function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const rt = useAuth.getState().refreshToken;
      try {
        // 1. prefer the persisted copy
        let token = await postRefresh(rt ? { refreshToken: rt } : {});
        // 2. stale copy (rotated by another tab) → retry with the cookie
        if (!token && rt) token = await postRefresh({});
        if (!token && (useAuth.getState().token || useAuth.getState().refreshToken)) {
          endSession(); // refresh rejected → session over, no error shown
        }
        return token;
      } catch {
        return null; // network failure — keep session; caller surfaces its own error
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/** Current access token, rotated preemptively when it is about to expire.
 *  A missing access token with a refresh token still in hand is NOT "signed
 *  out" — we rotate instead of returning null, so no request ever goes out
 *  header-less and bounces off the server with "Missing bearer token". */
async function freshToken(): Promise<string | null> {
  const { token, refreshToken } = useAuth.getState();
  if (!token) return refreshToken ? refreshSession() : null;
  if (!isExpiringSoon(token)) return token;
  return refreshSession();
}

/** BOOT GATE — awaited before the app makes its first API call.
 *  Restores a live access token from the refresh token (or the httpOnly
 *  cc_rt cookie) so the very first request already carries a Bearer header.
 *  Resolves to the token, or null for a genuinely signed-out visitor.
 *  Never throws and never opens a login prompt on its own. */
export async function ensureSession(): Promise<string | null> {
  const { token, refreshToken } = useAuth.getState();
  if (token && !isExpiringSoon(token)) return token;
  if (!token && !refreshToken) return null; // anonymous visitor — nothing to restore
  return refreshSession();
}

function authHeaders(token: string | null, init: RequestInit): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const token = await freshToken();
  let res = await fetch(`${AUTH_URL}${path}`, {
    ...init,
    headers: authHeaders(token, init),
  });
  // access token died mid-session → rotate once and replay. Only /me is retried:
  // a 401 on login/OTP endpoints means bad credentials, not expiry.
  if (res.status === 401 && path === "/me" && token) {
    const fresh = await refreshSession();
    if (!fresh) throw sessionExpiredError();
    res = await fetch(`${AUTH_URL}${path}`, { ...init, headers: authHeaders(fresh, init) });
  }
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok) {
    const err = new Error(json.message ?? `HTTP ${res.status}`) as ApiErrorWithDetails;
    err.status = res.status;
    err.details = json.details as ApiErrorWithDetails["details"];
    if (res.status === 401 && path === "/me") err.silent = true;
    throw err;
  }
  return json;
}

/**
 * POST /auth/guest — mint an anonymous session so the bundled `demo://`
 * projects open with no sign-up wall. Returns a normal session (the token
 * lives in localStorage and rotates like any other), but the backend marks it
 * `guest: true`, so only demo repositories are reachable until the visitor
 * signs in properly. Throws on failure — callers fall back to the auth modal.
 */
export async function beginGuestSession(): Promise<BeginResult> {
  const r = await request<{ user: AuthUser; token: string; refreshToken?: string }>("/guest", {
    method: "POST",
    body: JSON.stringify({}),
  });
  applySession(r.data!.token, r.data!.user, r.data!.refreshToken ?? null);
  return { status: "signed-in", token: r.data!.token, user: r.data!.user };
}

export async function beginSignIn(email: string, password: string): Promise<BeginResult> {
  try {
    const r = await request<{ user: AuthUser; token: string; refreshToken?: string }>("/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    applySession(r.data!.token, r.data!.user, r.data!.refreshToken ?? null);
    return { status: "signed-in", token: r.data!.token, user: r.data!.user };
  } catch (e) {
    // unverified local accounts → backend replies 403 { details: { needsVerification, email, devCode? } }
    const err = e as ApiErrorWithDetails;
    if (err.status === 403 && err.details?.needsVerification) {
      return { status: "otp-required", email: err.details.email ?? email, devCode: err.details.devCode };
    }
    throw e;
  }
}

/** Register always starts the OTP flow — the token arrives after /verify-otp.
 *  In dev mode the backend returns the OTP as top-level `devCode` so the UI can
 *  auto-fill it (no email transport locally). */
export async function beginSignUp(name: string, email: string, password: string): Promise<BeginResult> {
  const r = await request<{ devCode?: string }>("/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  return { status: "otp-required", email, devCode: r.devCode as string | undefined };
}

export async function verifyOtp(email: string, code: string) {
  const r = await request<{ user: AuthUser; token: string; refreshToken?: string }>("/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
  applySession(r.data!.token, r.data!.user, r.data!.refreshToken ?? null);
  return { user: r.data!.user, token: r.data!.token };
}

export async function resendOtp(email: string): Promise<{ devCode?: string }> {
  const r = await request<{ message: string }>("/resend-otp", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return { devCode: r.devCode as string | undefined };
}

/** Complete an OAuth redirect: accepts the legacy `#oauth=<token>` hash or the
 *  backend's `/auth/success?token=&name=&email=` query redirect, resolves the
 *  session via /me, persists it and cleans the URL. The refresh token travels
 *  as an httpOnly cc_rt cookie set by the backend — never in the URL. */
export async function completeOauthFromUrl(): Promise<{ token: string; user: AuthUser } | null> {
  let token: string | null = null;
  const m = location.hash.match(/#oauth=([^&]+)/);
  if (m) {
    token = decodeURIComponent(m[1]);
  } else if (location.pathname.endsWith("/auth/success")) {
    const params = new URLSearchParams(location.search);
    token = params.get("token");
  }
  if (!token) return null;
  try {
    const res = await fetch(`${AUTH_URL}/me`, { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json()) as ApiEnvelope<{ user: AuthUser }>;
    if (!res.ok || !json.data?.user) throw new Error(json.message ?? `HTTP ${res.status}`);
    history.replaceState(null, "", location.origin + "/");
    applySession(token, json.data.user, null);
    return { token, user: json.data.user };
  } catch {
    return null;
  }
}

/** Handle OAuth callback API response from browser redirect after OAuth complete.
 *  Backend redirects browser to /auth/success?..., but we also support an API call
 *  that returns JSON { success, user, redirect } for SPA-driven flows. */
export async function oauthCallbackApi(): Promise<{ success: boolean; user?: AuthUser; redirect?: string }> {
  // Try to get token from hash or query first
  let token: string | null = null;
  const hashMatch = location.hash.match(/#oauth=([^&]+)/);
  if (hashMatch) {
    token = decodeURIComponent(hashMatch[1]);
  } else {
    const searchToken = new URLSearchParams(location.search).get("token");
    if (searchToken) token = searchToken;
  }
  if (!token) return { success: false };

  try {
    const res = await fetch(`${AUTH_URL}/me`, { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json()) as ApiEnvelope<{ user: AuthUser }>;
    if (!res.ok || !json.data?.user) throw new Error(json.message ?? `HTTP ${res.status}`);
    return { success: true, user: json.data.user, redirect: "/#app" };
  } catch {
    return { success: false };
  }
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  refreshToken: string | null;
  signOut: () => void;
}

export const useAuth = create<AuthState>()(() => ({
  token: localStorage.getItem("cc-token"),
  user: readStoredUser(),
  refreshToken: localStorage.getItem("cc-refresh"),
  signOut: () => {
    const rt = useAuth.getState().refreshToken;
    // best-effort server-side revocation (also revokes the OAuth cookie) — fire and forget
    void fetch(`${AUTH_URL}/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(rt ? { refreshToken: rt } : {}),
    }).catch(() => {});
    endSession();
  },
}));

// Rotation is single-active per user — adopt token changes from other tabs so
// a rotation there never leaves this tab holding a stale token (which would
// 401 into a silent sign-out). A sign-out anywhere signs out everywhere.
window.addEventListener("storage", (e) => {
  if (e.key !== null && !["cc-token", "cc-user", "cc-refresh"].includes(e.key)) return;
  useAuth.setState({
    token: localStorage.getItem("cc-token"),
    user: readStoredUser(),
    refreshToken: localStorage.getItem("cc-refresh"),
  });
});

/** Backend performs the full redirect dance itself — just navigate there. */
export function oauthStartUrl(provider: "google" | "github") {
  return `${AUTH_URL}/${provider}`;
}

/** Authorized fetch helper for other frontend modules (analysis flow etc.).
 *  Also records the real round-trip latency into the city store — the
 *  telemetry card and traffic speed read from this, no more fake numbers.
 *  On an expired access token it silently rotates the session (refresh-token
 *  rotation) and replays the request once — callers never see "invalid token";
 *  only an unrecoverable session end throws, flagged `silent: true`. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const started = performance.now();
  try {
    const token = await freshToken();
    let res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: authHeaders(token, init),
    });
    // 401 → rotate once and replay. Runs whether or not we thought we had a
    // token: a header-less request (expired session, cold tab) gets the same
    // treatment, and a 401 with nothing to rotate is surfaced as a clean
    // silent session error instead of the server's raw "Missing bearer token".
    if (res.status === 401) {
      const fresh = token ? await refreshSession() : await ensureSession();
      if (!fresh) throw sessionExpiredError();
      res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: authHeaders(fresh, init),
      });
      if (res.status === 401) throw sessionExpiredError();
    }
    return res;
  } finally {
    // dynamic import avoids a store↔auth module cycle
    void import("../store/useCity").then(({ useCity }) =>
      useCity.getState().recordLatency(performance.now() - started),
    );
  }
}
