# CodeCity AI — 3D World & API-Flow Improvement Guide

Written from the POV of **a developer using the app and a user seeing it for the first time**,
based on real feedback from the live city view:

> *"Cars move like a car with very fast speed. The road was not clear. Some buildings overlap,
> some boxes (labels) overlap, and sometimes it is not looking like a world — it looks like
> boxes of a website."*

Every issue below names the **exact file + line**, the **root cause**, a **quick fix** (minutes)
and a **proper fix** (hours), plus acceptance criteria so you can verify the fix.

---

## Priority board

| # | Issue | User pain | Priority | Effort |
|---|---|---|---|---|
| 1 | Cars drive absurdly fast | Scene feels arcade-y, can't follow requests | 🔴 P0 | XS |
| 2 | Buildings spill past district ring roads / overlap | Looks broken, not planned | 🔴 P0 | S |
| 3 | Roads are unreadable (low contrast, no markings on ring roads) | Can't tell where cars may drive | 🟠 P1 | S |
| 4 | Floating labels + HUD toasts overlap each other | Screen noise, unreadable | 🟠 P1 | M |
| 5 | Scene reads as "boxes on a plane", not a world | No immersion, no depth cues | 🟠 P1 | M–L |
| 6 | API-flow missions hard to follow end-to-end | Core teaching moment gets lost | 🟡 P2 | M |

---

## 1. 🔴 Traffic moves way too fast

**Where:** `frontend/src/three/Traffic.tsx:11`

```ts
const SPEED = { fast: 0.1, medium: 0.045, slow: 0.018 };
```

**Root cause:** these are **curve-parameter speeds (u per second)**, not world speeds.
`u = 0.1` means "the whole lane in 10 seconds". The `login` lane is ~300 world units long
(`layout.ts:246-272`), so `fast` latency ≈ **30 units/sec** — a car the size of a building
per second. Worse, `Car` (`Traffic.tsx:91`) applies `SPEED[cur]` to **every ambient car**
based on the global latency selector, so one HUD toggle turns the whole city into a racetrack.

### Quick fix (5 min)

```ts
// world-units per second instead of u/sec — consistent at any lane length
const SPEED = { fast: 9, medium: 5.5, slow: 3 }; // was { 0.1, 0.045, 0.018 }
// in Car's useFrame (Traffic.tsx:91):
const laneLen = curve.getLength();
t.current = (t.current + (dt * SPEED[cur]) / laneLen) % 1;
```

Also add a master slider instead of a 3-way jump:

```ts
// store/useCity.ts — one knob, clamped
speedMultiplier: number; // 0.25× – 1.5×, default 1
```

### Proper fix

- **Per-road speed limits**: cars slow to `SPEED.slow` inside district rings (city streets),
  cruise at `SPEED.fast` only on the two avenues/highways. Sample the tangent position:
  inside `|x| ∈ [district.cx - 11, district.cx + 11]` → city limit.
- **Decouple latency from speed**: the latency selector should change the *beacon color +
  mission card timing*, not teleport ambient cars. Ambient traffic keeps `medium`.
- **Car spacing**: with normalized speeds all cars bunch up at corners; stagger offsets by
  lane length (`offset * laneLen / 40`) so gaps look natural.

**Accept:** at default settings a car takes **≥ 45 s** to cross the full login lane; switching
latency to `fast` does not exceed ~1.5× the medium visual speed.

---

## 2. 🔴 Buildings overlap & spill past the district ring road

**Where:** `frontend/src/lib/layout.ts:135-143` and the fixed ring at `layout.ts:156-164`.

```ts
x = ((bi % 3) - 1) * 6.5;              // 3 columns
z = (Math.floor(bi / 3) - 0.5) * 7;    // rows: -3.5, +3.5, +10.5, …
```

**Root cause:** the ring road is a **fixed rectangle** `R=11, D=9` (`layout.ts:158`), but rows
keep stacking every 7 units. The **7th building in any district lands at z = +10.5 — outside
the ring road**, visually colliding with the street and the sidewalk where pedestrians walk.
There is also **no collision check** anywhere: two tall buildings (`h` up to 11, `layout.ts:144`)
can z-fight when a district's grid drifts near a neighbor, and the district pitch is hardcoded
(26 × 24, `layout.ts:128-132`) no matter how many buildings the repo produced.

### Quick fix (30 min) — fit the ring to the content

