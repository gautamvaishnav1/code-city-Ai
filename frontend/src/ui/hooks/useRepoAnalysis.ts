import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, beginGuestSession, ensureSession, useAuth } from "../../lib/auth";
import { architectureToCity } from "../../lib/city";
import { subscribeAnalysisProgress } from "../../lib/progressSocket";
import { useCity } from "../../store/useCity";
import { useUi } from "../../store/useUi";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 90; // ~3 min ceiling
const REPO_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*(\/[^\s/]+)+$/i;

/** Repo → city analysis pipeline, extracted out of the RepoLoader UI so the
    component stays presentational and the flow survives strict effects.
    Guards every await with an `alive` flag: navigating away mid-analysis
    can never setState-after-unmount or leak the polling loop. */
export function useRepoAnalysis() {
  const setCity = useCity((s) => s.setCity);
  const patchCity = useCity((s) => s.patch);
  const notify = useCity((s) => s.notify);
  const [busy, setBusy] = useState(false);
  /** live pipeline progress 0..100 from the backend Socket.IO stream
      (null = indeterminate — never a fabricated counter) */
  const [progress, setProgress] = useState<number | null>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** a build that hit the sign-in gate — resumed automatically once the auth
   *  modal hands back a live session (no second click, no dead-end toast). */
  const pendingInput = useRef<string | null>(null);

  // resume the moment a session appears (sign-in / OTP / OAuth all land here)
  useEffect(() => {
    return useAuth.subscribe((s, prev) => {
      if (prev.token || !s.token || !pendingInput.current) return;
      const input = pendingInput.current;
      pendingInput.current = null;
      void analyze(input);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the modal was dismissed without signing in → forget the queued build
  useEffect(() => {
    return useUi.subscribe((s, prev) => {
      if (prev.authOpen && !s.authOpen && !useAuth.getState().token) pendingInput.current = null;
    });
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
      let unsubProgress: (() => void) | undefined;
      notify(
        isDemo
          ? "▸ Loading bundled demo project (Beach Resort)…"
          : `▸ Analyzing ${target} …`,
      );
      try {
        // a cold tab may still hold only a refresh token — mint the access
        // token first instead of refusing with "sign in first"
        if (!useAuth.getState().token) await ensureSession();
        if (!useAuth.getState().token && !useAuth.getState().refreshToken) {
          // no session at all. The BUNDLED DEMO never dead-ends on a sign-in
          // wall: ask the backend for an anonymous guest session (demo:// only
          // — the API refuses everything else for guests) and carry straight on
          // with the build. Real repositories keep the sign-in gate, but they
          // also queue the build, so the moment the session lands the build
          // starts on its own and nobody has to press BUILD CITY twice.
          if (isDemo) {
            try {
              await beginGuestSession();
              if (!alive.current) return;
              notify("👋 Opening the demo as a guest — sign in whenever you like", undefined, "info");
            } catch {
              pendingInput.current = target;
              useUi.setState({ authOpen: true });
              notify("🔐 Sign in to open the demo — the build starts the moment you're in", undefined, "info");
              return;
            }
          } else {
            pendingInput.current = target;
            useUi.setState({ authOpen: true });
            notify("🔐 Sign in to build this repo — the build starts the moment you're in", undefined, "info");
            return;
          }
        }

        // a guest session is enough for the demo but never for a repository —
        // swap it for the sign-in dialog (queued, resumes on its own) instead
        // of letting the backend answer with a raw 403 halfway through a build
        if (!isDemo && useAuth.getState().user?.provider === "guest") {
          pendingInput.current = target;
          useUi.setState({ authOpen: true });
          notify("🔐 Guest sessions can open the demo only — sign in to analyze this repo", undefined, "info");
          return;
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
                patchCity({ guideCta: true });
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

        // REAL progress: join the project room on Socket.IO and listen to the
        // pipeline's analysis:progress events (step + percent from the backend).
        // If the socket never connects, progress stays null → honest
        // indeterminate "BUILDING…" on the button (audit finding 3).
        let lastStep = "";
        unsubProgress = subscribeAnalysisProgress({
          projectId,
          analysisId,
          token: useAuth.getState().token ?? "",
          onProgress: (p) => {
            if (!alive.current) return;
            if (typeof p.percent === "number") setProgress(p.percent);
            if (p.step !== lastStep) {
              lastStep = p.step;
              notify(`▸ ${p.message ?? p.step}${typeof p.percent === "number" ? ` — ${p.percent}%` : ""}`);
            }
          },
        });

        // poll until the pipeline completes (bails instantly on unmount).
        // The status endpoint carries NO percent — completion detection only,
        // never a fabricated progress number.
        let status = "running";
        for (let i = 0; i < MAX_POLLS && alive.current; i++) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          if (!alive.current) return;
          const stRes = await apiFetch(`/analyses/${analysisId}/status`);
          const stJson = await stRes.json();
          if (!stRes.ok) throw new Error(stJson.message ?? `HTTP ${stRes.status}`);
          status = stJson.data.status as string;
          if (status !== "running") break;
        }
        if (!alive.current) return;
        if (status !== "completed")
          throw new Error(`analysis ${status} — check backend logs`);
        setProgress(100);

        // fetch the validated city architecture
        const archRes = await apiFetch(`/projects/${projectId}/architecture`);
        const archJson = await archRes.json();
        if (!archRes.ok) throw new Error(archJson.message ?? `HTTP ${archRes.status}`);

        const city = architectureToCity(archJson.data);
        const files = city.districts.reduce((a, d) => a + d.buildings.length, 0);
        setCity(city);
        // reset UI selection so the city starts with a clean state (no building highlighted)
        // + surface the post-build "how to improve" CTA in the right rail
        patchCity({ selectedId: null, selectedFn: null, guideCta: true });
        notify(`🏙 Loaded ${city.project.name} — ${files} buildings`, undefined, "success");
      } catch (e) {
        // silent = session ended by the refresh layer — never surface token errors
        if (alive.current && !(e as { silent?: boolean }).silent)
          notify(`⚠ ${(e as Error).message}`, undefined, "error");
      } finally {
        unsubProgress?.();
        busyRef.current = false;
        if (alive.current) {
          setBusy(false);
          setProgress(null);
        }
      }
    },
    [setCity, notify, patchCity],
  );

  return { busy, analyze, progress };
}
