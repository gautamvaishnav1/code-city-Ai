# CodeCity AI — UI Mistakes Audit

A walkthrough of every UI surface **as a first-time user**, listing what's broken, where,
and how to fix it. Every finding has an exact `file:line` reference.

**Surfaces reviewed:** HUD (top bar, transport bar, rail, inspector, weather, minimap, legend,
log, improvement guide), MissionStrip, Landing page, AuthModal, CommandPalette, DraggablePanel,
App shell.

**Severity:** 🔴 Breaks flow or misleads · 🟠 Confusing/frustrating · 🟡 Polish

---

## 🔴 Critical

### 1. Mission strip covers the RUN buttons — the exact overlap it was built to prevent
`src/ui/MissionStrip.tsx:27` vs `src/ui/HUD.tsx:594`

Both are `absolute bottom-4 left-1/2 -translate-x-1/2` (and both `max-md:bottom-24` on mobile).
The strip renders later in the DOM with `z-30`, so the moment a mission starts, the card lands
**on top of RUN LOGIN / PAYMENT / CART / SHOWCASE / FAIL PAYMENT** and blocks them. You also
can't start a second mission or toggle showcase while one runs.

**Fix:** move the strip up: `bottom-24` (desktop) / `bottom-40` (mobile), or dock it
bottom-right above the notifications panel. Acceptance: RUN buttons stay clickable during a mission.

### 2. Enter key double-fires when any button has focus
`src/ui/HUD.tsx:400-416`

The global keydown handler guards only `INPUT`/`TEXTAREA`. After you click *any* HUD button
(e.g. **Traffic**), that button keeps focus. Pressing **Enter** then fires the button's click
**and** the global `case "Enter"` → `runLogin()` — two actions from one keypress (double
mission dispatch, courier remount flicker).

**Fix:** in `onKey`, also bail when `(t as HTMLElement).closest("button,[role=button],a,select")`
for the `Enter` case — or blur buttons on `pointerup`.

### 3. Fake analysis progress percentages
`src/ui/HUD.tsx:108`

```ts
notify(`▸ analyzing… ${stJson.data.progress ?? Math.min(99, i * 4)}%`);
```
`GET /analyses/:id/status` returns `{ id, status, durationMs, error }` — **no `progress`**.
Users watch a fabricated `4%, 8%, 12%…` counter that has no relation to reality (and can sit
at 99% for a minute).

**Fix:** show step names from Socket.IO (`analysis:progress` already emits `step` + `percent`),
or an honest indeterminate state: `▸ analyzing — parsing files…`. Never fabricate numbers.

### 4. No cancel for a 3-minute blocking analysis
`src/ui/HUD.tsx:47,95-111` — `MAX_POLLS = 90` × 2 s poll loop, `busy` disables **Build City
and Demo** with no way to abort. A wrong URL or slow backend locks the top bar for up to
3 minutes; navigating away doesn't stop the loop.

**Fix:** add an `AbortController` + Cancel button; disable only the input, not the Demo escape hatch.

### 5. "+N MORE — dismiss" silently deletes notifications
`src/ui/HUD.tsx:677-682`

The chip reads like "show more" but **dismisses every hidden notification at once**, no confirm.
Success and error toasts die together.

**Fix:** label it `＋N older — clear all`, or expand-on-click and let users dismiss individually.

### 6. Landing FAQ promises "no account needed" — the app demands one
`src/pages/Landing.tsx:477` vs `src/App.tsx:33-37`

FAQ: *"An account is only asked for when you launch the live app **and save plans**."*
Reality: `launch()` bounces **every** launch into the AuthModal — you can't even look at the
demo city without signing up. First-time users feel lied to at the exact moment of conversion.

**Fix:** either allow guest/demo mode (skip auth for `demo://`), or fix the FAQ:
*"An account is required to build cities — free, public repos only."*

### 7. OTP modal has no focus trap (claims `aria-modal`)
`src/components/AuthModal.tsx:298` + `:41-46`

`role="dialog" aria-modal="true"` is set, but **Tab cycles into the page behind** the modal
(landing hero links, form fields). Keyboard users get lost; screen readers announce a modal
that isn't modal.

**Fix:** trap Tab within `frame.current` (first/last element wrap-around), and restore focus
to the trigger on close.

---

## 🟠 High — confusing or broken UX

