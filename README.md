<div align="center">

# 🏙 CodeCity AI

**Turn any GitHub repository into a living, breathing 3D city.**

Every file becomes a building · every dependency a road · every API route a glowing pipeline.
Walk through your architecture, ask an AI architect about it, and watch the city come alive.

`React 19` · `Three.js` · `Node + Express` · `MongoDB` · `LLM-powered analysis`

</div>

---

## ✨ What it does

Paste a GitHub repo URL → CodeCity clones it, parses the AST of every file, builds a validated
architecture graph, and renders it as an animated isometric city you can fly through:

- 🔍 **Repo → City** — clone any public JS/TS repo and get a validated `CityJSON` architecture graph
- 🧠 **AI Architect** — LLM-powered architecture reasoning (any OpenAI-compatible API) with a
  deterministic heuristic fallback when no API key is set
- 💬 **AI Chat** — ask *"where is auth handled?"* and get component-validated answers grounded in the graph
- 🌆 **Living city** — traffic, weather, day/night cycle, lightning, water, pedestrians, ambient audio
- 🔐 **Full auth** — email + OTP verification, JWT sessions, Google & GitHub OAuth
- 📡 **Realtime** — Socket.IO progress events while your repo is analyzed
- 🧪 **Tested** — 25+ Vitest suites covering parser, pipeline, auth, and services

---

## 🏗 Architecture

```
┌────────────────────┐        ┌─────────────────────────────────────────┐
│  frontend  :5199   │  /api  │              Backend  :5000             │
│  React 19 + Vite   │ ─────► │  Express · MongoDB · Socket.IO          │
│  Three.js (R3F)    │  proxy │                                         │
│  Tailwind v4       │ ◄───── │  auth ─ analysis ─ parser ─ ai ─ repos  │
└────────────────────┘  ws    └────────────┬──────────────┬─────────────┘
                                           │              │
                                      GitHub API     LLM API
                                      (clone/scan)   (OpenAI-compatible)
```

### Analysis pipeline

```
repo URL → github.service (clone/download)
        → file-scanner (pick JS/TS files, size caps)
        → babel.parser → ast-analyzer (per-file facts)
        → metadata.builder → fallback-extractor
        → architecture.schema (Zod-validated CityJSON)
        → city.builder (3D layout: buildings, roads, districts)
        → AI architect (optional LLM pass / heuristic fallback)
        → Socket.IO progress → frontend renders the city
```

---

## 📦 Monorepo layout

| Path | What it is | Stack |
|---|---|---|
| `frontend/` | 3D web app — landing page, auth modal, city renderer, HUD, AI chat | React 19, Vite, R3F/Three.js, Tailwind v4, Zustand, Motion |
| `Backend/` | API server — auth, analysis pipeline, AI chat, projects, realtime | Node ≥18, Express, TypeScript, Mongoose, Zod, Vitest |
| `demo/` | Reference sample app used as an analysis demo target (third-party hotel-booking system) | Next.js + Express |

```
Backend/
├── src/
│   ├── config/            # env loading & defaults
│   ├── infrastructure/    # database, github, llm, mailer, realtime
│   ├── modules/
│   │   ├── ai/            # architect service, chat, prompts, city builder
│   │   ├── analysis/      # pipeline, controller, model, schema
│   │   ├── auth/          # JWT, OTP, OAuth (Google/GitHub), users
│   │   ├── parser/        # babel AST → per-file facts
│   │   ├── projects/      # saved city projects (CRUD)
│   │   ├── realtime/      # Socket.IO server
│   │   └── repository/    # file scanner, repo URL utils
│   └── shared/            # errors, middleware, types, utils
├── tests/                 # 25+ Vitest suites
└── docs/                  # API inventory, workflows, example payloads

frontend/
├── src/
│   ├── pages/             # Landing (+ landing UI kit)
│   ├── three/             # CityScene, Buildings, Traffic, Weather, People…
│   ├── components/        # AuthModal, CommandPalette, UI primitives
│   ├── lib/               # auth, city, layout, windows helpers
│   └── store/             # Zustand city state
├── public/models/         # served 3D assets (GLB, HDRI, textures)
└── Starlight-res/         # raw asset source of truth
```

---

## 🚀 Quickstart

**Prereqs:** Node ≥ 18, npm, a local MongoDB (`mongodb://127.0.0.1:27017`).

### 1. Backend

```bash
cd Backend
cp .env.example .env      # edit values — everything has sane dev defaults
npm install
npm run dev               # → http://localhost:5000
```

Works out of the box with no external keys:
- **No `LLM_API_KEY`** → deterministic heuristic architect mode
- **No SMTP** → OTP codes are returned in the API response (`devCode`) and logged
- **No `GITHUB_TOKEN`** → public repos still work (lower rate limit)

### 2. Frontend

