import { Html } from "@react-three/drei";
import { useCity } from "../../store/useCity";
import { useCityLayout } from "../../lib/city";

/* ── floating notification above a selected/failing building's head ── */
export function FloatingNotifs() {
  const notifs = useCity((s) => s.notifications);
  const selectedId = useCity((s) => s.selectedId);
  const L = useCityLayout();
  const b = L.byId.get(selectedId ?? "");
  if (!b) return null;
  return (
    <group position={[b.pos[0], b.h + 7, b.pos[2]]}>
      <Html center distanceFactor={70} zIndexRange={[40, 0]}>
        <div className="grid gap-1">
          {notifs.slice(-2).map((n) => (
            <div
              key={n.id}
              className={`whitespace-nowrap rounded-none border-[1.5px] px-2 py-1 font-mono text-[10px] font-bold shadow-[3px_3px_0_rgba(0,0,0,.4)] ${
                n.type === "error"
                  ? "border-black-ink bg-signal text-paper"
                  : n.type === "success"
                    ? "border-black-ink bg-emerald-500 text-black-ink"
                    : "border-black-ink bg-paper text-black-ink"
              }`}
            >
              {n.text}
            </div>
          ))}
        </div>
      </Html>
    </group>
  );
}
