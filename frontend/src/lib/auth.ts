import { create } from "zustand";

/** Sole backend dependency — everything goes through the Express API. */
export const API_BASE = import.meta.env.DEV ? "/api/v1" : `${location.origin}/api/v1`;
const AUTH_URL = `${API_BASE}/auth`;

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
  details?: { needsVerification?: boolean; email?: string; devCode?: string };
};

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const token = useAuth.getState().token;
  const res = await fetch(`${AUTH_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok) {
    const err = new Error(json.message ?? `HTTP ${res.status}`) as ApiErrorWithDetails;
    err.status = res.status;
    err.details = json.details as ApiErrorWithDetails["details"];
    throw err;
  }
  return json;
}

export async function beginSignIn(email: string, password: string): Promise<BeginResult> {
  try {
    const r = await request<{ user: AuthUser; token: string }>("/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    applySession(r.data!.token, r.data!.user);
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
  const r = await request<{ user: AuthUser; token: string }>("/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
  applySession(r.data!.token, r.data!.user);
  return r.data!;
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
 *  session via /me, persists it and cleans the URL. */
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
    applySession(token, json.data.user);
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

function persist(token: string, user: AuthUser) {
  localStorage.setItem("cc-token", token);
  localStorage.setItem("cc-user", JSON.stringify(user));
}

function applySession(token: string, user: AuthUser) {
  persist(token, user);
  useAuth.setState({ token, user });
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  signOut: () => void;
}

export const useAuth = create<AuthState>()((set) => ({
  token: localStorage.getItem("cc-token"),
  user: (() => {
    try {
      return JSON.parse(localStorage.getItem("cc-user") ?? "null") as AuthUser | null;
    } catch {
      return null;
    }
  })(),
  signOut: () => {
    localStorage.removeItem("cc-token");
    localStorage.removeItem("cc-user");
    set({ token: null, user: null });
  },
}));

/** Backend performs the full redirect dance itself — just navigate there. */
export function oauthStartUrl(provider: "google" | "github") {
  return `${AUTH_URL}/${provider}`;
}

/** Authorized fetch helper for other frontend modules (analysis flow etc.).
 *  Also records the real round-trip latency into the city store — the
 *  telemetry card and traffic speed read from this, no more fake numbers. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = useAuth.getState().token;
  const started = performance.now();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  }).then((res) => {
    // dynamic import avoids a store↔auth module cycle
    void import("../store/useCity").then(({ useCity }) =>
      useCity.getState().recordLatency(performance.now() - started),
    );
    return res;
  });
}