```ts
// layout.ts — inside d.buildings.forEach, first compute rows
const rows = Math.ceil(d.buildings.length / 3);
const D = Math.max(9, rows * 7 / 2 + 3);   // ring grows with content
const R = Math.max(11, 13);
// then use this D when pushing the 4 ring road segments (layout.ts:159-163)
```

### Proper fix — real packing with collision

1. **Bin-packing per district**: sort buildings by footprint, place greedily, and grow the
   district rect; only then draw the ring road around the final rect (roads follow content,
   not the other way around).
2. **Global overlap pass**: after layout, run an O(n²) XZ AABB test (n ≤ ~150 buildings, cheap)
   and nudge overlaps apart along the smaller penetration axis. Log warnings — overlaps usually
   mean the upstream `city.builder` produced bad districts.
3. **Height budget**: cap `h` relative to district footprint (`h ≤ 1.2 × min(R, D)`) so one
   1,500-LOC monster file doesn't tower over its whole district and visually "eat" neighbors.
4. **Defensive backend guard**: in `Backend/src/modules/ai/city.builder.ts`, reject/merge
   districts whose building count exceeds the layout's capacity (currently ~9 per district
   at 3×3) instead of letting the frontend silently overflow.

**Accept:** zero building AABB intersections at runtime; every building strictly inside its
district's ring road; `console` reports `0 overlaps` after the layout pass.

---

## 3. 🟠 Roads are unreadable

**Where:** `frontend/src/lib/layout.ts` (geometry), `frontend/src/three/Infrastructure.tsx` (rendering).

**Root cause (user POV):** asphalt, ground, and district slabs are all near-black in night mode;
dashed center lines exist **only on highways** (`layout.ts:210-224`), so ring roads where cars
actually drive are unmarked gray-on-gray. There are no curbs, no sidewalks (pedestrians walk a
floating line), no crosswalks at the district gates.

### Fixes (all small, huge visual payoff)

| Fix | How |
|---|---|
| Contrast pass | Asphalt `#1a1d24`, ground `#0c0f14`, sidewalk strip `#232833` — roads become readable without bloom |
| Markings everywhere | Reuse the dash loop (`layout.ts:210`) for ring roads too, thinner (`w: 1.5`), lower opacity |
| Curbs | Extrude a 0.15-unit lip around each ring road rect — instant "real street" read |
| Crosswalks at gates | 5 white stripes across each gate stub (`layout.ts:196-206` already lists them) |
| Gate signs | Small signpost at every gate stub naming the district it enters — doubles as wayfinding |

**Accept:** screenshot the city at night — you can trace every road a car can take without
looking at the cars.

---

## 4. 🟠 Labels & HUD boxes overlap

**Where:**
- District labels: `frontend/src/three/Buildings.tsx:86` (fixed `y=12`, `distanceFactor={90}`)
- Building tooltips: `Buildings.tsx:148,155` (`distanceFactor={55}`)
- Toast stack: `frontend/src/ui/HUD.tsx:259` rendered into the right rail `HUD.tsx:686`

**Root cause:** every `<Html>` label renders at full opacity at every camera distance, and drei's
`zIndexRange` only controls DOM stacking — nothing hides labels that visually collide. In the
screenshot, six district labels, three incident toasts, and the atmosphere panel all fight for
the same screen area.

### Fixes

**3D labels (drei):**

```tsx
// 1) distance-based LOD — far away, only district names survive
const { camera } = useThree();
const show = useFrame(() => camera.position.length() < 90); // building labels only when close

// 2) occlude so labels hide behind buildings instead of drawing through them
<Html occlude="blending" ... />

// 3) declutter: one shared hook tracks occupied screen rects per frame (throttled to ~5 Hz),
//    later labels flip to a small dot; click the dot to promote it
```

**HUD toasts:**

- Cap the stack at **3** (`events.slice(0, 3)`), collapse older ones into a `+N incidents` chip
  (the screenshot already hints at an incidents tray — make it the only place history lives).
- Give the atmosphere panel a fixed top margin (`mt-4`) so the header text
  (`HUD.tsx:182` "RAIN — BROKEN PIPELINES") can never slide under the toast stack.

**Accept:** at default zoom ≤ 8 labels visible on screen; zero overlapping text rects;
toasts never exceed 3.

---

## 5. 🟠 "It looks like boxes, not a world"

