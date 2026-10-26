import { useCallback, useEffect, useState } from "react";
import { Building2, History, Loader2 } from "lucide-react";
import { apiFetch, ensureSession, useAuth } from "../lib/auth";
import { architectureToCity } from "../lib/city";
import { useCity } from "../store/useCity";

interface ProjectRow {
  id: string;
  name: string;
  repoUrl: string;
  source?: string;
  lastAnalysisId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** What GET /api/v1/projects returns. */
interface ProjectListResponse {
  success: boolean;
  data?: { projects?: ProjectRow[] };
}

function relTime(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Short repo label: "https://github.com/acme/shop" → "acme/shop". */
function shortRepo(url?: string): string {
  if (!url) return "";
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

/**
 * RECENT PROJECTS — the "my work" entry point every platform needs.
 * Lists the signed-in user's previously analyzed repos; clicking one reopens
 * its stored architecture straight into the city, no re-analysis.
 */
export function RecentProjects({ onPicked }: { onPicked?: () => void }) {
  const setCity = useCity((s) => s.setCity);
  const patch = useCity((s) => s.patch);
  const notify = useCity((s) => s.notify);

  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);

  const token = useAuth((s) => s.token);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const minted = await ensureSession();
      // No session at all → don't fire a request we already know answers 401
      // (two console errors on every anonymous visit). The signed-out visitor
      // just sees the empty state, and the list loads the moment a session
      // lands — the `token` dependency below re-runs this effect.
      if (!minted && !useAuth.getState().refreshToken) {
        setRows([]);
        return;
      }
      const res = await apiFetch("/projects");
      if (res.status === 401 || res.status === 403) {
        setRows([]);
        return;
      }
      const json = (await res.json().catch(() => null)) as ProjectListResponse | null;
      if (res.ok && json?.success) setRows(json.data?.projects ?? []);
      else setRows([]);
    } catch {
      // signed out / session ended — show an empty list, never a raw 401
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, token]);

  const open = useCallback(
    async (p: ProjectRow) => {
      if (opening) return;
      setOpening(p.id);
      try {
        await ensureSession();
        const res = await apiFetch(`/projects/${p.id}/architecture`);
        const json = (await res.json().catch(() => null)) as
          | { success?: boolean; data?: unknown; message?: string }
          | null;

        if (!res.ok || !json?.success || !json.data) {
          notify(
            `⚠ ${p.name} has no completed analysis yet — run BUILD CITY on it first`,
            undefined,
            "error",
          );
          return;
        }

        const city = architectureToCity(json.data as Parameters<typeof architectureToCity>[0]);
        setCity(city);
        patch({ selectedId: null, selectedFn: null, guideCta: true });
        notify(`🏙 Opened ${p.name}`, undefined, "success");
        onPicked?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "could not open that project";
        if (!(e as { silent?: boolean }).silent) notify(`⚠ ${msg}`, undefined, "error");
      } finally {
        setOpening(null);
      }
    },
    [opening, setCity, patch, notify, onPicked],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-black-ink/25 bg-paper-deep px-2.5 py-3 text-xs text-black-ink/60">
        <Loader2 size={13} className="animate-spin" />
        Loading your projects…
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-black-ink/30 bg-paper-deep px-2.5 py-3 text-xs leading-relaxed text-black-ink/55">
        No projects yet — paste a repo above and press <b>BUILD CITY</b>.
      </div>
    );
  }

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-bold uppercase tracking-wider text-black-ink/45">
        <History size={11} /> {rows.length} project{rows.length === 1 ? "" : "s"}
      </div>
      <div className="grid max-h-56 gap-1 overflow-y-auto pr-0.5">
        {rows.map((p) => {
          const busy = opening === p.id;
          return (
            <button
              key={p.id}
              onClick={() => void open(p)}
              disabled={!!opening}
              title={`Open ${p.name}${p.repoUrl ? ` — ${p.repoUrl}` : ""}`}
              className={`group flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                busy
                  ? "cursor-wait border-signal bg-signal/10"
                  : "border-black-ink/25 bg-paper-deep hover:border-signal hover:bg-signal/10"
              }`}
            >
              <Building2 size={14} className="shrink-0 text-black-ink/55 group-hover:text-signal" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-black-ink">{p.name}</span>
                <span className="block truncate font-mono text-[10px] text-black-ink/55">
                  {shortRepo(p.repoUrl) || "—"}
                  {p.updatedAt ? ` · ${relTime(p.updatedAt)}` : ""}
                </span>
              </span>
              {busy && <Loader2 size={12} className="shrink-0 animate-spin text-signal" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
