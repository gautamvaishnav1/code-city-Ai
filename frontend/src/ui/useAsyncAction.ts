import { useEffect, useRef, useState } from "react";

/** Generic async-task wiring (busy / result text / error) used by the AI
    panels. The task returns the final text; failures surface as
    "AI unavailable: …". Safe against setState-after-unmount. */
export function useAsyncAction<A extends unknown[]>(
  task: (...args: A) => Promise<string>,
) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function run(...args: A) {
    if (busyRef.current) return;
    busyRef.current = true;
    if (alive.current) {
      setBusy(true);
      setText(null);
    }
    try {
      const out = await task(...args);
      if (alive.current) setText(out);
    } catch (e) {
      // silent = session ended by the refresh layer — never surface token errors
      if (alive.current) {
        if ((e as { silent?: boolean }).silent) setText(null);
        else setText(`AI unavailable: ${(e as Error).message}`);
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return { busy, text, setText, run };
}
