# API Request Reference (JSON)

Base URL: `http://localhost:5000`

All `/api/v1/*` endpoints (except the auth endpoints noted) require a Bearer token:

```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Access tokens come from `register`, `login`, OTP verification, or OAuth login and look like:

```json
{ "sub": "64f1...", "email": "dev@example.com", "iat": 1756000000, "exp": 1756604800 }
```

---

## 1. Health — no auth

### `GET /health`

```json
// no request body
```

**Response 200**

```json
{
  "success": true,
  "status": "ok",
  "uptimeSeconds": 128,
  "db": "connected",
  "timestamp": "2026-08-22T18:00:00.000Z"
}
```

---

## 2. Auth

### `POST /api/v1/auth/register`

| Field | Rules |
|---|---|
| `name` | optional, 1–80 chars after trim |
| `email` | valid email, trimmed + lowercased |
| `password` | min 8, max 128, must contain a letter and a number |

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "password": "Passw0rd!"
}
```

**Response 201**

```json
{
  "success": true,
  "user": { "id": "64f1...", "email": "ada@example.com", "emailVerified": false },
  "token": "<jwt>",
  "otp": { "delivered": false, "devCode": "482913" }
}
```

> When SMTP is not configured, `otp.delivered` is `false` and `otp.devCode` contains the 6-digit code for local testing.

### `POST /api/v1/auth/login`

```json
{
  "email": "ada@example.com",
  "password": "Passw0rd!"
}
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "user": { "id": "64f1...", "email": "ada@example.com" },
    "token": "<jwt>"
  }
}
```

### `POST /api/v1/auth/verify-otp`

| Field | Rules |
|---|---|
| `code` | exactly 6 digits |

```json
{
  "email": "ada@example.com",
  "code": "482913"
}
```

**Response 200**

```json
{ "success": true, "verified": true }
```

### `POST /api/v1/auth/resend-otp`

| Field | Rules |
|---|---|
| `purpose` | optional: `"register"` (default) or `"password_reset"` |

```json
{
  "email": "ada@example.com",
  "purpose": "register"
}
```

**Response 200**

```json
{ "success": true, "delivered": false, "devCode": "159357" }
```

> Rate limited to one code per minute.

### `POST /api/v1/auth/forgot-password`

```json
{
  "email": "ada@example.com"
}
```

**Response 200**

```json
{ "success": true, "message": "If that email exists, a reset code has been sent" }
```

### `POST /api/v1/auth/reset-password`

| Field | Rules |
|---|---|
| `newPassword` | same rules as register password |

```json
{
  "email": "ada@example.com",
  "code": "246810",
  "newPassword": "NewPass123"
}
```

**Response 200**

```json
{
  "success": true,
  "data": { "user": { "id": "64f1...", "email": "ada@example.com" }, "token": "<jwt>" }
}
```

### `GET /api/v1/auth/google` — OAuth redirect (browser flow)

No body. Redirects to Google consent screen.

### `POST /api/v1/auth/google` — SPA flow (Google Identity ID token)

| Field | Rules |
|---|---|
| `credential` | Google ID token, min 20 chars |

```json
{
  "credential": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ.eyJzdWIiOiIxMjM0NSJ9.sig"
}
```

**Response 200**

```json
{
  "success": true,
  "data": { "user": { "id": "64f1...", "email": "ada@gmail.com" }, "token": "<jwt>" }
}
```

### `GET /api/v1/auth/github` — OAuth redirect (browser flow)

No body.

### `POST /api/v1/auth/github` — SPA flow (OAuth code)

| Field | Rules |
|---|---|
| `code` | GitHub authorization code, 5–200 chars |

```json
{
  "code": "abcde12345ffff67890"
}
```

**Response 200**

```json
{
  "success": true,
  "data": { "user": { "id": "64f1...", "email": "ada@users.noreply.github.com" }, "token": "<jwt>" }
}
```

### `GET /api/v1/auth/me`

```json
// no request body — requires Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "data": { "user": { "id": "64f1...", "email": "ada@example.com" } }
}
```

