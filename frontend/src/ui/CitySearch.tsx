import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useCityLayout } from "../lib/city";
import { useCity } from "../store/useCity";
import { pushLog } from "./logFeed";

/** Building search with arrow-key listbox — lives inside the ☰ menu so the
    city view stays clean (press / to jump here). */
export function CitySearch({ onPicked }: { onPicked?: () => void }) {
  const layout = useCityLayout();
  const select = useCity((s) => s.select);
  const setFocus = useCity((s) => s.setFocus);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () =>
      q
        ? layout.buildings.filter((b) => (b.name + b.districtName).toLowerCase().includes(q.toLowerCase())).slice(0, 6)
        : [],
    [q, layout],
  );
  const hiSafe = Math.min(hi, results.length - 1);

  const pick = (id: string) => {
    const b = layout.byId.get(id);
    if (!b) return;
    select(id);
    setFocus(b.pos[0], b.pos[2]);
    setQ("");
    pushLog("fe", `inspect ${b.name}`, "info");
    onPicked?.();
  };

  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-3 text-black-ink/55" />
      <input
        id="city-search"
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && results[hiSafe]) {
            pick(results[hiSafe].id);
          }
        }}
        placeholder="Find a feature… e.g. payment   (press / )"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="city-search-listbox"
        aria-activedescendant={results[hiSafe] ? `city-opt-${results[hiSafe].id}` : undefined}
        aria-label="Search buildings"
        className="w-full rounded-xl border-[1.5px] border-black-ink bg-paper/95 py-2 pl-8 pr-3 text-sm outline-none focus:border-signal"
      />
      {results.length > 0 && (
        <div id="city-search-listbox" role="listbox" aria-label="Matching buildings" className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border-[1.5px] border-black-ink bg-paper">
          {results.map((b, i) => (
            <button
              key={b.id}
              id={`city-opt-${b.id}`}
              role="option"
              aria-selected={i === hiSafe}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(b.id)}
              className={`block w-full px-3 py-2 text-left text-sm ${i === hiSafe ? "bg-black-ink text-paper" : "hover:bg-black-ink/10"}`}
            >
              {b.name} <span className={i === hi ? "text-paper/60" : "text-black-ink/60"}>· {b.districtName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
