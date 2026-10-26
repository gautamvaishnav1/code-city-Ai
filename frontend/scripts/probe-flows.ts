/** end-to-end pipeline probe: real backend payload → CityJSON → layout.
 *  run: ..\Backend\node_modules\.bin\tsx.cmd scripts\probe-flows.ts */
import { architectureToCity, allFlows, deriveFlows } from "../src/lib/city";
import { buildLayout } from "../src/lib/layout";

const API = "http://localhost:5000/api/v1";

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test+layout@localhost.dev", password: "LayoutVerify#2026" }),
  }).then((r) => r.json());
  const token: string = login?.data?.token;
  if (!token) throw new Error("login failed: " + JSON.stringify(login).slice(0, 200));
  const auth = { Authorization: `Bearer ${token}` };

  const projects = await fetch(`${API}/projects`, { headers: auth }).then((r) => r.json());
  const list: any[] = projects?.data?.projects ?? projects?.data ?? [];
  const demo = list.find((p) => String(p.repoUrl ?? "").includes("demo://")) ?? list[0];
  if (!demo) throw new Error("no project");

  const arch = await fetch(`${API}/projects/${demo.id}/architecture`, { headers: auth }).then((r) => r.json());
  const city = architectureToCity(arch.data);

  const kinds: Record<string, number> = {};
  let buildings = 0;
  for (const d of city.districts)
    for (const b of d.buildings) {
      buildings++;
      kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
    }
  console.log("districts:", city.districts.map((d) => `${d.id}(${d.buildings.length})`).join(", "));
  console.log("buildings:", buildings, "kinds:", JSON.stringify(kinds));
  console.log("edges:", city.edges?.length ?? 0, "dropped:", (arch.data?.architecture?.connections?.length ?? 0) - (city.edges?.length ?? 0));

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
