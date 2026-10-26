import { LogOut } from "lucide-react";
import { useAuth } from "../lib/auth";

/** avatar + sign-out — used in the first-run top bar and the ☰ menu footer */
export function UserChip() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  if (!user) return null;
  return (
    <div className="flex items-center gap-2 rounded-none border-[1.5px] border-black-ink bg-paper/95 px-2.5 py-2">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-black-ink text-[10px] font-bold text-paper">
        {user.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="hidden max-w-[90px] truncate font-mono text-[11px] text-black-ink/75 lg:block">{user.name}</span>
      <button onClick={signOut} title="Sign out" aria-label="Sign out" className="text-black-ink/45 transition-colors hover:text-signal">
        <LogOut size={13} />
      </button>
    </div>
  );
}
