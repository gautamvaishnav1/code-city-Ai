# Repo-analysis JSON — what the backend returns

> **Scope:** the JSON the backend (`Backend/`) produces when you ask it to analyze a
> repository, from the first `POST /projects` all the way to the final
> `GET /projects/:id/architecture` payload the 3D city is built from.
>
> Companions: [`FRONTEND-BACKEND-DATA-FLOW.md`](./FRONTEND-BACKEND-DATA-FLOW.md) (how the frontend
> consumes it) · [`Backend/JSON.md`](../Backend/JSON.md) (full API reference) ·
> [`IMPROVEMENTS.md`](./IMPROVEMENTS.md) (known gaps).
>
> Every response below was **captured from a live run** (2026-10-30, `demo://beach-resort`,
> backend on `:5000`) — not invented. Counts from that run: **31 components · 88 connections ·
> 3 districts · 34 routes · healthScore 93**.

---

## Table of contents

1. [The pipeline at a glance](#1-the-pipeline-at-a-glance)
2. [Response envelope](#2-response-envelope)
3. [Step-by-step responses](#3-step-by-step-responses)
4. [The `architecture` payload, field by field](#4-the-architecture-payload-field-by-field)
5. [`architecture.components[]` — one building](#5-architecturecomponents--one-building)
6. [`architecture.connections[]` — one road/arc](#6-architectureconnections--one-roadarc)
7. [Types → districts → building kinds](#7-types--districts--building-kinds)
8. [Guarantees, limits & determinism](#8-guarantees-limits--determinism)
9. [How the frontend turns it into a city](#9-how-the-frontend-turns-it-into-a-city)
10. [Realtime (Socket.IO) payloads](#10-realtime-socketio-payloads)
11. [Reproduce it yourself](#11-reproduce-it-yourself)

---

## 1. The pipeline at a glance

```
POST /projects                     201  → project id
POST /projects/:id/analyze         202  → analysisId (async job starts)
   ↓  poll every 0.5–1 s (or listen on the socket)
GET  /analyses/:id/status          200  → running | completed | failed
   ↓
GET  /projects/:id/architecture    200  → ★ THE payload (city world)
```

| # | Endpoint | Method | Auth | Success | Purpose |
|---|---|---|---|---|---|
| 1 | `/api/v1/projects` | POST | Bearer | **201** | Create the project row (`repoUrl` can be `https://github.com/…`, a real URL, or the bundled `demo://…`) |
| 2 | `/api/v1/projects/:id/analyze` | POST | Bearer | **202** | Start download → AST parse → AI/heuristic architect → city builder. Rate-limited by `aiLimiter` |
| 3 | `/api/v1/analyses/:id/status` | GET | Bearer | **200** | Cheap poll: `status`, `durationMs`, `error` |
| 4 | `/api/v1/analyses/:id` | GET | Bearer | **200** | Full analysis document incl. raw `metadata` (parse facts) |
| 5 | `/api/v1/projects/:id/architecture` | GET | Bearer | **200** | **Latest completed city world** — what `architectureToCity()` consumes |

Socket alternative to polling: join room `project:<projectId>` and listen for
`analysis:progress` / `analysis:completed` / `analysis:failed` ([§10](#10-realtime-socketio-payloads)).

> All five routes sit behind `router.use(requireAuth)` (`analysis.routes.ts`), so an
> anonymous call never reaches the analyzer.

---

## 2. Response envelope

**Success**

```jsonc
{
  "success": true,
  "message": "…",      // optional, present on writes
  "data": { /* … */ }   // always an object
}
```

**Error** (`src/shared/errors/error.middleware.ts`)

```jsonc
{
  "success": false,
  "message": "Human-readable reason",
  "details": [ /* only for 4xx that carry structured detail (zod issues, field errors) */ ],
  "stack": "…"          // only non-production + 5xx
}
```

Real error samples from this run:

```json
// 401 — no Authorization header
{ "success": false, "message": "Missing bearer token" }

// 404 — project id that does not exist (or belongs to someone else)
{ "success": false, "message": "Project not found" }

// 404 — project exists but has no completed analysis yet
{ "success": false, "message": "No completed architecture yet. POST /api/v1/projects/:id/analyze first." }
```

---

## 3. Step-by-step responses

### 3.1 `POST /api/v1/projects` → 201

```json
{
  "success": true,
  "message": "Project created",
  "data": {
    "project": {
      "name": "Doc flow sample",
      "description": "",
      "repoUrl": "demo://beach-resort",
      "source": "demo",
      "owner": "6ae461a8c29cc4cd86d1f641",
      "lastAnalysis": null,
      "createdAt": "2026-10-30T09:21:44.427Z",
      "updatedAt": "2026-10-30T09:21:44.427Z",
      "id": "6ae461a8c29cc4cd86d1f643"
    },
    "reused": false
  }
}
```

`reused: true` means an identical `repoUrl` already existed for this user: the endpoint then
answers **200** (not 201) with `"message": "Existing project for this repository returned"` and
the existing row — no duplicate project is created.

> **Guest sessions** (`provider: "guest"`) may only create `demo://` projects — anything else
> answers **403** `"Guest sessions can open the bundled demo only — sign in to analyze a repository"`.

### 3.2 `POST /api/v1/projects/:id/analyze` → 202

```json
{
  "success": true,
  "message": "Analysis started",
  "data": {
    "analysisId": "6ae461a8c29cc4cd86d1f644",
    "projectId": "6ae461a8c29cc4cd86d1f643",
    "socketRoom": "project:6ae461a8c29cc4cd86d1f643"
  }
}
```

No request body is required. The job runs asynchronously — **never** block on this call.

### 3.3 `GET /api/v1/analyses/:id/status` → 200

```json
{
  "success": true,
  "data": {
    "id": "6ae461a8c29cc4cd86d1f644",
    "status": "completed",
    "durationMs": 1386,
    "error": {}
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | `"running" \| "completed" \| "failed"` | the only value you must switch on |
| `durationMs` | `number \| null` | filled once finished |
| `error` | `{}` / `{ "message": "…" }` / `null` | **empty object `{}` means "no error"** — truthy-check `error.message`, not `error` |

### 3.4 `GET /api/v1/analyses/:id` → 200 (full document)

```jsonc
{
  "success": true,
  "data": {
    "id": "6ae461a8c29cc4cd86d1f644",
    "projectId": "6ae461a8c29cc4cd86d1f643",
    "status": "completed",
    "repoInfo": { /* … see §4.1 */ },
    "stats": { /* … see §4.2 */ },
    "failures": [],          // up to 50 per-file parse failures { file, error, strategy }
    "error": {},             // or { "message": "…" }
    "durationMs": 1386,
    "createdAt": "2026-10-30T09:21:45.002Z",
    "completedAt": "2026-10-30T09:21:46.388Z",
    "metadata": { /* compact ProjectMetadata — the RAW parse facts, no ASTs */ },
    "architecture": { /* the enriched CityWorld.architecture (same as §4.4/§4.5) */ }
  }
}
```

`metadata` is the analyzer's own output (pre-AI). Its keys:

| Key | Type | Meaning |
|---|---|---|
| `generatedAt`, `project` | string | run timestamp / project id |
| `stats` | object | `filesConsidered`, `filesParsedBabel`, `filesFallback`, `filesFailed`, `totalFunctions`, `totalClasses`, `totalRoutes`, `totalModels`, `durationMs` |
| `syntax` | object | parser flavour per file |
| `signals` | object | frontend/backend detection signals |
| `dependencies`, `devDependencies` | `Record<pkg, version>` | from `package.json` (+ lockfiles) |
| `files[]` | `{ path, bytes, lines, role }` | role ∈ `entry · routes · controller · service · model · component · config · …` |
| `imports[]` | `{ file, source, specifiers[] }` | 550 in the sample run |
| `exports[]` | `{ file, names[], kind }` | 188 |
| `functions[]` | `{ name, file, line, params[], isAsync, exported, kind }` | 153 |
| `classes[]` | `{ name, file, line, extends, methods[] }` | 1 |
| `routes[]` | `{ method, path, handler, file }` | raw `RouteFact[]` — **includes `USE`/`MOUNT` middleware rows** |
| `controllers[]` | `{ name, file, kind, type, routeCount }` | |
| `services[]`, `models[]` | `{ name, file, … }` | `models[].fields[]` = schema fields |
| `authIndicators` | object | detected auth middleware names |

### 3.5 `GET /api/v1/projects/:id/architecture` → 200 ★

Top-level shape (all nine keys, in order):

```jsonc
{
  "success": true,
  "data": {
    "analysisId": "6ae461a8c29cc4cd86d1f644",
    "projectId":   "6ae461a8c29cc4cd86d1f643",
    "repoInfo":    { /* §4.1 */ },
    "stats":       { /* §4.2 */ },
    "districts":   [ /* §4.3 */ ],
    "architecture": { "components": [ /* §5 */ ], "connections": [ /* §6 */ ] },
    "routes":      [ /* §4.6 — real Express routes */ ],
    "dependencies": { "runtime": [], "dev": [] },
    "changes":     { /* §4.8 */ }
  }
}
```

This is the **only** endpoint the frontend calls to build a city
(`architectureToCity(data)` in `frontend/src/lib/city.ts`).

---

## 4. The `architecture` payload, field by field

### 4.1 `repoInfo`

```json
{
  "fullName": "codecity/beach-resort-demo",
  "defaultBranch": "main",
  "primaryLanguage": "JavaScript",
  "description": "Beach Resort — full-stack MERN hotel booking system (bundled demo)",
  "stars": 0,
  "techStack": {
    "languages": ["JavaScript"],
    "frontend": ["next", "react", "react-dom"],
    "backend": ["cors", "express"],
    "database": ["mongoose"],
    "authentication": ["bcryptjs", "jsonwebtoken"],
    "tooling": []
  }
}
```

`techStack` is nested **here** (moved out of the top level), so read
`data.repoInfo.techStack` — not `data.techStack`.
For `demo://` projects the values describe the bundled sample app, not a real remote repo.

### 4.2 `stats`

```json
{
  "filesConsidered": 133,
  "filesParsedBabel": 133,
  "filesFallback": 0,
  "filesFailed": 0,
  "totalFunctions": 153,
  "totalClasses": 1,
  "totalRoutes": 53,
  "totalModels": 4,
  "durationMs": 669,
  "scannedFiles": 133,
  "truncatedScan": false,
  "ignoredDirs": [".vscode", "node_modules", "coverage", ".next"],
  "aiEngine": "heuristic",
  "healthScore": 93,
  "bottlenecks": ["app"],
  "totalComponents": 31,
  "totalConnections": 88
}
```

| Field | Meaning |
|---|---|
| `filesConsidered` / `filesParsedBabel` / `filesFallback` / `filesFailed` | parse pipeline accounting — fallback = regex parser when Babel rejects a file |
| `truncatedScan`, `ignoredDirs` | scan caps + directories that were skipped |
| `totalRoutes`, `totalModels` | raw counts from the AST |
| `aiEngine` | `"llm"` \| `"heuristic"` \| `"cached"` — which architect produced the graph |
| `healthScore` | 0–100, starts at 100 and drops with average component complexity + parse failures |
| `bottlenecks` | up to 3 hub component ids with `complexity >= 60` (empty array when none) |
| `totalComponents` / `totalConnections` | computed at read time from `architecture` (not stored) |
| `cacheHit` | present only when a previous analysis of the same repo was reused |

The frontend uses `stats.healthScore` (falling back to `explanation.highlights.healthScore`
for a `/repos/explain` cache hit) as the city's headline score.

### 4.3 `districts[]`

Only districts that actually contain components are emitted:

```json
[
  { "id": "frontend-district", "name": "Frontend District", "position": { "x": 0, "y": 0, "z": 140 },  "bounds": { "width": 160, "depth": 160 }, "color": "#00F0FF" },
  { "id": "backend-district",  "name": "Backend District",  "position": { "x": 0, "y": 0, "z": -140 }, "bounds": { "width": 160, "depth": 160 }, "color": "#A855F7" },
  { "id": "data-district",     "name": "Data District",     "position": { "x": -240, "y": 0, "z": 0 }, "bounds": { "width": 160, "depth": 160 }, "color": "#FF2E97" }
]
```

Five specs exist — `frontend-district`, `backend-district`, `data-district`,
`external-district`, `core-district` — each with a fixed colour and slot; `bounds` **grows**
with the member count (`ceil(sqrt(n))` grid) so a big repo never spills outside its ring.

### 4.4/4.5 → see §5 and §6 (they are `architecture.components` / `architecture.connections`).

### 4.6 `routes[]` — real Express endpoints

Extracted from the AST by `compactRoutes()` — `MOUNT`/`USE` rows and pathless rows are
stripped, capped at 300:

```json
[
  { "method": "GET",  "path": "/",          "handler": "defaultController",                                                          "file": "backend/src/app/index.js" },
  { "method": "GET",  "path": "/dashboard", "handler": "isAuthenticatedUser, isBlocked, isAdmin, getDashboardData",                   "file": "backend/src/routes/apps.routes.js" },
  { "method": "POST", "path": "/auth/registration", "handler": "avatarUpload.single(...), register",                                "file": "backend/src/routes/auth.routes.js" }
]
```

| Field | Type | Notes |
|---|---|---|
| `method` | string | HTTP verb (`GET`, `POST`, …) |
| `path` | string | **as written in the source** — often relative to the router mount (e.g. `/dashboard`, not `/api/v1/dashboard`) |
| `handler` | string | comma-joined handler chain exactly as declared |
| `file` | string | owning file, `/`-normalized — this is the join key the frontend uses |
| `guarded` | `true` *(optional)* | present only when a file-level `router.use(requireAuth)`-style guard covers this path |

`guarded` is derived from **router-level** guards (`router.use(…)` / `passport.authenticate`),
so a route whose *handler list* mentions `isAuthenticatedUser` is **not** automatically flagged.
The frontend's REQUEST FLOW combines this flag with the handler names to decide the `JWT` /
`NO JWT` chip and the "without JWT" 401 probe.

### 4.7 `dependencies`

```json
{ "runtime": [], "dev": [] }
```

* `runtime[]`: up to 60 npm packages from `metadata.dependencies`, each
  `{ name, version, usedBy: [componentId…], hasVulnerabilities: false, lastUpdated: null }`
  (`hasVulnerabilities` is hard-coded `false` — no audit API in the MVP).
* `dev`: up to 40 devDependency names, sorted.
* Both are **empty when the analyzer found no `package.json` dependencies** (as in the bundled
  demo, whose `metadata.dependencies` is `{}`) — treat an empty array as "not detected", not
  as an error.

### 4.8 `changes`

```json
{
  "lastAnalyzed": "2026-10-30T09:20:43.620Z",
  "filesChanged": 0,
  "componentsAffected": [],
  "newConnections": 0,
  "removedConnections": 0,
  "previousAnalysisId": null
}
```

First analysis of a project → all zeros and `previousAnalysisId: null`. On a re-analysis the
backend diffs against the previous completed architecture: component ids added/removed,
per-component file-list changes, and connection keys `from->to` added/removed.

---

## 5. `architecture.components[]` — one building

Real component (trimmed only by omitting `files[]` entries):

```json
{
  "id": "app",
  "name": "App",
  "type": "frontend",
  "description": "UI surface rendering part of the client app (1 file(s)).",
  "district": "frontend-district",
  "floor": 0,
  "parent": null,
  "children": [],
  "belongsTo": [],
  "position": { "x": -39, "y": 0, "z": 114 },
  "size": { "width": 13.6, "height": 32, "depth": 13.6 },
  "visual": {
    "primaryColor": "#00FFFF",
    "glowColor": "#00FFFF",
    "buildingStyle": "modern",
    "importance": 10,
    "complexity": 95
  },
  "files": [
    { "path": "admin-panel/src/pages/Login.jsx", "size": 3778, "lines": 123, "functions": ["Login", "onFinish"], "lastModified": null }
  ],
  "metrics": { "requestCount": 0, "avgLatencyMs": 0, "errorRate": 0, "lastActivity": null, "health": "healthy" },
  "dependencies": {
    "imports": ["@ant-design/icons", "antd", "next", "react", "react-router-dom"],
    "uses": ["apps-routes", "auth-routes", "booking-routes", "index-routes", "review-routes", "room-routes", "user-routes"]
  }
}
```

| Field | Type | How it is produced / rules |
|---|---|---|
| `id` | string | `slugify(name)` — kebab-case, de-duplicated with `-1`, `-2`… Stable across runs for the same name |
| `name` | string | trimmed, capped at 120 chars |
| `type` | string | **canonical** type (LLM output is run through the alias table in §7; the heuristic engine emits canonical values directly) — e.g. `frontend`, `routes`, `controller`, `service`, `model`, `database`, `auth`, `middleware`, `config`, `integration`, `other` |
| `description` | string \| omitted | trimmed, capped 500 chars; empty → key dropped |
| `district` | string | `districtKeyFor(type)` → one of the five district ids |
| `floor` / `parent` / `children` / `belongsTo` | — | currently always `0` / `null` / `[]` / `[]` (reserved for nesting) |
| `position` | `{x,y,z}` | deterministic grid inside the district (`GRID_CELL` spacing), `y = 0` |
| `size` | `{width,height,depth}` | `width = depth = clamp(8 + fileCount*0.8, 8, 16)`; `height = clamp(10 + importance*2.2, 10, 34)` |
| `visual.importance` | 1–10 | `1 + degree*1.4 + min(fileCount,8)*0.45` (in+out edges) |
| `visual.complexity` | 5–95 | `5 + totalLines/maxLines*90` — the repo's biggest component reaches 95 |
| `visual.buildingStyle` | enum | `modern · gate · block · tower · datacenter · antenna · lowrise` (by type) |
| `visual.primaryColor`/`glowColor` | hex | per-type palette (`frontend` cyan, `routes` violet, `model` pink, …) |
| `files[]` | ≤ 12 | `{ path, size(bytes), lines, functions[], lastModified: null }` — `lastModified` is always `null` (GitHub commits API not called) |
| `metrics` | object | **always zeroed**: static analysis has no runtime telemetry (`health: "healthy"`) |
| `dependencies.imports` | string[] | npm packages imported by this component's files, sorted |
| `dependencies.uses` | string[] | ids this component points at (filled from outgoing connections), sorted |

Type → district → style quick reference:

| `type` | district | `buildingStyle` | glow |
|---|---|---|---|
| `frontend` | `frontend-district` | `modern` | `#00FFFF` |
| `routes` | `backend-district` | `gate` | `#C084FC` |
| `controller`, `service` | `backend-district` | `block` | `#A78BFA` |
| `middleware`, `auth` | `backend-district` | `tower` | `#F472B6` |
| `config` | `backend-district` | `lowrise` | `#94A3B8` |
| `model`, `database` | `data-district` | `datacenter` | `#FF5CAD` |
| `integration`, `external` | `external-district` | `antenna` | `#FFC85C` |
| anything else | `core-district` | `lowrise` | `#B6BBC4` |

---

## 6. `architecture.connections[]` — one road/arc

```json
{
  "id": "conn-001",
  "from": "app",
  "to": "apps-routes",
  "label": "sends requests",
  "type": "http",
  "direction": "bidirectional",
  "weight": 84,
  "trafficVolume": "high",
  "protocol": "REST",
  "latencyMs": 0,
  "status": "healthy",
  "path": [
    { "x": -39, "y": 0,   "z": 114 },
    { "x": -6.1, "y": 18, "z": -30.7 },
    { "x": -13, "y": 0,   "z": -179 }
  ],
  "pathType": "curved",
  "elevation": "bridge",
  "visual": { "color": "#00FF88", "width": 4, "glowIntensity": 0.9 }
}
```

| Field | Rules |
|---|---|
| `id` | `conn-001`, `conn-002`… in deterministic sort order |
| `from` / `to` | **must** exist in `components` — dangling and self edges are dropped before you ever see them |
| `label` | ≤ 80 chars; empty → `"uses"` |
| `type` | classified from `label` (see table below) |
| `direction` | `bidirectional` for `http`/`external-api`, else `unidirectional` |
| `weight` | base by type + `8 * min(outDegree, 3)`, clamped 20–95 |
| `trafficVolume` | `high` ≥ 70 · `medium` ≥ 45 · else `low` |
| `protocol` | `REST` · `MongoDB` · `JWT` · `HTTPS` · `in-process` · `npm` |
| `latencyMs` | always `0` (no runtime telemetry yet) |
| `status` | always `"healthy"` |
| `path` | `[from.position, bowed midpoint, to.position]` — the curve the renderer draws |
| `elevation` | `bridge` when the two ends live in different districts (midpoint lifted 18), else `ground` (lift 4) |
| `visual` | colour by type, `width` 4/3/2 by traffic, `glowIntensity` 0.9/0.65/0.4 |

`label` → `type` classification (`classifyConnection`):

| If `label` matches | `type` | colour | protocol |
|---|---|---|---|
| persist / store / database / save / write | `storage` | `#FF2E97` | MongoDB |
| guard / auth / jwt / token / session | `auth-flow` | `#FFD166` | JWT |
| integrat / external / third / webhook / sdk | `external-api` | `#FFB020` | HTTPS |
| send / request / http / rest / fetch | `http` | `#00FF88` | REST |
| delegate / call / use / invoke / handle / dispatch | `internal` | `#00F0FF` | in-process |
| everything else | `dependency` | `#8A8F98` | npm |

---

## 7. Types → districts → building kinds

The LLM/heuristic may emit any string as `type`; `canonicalType()` slugifies it and resolves
~70 aliases (`TYPE_ALIASES` in `architecture.schema.ts`). **Unknown types keep their own
slug**, so nothing silently disappears into a catch-all.

| Canonical `type` | Aliases that collapse into it | District (backend) | Building `kind` (frontend) |
|---|---|---|---|
| `frontend` | ui, view, page, pages, screen, component, react, vue, svelte, angular, client, web, spa | `frontend-district` | `page` / `component` |
| `routes` | route, router, endpoint(s) | `backend-district` | `route` |
| `controller` | controllers, handler(s) | `backend-district` | `controller` |
| `service` | services, business, logic | `backend-district` | `service` |
| `middleware` | middlewares, guard, interceptor, plugin | `backend-district` | `middleware` |
| `auth` | authentication, authorization, security, session, jwt, oauth | `backend-district` | `middleware` |
| `model` | models, schema(s), entity, dao, repository | `data-district` | `model` |
| `database` | db, databases, datastore, storage, persistence, collection | `data-district` | `model` |
| `config` | configuration, settings, env, bootstrap, entry, server, app, util(s), helper | `backend-district` | `api` |
| `integration` | integrations | `external-district` | `api` |
| `external` | thirdparty, third_party, third_party_api, external_api, api_client, sdk, vendor | `external-district` | `api` |
| `other` | — (heuristic fallback component, e.g. `Core Codebase`) | `core-district` | `api` |
| *(unknown slug)* | — | `core-district` | `api` |

Connection `type` → the edge the frontend draws:

| backend `connection.type` | frontend edge `kind` |
|---|---|
| `http`, `auth-flow`, `external-api` | `http` (cyan arc) |
| `storage` | `query` (green arc) |
| `internal`, `dependency`, missing | `import` (violet arc) |

District id → frontend stack (`DISTRICT_STACK` in `city.ts`):
`frontend-district → frontend`, `backend-district → backend`, `data-district → database`,
`external-district → external`, `core-district → backend`.

---

## 8. Guarantees, limits & determinism

Enforced by `normalizeArchitecture()` + `assertCityWorld()` and re-checked before persisting:

**Always (both engines — LLM and heuristic)**

| Guarantee | Value |
|---|---|
| Ids | kebab-case slugs, unique (`-1`, `-2`… suffixes on collision) |
| Files per component | **12** (sliced in the city builder) |
| Connections | endpoints must exist in `components`, no self-edges, de-duplicated on `from\|to\|label` |
| Districts | only those with members; bounds scale with members (`ceil(sqrt(n))` grid) |
| Ordering | components sorted by `id`; connections sorted by the concatenated key `from\|to\|label` (`localeCompare`) |
| Numeric precision | rounded to 1 decimal |
| Output | **byte-identical JSON for identical input** — a re-run of the same commit produces the same document |
| Validation failure | `assertCityWorld` throws → the analysis is stored as `status: "failed"`; `GET …/architecture` then keeps returning the **previous** completed payload |

**LLM path only** (`normalizeArchitecture` — the heuristic graph is built already-canonical and
is not passed through it)

| Guarantee | Value |
|---|---|
| Component cap | **60** (`components.slice(0, 60)`) |
| Name / description / label | 120 / 500 / 80 chars (empty description → key dropped, empty label → `"uses"`) |
| Type strings | canonicalized through `TYPE_ALIASES` (§7) |
| Connection endpoints | remapped by id → name → slug, otherwise dropped |
| Malformed AI output | **422** `"AI returned an invalid architecture structure"` with `details.issues[]` |

**Heuristic path caps** (`generateHeuristic`, `aiEngine: "heuristic"`): ≤10 UI surfaces × ≤6 files,
120 routes, 30 services, 25 models, 6 external packages, 40 route/controller feature groups —
types are emitted already canonical (`frontend · routes · controller · service · auth · model ·
database · config · integration · other`).

---

## 9. How the frontend turns it into a city

`architectureToCity(data)` → `CityJSON` → `useCity.setCity()` → `buildLayout()`:

| Backend field | CityJSON field | Notes |
|---|---|---|
| `repoInfo.fullName` / `name` / `projectId` | `project.name` | fallback chain |
| `repoInfo.techStack.languages[]` | `project.stack` | joined with `·`, default `javascript / typescript` |
| `districts[]` | `districts[]` | `id`, `name`, plus derived `stack` |
| `architecture.components[]` (grouped by `c.district`) | `districts[].buildings[]` | one component → one building |
| `component.type` | `building.kind` | `kindFor()` (§7) |
| `component.files[].lines` summed | `building.loc` | "lines of code" |
| `component.visual.complexity` | `building.health` | ≥60 `error`, ≥40 `warn`, else `ok` |
| `component.files[].functions[]` (deduped, ≤12) | `building.functions[]` | inspector list |
| `routes[]` matched by owning file | `building.route` | `{ method, path, handler, guarded }` for route buildings |
| `architecture.connections[]` (both ends must be buildings) | `edges[]` | `type` → `kind` (§7) |
| `stats.healthScore` (→ `explanation.highlights.healthScore`) | `healthScore` | |
| `districts[].position/bounds/color`, `component.position/size/visual`, `connection.path` | **ignored** | the frontend re-lays out the city itself (`lib/layout.ts`) so roads, sidewalks and gaps are consistent |
| `metrics`, `dependencies`, `changes`, `floor`, `parent`, `children` | **ignored** | reserved / zeroed server-side |

**Orphan safety:** a component whose `district` is unknown is re-homed by its type into an
existing district of that stack, or a `recovered-*-district` is created — no building is ever
dropped silently. Edges whose endpoints never became buildings are removed so no dead arc is drawn.

---

## 10. Realtime (Socket.IO) payloads

Join room `project:<projectId>` (JWT handshake) instead of polling:

```jsonc
// analysis:progress  — throttled, `percent` capped at 70 during parsing
{ "analysisId": "…", "projectId": "…", "step": "parse", "percent": 42,
  "current": 55, "total": 130, "message": "Parsing files 55/130" }

// analysis:completed — compact counts, NOT the full architecture
{ "analysisId": "…", "projectId": "…",
  "stats": { "filesConsidered": 133, "filesParsedBabel": 133, "filesFallback": 0,
             "routes": 53, "models": 4, "durationMs": 1386,
             "healthScore": 93, "bottlenecks": ["app"] },
  "architecture": { "componentCount": 31, "connectionCount": 88,
                    "districts": [{ "id": "frontend-district", "color": "#00F0FF" }],
                    "components": [{ "id": "app", "name": "App", "type": "frontend",
                                     "district": "frontend-district",
                                     "position": { "x": -39, "y": 0, "z": 114 } }] },
  "engine": "heuristic", "aiEngine": "heuristic" }

// analysis:failed
{ "analysisId": "…", "projectId": "…", "error": "Repository download failed" }
```

After `analysis:completed`, call `GET /api/v1/projects/:id/architecture` for the full payload —
the socket event deliberately carries counts and ids only.

---

## 11. Reproduce it yourself

```bash
# 1. backend (port 5000, needs MongoDB)
cd Backend && npm run dev

# 2. the five calls (guest session works for demo:// only)
TOKEN=$(curl -s -X POST localhost:5000/api/v1/auth/guest \
  -H 'Content-Type: application/json' -d '{}' | jq -r '.data.token')

PID=$(curl -s -X POST localhost:5000/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Docs sample","repoUrl":"demo://beach-resort","source":"demo"}' \
  | jq -r '.data.project.id')

curl -s -X POST localhost:5000/api/v1/projects/$PID/analyze \
  -H "Authorization: Bearer $TOKEN" | jq            # 202 { analysisId, projectId, socketRoom }

# poll until completed, then:
curl -s localhost:5000/api/v1/projects/$PID/architecture \
  -H "Authorization: Bearer $TOKEN" | jq '.data | {counts: {districts: (.districts|length),
  components: (.architecture.components|length), connections: (.architecture.connections|length),
  routes: (.routes|length)}, health: .stats.healthScore}'
```

Or run the repo's own probes (backend must be running; commands shown for Windows — swap the
binary for `../Backend/node_modules/.bin/tsx` on macOS/Linux):

```bash
cd frontend
..\Backend\node_modules\.bin\tsx.cmd scripts\probe-flows.ts   # backend → CityJSON → layout
..\Backend\node_modules\.bin\tsx.cmd scripts\probe-guest.ts   # guest demo permissions
..\Backend\node_modules\.bin\tsx.cmd scripts\assert-layout.ts # road/building gap assertions
```

---

*Captured and written 2026-10-30 from the live dev stack. If the payload changes, update this
file alongside `Backend/src/modules/analysis/analysis.controller.ts` and `frontend/src/lib/city.ts`.*