**Root cause (user POV):** uniform window-textured boxes on an infinite dark plane. No horizon,
no terrain, no skyline depth cues, no variety in silhouettes. Real cities read as cities because
of **variation + atmosphere + edges**, not detail.

### Cohesion checklist (ordered by payoff ÷ effort)

1. **Sky & fog (XS)** — gradient skydome + `scene.fog = new THREE.Fog(bg, 120, 420)`. Distant
   districts melt into haze instead of floating on black. Single biggest "world" upgrade.
2. **Ground variety (S)** — the plane isn't empty: add parking lots, plazas, and dark grass
   patches between districts (reuse the tree scatter at `layout.ts:168` with bigger patches).
3. **Building silhouette variety (S)** — three box archetypes, chosen by hash of `b.id`:
   - setback tower (2 stacked boxes, 70% / 40% footprint)
   - slab + rooftop props (AC boxes, water tank, antenna — 4–8 tiny boxes)
   - L-shaped pair
   Same materials, so cost stays flat — silhouettes stop repeating.
4. **District identity (S)** — each stack gets a ground tint + streetlight color:
   frontend = cool cyan windows, backend = warm amber, database = green status LEDs,
   external = violet. You can then *name the stack from across the river*.
5. **Edges of the world (M)** — currently the plane just ends. Fade the outer 40 units into fog
   and add a faint grid that dissolves — reads as "the map continues" without geometry.
6. **Water & bridge already good** — keep. The river is the strongest landmark; make the two
   avenues lead the eye to it (align lamp colors toward the bridge).

**Accept:** show the scene to someone for 5 seconds and ask "what is this?" — the answer should
be "a city at night", not "a 3D chart".

---

## 6. 🟡 Make the API workflow easier to follow

The RUN LOGIN / PAYMENT / CART missions are the product's core story, but three things
work against them:

| Problem | Fix |
|---|---|
| Mission cards pop at `distanceFactor={52}` (`Traffic.tsx:329`) and can sit under the right-rail toasts | Reserve a **bottom-center "mission strip"** in the HUD; render hop cards there, anchored to nothing in 3D. The car keeps a small beacon instead. |
| Ambient cars race past the courier at 3× speed, ruining the "stately roll" (`MISSION_CRUISE`, `Traffic.tsx:231`) | While a mission is active, clamp ambient speed to `SPEED.slow * 0.5` — the courier becomes the fastest thing on screen, eyes track it automatically. |
| Hop progress is only the tiny card progress bar | Add a thin **route progress line** along the lane (shader or dashed line updated per frame from `u`) — at a glance you see "we are 60% through login". |

Also expose the already-built fast-forward (`?fm=1`, `Traffic.tsx:234`) as a small "2×" button
on the mission strip instead of a hidden URL param.

---

## Tuning constants cheat-sheet

| Constant | File | Current | Suggested |
|---|---|---|---|
| `SPEED` | `three/Traffic.tsx:11` | `{0.1, 0.045, 0.018}` u/s | `{9, 5.5, 3}` world-u/s ÷ lane length |
| `MISSION_CRUISE` / `MISSION_DWELL` | `three/Traffic.tsx:231-232` | `0.03` / `3.4s` | keep (good), clamp ambient while mission runs |
| Ring road `R` / `D` | `lib/layout.ts:157-158` | fixed `11` / `9` | derived from district rows/cols |
| Building grid pitch | `lib/layout.ts:141-142` | `6.5 × 7` | keep, but add collision pass |
| District pitch | `lib/layout.ts:128-132` | fixed `26 × 24` | derived from ring sizes + 6-unit street |
| Building height | `lib/layout.ts:144` | `2 + min(9, loc/25)` | cap at `1.2 × district min-dimension` |
| Label `distanceFactor` | `Buildings.tsx:86,148,155` | `90 / 55 / 55` | + LOD distance gating & `occlude` |
| Toast stack | `ui/HUD.tsx:259` | unbounded | max 3 + `+N` chip |

---

## Suggested rollout order

1. **Day 1 (P0s):** speed normalization (#1) → ring-road fit + overlap pass (#2). These two
   remove the "broken toy" feeling.
2. **Day 2 (P1 polish):** road contrast + markings (#3) → label LOD + toast cap (#4).
3. **Day 3 (P1 world):** fog/skydome → silhouette variety → district tints (#5).
4. **Later (P2):** mission strip + route progress (#6), speed slider in HUD.

Each step is independently shippable and instantly visible in a screenshot — which is the
honest test this project's UI should be held to.