---

## 3. Projects — all require auth

### `POST /api/v1/projects`

| Field | Rules |
|---|---|
| `name` | required, 1–120 chars after trim |
| `description` | optional, max 500 chars, defaults `""` |
| `repoUrl` | valid URL containing `github.com` |

```json
{
  "name": "My Awesome API",
  "description": "Express + MongoDB demo service",
  "repoUrl": "https://github.com/acme/widgets"
}
```

Branch-specific repos also work:

```json
{
  "name": "Widgets (develop)",
  "repoUrl": "https://github.com/acme/widgets/tree/feature/cool-thing"
}
```

**Response 201**

```json
{
  "success": true,
  "data": {
    "project": {
      "_id": "66a1...",
      "owner": "64f1...",
      "name": "My Awesome API",
      "description": "Express + MongoDB demo service",
      "repoUrl": "https://github.com/acme/widgets",
      "status": "created",
      "createdAt": "2026-08-22T18:00:00.000Z"
    }
  }
}
```

### `GET /api/v1/projects`

```json
// no request body
```

**Response 200**

```json
{ "success": true, "data": { "projects": [ /* ... */ ] } }
```

### `GET /api/v1/projects/:id`

```json
// no request body; :id = project ObjectId e.g. 66a1...
```

### `DELETE /api/v1/projects/:id`

```json
// no request body
```

**Response 200**

```json
{ "success": true, "message": "Project deleted" }
```

---

## 4. Analysis — all require auth

### `POST /api/v1/projects/:id/analyze`

Triggers repo download → AST parse → AI/heuristic architecture build. Rate limited (AI limiter).

```json
// no request body; :id = project id
```

**Response 202**

```json
{
  "success": true,
  "data": {
    "analysisId": "67b2...",
    "status": "running"
  }
}
```

### `GET /api/v1/analyses/:id`

Full analysis document (metadata + architecture).

```json
// no request body
```

**Response 200**

```json
{ "success": true, "data": { /* analysis doc */ } }
```

### `GET /api/v1/analyses/:id/status`

Lightweight polling endpoint.

```json
// no request body
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "status": "completed",
    "progress": 100,
    "error": null
  }
}
```

### `GET /api/v1/projects/:id/architecture`

Latest completed architecture for a project, **pre-laid-out as a 3D city**: every component arrives with district, position, size and visual hints; every connection carries a typed road spec. The frontend can spawn the world without computing any layout math.

> **Field-by-field reference (all 5 analysis endpoints, real captured payload, type →
> district → building-kind tables):** [`docs/ANALYSIS-JSON.md`](../docs/ANALYSIS-JSON.md).

