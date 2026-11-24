/** end-to-end pipeline probe: real backend payload → CityJSON → layout.
 *  run: ..\Backend\node_modules\.bin\tsx.cmd scripts\probe-flows.ts */
import { architectureToCity, allFlows, deriveFlows } from "../src/lib/city";
import { buildLayout } from "../src/lib/layout";

const API = "http://localhost:5000/api/v1";

/** the subset of a `GET /projects` row this probe actually reads */
interface ProjectRow {
  id: string;
  name?: string;
  repoUrl?: string;
}

/** stored architecture payload, or null when the project has no analysis yet */
type ArchPayload = Parameters<typeof architectureToCity>[0];

async function getArchitecture(
  auth: { Authorization: string },
  id: string,
  name?: string,
  repoUrl?: string,
): Promise<ArchPayload | null> {
  const res = await fetch(`${API}/projects/${id}/architecture`, { headers: auth });
  const json = await res.json().catch(() => null);
  if (res.ok && json?.data) return json.data as ArchPayload;
  if (res.status === 404) return null; // not analyzed yet — caller runs it
  throw new Error(
    `architecture HTTP ${res.status} for "${name}" (${repoUrl}): ` + JSON.stringify(json).slice(0, 300),
  );
}

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test+layout@localhost.dev", password: "LayoutVerify#2026" }),
  })
    .then((r) => r.json())
    .catch(() => null);
  let token: string | null = login?.data?.token ?? null;
  let session = "seeded account";

  if (!token) {
    // this database has no seeded probe account (fresh container) — a guest
    // session can still open the bundled demo and read its architecture, so
    // the pipeline probe never depends on a manual seed step
    session = "guest (no seeded account)";
    const g = await fetch(`${API}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then((r) => r.json())
      .catch(() => null);
    token = g?.data?.token ?? null;
    if (!token) throw new Error("login failed: " + JSON.stringify(login).slice(0, 200));
    await fetch(`${API}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Guest demo", repoUrl: "demo://beach-resort", source: "demo" }),
    }).catch(() => undefined);
  }
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  console.log("session:", session);

  const projects = await fetch(`${API}/projects`, { headers: auth }).then((r) => r.json());
  const list: ProjectRow[] = projects?.data?.projects ?? projects?.data ?? [];
  const demo = list.find((p) => String(p.repoUrl ?? "").includes("demo://")) ?? list[0];
  if (!demo) throw new Error("no project");

  let arch = await getArchitecture(auth, demo.id, demo.name, demo.repoUrl);
  // brand-new project (guest fallback above) has no stored analysis yet — run
  // the pipeline exactly like the UI does: start → poll status → read result
  if (!arch) {
    const started = await fetch(`${API}/projects/${demo.id}/analyze`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    }).then((r) => r.json());
    const analysisId: string | undefined = started?.data?.analysisId;
    if (!analysisId) throw new Error("analyze failed: " + JSON.stringify(started).slice(0, 300));
    let status = "running";
    for (let i = 0; i < 60 && status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const st = await fetch(`${API}/analyses/${analysisId}/status`, { headers: auth })
        .then((r) => r.json())
        .catch(() => null);
      status = st?.data?.status ?? "running";
    }
    if (status !== "completed") throw new Error(`analysis ${status}`);
    arch = await getArchitecture(auth, demo.id, demo.name, demo.repoUrl);
  }
  if (!arch) throw new Error("architecture still missing after analyze");
  const city = architectureToCity(arch);

  const kinds: Record<string, number> = {};
  let buildings = 0;
  for (const d of city.districts)
    for (const b of d.buildings) {
      buildings++;
      kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
    }
  console.log("districts:", city.districts.map((d) => `${d.id}(${d.buildings.length})`).join(", "));
  console.log("buildings:", buildings, "kinds:", JSON.stringify(kinds));
  console.log("edges:", city.edges?.length ?? 0, "dropped:", (arch?.architecture?.connections?.length ?? 0) - (city.edges?.length ?? 0));

  const derived = deriveFlows(city);
  const merged = allFlows(city);
  console.log("derived flows:", Object.keys(derived).length, "→", Object.keys(derived).slice(0, 4).join(", "));
  console.log("merged flows:", Object.keys(merged).length);

  const L = buildLayout(city);
  // every chain must resolve to a real building, or the courier has no hops
  for (const [k, chain] of Object.entries(merged)) {
    const missing = chain.filter((id) => !L.byId.has(id));
    if (missing.length) console.log(`  ✗ ${k}: chain ids missing from layout: ${missing.join(", ")}`);
  }
  console.log("flow chains resolve:", Object.values(merged).every((c) => c.every((id) => L.byId.has(id))));
  console.log("lanes:", Object.keys(L.flowPaths).join(", "));
  console.log("ambient cars would be:", Math.min(6, Object.keys(L.flowPaths).length + Object.keys(merged).length));
  for (const [k, pts] of Object.entries(L.flowPaths)) console.log(`  lane ${k}: ${pts.length} waypoints`);
  console.log("district centres:", L.districts.map((d) => `${d.id}@(${d.center[0]},${d.center[1]}) ring ${d.ringR}x${d.ringD} slabs=${d.slabs?.length ?? 0}`).join(" | "));
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
