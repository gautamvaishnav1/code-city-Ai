import { useMemo } from "react";
import {
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  Snowflake,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import { setAudioEnabled } from "../../three/audio";
import { useCity } from "../../store/useCity";
import { DraggablePanel } from "../DraggablePanel";

/* ── atmosphere panel (weather · time · sound) — HIDDEN by default (UX
      review); reopen from ☰ MENU → Panels → Atmosphere. weather now MEANS
      something: clear = healthy · drizzle = warnings · rain/storm = errors ── */
export function WeatherPanel() {
  // granular selectors — this panel must NOT re-render on every time tick
  const weather = useCity((s) => s.weather);
  const live = useCity((s) => s.live);
  const sound = useCity((s) => s.sound);
  const time = useCity((s) => s.time);
  const autoCycle = useCity((s) => s.autoCycle);
  const failing = useCity((s) => s.failing);
  const apiLatencyMs = useCity((s) => s.apiLatencyMs);
  const districts = useCity((s) => s.city.districts);
  const patch = useCity((s) => s.patch);

  const { bad, errs } = useMemo(() => {
    let bad = 0;
    let errs = 0;
    for (const d of districts)
      for (const b of d.buildings) {
        if (b.health !== "ok") bad++;
        if (b.health === "error") errs++;
      }
    return { bad, errs };
  }, [districts]);

  const meaning =
    failing || (apiLatencyMs != null && apiLatencyMs > 900)
      ? "STORM — API SLOW OR FAILING"
      : errs > 0
        ? "RAIN — BROKEN PIPELINES"
        : bad > 0
          ? "DRIZZLE — WARNINGS PRESENT"
          : "CLEAR — ALL SYSTEMS HEALTHY";

  // total-minutes math — independent rounding used to show "23:60"
  const mins = Math.round(time * 60);
  const hh = String(Math.floor(mins / 60) % 24).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");

  return (
    <DraggablePanel
      id="weather"
      className="pointer-events-auto fixed left-1/2 top-1/2 z-40 w-[min(92vw,232px)] -translate-x-1/2 -translate-y-1/2"
      resizable={false}
    >
      <div className="pointer-events-auto w-full rounded-xl border-[1.5px] border-black-ink bg-paper/95 p-3 shadow-[4px_4px_0_rgba(0,0,0,.3)]">
      <div className="caption-caps mb-2 flex items-baseline justify-between gap-2 font-bold">
        <span className="shrink-0">ATMOSPHERE</span>
        <span className="truncate text-right text-[9px] text-black-ink/70">{meaning}</span>
      </div>
      <div className="flex gap-1.5">
        {(
          [
            ["clear", Sun],
            ["drizzle", CloudDrizzle],
            ["rain", CloudRain],
            ["storm", CloudLightning],
            ["snow", Snowflake],
            ["fog", CloudFog],
          ] as const
        ).map(([w, Ico]) => (
          <button
            key={w}
            onClick={() => patch({ weather: w, live: false })}
            title={w}
            aria-label={`${w} weather`}
            aria-pressed={weather === w}
            className={`min-h-[36px] flex-1 rounded-lg border py-2 text-xs ${weather === w ? "border-black-ink bg-black-ink text-paper" : "border-[1.5px] border-black-ink/60 bg-paper-deep"}`}
          >
            <Ico size={13} className="inline" />
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-black-ink/70">
        <input type="checkbox" checked={!!live} onChange={(e) => patch({ live: e.target.checked })} className="accent-signal" />
        Weather follows code health
      </label>
      <button
        onClick={() => {
          const on = !sound;
          patch({ sound: on });
          setAudioEnabled(on);
        }}
        aria-pressed={sound}
        className={`mt-2 min-h-[36px] w-full rounded-lg border py-2 text-xs ${sound ? "border-black-ink bg-black-ink text-paper" : "border-[1.5px] border-black-ink/60 bg-paper-deep"}`}
      >
        {sound ? <Volume2 size={13} className="mr-1 inline" /> : <VolumeX size={13} className="mr-1 inline" />}
        {sound ? "Sound on" : "Sound off"}
      </button>
      <div className="mt-3 flex items-center gap-2 text-xs text-black-ink/70">
        <span className="tabular-nums">
          {hh}:{mm}
        </span>
        <input
          type="range"
          min={0}
          max={24}
          step={0.1}
          value={time}
          onChange={(e) => patch({ time: +e.target.value, autoCycle: false })}
          aria-label="Time of day"
          className="flex-1 accent-signal"
        />
      </div>
      <label className="mt-1 flex items-center gap-2 text-xs text-black-ink/70">
        <input type="checkbox" checked={autoCycle} onChange={(e) => patch({ autoCycle: e.target.checked })} className="accent-signal" />
        Auto day–night cycle
      </label>
      </div>
    </DraggablePanel>
  );
}