```json
// no request body
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "analysisId": "67b2...",
    "projectId": "66a1...",
    "repoInfo": {
      "fullName": "acme/widgets",
      "defaultBranch": "main",
      "primaryLanguage": "TypeScript",
      "techStack": {
        "languages": ["TypeScript"],
        "frontend": ["react"],
        "backend": ["express", "socket.io"],
        "database": ["mongoose"],
        "authentication": ["jsonwebtoken", "bcryptjs"],
        "tooling": ["vitest", "tsx"]
      }
    },
    "stats": {
      "filesConsidered": 141,
      "totalRoutes": 40,
      "totalModels": 5,
      "durationMs": 18320,
      "aiEngine": "llm",
      "healthScore": 92,
      "bottlenecks": ["auth-controller"]
    },
    "districts": [
      {
        "id": "backend-district",
        "name": "Backend District",
        "position": { "x": 0, "y": 0, "z": -140 },
        "bounds": { "width": 160, "depth": 160 },
        "color": "#A855F7"
      }
    ],
    "architecture": {
      "components": [
        {
          "id": "auth-routes",
          "name": "Auth Routes",
          "type": "routes",
          "district": "backend-district",
          "position": { "x": -13, "y": 0, "z": -153 },
          "size": { "width": 9.6, "height": 15.8, "depth": 9.6 },
          "visual": {
            "primaryColor": "#C084FC",
            "glowColor": "#C084FC",
            "buildingStyle": "gate",
            "importance": 6,
            "complexity": 72
          },
          "files": [
            { "path": "src/routes/auth.routes.ts", "size": 7680, "lines": 210, "functions": ["loginUser"], "lastModified": null }
          ],
          "metrics": { "requestCount": 0, "avgLatencyMs": 0, "errorRate": 0, "lastActivity": null, "health": "healthy" },
          "dependencies": { "imports": ["jsonwebtoken"], "uses": ["auth-controller"] }
        }
      ],
      "connections": [
        {
          "id": "conn-001",
          "from": "auth-routes",
          "to": "auth-controller",
          "label": "delegates to",
          "type": "internal",
          "direction": "unidirectional",
          "weight": 48,
          "trafficVolume": "medium",
          "protocol": "in-process",
          "latencyMs": 0,
          "status": "healthy",
          "path": [
            { "x": -13, "y": 0, "z": -153 },
            { "x": 0, "y": 4, "z": -140 },
            { "x": 13, "y": 0, "z": -127 }
          ],
          "pathType": "curved",
          "elevation": "ground",
          "visual": { "color": "#00F0FF", "width": 3, "glowIntensity": 0.65 }
        }
      ]
    },
    "dependencies": {
      "runtime": [ { "name": "express", "version": "^4.18.2", "usedBy": ["server-app"], "hasVulnerabilities": false } ],
      "dev": ["vitest", "tsx"]
    },
    "changes": {
      "lastAnalyzed": "2026-08-22T18:00:00.000Z",
      "filesChanged": 2,
      "componentsAffected": ["user-model"],
      "newConnections": 1,
      "removedConnections": 0,
      "previousAnalysisId": "67a0..."
    }
  }
}
```

**Component field notes (3D mapping hints)**

| Field | Frontend usage |
|---|---|
| `type` | building model picker (`database` → cylinder/datacenter, `routes` → gate, `auth`/`middleware` → tower…) |
| `district` | cluster id; matches a `districts[].id` |
| `position` / `size` | world transform + AABB (no overlaps guaranteed) |
| `visual.importance` | 1–10 → LOD / camera focus weight |
| `visual.complexity` | 5–95 → emissive intensity / detail budget |

**Connection road types** (`connections[].type`)

| Type | Protocol label | Suggested road style |
|---|---|---|
| `http` | REST | neon highway (bidirectional) |
| `storage` | MongoDB | underground pipe / magenta tube |
| `auth-flow` | JWT | golden secure conduit |
| `external-api` | HTTPS | antenna bridge to the void |
| `internal` | in-process | cyan local street |
| `dependency` | npm | faint gray supply line |

`weight` is 20–95 → map to road width / glow intensity; `trafficVolume` is `low | medium | high`.

---

## 5. Chat — requires auth

### `POST /api/v1/projects/:id/chat`

Ask a question about the analyzed architecture (3D city map guide).

| Field | Rules |
|---|---|
| `question` | required, 2–500 chars after trim |

```json
{
  "question": "How does authentication work?"
}
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "answer": "Authentication starts at the auth routes and delegates into the controller.",
    "targetComponent": "auth-routes",
    "path": ["frontend", "auth-routes", "auth-controller"],
    "relatedComponents": ["user-model"]
  }
}
```

> **AI hallucination guard (built-in):** every `targetComponent`, `path` and `relatedComponents` id is validated against the stored architecture before responding. Invalid LLM ids are dropped or replaced with heuristic matches, so the frontend never receives a component id that does not exist in the 3D world.

---

## 6. Socket.IO (live analysis progress + character control)

Connect with the same JWT:

```javascript
import { io } from "socket.io-client";
const socket = io("http://localhost:5000", { auth: { token: "<jwt>" } });
```

Handshake without a valid token is rejected. Join a project room first — every event below is scoped to `project:<projectId>` rooms and ownership-checked.

```javascript
socket.emit("project:join", { projectId: "<id>" }, (ack) => console.log(ack));
// => { ok: true, room: "project:<id>" }
```

### Server → Client events