### 8. Trailing-slash GitHub URLs are rejected
`src/ui/HUD.tsx:43`

The validator regex requires a non-empty segment after the last `/`, so pasting
`github.com/owner/repo/` (trailing slash — extremely common when copying from a browser)
fails with *"⚠ Enter a repo like github.com/owner/repo"*. The backend accepts it fine
(`repo-url.util.ts` strips it).

**Fix:** strip trailing slashes before validating: `target.replace(/\/+$/, "")`.

### 9. Dismiss "✕" nested inside the alert button — invalid HTML
`src/ui/HUD.tsx:249-271`

The whole alert is a `<button>`, and the dismiss control is a `span role="button"` **inside it**
— interactive-inside-interactive is invalid HTML, breaks screen readers, and the click must
manually `stopPropagation`. Same pattern in the inspector close is fine (not nested).

**Fix:** make the alert a `div` with an inner clickable row, or move ✕ outside as a sibling
with absolute positioning.

### 10. Duplicate "Links" spans — dead responsive copy
`src/ui/HUD.tsx:554-555`

```tsx
<span className="hidden lg:inline">Links</span>
<span className="lg:hidden">Links</span>
```
Both breakpoints render the identical word — the mobile variant was clearly meant to be an
icon (`<GitBranch>`) or shorter label. Harmless but dead weight; every other button in the
group has a real compact variant.

**Fix:** `<Link2 size={12} className="lg:hidden" />` + keep the text for `lg:`.

### 11. Dead conditional: `failB ? undefined : undefined`
`src/ui/HUD.tsx:651`

Always evaluates to `undefined` — a copy-paste remnant. The intent was probably to pass the
building position as a notification target so the toast would fly you to the failure.

**Fix:** `s.notify("❌ Payment pipeline failed — 500", failB?.id, "error")` (matches the
`target` field consumed at `HUD.tsx:688`).

### 12. Red hover on *success* notifications
`src/ui/HUD.tsx:690`

Every toast — including `✓ success` ones like "🏙 Loaded … 26 buildings" — gets
`hover:bg-red-500/20`. Red-as-hover on a success message reads as "something is wrong with this."

**Fix:** neutral hover (`hover:bg-black-ink/5`), red only for `type === "error"`.

### 13. Time slider displays "23:60"
`src/ui/HUD.tsx:209`

`Math.round((s.time % 1) * 60)` rounds minutes up independently of hours: at `time = 23.999`
the clock reads **23:60** (and any `x.99x` shows `:60`).

**Fix:** compute total minutes first:
`const mins = Math.round(s.time * 60); `${String(Math.floor(mins/60)%24).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}``

### 14. Command palette keeps stale selection while typing
`src/components/ui/CommandPalette.tsx:29-56`

`idx` is **not reset when the query changes**. Arrow down to item 4, type a narrower query
with 1 result, press Enter → `filtered[4]` is `undefined` → Enter silently does nothing
(or runs the wrong row if counts overlap).

**Fix:** `onChange={e => { setQ(e.target.value); setIdx(0); }}`.

### 15. Second "← back to site" button, off-brand colors
`src/App.tsx:127-132`

A duplicate home button floats 64 px below the transport bar in **slate/cyan** — the only
pixels in the app that ignore the paper/ink design system. The HUD logo (HUD.tsx:503-511)
already goes home.

**Fix:** delete it.

### 16. Improvement Guide launcher uses magic pixel offsets
`src/ui/HUD.tsx:852` — `bottom-[240px] right-[344px]`

Position is hardcoded to today's default rail layout; drag the weather panel or grow the
alert stack and the button **overlaps them**. It's also `max-lg:hidden`, so tablet/mobile
users lose the feature entirely (nothing else links to `cc-open-guide` on small screens).

**Fix:** render it as the last child *inside* the rail flow column (it stacks, never overlaps),
which also restores mobile access.

### 17. Drag grips are invisible on touch devices
`src/ui/DraggablePanel.tsx:169`

The ⠿ grip is `opacity-0` until `group-hover/dp:opacity-100` — **touch has no hover**, so on
phones/tablets the grip never appears and panels can't be moved or re-docked. Drag/resize are
also pointer-only (no keyboard path), so the feature is inaccessible to AT users.

