import { useEffect, useRef, useState } from "react";
import { GitBranch } from "lucide-react";

/** The ONE build control: paste a repo → BUILD CITY. Shows REAL pipeline
 *  progress (Socket.IO) while the analysis runs. Used in the first-run top
 *  bar AND inside the ☰ menu (rebuild). Demo lives in the empty-state card. */
export function RepoLoader({
  busy,
  analyze,
  progress,
  onDone,
}: {
  busy: boolean;
  analyze: (input: string) => Promise<void>;
  progress: number | null;
  /** called once when a build finishes (menu auto-closes to reveal the city) */
  onDone?: () => void;
}) {
  const [q, setQ] = useState("");
  const wasBusy = useRef(false);

  // auto-load a repo requested from the landing page hero form
  useEffect(() => {
    const pending = localStorage.getItem("cc-pending-repo");
    if (!pending) return;
    localStorage.removeItem("cc-pending-repo");
    const id = window.setTimeout(() => void analyze(pending), 0);
    return () => clearTimeout(id);
  }, [analyze]);

  // notify when a build transitions busy → idle (success or failure)
  useEffect(() => {
    if (busy) wasBusy.current = true;
    else if (wasBusy.current) {
      wasBusy.current = false;
      onDone?.();
    }
  }, [busy, onDone]);

  const label = busy ? (progress != null ? `BUILDING… ${progress}%` : "BUILDING…") : "BUILD CITY";

  return (
    <div className="relative flex min-w-[240px] flex-1 items-center gap-1 sm:min-w-[320px] sm:flex-none">
      <GitBranch size={14} className="absolute left-3 top-3 text-black-ink/55" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void analyze(q)}
        placeholder="github.com/owner/repo"
        aria-label="Repository URL"
        className="min-w-0 flex-1 rounded-xl border-[1.5px] border-black-ink bg-paper/95 py-2 pl-8 pr-2 text-sm outline-none focus:border-signal"
      />
      <button
        onClick={() => void analyze(q)}
        disabled={busy}
        title={busy ? `Analysis in progress${progress != null ? ` — ${progress}%` : ""}` : "Analyze the repo and build its city"}
        className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-xl border-[1.5px] border-black-ink px-2.5 py-2 text-xs font-bold lg:px-3 ${
          busy
            ? "cursor-wait bg-black-ink/15 text-black-ink/50"
            : "bg-signal text-paper shadow-[3px_3px_0_rgba(20,20,20,.35)] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_rgba(20,20,20,.35)]"
        }`}
      >
        {label}
      </button>
    </div>
  );
}