```bash
cd frontend
npm install
npm run dev               # → http://localhost:5199
```

The Vite dev server proxies `/api` → `localhost:5000`, so there's zero CORS setup in dev.

### 3. Try it

Open `http://localhost:5199`, paste a GitHub repo URL (or use the bundled demo), and watch the city build itself.

---

## 🔧 Configuration

All backend config lives in `Backend/.env` (see `.env.example` for the full annotated list).
**Where to find every credential (SMTP, GitHub token, OAuth, LLM keys) step-by-step:**
[`Backend/docs/PRODUCTION_CONFIG.md`](Backend/docs/PRODUCTION_CONFIG.md).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | API port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/software-world` | MongoDB connection |
| `JWT_SECRET` | dev placeholder | **change in production** |
| `CORS_ORIGINS` | `*` | comma-separated allowed origins |
| `GITHUB_TOKEN` | — | PAT for higher rate limits (no scopes needed for public repos) |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI / empty | any OpenAI-compatible endpoint; empty key = heuristic mode |
| `MAX_REPO_FILES` / `MAX_FILE_SIZE_KB` | `1500` / `256` | analysis caps for large repos |
| `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_*` | — | OAuth providers (optional) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | — | OTP email delivery (optional) |

---

## 📡 API overview

Base URL `http://localhost:5000` · 23 endpoints · full inventory with bodies & expected statuses in
[`Backend/docs/API_ENDPOINTS.json`](Backend/docs/API_ENDPOINTS.json) · workflows in
[`Backend/docs/API_WORKFLOW.md`](Backend/docs/API_WORKFLOW.md).

| Group | Endpoints | Highlights |
|---|---|---|
| Health | 1 | `GET /health` |
| Auth | 13 | register → OTP verify → JWT · login · forgot/reset password · Google & GitHub OAuth · `GET /me` |
| Projects | 4 | create / list / get / delete saved cities |
| Analysis | 2 | `POST /api/v1/analysis` (repo URL → CityJSON, streamed progress via Socket.IO) |
| AI | 3 | architect reasoning + architecture-aware chat |

Auth: `Authorization: Bearer *** where required.

---

## 🛠️ Repo URL Caching

If a user pastes a GitHub repository URL that already has a completed analysis in the database, CodeCity AI will **skip re-analysis** and immediately use the cached results. This provides:

- **Instant feedback** — no need to wait for re-download/parse/re-analyze
- **Consistent results** — same repo always produces the same cached city plan
- **Rate limit savings** — avoids unnecessary GitHub API calls for frequently-analyzed repos

The check happens automatically when `POST /api/v1/projects/:id/analyze` is called. If a completed analysis exists for that repository URL, the pipeline returns the existing analysis ID immediately.

Additionally, `POST /api/v1/repos/explain` accepts `{ url }` and — if **any** user has already analyzed that repository — returns a stored, human-readable repo explanation plus the full cached city plan in one response, so the frontend renders the city instantly with zero re-analysis. Project creation is idempotent (re-submitting the same `repoUrl` returns the existing project instead of a conflict error).

📖 Full developer documentation: [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md)

To take advantage of caching, simply analyze the same repo URL multiple times — the second and subsequent attempts will return instantly from the database.

---

## 🧪 Scripts & tests

```bash
# Backend
npm run dev          # tsx watch
npm run build        # tsc → dist/
npm start            # node dist/server.js
npm run typecheck    # tsc --noEmit
npm test             # vitest run (25+ suites)
npm run test:watch

# Frontend
npm run dev          # vite :5199
npm run build        # tsc -b && vite build
npm run lint         # eslint
```

---

## 🗺 Roadmap

> 📐 **UX/3D improvement plan** — traffic speed, building overlap, label decluttering, world
> cohesion: see [`docs/IMPROVEMENTS.md`](docs/IMPROVEMENTS.md).

- [ ] Language support beyond JS/TS (Python, Go)
- [ ] Persist & share city snapshots
- [ ] Multi-repo "metro area" view
- [ ] CI pipeline (lint + typecheck + tests)
- [ ] Production deployment guide (Dockerfile for Backend already included)

---

## 🙏 Credits

- Fork of [gautamvaishnav1/projects](https://github.com/gautamvaishnav1/projects) — original CodeCity concept & backend
- `demo/` contains [SamiurRahmanMukul/Hotel-Room-Booking-System](https://github.com/SamiurRahmanMukul/Hotel-Room-Booking-System) as the sample analysis target
- 3D assets: three.js example models, Poly Haven HDRIs
- **Repo URL caching** — avoids re-analysis for previously-analyzed repositories

## 📄 License

MIT — see individual packages for details.

---

<div align="center">

**Built at a hackathon, kept alive after it.** 🌃

*If your codebase looks like a city, maybe you can finally fix the traffic.*

</div>
