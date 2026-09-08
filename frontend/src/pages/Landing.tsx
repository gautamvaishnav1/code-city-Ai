import { Suspense, lazy, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Reveal, FolioBar, Teletype, MiniCity, TickerBand } from "./landing/ui";
import { useInView, useCountUp, useOnScreen } from "./landing/hooks";

/* ═══ INTERNATIONALES ARCHIV — Swiss press system ══════════════════
   1958 Müller-Brockmann poster logic on a modern web grid.
   Remix-ready: swap the strings in BRAND, keep the system.          */

const BRAND = {
  mark: "CODECITY AI",
  headerLeft: "CODECITY AI — INTERNATIONALES ARCHIV N° 04",
  kicker: "A CITY MAP FOR ONBOARDING · NAVIGATION · CODE",
};

const INDEX = [
  { n: "01", t: "SYSTEM", meta: "12 COLUMNS", id: "raster" },
  { n: "02", t: "ATLAS", meta: "FULL-STACK MERN PLATE", id: "atlas" },
  { n: "03", t: "LIVE DATA", meta: "DEPARTURES BOARD", id: "zeit" },
];

const SPECS: Array<[string, string]> = [
  ["PRODUCT", "CODECITY AI"],
  ["FORMAT", "CITY PLAN FROM SOURCE CODE"],
  ["PROBLEM", "MONTHS-LONG ONBOARDING · BLIND REFACTORS"],
  ["SOLUTION", "ONE MAP, DAY ONE"],
  ["USERS", "INTERNS · DEVS · SENIORS"],
];

/* ── helpers ─────────────────────────────────────────────────────── */

function goTo(e: MouseEvent<HTMLAnchorElement>, id: string) {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function RuleHeavy() {
  return <hr aria-hidden className="rule-heavy" />;
}

/* ── hero — asymmetric 8 / 4 split ───────────────────────────────── */

function Hero({ onLaunch, onLaunchIntent }: { onLaunch: () => void; onLaunchIntent?: () => void }) {
  return (
    <section id="top" className="sheet relative scroll-mt-8">
      <div className="relative grid grid-cols-12 gap-x-6 gap-y-12 pb-16 pt-10 md:pt-14">
        <GridSystem />
        <div className="col-span-12 lg:col-span-8">
          <Reveal>
            <div className="mb-8 flex items-baseline justify-between gap-6 border-b border-black-ink/25 pb-4">
              <p className="caption-caps font-bold">{BRAND.kicker}</p>
              <p className="caption-caps hidden text-black-ink/55 sm:block">ZÜRICH — PRESS PROOF</p>
            </div>
          </Reveal>
          {/* headline builds like a printed pass — three ink passes */}
          <h1 aria-label="Code becomes city" className="display-caps select-none text-[clamp(64px,11vw,150px)]">
            {(["CODE", "BECOMES"] as const).map((word, i) => (
              <span key={word} className="headline-pass block" style={{ ["--d" as string]: i }}>
                {word}
              </span>
            ))}
            <span className="block headline-pass pass-signal" style={{ ["--d" as string]: 2 }}>
              <span className="misreg inline-block bg-signal px-[0.09em] text-paper">CITY</span>
            </span>
          </h1>
          <Reveal delay={650}>
            <p className="mt-8 max-w-[54ch] text-[15px] leading-6 text-black-ink/80">
              CodeCity AI draws a city plan from your source code: every file a building,
              every dependency a street, every hotspot a red tower. It removes the two
              costs of invisible architecture — months-long onboarding and blind refactoring.
              New developers walk the city on day one; seniors read complexity as height
              and dead code as empty lots. One objective plan, printed flat in three inks,
              understood by the whole team at a glance.
            </p>
          </Reveal>
          <Reveal delay={800}>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <button type="button" onClick={onLaunch} onMouseEnter={onLaunchIntent} onFocus={onLaunchIntent} className="btn-print solid">
                Launch the app ▸
              </button>
              <a href="#terminals" onClick={(e) => goTo(e, "terminals")} className="btn-print ghost">
                See how it works ↓
              </a>
            </div>
          </Reveal>
        </div>

        <div className="col-span-12 flex flex-col justify-end gap-10 lg:col-span-4">
          <Reveal delay={250}>
            <Teletype />
          </Reveal>
          <Reveal delay={400}>
            <MiniCity />
          </Reveal>
        </div>
      </div>

      {/* index — hover inverts to a black block */}
      <nav aria-label="Contents" className="relative pb-20">
        <div className="max-w-xl border-b border-black-ink/25 lg:max-w-2xl">
          {INDEX.map((row, i) => (
            <Reveal key={row.n} delay={i * 90}>
              <a
                href={`#${row.id}`}
                onClick={(e) => goTo(e, row.id)}
                className="idx-row group flex items-baseline gap-6 border-t border-black-ink/25 px-3 py-4 md:py-5"
              >
                <span className="text-xs font-bold tabular-nums transition-colors duration-100 group-hover:text-signal md:text-sm">{row.n}</span>
                <span className="display-caps flex-1 text-3xl transition-colors duration-100 group-hover:text-paper md:text-5xl">{row.t}</span>
                <span className="caption-caps hidden text-black-ink/55 transition-colors duration-100 group-hover:text-paper/65 sm:block">{row.meta}</span>
                <span aria-hidden className="text-xl font-black transition-transform duration-150 md:text-2xl group-hover:translate-x-1.5">
                  →
                </span>
              </a>
            </Reveal>
          ))}
        </div>
      </nav>
    </section>
  );
}

/* ── visible grid system (hero only) ─────────────────────────────── */

function GridSystem() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="grid-cols-rules absolute inset-0" />
      <div className="baseline-rules absolute inset-0" />
    </div>
  );
}

