import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, useAuth } from "../../lib/auth";
import { architectureToCity } from "../../lib/city";
import { useCity } from "../../store/useCity";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 90; // ~3 min ceiling
const REPO_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*(\/[^\s/]+)+$/i;

/** Repo → city analysis pipeline, extracted out of the RepoLoader UI so the
    component stays presentational and the flow survives strict effects.
    Guards every await with an `alive` flag: navigating away mid-analysis
    can never setState-after-unmount or leak the polling loop. */
export function useRepoAnalysis() {
  const setCity = useCity((s) => s.setCity);
  const notify = useCity((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const analyze = useCallback(
    async (input: string) => {
      const target = input.trim();
      if (!target || busyRef.current || !alive.current) return;
      const isDemo = target.startsWith("demo://");
      if (!isDemo && !REPO_RE.test(target.replace(/^https?:\/\//i, ""))) {
        notify("⚠ Enter a repo like github.com/owner/repo", undefined, "error");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      notify(
        isDemo
          ? "▸ Loading bundled demo project (Beach Resort)…"
          : `▸ Analyzing ${target} …`,
      );
      try {
        if (!useAuth.getState().token) {
          throw new Error("sign in first — ⌘K → Sign in / Create account");
        }

        // create a project for the repo (demo:// → bundled demo, no download)
        const repoUrl = isDemo
          ? target
          : /^https?:\/\//i.test(target)
            ? target
            : `https://${target}`;
        const name = isDemo
          ? "Beach Resort (demo)"
          : decodeURIComponent(
              repoUrl.split("?")[0].replace(/\/+$/, "").split("/").pop() ||
                "repo",
            );

        // already analyzed before? serve the stored explanation + city instantly
        if (!isDemo) {
          try {
            const exRes = await apiFetch("/repos/explain", {
              method: "POST",
              body: JSON.stringify({ url: repoUrl }),
            });
            if (exRes.ok) {
              const exJson = await exRes.json();
              if (exJson?.data?.cached && exJson.data.architecture) {
                if (!alive.current) return;
                setCity(architectureToCity(exJson.data));
                notify(
                  `⚡ ${exJson.data.explanation?.summary ?? `Loaded ${exJson.data.repoInfo?.fullName} from database`}`,
                  undefined,
                  "success",
                );
                return;
              }
            }
          } catch {
            /* cache miss → fall through to the normal analysis flow */
          }
        }

        const projRes = await apiFetch("/projects", {
          method: "POST",
          body: JSON.stringify({
            name,
            repoUrl,
            ...(isDemo ? { source: "demo" } : {}),
          }),
        });
        const projJson = await projRes.json();
        if (!projRes.ok) throw new Error(projJson.message ?? `HTTP ${projRes.status}`);
        const projectId: string = projJson.data.project.id;

        // kick off the analysis pipeline
        const startRes = await apiFetch(`/projects/${projectId}/analyze`, {
          method: "POST",
        });
        const startJson = await startRes.json();
        if (startRes.status !== 202 && !startRes.ok)
          throw new Error(startJson.message ?? `HTTP ${startRes.status}`);
        const analysisId: string = startJson.data.analysisId;

        // poll until the pipeline completes (bails instantly on unmount)
        let status = "running";
        for (let i = 0; i < MAX_POLLS && alive.current; i++) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          if (!alive.current) return;
          const stRes = await apiFetch(`/analyses/${analysisId}/status`);
          const stJson = await stRes.json();
          if (!stRes.ok) throw new Error(stJson.message ?? `HTTP ${stRes.status}`);
          status = stJson.data.status as string;
          notify(`▸ analyzing… ${stJson.data.progress ?? Math.min(99, i * 4)}%`);
          if (status !== "running") break;
        }
        if (!alive.current) return;
        if (status !== "completed")
          throw new Error(`analysis ${status} — check backend logs`);

        // fetch the validated city architecture
        const archRes = await apiFetch(`/projects/${projectId}/architecture`);
        const archJson = await archRes.json();
        if (!archRes.ok) throw new Error(archJson.message ?? `HTTP ${archRes.status}`);

        const city = architectureToCity(archJson.data);
        const files = city.districts.reduce((a, d) => a + d.buildings.length, 0);
        setCity(city);
        notify(`🏙 Loaded ${city.project.name} — ${files} buildings`, undefined, "success");
      } catch (e) {
        if (alive.current) notify(`⚠ ${(e as Error).message}`, undefined, "error");
      } finally {
        busyRef.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [setCity, notify],
  );

  return { busy, analyze };
}
