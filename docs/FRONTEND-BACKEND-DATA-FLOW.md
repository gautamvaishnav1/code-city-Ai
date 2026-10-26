# Frontend ↔ Backend Data Flow

> How the CodeCity frontend (`frontend/`) takes data from the backend (`Backend/`).

For the full developer handbook see [`DOCUMENTATION.md`](./DOCUMENTATION.md).

---

## Table of contents

1. [Overview](#1-overview)
2. [Network layer](#2-network-layer)
3. [Environment & base URL](#3-environment--base-url)
4. [Authentication flow](#4-authentication-flow)
5. [API endpoints consumed](#5-api-endpoints-consumed)
6. [The repo → city pipeline](#6-the-repo--city-pipeline)
7. [State management (Zustand)](#7-state-management-zustand)
8. [Realtime data (SSE & Socket.IO)](#8-realtime-data-sse--socketio)
9. [Type mapping (backend payload → frontend city)](#9-type-mapping-backend-payload--frontend-city)
10. [Known gaps](#10-known-gaps)

---

## 1. Overview

The frontend is a **React 19 + Vite** single-page app (port `5199`) that renders a 3D
city with React Three Fiber. The backend is an **Express 5 + Mongoose** API (port `5000`)
that clones GitHub repos, analyzes them with Babel AST parsing, and returns an
architecture graph.

**Data flow at a glance:**

```
User pastes repo URL
        │
        ▼
HUD RepoLoader ──► useRepoAnalysis hook
        │               │  (REST calls via apiFetch)
        ▼               ▼
   Backend API  ──► architecture JSON payload
                        │
                        ▼
              architectureToCity()   (adapter, src/lib/city.ts)
                        │
                        ▼
              useCity.setCity()      (Zustand store)
                        │
                        ▼
        React Three Fiber components subscribe & render
```

---

## 2. Network layer

The frontend uses **native `fetch`** — there is no axios, react-query, or SWR.
All network calls go through **two helpers** in `frontend/src/lib/auth.ts`
(the frontend's sole backend dependency):

### `request<T>()` — private, auth-scoped (`auth.ts:31`)

Used only for auth endpoints. Injects the Bearer token and unwraps the
backend's uniform envelope:

```ts
const token = useAuth.getState().token;
const res = await fetch(`${AUTH_URL}${path}`, {
  ...init,
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init.headers,
  },
});
```

### `apiFetch()` — public, for all other modules (`auth.ts:187`)

Same token injection, plus it **records real round-trip latency** into the city
store on every request (this drives 3D traffic speed and the telemetry HUD):

```ts
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
    void import("../store/useCity").then(({ useCity }) =>
      useCity.getState().recordLatency(performance.now() - started),
    );
    return res;
  });
}
```

### Response envelope

Every backend response follows the same shape, typed as `ApiEnvelope<T>`
(`auth.ts:7-24`):

```ts
interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
  details?: unknown;   // zod validation errors, etc.
}
```

Call sites:

| File | Purpose |
|---|---|
| `src/lib/auth.ts` | login, register, OTP, `/auth/me` |
| `src/ui/hooks/useRepoAnalysis.ts` | full repo → city pipeline |
| `src/ui/HUD.tsx` | `POST /insights/building` |
| `src/ui/panels/ImprovementGuide.tsx` | `POST /insights/improvements` |
| `src/ui/panels/LogPanel.tsx` | `EventSource` → `GET /logs/stream` (SSE) |

---

## 3. Environment & base URL

**Frontend env** (`frontend/.env`, `.env.example`):

```
VITE_API_BASE_URL=http://localhost:5000/api/v1
VITE_SOCKET_URL=
```

⚠️ **`VITE_API_BASE_URL` is defined but never read.** The actual base URL is
hardcoded in `auth.ts:4`:

```ts
export const API_BASE = import.meta.env.DEV
  ? "/api/v1"                                  // dev → Vite proxy
  : `${location.origin}/api/v1`;               // prod → same origin
```

**Dev proxy** (`frontend/vite.config.ts:8-18`) forwards `/api` → `http://localhost:5000`,
so dev requests are same-origin and CORS is never triggered:

```ts
server: {
  proxy: { "/api": "http://localhost:5000" },
}
```

**Backend env** (`Backend/.env.example`): `PORT`, `MONGO_URI`, `JWT_SECRET`,
`CORS_ORIGINS`, `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`, OAuth client IDs,
`SMTP_*`, etc.

---

## 4. Authentication flow

Auth uses **JWT Bearer tokens**: a short-lived access token (15 min, stored in
`localStorage` under `cc-token` / `cc-user` via the persisted `useAuth` store)
plus a rotating refresh token (7 days).

### Flows

| Flow | Endpoints | Notes |
|---|---|---|
| Email/password sign-in | `POST /auth/login` → `{ user, token, refreshToken }` | access + refresh token saved to localStorage |
| Sign-up + OTP | `POST /auth/register` → `devCode` → `POST /auth/verify-otp` → `{ user, token, refreshToken }` | `devCode` returned when SMTP is unset (dev mode) |
| Resend OTP | `POST /auth/resend-otp` | |
| Session restore | `GET /auth/me` | validates stored token, returns `{ user }` |
| OAuth (Google/GitHub) | browser → `/auth/google` or `/auth/github` | server-side redirect dance; frontend completes via `/auth/success?token=` query, then validates with `GET /auth/me` (`auth.ts`). The refresh token is delivered as an **httpOnly `cc_rt` cookie** (Path=/api/v1/auth) — never in the URL |
| **Silent refresh (rotation)** | `POST /auth/refresh` | see below |
| Logout | `POST /auth/logout` | revokes the refresh token server-side (body or cookie), clears the `cc_rt` cookie and local state |

Every subsequent `apiFetch`/`request` call automatically attaches
`Authorization: Bearer <token>`. The backend's `requireAuth` middleware
(`Backend/src/shared/middleware/auth.middleware.ts`) verifies the JWT and
attaches `req.user`.

### Silent refresh-token rotation

The user should **never** see "invalid token" / "expired token" or be forced
to re-login while the refresh token is valid. Implemented in
`frontend/src/lib/auth.ts`:

1. **Preemptive** — before each request, `freshToken()` decodes the JWT `exp`
   (base64url, no verification) and, if the token expires within **30s**,
   rotates it first. Removes almost all 401 round-trips.
2. **Reactive** — if a response still comes back `401`, `request()` /
   `apiFetch()` call `refreshSession()` once and **replay the original request**
   with the new token.
3. **Single-flight** — concurrent refreshes share one in-flight promise: the
   backend keeps a *single active* refresh token per user, so parallel
   rotations would invalidate each other.
4. **Cookie fallback** — the refresh call sends the localStorage copy in the
   body; if that's rejected (e.g., rotated by another tab), it retries with the
   httpOnly `cc_rt` cookie (`credentials: "include"`).
5. **Silent failure** — if the backend explicitly rejects the refresh, the
   session is cleared **without any toast** (errors are flagged `silent: true`
   and callers like `useRepoAnalysis` / `useAsyncAction` skip them). Network
   errors keep the session.
6. **Multi-tab** — a `storage` event listener adopts token rotations from
   other tabs, so a rotation there never leaves this tab holding a stale token.
7. **Logout** — `signOut()` fires `POST /auth/logout` (fire-and-forget revoke),
   then clears local state; the user sees the signed-out UI only here.

**Not used by the frontend:** `/auth/forgot-password`, `/auth/reset-password`
OAuth token/code SPA endpoints (`POST /auth/google|github`).

---

## 5. API endpoints consumed

All routes are mounted under `/api/v1` in `Backend/src/app.ts:73-79`.

| # | Method & Path | Called from | Request body | Response `data` used |
|---|---|---|---|---|
| 1 | `POST /auth/login` | `auth.ts` (`beginSignIn`) | `{ email, password }` | `{ user, token, refreshToken }` |
| 2 | `POST /auth/register` | `auth.ts` (`beginSignUp`) | `{ name, email, password }` | top-level `devCode` (OTP) |
| 3 | `POST /auth/verify-otp` | `auth.ts` (`verifyOtp`) | `{ email, code }` | `{ user, token, refreshToken }` |
| 4 | `POST /auth/resend-otp` | `auth.ts` (`resendOtp`) | `{ email }` | top-level `devCode` |
| 5 | `GET /auth/me` | `auth.ts` (`completeOauthFromUrl`, `oauthCallbackApi`) | — | `{ user }` |
| 6 | `POST /auth/refresh` | `auth.ts` (`refreshSession`, single-flight) | `{ refreshToken? }` (cookie fallback) | `{ user, token, refreshToken }` — rotated pair |
| 7 | `POST /auth/logout` | `auth.ts` (`signOut`) | `{ refreshToken? }` (cookie fallback) | revoke + clear `cc_rt` cookie |
| 8 | `POST /repos/explain` | `useRepoAnalysis.ts:66` | `{ url }` | cache hit: `{ cached, architecture, explanation, repoInfo }` |
| 9 | `POST /projects` | `useRepoAnalysis.ts:88` | `{ name, repoUrl, source? }` | `data.project.id` |
| 10 | `POST /projects/:id/analyze` | `useRepoAnalysis.ts:101` | — | `data.analysisId` (HTTP 202) |
| 11 | `GET /analyses/:id/status` | `useRepoAnalysis.ts:114` (polled every 2s, max ~90×) | — | `{ status, progress? }` |
| 12 | `GET /projects/:id/architecture` | `useRepoAnalysis.ts:126` | — | full architecture payload → `architectureToCity()` |
| 13 | `POST /insights/building` | `HUD.tsx:178` | `{ building, connections }` | `{ analysis: string }` |
| 14 | `POST /insights/improvements` | `ImprovementGuide.tsx:30` | `{ stats, hotspots, broken }` | `{ guide: string }` |
| 15 | `GET /logs/stream` (SSE) | `LogPanel.tsx:15` (`EventSource`) | — | streamed `{ message, level }` lines |

Backend endpoints **not currently called** by the UI:
`/auth/forgot-password`, `/auth/reset-password`, OAuth callbacks (beyond completion),
`GET /projects`, `GET/DELETE /projects/:id`, `GET /analyses/:id`,
`POST /projects/:id/chat`, `POST /logs/stream-ticket`, `/health`.

---

## 6. The repo → city pipeline

The orchestration lives in **`frontend/src/ui/hooks/useRepoAnalysis.ts`**,
invoked by the `RepoLoader` component in `HUD.tsx:40`. Steps:

```
1. POST /repos/explain { url }
     └─ cache hit?  → use returned architecture directly (skip to step 5)

2. POST /projects { name, repoUrl, source }
     └─ get project.id

3. POST /projects/:id/analyze
     └─ HTTP 202 → get analysisId

4. Poll GET /analyses/:id/status  (every 2s, ~3 min max)
     └─ until status === "completed" | "failed"

5. GET /projects/:id/architecture
     └─ full architecture payload (districts, components, connections, stats)

6. architectureToCity(payload)     # src/lib/city.ts:58 — adapter layer
7. useCity.getState().setCity(city) # Zustand store
8. 3D components re-render via useCity((s) => s.city)
```

Key response shapes (from `Backend/src/modules/analysis/analysis.controller.ts`):

- `POST /projects/:id/analyze` → `202 { analysisId, projectId, socketRoom }`
- `GET /projects/:id/architecture` →
  `{ analysisId, projectId, repoInfo, stats, districts, architecture: { components, connections }, dependencies, changes }`

---

## 7. State management (Zustand)

Three stores (no Redux):

| Store | File | Role |
|---|---|---|
| `useCity` | `src/store/useCity.ts` | **Central store** — `city: CityJSON`, selection, camera focus, latency, weather, notifications, health events, missions. API data lands via `setCity()` (line 166), which also derives `healthEvents` from unhealthy buildings (`healthFromCity`, line 90). `apiFetch` imperatively calls `recordLatency()` here on every request. |
| `useAuth` | `src/lib/auth.ts:163-177` | `{ token, user, signOut }` — **persisted to localStorage** (`cc-token`, `cc-user`) |
| `useUi` | `src/store/useUi.ts` | overlay open/close flags only |

**How API data reaches the 3D scene:**

```
useRepoAnalysis → setCity(city)          # imperative write
        │
        ▼
useCity((s) => s.city)                   # components subscribe
        │
        ▼
useCityLayout()  (src/lib/city.ts:94)    # derived layout for Three.js
```

---

## 8. Realtime data (SSE & Socket.IO)

### SSE — active (`LogPanel.tsx:15`)

The log panel opens an `EventSource` to `GET /api/v1/logs/stream` and renders
streamed `{ message, level }` lines.

⚠️ **Known issue:** `EventSource` cannot set an `Authorization` header. The
backend issues one-time 30-second tickets via `POST /logs/stream-ticket`
(→ `?ticket=`), but `LogPanel.tsx` currently opens the stream **without** a
ticket or token — it may 401 unless the backend accepts anonymous connections.

### Socket.IO — implemented but unused

The backend emits `analysis:progress` events over Socket.IO
(`Backend/src/modules/realtime/socket.server.ts`, auth via `auth: { token }`
handshake), but the **frontend never connects** — it polls
`GET /analyses/:id/status` over REST instead. This is improvement #1 in
[`DOCUMENTATION.md`](./DOCUMENTATION.md) §12.

---

## 9. Type mapping (backend payload → frontend city)

There is **no shared types package** — types are re-declared on the frontend
and kept in sync manually.

### Frontend renderer contract — `frontend/src/types.ts`

`CityJSON`, `DistrictNode`, `BuildingNode` (kind: `page|component|route|controller|service|middleware|model|api`, `health`, `loc`), `FunctionNode`, `EdgeNode` (`http|query|import`).

### Adapter interfaces — `frontend/src/lib/city.ts:8-30`

Local interfaces mirroring the backend architecture payload (closest thing to
shared types):

```ts
interface BackendComponent {
  id, name, type, description?, district,
  files?: [{ path, lines, functions? }]
}
interface BackendConnection { id, from, to, type? }
interface BackendArchitecture {
  analysisId, projectId, repoInfo?, districts?,
  architecture: { components, connections }
}
```

### The adapter — `architectureToCity()` (`city.ts:58-91`)

Maps the backend payload to the frontend `CityJSON`:

- `districts` / `components` → **buildings** (with `kind`, `loc`, `health`, `functions`)
- `connections` → **typed edges** (`http` | `query` | `import`)

### Backend source of truth

`Backend/src/modules/analysis/analysis.types.ts` +
`architecture.schema.ts` (zod-normalized: kebab-case ids, dangling
connections dropped) + `analysis.controller.ts:66-81` (`serialize()`).

---

## 10. Known gaps

1. **Socket.IO unused** — backend realtime is fully implemented; frontend polls REST instead.
2. **SSE auth** — `LogPanel.tsx` opens `/logs/stream` without a ticket/token; likely 401s.
3. **Dead env vars** — `VITE_API_BASE_URL` / `VITE_SOCKET_URL` are defined but never read; base URL is hardcoded in `auth.ts:4`.
4. **No shared types package** — frontend `BackendArchitecture` interfaces are manually kept in sync with backend schemas.
5. **No dedicated `lib/api.ts`** — both fetch helpers live in `auth.ts`; extraction is a listed TODO ([`DOCUMENTATION.md`](./DOCUMENTATION.md) §12).

> ✅ **Resolved:** refresh-token rotation with silent 401 recovery is now
> implemented — see [§4](#4-authentication-flow). Sessions last 7 days
> (sliding via rotation); the user is never shown "invalid/expired token" and
> never forced to re-login mid-session. Explicit logout revokes the token
> server-side.