/* ── section header ──────────────────────────────────────────────── */

function SecHead({ n, t, meta }: { n: string; t: string; meta?: string }) {
  return (
    <Reveal>
      <header className="mb-12 flex items-end justify-between gap-8">
        <h2 className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <span className="text-xs font-black tracking-[0.2em] text-signal">{n}</span>
          <span className="display-caps text-[clamp(40px,6vw,84px)]">{t}</span>
        </h2>
        {meta && <p className="caption-caps hidden pb-2 text-right text-black-ink/50 md:block">{meta}</p>}
      </header>
    </Reveal>
  );
}

/* ── 01 SYSTEM — spec table + column lattice ─────────────────────── */

const LATTICE = [64, 118, 96, 152, 80, 200, 140, 74, 176, 110, 58, 132];

function RasterSection() {
  const [ref, seen] = useInView<HTMLDivElement>(0.35);
  return (
    <section id="raster" className="sheet scroll-mt-8 py-20 md:py-28">
      <SecHead n="01" t="SYSTEM" meta="THE GRID BEFORE THE CONTENT" />
      <div className="grid grid-cols-12 gap-x-6 gap-y-12">
        <div className="col-span-12 lg:col-span-7">
          <Reveal>
            <p className="display-caps text-[clamp(36px,5vw,72px)]">
              A thousand files.
              <br /> One city.
              <br /> No
              <br />
              <span className="text-signal">exceptions.</span>
            </p>
          </Reveal>
          <Reveal delay={150}>
            <p className="mt-10 max-w-[54ch] text-[15px] leading-6 text-black-ink/80">
              Every surface sits on the fixed carrier grid: files become buildings,
              dependencies become streets, complexity becomes height. The intern reads
              the city on the first day; the senior checks the street before writing.
              The map is the construction on which content first becomes legible.
            </p>
          </Reveal>
          <Reveal delay={250}>
            <p className="caption-caps mt-6 text-black-ink/55">
              A TWELVE-COLUMN LATTICE PRECEDES CONTENT. COLUMNS ARE STRUCTURE, NOT ORNAMENT.
            </p>
          </Reveal>
        </div>

        <div className="col-span-12 lg:col-span-4 lg:col-start-9">
          <Reveal delay={120}>
            <dl className="border-b border-black-ink/25">
              {SPECS.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-6 border-t border-black-ink/25 py-3.5">
                  <dt className="caption-caps text-black-ink/55">{k}</dt>
                  <dd className="text-sm font-bold tracking-[0.08em] tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </Reveal>

          {/* column diagram — bars rise to their LOC height when seen */}
          <div ref={ref} aria-hidden className="mt-10 flex h-24 items-end gap-[6px]">
            {LATTICE.map((h, i) => (
              <span
                key={i}
                className={`lattice-bar ${i === 5 ? "bg-signal" : "bg-black-ink"} ${seen ? "up" : ""}`}
                style={{ height: `${(h / 200) * 100}%`, transitionDelay: `${i * 45}ms` }}
              />
            ))}
          </div>
          <p className="caption-caps mt-3 text-black-ink/45">FIG. 03 — COLUMN AXES AS FILE SIZES</p>
        </div>
      </div>
    </section>
  );
}

/* ── 02 ATLAS — world map: printed MERN maquette + flat plate ────── */

const MernWorld3D = lazy(() => import("./landing/MernWorld"));

function AtlasSection() {
  const [ref, seen] = useInView<HTMLDivElement>(0.25);
  const [gone, onScreen] = useOnScreen<HTMLDivElement>(0.05);
  const [tab, setTab] = useState(0);
  const manualLock = useRef(0);
  const caps = [
    "<App/> renders the plan — state, router, components.",
    "route → guard → controller. Requests checked at the gate.",
    "Event loop executes — non-blocking I/O, libuv pool.",
    "Documents persist — collections, indexes, pipelines.",
  ];
  /* the 3D scene narrates as the request travels; clicking a layer pins it
     for 15 s (manual lock) so narration doesn't instantly override you     */
  useEffect(() => {
    const onLayer = (e: Event) => {
      if (Date.now() < manualLock.current) return;
      setTab((e as CustomEvent<number>).detail);
    };
    window.addEventListener("mern-layer", onLayer);
    return () => window.removeEventListener("mern-layer", onLayer);
  }, []);
  const pick = (i: number) => {
    setTab(i);
  };
  return (
    <section id="atlas" className="sheet scroll-mt-8 py-20 md:py-28">
      <SecHead n="02" t="ATLAS" meta="ONE REQUEST, END TO END" />
      <div className="grid grid-cols-12 gap-x-6 gap-y-12">
        <div ref={ref} className="col-span-12 lg:col-span-8">
          {/* ── the world map — real 3D maquette, mounts on first view ── */}
          <Reveal>
            <figure ref={gone}>
              <div className="border-[1.5px] border-black-ink p-1.5">
                <div className="relative bg-paper-deep">
                  {/* legend — printed key for the map's two inks */}
                  <div className="caption-caps pointer-events-none absolute top-3 right-3 z-10 space-y-1 border border-black-ink/40 bg-paper/85 px-2 py-1.5 text-[9px] leading-none backdrop-blur-sm">
                    <p className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: "#e30613" }} /> REQUEST</p>
                    <p className="flex items-center gap-1.5 opacity-60"><span className="inline-block h-px w-4" style={{ background: "#141414" }} /> RESPONSE</p>
                    <p className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#c99700" }} /> ACK</p>
                    <p className="pt-0.5 opacity-45">DRAG TO ORBIT</p>
                  </div>
                  <div className="h-[380px] w-full md:h-[440px]">
                    {seen ? (
                      <Suspense fallback={
                        <div className="caption-caps grid h-full place-items-center text-black-ink/45">CASTING THE MAQUETTE…</div>
                      }>
                        <MernWorld3D active={onScreen} />
                      </Suspense>
                    ) : (
                      <div className="caption-caps grid h-full place-items-center text-black-ink/30">FIG. 05 — SCROLL TO CAST</div>
                    )}
                  </div>
                  {/* layer strip — follows the request live; click to pin a layer */}
                  <div className="flex border-t-[1.5px] border-black-ink" aria-live="polite">
                    {["CLIENT · REACT", "API · EXPRESS", "RUNTIME · NODE", "DATA · MONGODB"].map((t, i) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          pick(i);
                          // 15 s manual lock so narration doesn't override the user
                          manualLock.current = Date.now() + 15000;
                        }}
                        aria-pressed={tab === i}
                        style={{ position: "relative", zIndex: 5 }}
                        className={`caption-caps flex-1 border-r border-black-ink/25 px-1 py-2 text-center last:border-r-0 transition-colors ${tab === i ? "bg-black-ink text-paper font-bold" : "text-black-ink/55 hover:bg-black-ink/10"}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <figcaption className="caption-caps mt-3 flex flex-wrap items-baseline justify-between gap-2 text-black-ink/45">
                  <span>FIG. 05 — THE WORLD MAP · ONE REQUEST, END TO END</span>
                  <span className="text-signal">{caps[tab]}</span>
                </figcaption>
              </figure>
            </Reveal>
          <Reveal delay={150}>
            <p className="mt-8 max-w-[54ch] text-[15px] leading-6 text-black-ink/80">
              The whole stack on one plate: React renders, Express routes, Node executes,
              MongoDB persists. Follow a single request as it descends through every island
              and climbs home — hover a district to inspect it, watch the strip below follow.
            </p>
          </Reveal>
        </div>

        <aside className="col-span-12 flex flex-col gap-8 lg:col-span-3 lg:col-start-10 lg:border-l lg:border-black-ink/25 lg:pl-6">
          {[
            ["LAYERS", "4"],
            ["HOPS PER REQUEST", "8"],
            ["ROUND TRIP", "3.2 S"],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="caption-caps font-bold">{k}</p>
              <p className="mt-2 text-3xl font-black tabular-nums tracking-tight">{v}</p>
            </div>
          ))}
          <p className="caption-caps mt-auto text-black-ink/45">FIG. 06 — THE STACK, PRINTED FLAT</p>
        </aside>
      </div>
    </section>
  );
}

/* ── trust strip — big numbers build credibility (dev-tool pattern) ─ */

const TRUST: Array<[string, string, string]> = [
  ["1.2K", "FILES PER CITY", "average repo mapped"],
  ["8.2s", "CITY BUILD TIME", "clone to walkable plan"],
  ["4 DAYS", "AVG ONBOARDING", "down from months"],
  ["100%", "OPEN SPEC", "plain JSON city format"],
];

function TrustStrip() {
  return (
    <section aria-label="Key numbers" className="sheet">
      <dl className="grid grid-cols-2 gap-px border border-black-ink/25 bg-black-ink/25 md:grid-cols-4">
        {TRUST.map(([v, t, sub], i) => (
          <Reveal key={t} delay={i * 80} className="bg-paper">
            <div className="flex h-full flex-col gap-1 px-5 py-6">
              <dd className="display-caps text-4xl md:text-5xl">{v}</dd>
              <dt className="caption-caps font-bold">{t}</dt>
              <p className="caption-caps text-black-ink/45">{sub}</p>
            </div>
          </Reveal>
        ))}
      </dl>
    </section>
  );
}

/* ── quote band — inversion moment ───────────────────────────────── */

function QuoteBand() {
  return (
    <aside className="bg-black-ink text-paper">
      <div className="sheet py-20 md:py-24">
        <blockquote>
          <Reveal>
            <p className="display-caps max-w-4xl text-[clamp(24px,4vw,40px)] leading-snug">
              ONBOARDING IN DAYS, NOT MONTHS.
            </p>
          </Reveal>
          <footer className="caption-caps mt-6 text-paper/60">CODECITY AI — THESIS 01</footer>
        </blockquote>
      </div>
    </aside>
  );
}

/* ── 04 LIVE DATA — departures board for a codebase ──────────────── */

interface DepRow {
  line: string;
  dep: string;
  plat: string;
  to: string;
  status: string;
  late: boolean;
}

const FLOWS: Array<[string, string[], number]> = [
  ["POST /login", ["Login.jsx", "authRoutes", "authController", "users DB"], 80],
  ["POST /pay", ["Payment.jsx", "payRoutes", "payController", "Stripe API"], 240],
  ["GET /cart", ["Cart.jsx", "cartRoutes", "cartController", "carts DB"], 300],
];

function makeDepartures(): DepRow[] {
  const now = new Date();
  const rows: DepRow[] = [];
  for (let i = 0; i < 6; i++) {
    const [verb, path] = FLOWS[i % FLOWS.length];
    const d = new Date(now.getTime() + (i * 7 + 4) * 60000);
    const late = i === 2; // one delayed row keeps the board honest
    const dep = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    rows.push({
      line: verb,
      dep,
      plat: String(((i * 3) % 9) + 1),
      to: path[path.length - 1],
      status: late ? "+2 MIN" : "ON TIME",
      late,
    });
  }
  return rows;
}

function ZeitSection() {
  const [rows, setRows] = useState<DepRow[]>(() => makeDepartures());
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  // re-stamp the board every minute so times stay live
  useEffect(() => {
    const id = window.setInterval(() => setRows(makeDepartures()), 60000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section id="zeit" className="sheet scroll-mt-8 py-20 md:py-28">
      <SecHead n="03" t="LIVE DATA" meta="TIMETABLE VALID WHILE YOUR APP RUNS" />
      <div className="grid grid-cols-12 gap-x-6 gap-y-12">
        <div ref={ref} className="col-span-12 overflow-x-auto lg:col-span-9">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="caption-caps text-black-ink/55">
                <th scope="col" className="border-b-2 border-black-ink pb-3 pr-4 font-bold">REQUEST</th>
                <th scope="col" className="border-b-2 border-black-ink pb-3 pr-4 font-bold">DEP</th>
                <th scope="col" className="border-b-2 border-black-ink pb-3 pr-4 font-bold">GATE</th>
                <th scope="col" className="border-b-2 border-black-ink pb-3 pr-4 font-bold">DESTINATION</th>
                <th scope="col" className="border-b-2 border-black-ink pb-3 text-right font-bold">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.line}-${i}`}
                  className={`dep-row text-sm ${seen ? "in" : ""}`}
                  style={{ transitionDelay: `${i * 70}ms` }}
                >
                  <td className="border-b border-black-ink/25 py-3.5 pr-4 font-bold tabular-nums">{r.line}</td>
                  <td className="border-b border-black-ink/25 py-3.5 pr-4 tabular-nums">{r.dep}</td>
                  <td className="border-b border-black-ink/25 py-3.5 pr-4 tabular-nums">{r.plat}</td>
                  <td className="border-b border-black-ink/25 py-3.5 pr-4 uppercase">{r.to}</td>
                  <td className={`border-b border-black-ink/25 py-3.5 text-right text-xs font-bold uppercase tracking-[0.18em] tabular-nums ${r.late ? "text-signal dep-late" : ""}`}>
                    {r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="col-span-12 flex flex-col gap-8 lg:col-span-3 lg:border-l lg:border-black-ink/25 lg:pl-6">
          <Stat n="FILES MAPPED" v={1284} suffix="" />
          <Stat n="STREETS (EDGES)" v={2140} suffix="" />
          <Stat n="AVG ONBOARDING" v={4} suffix=" DAYS" />
          <p className="caption-caps mt-auto text-black-ink/45">FIG. 04 — DEPARTURES, LIVE EXTRACT</p>
        </aside>
      </div>
    </section>
  );
}

