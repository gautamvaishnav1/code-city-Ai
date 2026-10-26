/** smoke test for guest sessions: mint → demo project OK → real repo 403 → refresh keeps the guest claim */
const API = "http://localhost:5000/api/v1";

const payloadOf = (t) => JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());

async function main() {
  const g = await fetch(`${API}/auth/guest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
  if (!g?.data?.token) throw new Error("guest mint failed: " + JSON.stringify(g).slice(0, 300));
  const tok = g.data.token;
  const rt = g.data.refreshToken;
  const p = payloadOf(tok);
  console.log("guest user:", g.data.user.email, "| provider:", g.data.user.provider, "| claim guest:", p.guest === true);

  const auth = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };

  const demo = await fetch(`${API}/projects`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Guest demo", repoUrl: "demo://beach-resort", source: "demo" }) });
  console.log("demo:// create ->", demo.status, (await demo.text()).slice(0, 160));

  const real = await fetch(`${API}/projects`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Some repo", repoUrl: "https://github.com/expressjs/express" }) });
  console.log("github create  ->", real.status, (await real.text()).slice(0, 200));

  const explain = await fetch(`${API}/repos/explain`, { method: "POST", headers: auth, body: JSON.stringify({ url: "https://github.com/expressjs/express" }) });
  console.log("repos/explain  ->", explain.status, (await explain.text()).slice(0, 200));

  const r2 = await fetch(`${API}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) }).then((r) => r.json());
  const p2 = payloadOf(r2?.data?.token ?? "");
  console.log("after refresh  -> guest claim:", p2.guest === true);

  const r3 = await fetch(`${API}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: r2.data.refreshToken }) }).then((r) => r.json());
  const p3 = payloadOf(r3?.data?.token ?? "");
  console.log("2nd refresh    -> guest claim:", p3.guest === true);

  const list = await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${r3.data.token}` } }).then((r) => r.json());
  console.log("guest projects ->", JSON.stringify((list.data?.projects ?? []).map((x) => x.repoUrl)));
  console.log("guest /me      ->", JSON.stringify((await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${r3.data.token}` } }).then((r) => r.json())).data));
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