**Fix:** `opacity-40` baseline (full on hover), plus `aria-grabbed`/keyboard arrow-nudge via
a focused grip (`tabIndex={0}`, arrows move 16 px, dbl-Enter docks).

### 18. No "forgot password" flow
`src/components/AuthModal.tsx` (whole file)

The backend ships full forgot/reset-password endpoints (13 auth routes, documented in
`Backend/docs/API_ENDPOINTS.json`), but the modal has **no link and no reset step**. Users
with an existing account who forget their password hit a dead end and must re-register
(which fails — email exists).

**Fix:** add "Forgot password?" under the password field → email step → reset step
(reuse the OTP UI, it's already built).

### 19. Minimap: 4 px dead band + slight click offset
`src/ui/HUD.tsx:1037-1044` vs `:905`

The offscreen plate is drawn at **160×160** but blitted into a **164×164** canvas without
scaling (`drawImage(plate, 0, 0)`), leaving a 4 px paper band on the right/bottom; the click
math assumes the full 164 px maps to world 200 → coordinates drift ~2.5 % near edges (clicks
near the river land slightly off).

**Fix:** `c.width = c.height = 164;` (or `drawImage(plate, 0, 0, 164, 164)`), and derive `k`
from one constant shared by both effects.

---

## 🟡 Polish

| # | Where | Issue | Fix |
|---|---|---|---|
| 20 | `HUD.tsx:467` | Inspector explain text ends *"…and continue to **nothing**."* for leaf buildings — reads broken | `"and continues to the database / has no downstream calls"` |
| 21 | `HUD.tsx:1079` | Legend shortcut list omits **O** (showcase) and the ⌘K palette; says ⌘K nowhere on Windows (`HUD.tsx:51` says "⌘K" to all OSes) | List `O`; show `Ctrl+K` when `navigator.platform` isn't Mac |
| 22 | `HUD.tsx:709-710` | Inspector has its own scrollbar *inside* the rail's scrollbar — nested scrolling | Drop inner `max-h/overflow`, let the rail scroll once |
| 23 | `HUD.tsx:277-279` | "N OPEN INCIDENTS" counts **RECOVERED** events too — they stay until manually dismissed | Auto-dismiss `recovered` after ~8 s, or count only error+warn |
| 24 | `HUD.tsx:524-531` | Search results: no arrow-key navigation, Enter picks nothing, no `role="listbox"` | Mirror the CommandPalette pattern (it already works) |
| 25 | `Landing.tsx:535` | Repo URL saved to `localStorage` **unvalidated** — errors only after the app loads | Validate with the same regex before storing |
| 26 | `AuthModal.tsx:162` | "It expires in 10 minutes" is hardcoded — drifts if backend TTL changes | Read TTL from the signup response |
| 27 | `AuthModal.tsx:74` | Min password 6 with no strength hint — modern default is 8+ with a live hint | `8+ characters` + 3-rule checklist |
| 28 | `DraggablePanel.tsx:111` | Panels can be dragged almost fully offscreen (`48 - w`) — recoverable only via Reset layout, which mobile can't see (button hidden in top-bar overflow) | Clamp to `8 - w/4`; keep Reset visible on mobile |
| 29 | `App.tsx:46-50` | `cancelIdleCallback?.(setTimeout-id)` — if the fallback timer was used, cancel is a no-op/mismatch | Store which scheduler was used; cancel accordingly |

---

## What's already good (keep!)

- **Design system discipline** — paper/ink/one-signal-red is applied consistently (the slate
  button in finding 15 is the only outlier).
- **MissionStrip concept** — right idea (DOM-anchored cards can't collide with 3D labels);
  it just needs to not sit on the transport bar (finding 1).
- **AuthModal micro-copy** — "Print your pass", devCode click-to-fill, resend cooldown,
  OTP paste-across-boxes: genuinely nice.
- **Notifications cap (+N chip)** and the **right-rail single flow column** — both prevent
  the overlap classes of bugs that plague HUDs.
- **Keyboard-first HUD** (`/`, T, U, F, K, O) with a legend — rare and good, once finding 2
  stops Enter double-firing.

---

## Suggested fix order

1. **Findings 1–3** (strip overlap, Enter double-fire, fake progress) — one small commit each,
   immediately noticeable.
2. **4–7** (cancel button, dismiss-all label, FAQ honesty, focus trap) — trust repairs.
3. **8–14** — papercut sweep, all under an hour total.
4. **15–19 + polish table** — batch with the next UI pass.

*Companion doc: [`IMPROVEMENTS.md`](IMPROVEMENTS.md) covers the 3D world (traffic speed,
building overlap, labels, world cohesion).*

---

## ✅ Resolved / superseded — 2026-10 UX overhaul

| Finding | Status | How |
|---|---|---|
| **2** — Enter double-fire (`runLogin` on Enter) | **Fixed** | The global Enter → run-login shortcut and the synthetic `runDemoEvents` bridge were deleted (`src/ui/shortcuts.ts`); the `RUN LOGIN` button no longer exists, so one keypress can never dispatch two actions. |
| **3** — Fake analysis progress percentages | **Fixed properly** | The frontend now listens to the backend's real `analysis:progress` Socket.IO stream (`src/lib/progressSocket.ts` → `project:join` room, step + percent emitted by `analysis.pipeline.ts`). The poll loop no longer fabricates `Math.min(99, i*4)`; when the socket is unavailable the BUILD button shows an honest indeterminate `BUILDING…` with no number. Dev vite proxy forwards `/socket.io` (ws). |
| **11** — Dead `failB ? undefined : undefined` | **Fixed** | Deleted with the FAIL PAYMENT button. |
| **Related** — `BUILD… ${progress ?? 0}%` title showed a fake `0%` | **Fixed** | `src/ui/HUD.tsx` title only shows a percent when a real one exists. |

### Changes from this pass (new behavior)

- **Bottlenecks are now real and clickable.** The telemetry HEALTH card shows the
  backend's actual `stats.healthScore` (per-building complexity → `health` derived in
  `lib/city.ts`, thresholds ≥60 error / ≥40 warn — matching the backend's ≥60 bottleneck
  rule). The **BOTTLENECKS** card toggles `ui/panels/BottlenecksPanel.tsx`: critical and
  elevated sections sorted by complexity, click a row → fly camera + select. The health
  event feed only surfaces `error` severity (warns live in the panel, not as alert spam).
- **Top bar reduced to its one job.** Repo input → `BUILD CITY` with live % → profile
  chip + logout. Traffic / Pipes / Links / Follow moved into a **View** popover
  (`ViewMenu`, aria `menuitemcheckbox`, includes `Reset panel layout`). Project chip and
  demo/traffic toggle clutter removed.
- **RUN LOGIN / FAIL PAYMENT demo buttons removed** (bottom bar keeps Latency +
  SHOWCASE); matching CommandPalette entries deleted.
- **No preloaded fake city.** App boots to `EMPTY_CITY` (`store/useCity.ts`); a centered
  empty-state card explains the flow and offers the Beach Resort demo. The right rail is
  hidden until a city exists (it's full-width on mobile and would cover the card — audit
  16 note: rail content is city-dependent anyway). All scene systems verified empty-safe
  (People `i % 0` guard, CameraRig origin default, Traffic curve guards,
  Minimap/Legend/ApiWorkflows loops).
- **Post-build CTA.** After any successful build/cache-hit, the right rail shows a
  dismissible **“HOW CAN I IMPROVE YOUR SYSTEM?”** card (`guideCta` state) → opens the
  AI Improvement Guide.
- **Mobile.** Logo wordmark hidden `< sm`, top bar wraps (search full-width row),
  telemetry + right rail drop to `top-32` until `lg`, stats grid 2→3 cols, all new
  controls touch-sized with `min-h` and no hover-only affordances (audit 17 note: drag
  grips still hover-gated — open).

### Still open (unchanged)

Findings **1** (mission strip vs bottom controls — reduced but Latency/SHOWCASE still
centered), **4** (no cancel on a 3-min analysis), **5–10**, **12–19** and the polish
table remain as written above.

---

## ✅ Resolved / superseded — 2026-10 ☰ menu restructure (HUD → "3D city + ☰")

| Finding | Status | How |
|---|---|---|
| **1** — MissionStrip vs bottom controls | **Superseded** | The bottom bar (Latency / SHOWCASE / RUN buttons) was removed in the previous pass; the strip now owns `bottom-4` alone. Notifications lift to `max-md:bottom-44` so a mission never covers them on mobile. |
| **10** — Duplicate "Links" spans | **Superseded** | The control group they lived in was deleted with the rail/bottom bar; Links is a menu row now. |
| **15** — Off-brand "← back to site" button | **Fixed** | Deleted from `src/App.tsx`; the menu's 🏙 Landing row is the way home (logo + palette remain too). |
| **16** — Guide launcher magic pixel offsets | **Fixed** | The launcher no longer exists; the AI Improvement Guide opens from ☰ MENU → Actions, from the post-build CTA card, and from the inspector's "Ask the AI architect" shortcut — all store-driven, no hardcoded pixels, available on every breakpoint. |
| **17** — Drag grips invisible on touch | **Fixed** | Grip baseline is `opacity-40` (full on hover) in `src/ui/DraggablePanel.tsx`. |
| **19** — Minimap dead band / click offset | **Superseded** | **City Plan (Minimap) removed entirely** — panel usage deleted from the HUD and `src/ui/panels/Minimap.tsx` deleted. |
| **22** — Inspector nested scrollbars | **Superseded** | The rail (the outer scrollbar) is gone; the inspector is a standalone draggable panel. |
| **28** — Reset layout unreachable on mobile | **Fixed** | Reset lives in ☰ MENU → Panels → **Reset layout**, reachable at every breakpoint (and `cc-panels-reset` still resets positions). |

### Changes from this pass

- **Clean-city architecture.** After a build the screen shows only the 3D city plus a
  **☰ MENU** cluster and a **REQUEST FLOW** button (`src/ui/HUD.tsx` + `src/ui/Mainmenu.tsx`).
  The rail, bottom bar, top-bar search and ViewMenu are gone. The ☰ dropdown holds every
  feature: **Build** (inline `RepoLoader`, auto-closes on build start/finish), **Search**
  (`CitySearch`, `/` opens the menu and focuses it), **View** (traffic / pipes / links /
  follow / showcase + live latency), **Panels** (telemetry, request flow, guide, legend,
  console, atmosphere, notifications + Reset layout), **Actions** (Request flow, Ask the AI
  architect), **Account** (UserChip, 🏙 Landing). Outside-click / Esc / ✕ close it.
- **Every draggable panel now closes like a popup.** `DraggablePanel` gained a ✕ close
  (store: `useUi.hiddenPanels` / `hidePanel`, defaults in `DEFAULT_HIDDEN`) and a visible
  grip. Panels reopen from the menu. Double-toggled panels unified to the store:
  LegendPanel and LogPanel lost their internal open/close state (menu opens content directly).
- **ATMOSPHERE hidden by default** (`weather` in `DEFAULT_HIDDEN`); the WeatherPanel is a
  centered draggable popup reopenable from the menu, with the `23:60` clock bug fixed
  (total-minutes math).
- **Request flow = visualization only, styled as a menu dropdown.** The REQUEST FLOW button
  opens the **same dropdown pattern as the ☰ MENU** (`src/ui/panels/ApiWorkflows.tsx`:
  paper card, `caption-caps` header + ✕, `min-h-[36px]` menu rows, outside-click/Esc close,
  sections “Curated flows” / “Derived from repo”) instead of a floating dialog. The caption
  says “Trace only — no live call is sent”; TRACE dispatches the courier mission
  (`dispatchMission` — pure state, no HTTP) and closes the dropdown so the city view is
  clear. Auth/login, payment, cart, signup and every derived repo route are listed;
  `autoSpec` in `src/three/Traffic.tsx` synthesizes per-component hops (dispatch → each
  building → 200 OK) so any flow shows the full journey. A safety effect ends missions
  whose curve can't be built. `anyOverlayOpen()` includes the dropdown, so keyboard
  shortcuts stand down while it's open.
- **HUD split** into `RepoLoader`, `UserChip`, `CitySearch`, `MainMenu` (extracted from the
  1000-line HUD). `/` shortcut opens the menu first (`shortcuts.ts`); `anyOverlayOpen()`
  includes `menuOpen` so other shortcuts stand down while it's open.
- **Responsive.** Popup panels use viewport-clamped widths (`w-[min(94vw,…)]`), notifications
  reposition above the mission strip on mobile, the telemetry column sits at `top-32` below
  `lg`, and the command palette gained **Open menu** / **Request flow** entries.
- Verified: `npm run build` + `npm run lint` green after the restructure.

