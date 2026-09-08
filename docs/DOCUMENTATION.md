# CodeCity AI — Project Documentation

> Turn any GitHub repository into a living, breathing 3D city.
> Every file becomes a building · every dependency a road · every API route a glowing pipeline.

This is the main developer handbook for the monorepo. For API payload examples see
[`Backend/docs/`](../Backend/docs/) · for the marketing overview see [`README.md`](../README.md).

---

## Table of contents

1. [What it does](#1-what-it-does)
2. [Tech stack](#2-tech-stack)
3. [Monorepo layout](#3-monorepo-layout)
4. [System architecture & data flow](#4-system-architecture--data-flow)
5. [Getting started (dev setup)](#5-getting-started-dev-setup)
6. [Configuration](#6-configuration)
7. [API reference](#7-api-reference)
8. [Data models](#8-data-models)
9. **[Repo URL caching (new)](#9-repo-url-caching)** — *input URL → instant explanation from DB*
10. [Frontend state management](#10-frontend-state-management)
11. [Testing](#11-testing)
12. **[How to improve this project](#12-how-to-improve-this-project)**

---

## 1. What it does

Paste a GitHub repo URL → CodeCity downloads it, parses every JS/TS file with Babel,
builds a validated architecture graph, renders it as an animated 3D isometric city
(React Three Fiber), and lets you chat with an AI architect about it.

Core capabilities:

| Capability | Where |
|---|---|
| Repo → City pipeline | `Backend/src/modules/analysis/analysis.pipeline.ts` |
| AST parsing | `Backend/src/modules/parser/` |
| AI architect (LLM + heuristic fallback) | `Backend/src/modules/ai/architect.service.ts` |
| 3D city layout | `Backend/src/modules/ai/city.builder.ts` |
| Auth (email+OTP, JWT, Google/GitHub OAuth) | `Backend/src/modules/auth/` |
| Realtime progress | Socket.IO (`Backend/src/modules/realtime/socket.server.ts`) |
| Cached repo explanations | `Backend/src/modules/repository/repo-explain.service.ts` |

---

## 2. Tech stack

**Frontend** (`frontend/`)
- React 19 + TypeScript, Vite 8
- Three.js via @react-three/fiber + drei + postprocessing
- Tailwind CSS v4, Motion, lucide-react
- State: **Zustand only** (see [§10](#10-frontend-state-management))

**Backend** (`Backend/`)
- Node ≥18, Express 5, TypeScript (CommonJS)
- MongoDB via Mongoose, Zod validation
- JWT auth, OTP email (nodemailer), OAuth (Google/GitHub)
- Socket.IO realtime, helmet, express-rate-limit, CORS
- Vitest test suite

---

## 3. Monorepo layout

```
projects/
├── frontend/                 # 3D web app (:5199)
│   └── src/
│       ├── pages/            # Landing page (+ landing UI kit)
│       ├── three/            # CityScene, buildings, traffic, weather, people
│       ├── components/       # AuthModal, CommandPalette, UI primitives
│       ├── lib/              # auth.ts (apiFetch + useAuth), city.ts (adapter), layout, windows
│       ├── store/useCity.ts  # Zustand city store
│       ├── ui/HUD.tsx        # in-city HUD incl. RepoLoader (GitHub URL input)
│       └── data/sampleCity.ts
├── Backend/                  # API server (:5000)
│   ├── src/
│   │   ├── config/env.ts
│   │   ├── infrastructure/   # database, github, llm, mailer, realtime
│   │   ├── modules/
│   │   │   ├── ai/           # architect.service, chat, prompts, city.builder
│   │   │   ├── analysis/     # pipeline, controller, model, routes
│   │   │   ├── auth/         # controller/service, OTP, OAuth, user model
│   │   │   ├── insights/     # AI insights endpoints
│   │   │   ├── logs/         # SSE log tail
│   │   │   ├── parser/       # babel AST → per-file facts
│   │   │   ├── projects/     # saved cities CRUD (idempotent create)
│   │   │   ├── realtime/     # socket server
│   │   │   └── repository/   # file-scanner, repo-url.util, repo explain (cache)
│   │   └── shared/           # errors, middleware (auth/validate/rate-limit), utils
│   ├── tests/                # 25+ Vitest suites
│   └── docs/                 # API inventory, workflows, example payloads
└── demo/                     # bundled sample app used as offline analysis target
```

---

## 4. System architecture & data flow

```
┌────────────────────┐   /api (vite proxy)   ┌────────────────────────────────┐
│  frontend :5199    │ ────────────────────► │  Backend :5000                 │
│  React 19 + R3F    │ ◄──────────────── ws  │  Express · Mongoose · Socket.IO│
│  Zustand stores    │                       │                                │
└────────────────────┘                       └───────────────┬────────────────┘
                                                             │
                                                    GitHub API · LLM API · SMTP
```

### Full flow when a user enters a GitHub URL

```
Landing hero / HUD input
  └─► HUD.tsx RepoLoader.load(url)
       ├─ 0. POST /api/v1/repos/explain { url }          ← NEW cache check
       │     ├─ HIT  → explanation + full city plan from Mongo → setCity() → done ⚡
       │     └─ MISS ↓
       ├─ 1. POST /api/v1/projects                        (idempotent — reuses existing project)
       ├─ 2. POST /api/v1/projects/:id/analyze            (202, runs async)
       │      pipeline: download → scan → Babel AST → metadata
       │               → AI architect → city builder → persist to Mongo
       │               → Socket.IO progress events
       ├─ 3. GET  /api/v1/analyses/:id/status             (poll until completed)
       └─ 4. GET  /api/v1/projects/:id/architecture → architectureToCity() → setCity()
```

### Analysis pipeline detail

`analysis.pipeline.ts` → `github.service.downloadAndExtractRepo()` → `file-scanner`
→ `babel.parser` + `ast-analyzer` per file → `metadata.builder` → `architect.service`
(LLM with strict JSON validation; deterministic heuristic fallback when no key)
→ `city.builder` (districts/buildings/roads/diff vs previous run) → persisted as an
`Analysis` document → `Project.lastAnalysis` updated → Socket.IO emits
`analysis:started / progress / completed / failed` to room `project:<id>`.

---

## 5. Getting started (dev setup)

Prereqs: Node ≥ 18, npm, local MongoDB at `mongodb://127.0.0.1:27017`.

```bash
# backend
cd Backend && cp .env.example .env && npm install && npm run dev   # :5000

# frontend
cd frontend && npm install && npm run dev                          # :5199 (proxies /api → :5000)

# or everything at once from the root
npm install && npm run install:all && npm run dev
```

Zero-config behavior:
- no `LLM_API_KEY` → heuristic architect mode
- no SMTP → OTP returned as `devCode` in API responses (dev only)
- no `GITHUB_TOKEN` → public repos still work at lower rate limits

---

## 6. Configuration

All config in `Backend/.env` (annotated list in `.env.example`; credentials guide in
`Backend/docs/PRODUCTION_CONFIG.md`). Key variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | API port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/software-world` | MongoDB |
| `JWT_SECRET` | dev placeholder | **change in production** |
| `CORS_ORIGINS` | `*` | comma-separated origins |
| `GITHUB_TOKEN` | — | PAT for higher rate limits |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI / empty | any OpenAI-compatible endpoint |
| `MAX_REPO_FILES` / `MAX_FILE_SIZE_KB` | `1500` / `256` | analysis caps |
| `GOOGLE_CLIENT_ID`… / `GITHUB_CLIENT_*` | — | optional OAuth |
| `SMTP_*` | — | optional OTP email delivery |

---

## 7. API reference

Base URL `http://localhost:5000/api/v1`. All responses use the envelope
`{ success, message?, data? }`. Protected routes need `Authorization: Bearer <jwt>`.
Full inventory: [`Backend/docs/API_ENDPOINTS.json`](../Backend/docs/API_ENDPOINTS.json).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | – | create account → OTP required |
| POST | `/auth/verify-otp` | – | verify code → JWT session |
| POST | `/auth/login` | – | password login |
| GET | `/auth/me` | ✔ | current user |
| GET | `/auth/google` / `/auth/github` | – | OAuth redirect flow |
| POST | `/repos/explain` | ✔ | **cached repo explanation for a GitHub URL** |
| GET | `/projects` | ✔ | list my saved cities |
| POST | `/projects` | ✔ | create project (**idempotent** on same `repoUrl`) |
| GET | `/projects/:id` | ✔ | project details |
| DELETE | `/projects/:id` | ✔ | delete project + its analyses |
| POST | `/projects/:id/analyze` | ✔ | kick off analysis (returns existing `analysisId` if cached) |
| GET | `/analyses/:id` | ✔ | full analysis doc |
| GET | `/analyses/:id/status` | ✔ | `{ status, durationMs, error }` |
| GET | `/projects/:id/architecture` | ✔ | validated CityWorld payload for the renderer |
| POST | `/ai/chat` (see `ai.routes.ts`) | ✔ | architecture-aware AI chat |
| GET | `/insights/*`, `/logs/tail` | ✔ | insights + SSE log stream |
| GET | `/health` (no prefix) | – | uptime + DB status |

### `POST /repos/explain` (new)

Request: `{ "url": "https://github.com/owner/repo" }`

- **Cache hit** → `200` with `data.cached: true` and everything the frontend needs to
  render instantly:

```jsonc
{
  "success": true,
  "data": {
    "cached": true,
    "analysisId": "...", "projectId": "...",
    "repoInfo": { "fullName": "owner/repo", "primaryLanguage": "TypeScript", "stars": 42 },
    "stats": { /* filesConsidered, healthScore, aiEngine, ... */ },
    "explanation": {
      "summary": "owner/repo (42 ★) is a TypeScript repository — \"...\". The analyzer processed 312 files in 14.2s and produced a 3D city of 38 buildings across 5 districts, connected by 51 roads (7 routes, 5 services, 4 models, 3 controllers).",
      "highlights": {
        "filesAnalyzed": 312, "components": 38, "connections": 51,
        "districts": 5, "routes": 7, "models": 5, "healthScore": 81, "aiEngine": "llm"
      }
    },
    "districts": [ /* … */ ],
    "architecture": { "components": [ /* … */ ], "connections": [ /* … */ ] },
    "dependencies": { "runtime": [], "dev": [] },
    "durationMs": 14200,
    "analyzedAt": "2026-08-25T10:00:00.000Z"
  }
}
```

The payload shape matches `GET /projects/:id/architecture`, so the frontend reuses one
adapter (`architectureToCity`) for both paths.

- **Cache miss** → `404` `{ success:false, message:"No cached analysis for owner/repo yet…" }`
  → the client falls back to the normal analysis flow.

---

## 8. Data models

**User** (`modules/auth/user.model.ts`) — name, email (unique), password hash, provider,
verified flag.

**Project** (`modules/projects/project.model.ts`) — name, description, `repoUrl`
(GitHub URL or `demo://`), `source` (`github`|`demo`), `owner → User`,
`lastAnalysis → Analysis`. Index `(owner, repoUrl)`.

**Analysis** (`modules/analysis/analysis.model.ts`) — `project → Project`,
`requestedBy → User`, `status` (`running`|`completed`|`failed`),
`repoInfo { fullName, defaultBranch, primaryLanguage, description, stars }`,
`stats`, `metadata` (compact AST facts), `architecture` (validated graph),
`districts`, `dependencies`, `techStack`, `changes`, `failures[]`, `durationMs`.
Index on `(repoInfo.fullName, status, createdAt)` powers the explain cache lookup.

---

## 9. Repo URL caching

Three layers prevent redundant work when the same repository is analyzed twice:

1. **Repo explanation endpoint** (`POST /repos/explain`) — searched across the whole DB by
   normalized `owner/repo`. On hit, the frontend renders the stored city instantly and shows
   the generated textual explanation. No download, no LLM call.
2. **Idempotent project creation** — `POST /projects` returns the existing project
   (`200 { data: { reused: true } }`) instead of a `409 conflict`, so re-submitting a URL never errors.
3. **Analysis dedupe** — `startAnalysis` returns the latest completed `analysisId` for that
   project + repo without re-running the pipeline (plus an in-flight guard per project).

Ownership note: analyses may be shared across users because they describe *public* repos;
all project-scoped endpoints still enforce ownership (`getOwnedProject`).

---

## 10. Frontend state management

> **Zustand only — there is no Redux anywhere in this project.**
> Nothing needs to be deleted; `package.json` has zero redux dependencies
> (`@reduxjs/toolkit`, `react-redux`, `redux` are absent) and a full source search finds
> no `useDispatch` / `useSelector` / `configureStore`.

Two small Zustand stores cover all app state:

| Store | File | Holds |
|---|---|---|
| `useCity` | `frontend/src/store/useCity.ts` | city JSON, selection/focus, camera flags (traffic/weather/showcase…), notifications, health events, missions, API latency |
| `useAuth` | `frontend/src/lib/auth.ts` | JWT token + user (persisted to localStorage), `signOut` |

Conventions: components subscribe with selectors (`useCity((s) => s.city)`); imperative
updates use `useCity.getState().x()` outside React (e.g. `apiFetch` records latency);
`patch(p)` merges partial state. If you ever need new global state, add it to these
stores rather than introducing another library.

---

## 11. Testing

```bash
cd Backend  && npm test          # vitest — parser, pipeline pieces, services, middleware
cd Backend  && npm run typecheck # tsc --noEmit
cd frontend && npm run build     # tsc -b && vite build
cd frontend && npm run lint      # eslint
```

---

## 12. How to improve this project

Prioritized, concrete suggestions:

### High impact
1. **Use the Socket.IO events instead of polling** — `HUD.tsx` polls `/analyses/:id/status`
   every 2 s while the backend already emits `analysis:progress` with percent to room
   `project:<id>`. Joining the room would give live progress bars and lower server load.
2. **Show the explanation as UI, not just a toast** — `explain.summary` +
   `highlights` deserve a side panel ("About this repo") with stars/language/health score
   and a link to re-analyze for fresh results.
3. **Job queue for the pipeline** — analysis is fire-and-forget inside the API process;
   a restart loses running jobs. Move `runPipeline` to BullMQ/Redis (or keep in-process but
   resume orphaned `running` docs on boot).
4. **CI pipeline** — GitHub Actions running `npm run typecheck && npm test` (Backend) and
   `npm run lint && npm run build` (frontend) on every PR.
5. **Refresh tokens / JWT expiry strategy** — tokens currently have no refresh rotation;
   add short-lived access + refresh token, or document session lifetime explicitly.

### Medium
6. **Pagination & filtering** on `GET /projects` (currently hard limit 100).
7. **Compression + ETags** (`compression` middleware) for the large architecture payloads.
8. **Normalize repoUrl at creation** with `parseGitHubUrl` so `github.com/a/b` and
   `https://github.com/a/b.git` map to one canonical key (improves cache hit rate).
9. **Unique index** `{ owner: 1, repoUrl: 1 }` (currently non-unique) to make idempotent
   create race-proof under concurrent requests.
10. **Structured logging** — swap `console.log` in `app.ts` for the existing pino-style
    logger util; add request IDs.
11. **Rate-limit `/analyze` per user** more strictly than the global limiter (each run =
    GitHub download + possible LLM spend).
12. **Frontend data-fetch layer** — extract the multi-step loader in `HUD.tsx` into
    `lib/api.ts` with typed envelopes; add abort support (AbortController) so leaving the
    page cancels polling.

### Nice-to-have
13. Share/export city snapshots (PNG + shareable read-only links).
14. Incremental re-analysis driven by the already-computed `changes` diff.
15. Language support beyond JS/TS (Python/Go) — the parser module is the seam.
16. Docker Compose for `mongo + backend + frontend` (backend Dockerfile exists).
17. E2E smoke test (Playwright): landing → demo analyze → city visible.

---

*Last updated: 2026-08-25.*