#### `analysis:progress`

```json
{ "analysisId": "67b2...", "projectId": "66a1...", "step": "parse", "percent": 42, "current": 55, "total": 130, "message": "Parsing files 55/130" }
```

Steps: `github` → `scan` → `parse` → `ai` → `city` → `save`.

#### `analysis:completed` (with city-health telemetry)

```json
{
  "analysisId": "67b2...",
  "projectId": "66a1...",
  "stats": {
    "filesConsidered": 141,
    "filesParsedBabel": 138,
    "filesFallback": 3,
    "routes": 40,
    "models": 5,
    "durationMs": 18320,
    "healthScore": 92,
    "bottlenecks": ["auth-controller"]
  },
  "architecture": {
    "componentCount": 9,
    "connectionCount": 12,
    "districts": [ { "id": "backend-district", "color": "#A855F7" } ],
    "components": [
      { "id": "auth-routes", "name": "Auth Routes", "type": "routes", "district": "backend-district", "position": { "x": -13, "y": 0, "z": -153 } }
    ]
  },
  "engine": "llm"
}
```

- `healthScore`: 0–100 deterministic score (100 − avg building complexity pressure − parse-failure penalty). Show it in the "City Health" overlay.
- `bottlenecks`: up to 3 component ids with complexity ≥ 60, sorted by complexity. Render warning beacons on those buildings.

After this event, fetch `GET /api/v1/projects/:id/architecture` for the full pre-laid-out world.

#### `analysis:failed`

```json
{ "analysisId": "67b2...", "projectId": "66a1...", "error": "Repository download failed" }
```

### Client → Server events

#### `character:move` — multi-hop walk

```javascript
socket.emit(
  "character:move",
  {
    projectId: "<id>",
    path: ["frontend", "api-gateway", "auth-routes", "auth-controller"], // exact flight sequence
    triggeredBy: "chat" // optional: "chat" | "user_click" | "telemetry" (default "user_click")
  },
  (ack) => console.log(ack) // => { ok: true, path: ["frontend","api-gateway","auth-routes"] }
);
```

- Every id is validated against the stored architecture; **hallucinated ids are stripped** before broadcast.
- If none of the ids are valid the ack is `{ ok: false }`.
- Legacy single-hop payloads (`{ toComponentId, fromComponentId }`) still work and become a 1-element path.
- Broadcast shape (all clients in the room receive):

```json
{
  "event": "character:move",
  "payload": {
    "projectId": "...",
    "path": ["frontend", "api-gateway", "auth-routes"],
    "toComponentId": "auth-routes",
    "fromComponentId": "frontend",
    "triggeredBy": "chat",
    "requestedBy": "<userId>"
  }
}
```

#### `character:explain` — narrate a walk

```javascript
socket.emit("character:explain", { projectId: "<id>", path: ["frontend", "auth-routes"] }, (ack) => {
  // ack: { ok: true, path: [...] } — invalid ids stripped server-side
});
```

---

## Error format (all endpoints)

```json
{
  "success": false,
  "message": "Validation failed",
  "details": [
    { "field": "password", "message": "Password must contain a number" }
  ]
}
```

| Status | Meaning |
|---|---|
| 400 | Validation failed / malformed JSON |
| 401 | Missing/invalid bearer token |
| 404 | Route or resource not found |
| 409 | Duplicate key (e.g. email registered) |
| 422 | Unprocessable (e.g. invalid AI output) |
| 429 | Rate limited |
| 500 | Internal server error |

## cURL quickstart

```bash
# register + get token
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada","email":"ada@example.com","password":"Passw0rd!"}'

TOKEN="<jwt from response>"

# create project
curl -X POST http://localhost:5000/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Demo","repoUrl":"https://github.com/acme/widgets"}'

# analyze it
curl -X POST http://localhost:5000/api/v1/projects/<projectId>/analyze \
  -H "Authorization: Bearer $TOKEN"

# chat about it
curl -X POST http://localhost:5000/api/v1/projects/<projectId>/chat \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"How does authentication work?"}'
```