function Stat({ n, v, suffix }: { n: string; v: number; suffix?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.5);
  const val = useCountUp(v, seen);
  return (
    <div ref={ref}>
      <p className="caption-caps font-bold">{n}</p>
      <p className="mt-2 text-3xl font-black tabular-nums tracking-tight">
        {val.toLocaleString()}
        {suffix}
      </p>
    </div>
  );
}

/* ── FAQ — accordion, near the end (dev-tool standard) ───────────── */

const FAQS: Array<[string, string]> = [
  ["DOES CODECITY STORE MY CODE?", "No. The analyzer reads your repository, derives the city plan as JSON, and keeps only that plan. Your source never leaves your infrastructure."],
  ["WHICH STACKS ARE SUPPORTED?", "Anything with a file tree and imports. The current plate is tuned for MERN — React frontends, Express APIs, Node services, MongoDB schemas."],
  ["CAN I USE IT WITHOUT AN ACCOUNT?", "Yes — look all you want. An account is only asked for when you launch the live app and save plans."],
  ["HOW BIG CAN A REPO BE?", "Cities of a few thousand buildings stay interactive. Beyond that, districts collapse into blocks you can expand on demand."],
  ["IS THE CITY FORMAT OPEN?", "Yes. The plan is plain JSON — documented, versioned, and yours to export or pipe into other tools."],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="sheet scroll-mt-8 py-20 md:py-28">
      <SecHead n="04" t="FAQ" meta="PRACTICAL QUESTIONS, PLAIN ANSWERS" />
      <div className="grid grid-cols-12 gap-x-6 gap-y-12">
        <div className="col-span-12 lg:col-span-9">
          {FAQS.map(([q, a], i) => {
            const isOpen = open === i;
            return (
              <Reveal key={q} delay={i * 60}>
                <div className={`border-t border-black-ink/25 ${i === FAQS.length - 1 ? "border-b" : ""}`}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-baseline justify-between gap-6 py-5 text-left"
                  >
                    <span className="display-caps text-xl md:text-2xl">{q}</span>
                    <span aria-hidden className={`text-2xl font-black text-signal transition-transform duration-150 ${isOpen ? "rotate-45" : ""}`}>
                      +
                    </span>
                  </button>
                  <div className={`grid transition-[grid-template-rows] duration-200 ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="overflow-hidden">
                      <p className="max-w-[62ch] pb-6 text-[15px] leading-6 text-black-ink/80">{a}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
        <aside className="col-span-12 flex flex-col gap-8 lg:col-span-3 lg:border-l lg:border-black-ink/25 lg:pl-6">
          <p className="caption-caps leading-relaxed text-black-ink/55">
            STILL PRINTING PROOFS?
            <br />
            THE INDEX ON TOP NAVIGATES; THE PANEL BELOW LAUNCHES.
          </p>
          <p className="caption-caps mt-auto text-black-ink/45">FIG. 07 — QUESTIONS SET IN INK</p>
        </aside>
      </div>
    </section>
  );
}

/* ── launch panel — form follows function ────────────────────────── */

function LaunchPanel({ onLaunch, onLaunchIntent }: { onLaunch: () => void; onLaunchIntent?: () => void }) {
  const [repo, setRepo] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    localStorage.setItem("cc-pending-repo", repo.trim());
    onLaunch();
  };

  return (
    <section id="terminals" className="sheet scroll-mt-8 py-20 md:py-28">
      <div className="grid grid-cols-12 gap-x-6 gap-y-12">
        <div className="col-span-12 lg:col-span-7">
          <p className="caption-caps mb-6 font-bold text-signal">APPLICATION — LIVE DEMO</p>
          <Reveal>
            <h2 className="display-caps text-[clamp(44px,7vw,96px)]">
              Ready
              <br />
              to print.
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-8 max-w-[52ch] text-[15px] leading-6 text-black-ink/80">
              A repository URL is all it takes: the city plan is built from your repo —
              files as houses, dependencies as streets, bottlenecks as construction sites.
              No account needed to look; launching asks for access.
            </p>
          </Reveal>

          <form onSubmit={submit} className="mt-12 max-w-md">
            <label htmlFor="repo-input" className="caption-caps block pb-3 font-bold">
              REPOSITORY INPUT
            </label>
            <input
              id="repo-input"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="github.com/owner/repo"
              spellCheck={false}
              autoComplete="off"
              className="field-print w-full"
            />
            <button type="submit" className="btn-print solid mt-8 w-full justify-center sm:w-auto">
              Build the city ▸
            </button>
          </form>

          <div className="mt-6 flex max-w-md items-center gap-3">
            <span aria-hidden className="h-px flex-1 bg-black-ink/25" />
            <span className="caption-caps text-[10px] font-bold text-black-ink/55">no repo handy?</span>
            <span aria-hidden className="h-px flex-1 bg-black-ink/25" />
          </div>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem("cc-pending-repo", "demo://beach-resort");
              onLaunch();
            }}
            className="btn-print ghost mt-4 w-full justify-center sm:w-auto"
            title="Analyze the bundled Beach Resort demo — a full-stack MERN hotel booking system, no download needed"
          >
            🏖 Try the demo project — Beach Resort (MERN) ▸
          </button>
        </div>

        <div className="col-span-12 flex flex-col items-start gap-6 lg:col-span-4 lg:col-start-9 lg:border-l lg:border-black-ink/25 lg:pl-6">
          <button type="button" onClick={onLaunch} onMouseEnter={onLaunchIntent} onFocus={onLaunchIntent} className="btn-print solid w-full justify-center py-5 text-sm">
            Launch ▸ open the app
          </button>
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="btn-print ghost w-full justify-center">
            Back to top ↑
          </button>
          <p className="caption-caps leading-relaxed text-black-ink/55">
            SHEET 1 OF 1 — THE EXHIBITION ENDS HERE. THE APPLICATION BEGINS.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── colophon ────────────────────────────────────────────────────── */

function Colophon() {
  return (
    <footer className="pb-10">
      <RuleHeavy />
      <div className="sheet flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 pt-5">
        <p className="caption-caps font-bold">PRINTED IN ZÜRICH — GROTESK ONLY — CODECITY AI · CITY PLAN FROM SOURCE CODE</p>
        <p className="caption-caps text-black-ink/60">47°22′N 8°33′E — BASELINE 8 PT — GRID 12</p>
        <p className="caption-caps text-black-ink/60">© 1958–2026 {BRAND.mark}</p>
      </div>
    </footer>
  );
}

/* ── page ────────────────────────────────────────────────────────── */

export default function Landing({ onLaunch, onLaunchIntent }: { onLaunch: () => void; onLaunchIntent?: () => void }) {
  return (
    <div className="swiss-root relative min-h-screen overflow-x-clip">
      {/* paper artifacts */}
      <div className="paper-grain" aria-hidden />
      <div className="paper-fold" aria-hidden />
      {/* living blueprint backdrop — grids drift, contours breathe */}
      <div className="atlas-drift" aria-hidden>
        <i className="ad-grid" />
        <i className="ad-grid ad-grid--b" />
        <i className="ad-contour" />
        <i className="ad-sweep" />
        <i className="ad-tear ad-tear--a" />
        <i className="ad-tear ad-tear--b" />
        <i className="ad-tearflash" />
      </div>
      <div className="trim-edge trim-n" aria-hidden />
      <div className="trim-edge trim-s" aria-hidden />
      <div className="trim-edge trim-w" aria-hidden />
      <div className="trim-edge trim-e" aria-hidden />

      <FolioBar mark={BRAND.headerLeft} onLaunch={onLaunch} />

      <main>
        <Hero onLaunch={onLaunch} onLaunchIntent={onLaunchIntent} />
        <RuleHeavy />
        <TrustStrip />
        <RuleHeavy />
        <RasterSection />
        <RuleHeavy />
        <AtlasSection />
        <TickerBand phrase="EVERY FILE A BUILDING" />
        <QuoteBand />
        <RuleHeavy />
        <ZeitSection />
        <TickerBand phrase="CODE BECOMES CITY" />
        <Faq />
        <RuleHeavy />
        <LaunchPanel onLaunch={onLaunch} onLaunchIntent={onLaunchIntent} />
      </main>

      <Colophon />
    </div>
  );
}
