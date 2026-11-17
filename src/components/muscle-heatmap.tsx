"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { findLayerAt, type HitLayer } from "@/client/muscle-hit";
import { MUSCLES, type Muscle } from "@/domain/exercise";
import { detailParent } from "@/domain/muscle-detail";
import { bodyShading, listMuscles, type BodyShade, type MuscleFocus } from "@/domain/muscle-focus";
import { muscleMapFor, MUSCLE_MAP_BODIES, type MuscleMapSide } from "@/domain/muscle-map";
import type { CommandOutput } from "@/server/commands";
import { useStrings } from "@/strings/provider";

type Heatmap = CommandOutput<"getMuscleHeatmap">;
type HeatLevel = Heatmap["muscles"][number]["level"];

/** Tailwind fills for heat levels 1–4 (the sequential --heat-* tokens); level 0 is not drawn. */
const HEAT_FILL = ["", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4"] as const;

const sets = (n: number) => Math.round(n * 10) / 10;

function overlayStyle(url: string): CSSProperties {
  // The overlay SVG is a silhouette of one muscle in the body's coordinate space: use it as a mask.
  const mask = `url(${url})`;
  return {
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: "100% auto",
    WebkitMaskSize: "100% auto",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "top left",
    WebkitMaskPosition: "top left",
  };
}

function Body({
  side,
  shades,
  onPick,
}: {
  side: MuscleMapSide;
  shades: Map<Muscle, BodyShade<HeatLevel>>;
  /** The muscle tapped on the diagram, or null for a tap on nothing. */
  onPick: (muscle: Muscle | null) => void;
}) {
  const s = useStrings();
  const layers = useRef<HitLayer<Muscle>[]>([]);
  useEffect(() => {
    layers.current = MUSCLES.flatMap((muscle) =>
      muscleMapFor(muscle)
        .filter((o) => o.side === side)
        .map((o) => {
          const image = new Image();
          image.src = o.primaryUrl;
          return { id: muscle, image };
        }),
    );
  }, [side]);

  const shaded = [...shades].flatMap(([muscle, shade]) =>
    muscleMapFor(muscle)
      .filter((o) => o.side === side)
      .map((o) => ({ ...o, muscle, ...shade })),
  );
  const sideLabel = side === "front" ? s.analytics.front : s.analytics.back;
  const summary = shaded.length
    ? [...new Set(shaded.map((o) => `${s.muscles[o.muscle]} ${s.analytics.sets(sets(o.sets))}`))].join(", ")
    : s.analytics.notTrained;

  function pick(event: MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    onPick(findLayerAt(layers.current, event.clientX - box.left, event.clientY - box.top, box.width));
  }

  return (
    <figure className="flex flex-1 flex-col items-center gap-1">
      {/* Tapping is a shortcut: the list below has every muscle as a button. */}
      <div
        role="img"
        aria-label={s.analytics.bodyAlt(sideLabel, summary)}
        className="relative w-full max-w-48 cursor-pointer"
        onClick={pick}
      >
        <img src={MUSCLE_MAP_BODIES[side]} alt="" className="block h-auto w-full" />
        {shaded.map((o) => (
          <span
            key={o.wgerId}
            aria-hidden
            className={`absolute inset-0 transition-opacity ${HEAT_FILL[o.level]} ${o.dim ? "opacity-25" : ""}`}
            style={overlayStyle(o.primaryUrl)}
          />
        ))}
      </div>
      <figcaption className="text-xs text-muted">{sideLabel}</figcaption>
    </figure>
  );
}

/** Where a muscle is and what it does, for the row the user tapped. */
function MuscleGuide({ muscle, onClose }: { muscle: Heatmap["muscles"][number]["muscle"]; onClose: () => void }) {
  const s = useStrings();
  const info = s.muscleInfo[muscle];
  const parent = detailParent(muscle);
  const note =
    muscleMapFor(parent).length === 0
      ? s.analytics.notDrawn
      : parent === muscle
        ? null
        : s.analytics.wholeMuscleNote(s.muscles[parent].toLowerCase());
  return (
    <section aria-label={s.muscleDetail[muscle]} className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{s.muscleDetail[muscle]}</h3>
        <button type="button" onClick={onClose} className="text-xs text-muted underline">
          {s.analytics.showAll}
        </button>
      </div>
      <p>
        <span className="font-semibold">{s.analytics.whereLabel}: </span>
        {info.where}
      </p>
      <p>
        <span className="font-semibold">{s.analytics.doesLabel}: </span>
        {info.does}
      </p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </section>
  );
}

/**
 * Front and back muscle maps (wger diagrams) shaded by recent working sets
 * against a weekly target, with a legend and the per-muscle numbers, least
 * trained first, so neglected muscles (including ones the map doesn't draw)
 * stand out. Tap a muscle on the body to filter the list to its parts; tap a
 * row to see only that muscle on the body, with a short guide to it.
 */
export function MuscleHeatmap({ heatmap }: { heatmap: Heatmap }) {
  const s = useStrings();
  const [focus, setFocus] = useState<MuscleFocus | null>(null);
  const shades = bodyShading(heatmap.muscles, focus);
  const ranked = listMuscles(heatmap.muscles, focus).toSorted((a, b) => a.sets - b.sets);

  function pickOnBody(group: Muscle | null) {
    setFocus((f) => {
      if (group === null) return f?.by === "map" ? null : f;
      return f?.by === "map" && f.group === group ? null : { by: "map", group };
    });
  }
  function pickInList(muscle: Heatmap["muscles"][number]["muscle"]) {
    setFocus((f) => (f?.by === "list" && f.muscle === muscle ? null : { by: "list", muscle }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-4 rounded-card border border-border bg-surface p-3">
        <Body side="front" shades={shades} onPick={pickOnBody} />
        <Body side="back" shades={shades} onPick={pickOnBody} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted" aria-hidden>
        <span>{s.analytics.legend}:</span>
        <span>{s.analytics.legendLess}</span>
        {HEAT_FILL.slice(1).map((fill) => (
          <span key={fill} className={`h-3 w-6 rounded-sm ${fill}`} />
        ))}
        <span>{s.analytics.legendMore}</span>
        <span className="font-numeric">({s.analytics.fullColor(heatmap.weeklyTarget)})</span>
      </div>
      {heatmap.muscles.every((m) => m.sets === 0) ? (
        <EmptyState>{s.analytics.noSets}</EmptyState>
      ) : (
        <>
          <p className="text-xs text-muted">{s.analytics.heatmapHint}</p>
          {focus?.by === "list" && <MuscleGuide muscle={focus.muscle} onClose={() => setFocus(null)} />}
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold">
              {focus?.by === "map" ? s.analytics.showingOnly(s.muscles[focus.group]) : s.analytics.leastTrainedFirst}
            </h3>
            {focus?.by === "map" && (
              <button type="button" onClick={() => setFocus(null)} className="text-xs text-muted underline">
                {s.analytics.showAll}
              </button>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border text-sm">
            {ranked.map((m) => (
              <li key={m.muscle}>
                <button
                  type="button"
                  aria-pressed={focus?.by === "list" && focus.muscle === m.muscle}
                  onClick={() => pickInList(m.muscle)}
                  className={`flex w-full flex-col gap-1.5 px-3 py-2.5 text-left ${focus?.by === "list" && focus.muscle === m.muscle ? "bg-surface-raised" : ""}`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span>
                      {s.muscleDetail[m.muscle]}
                      {muscleMapFor(detailParent(m.muscle)).length === 0 && (
                        <span className="ml-2 text-xs text-muted">{s.analytics.notDrawn}</span>
                      )}
                    </span>
                    <span className={`font-numeric ${m.sets === 0 ? "text-muted" : ""}`}>
                      {m.sets === 0 ? s.analytics.notTrained : s.analytics.sets(sets(m.sets))}
                    </span>
                  </span>
                  <span className="h-2 rounded-sm bg-surface-raised">
                    {m.level > 0 && (
                      <span
                        className={`block h-2 rounded-sm ${HEAT_FILL[m.level]}`}
                        style={{ width: `${Math.min(1, m.sets / heatmap.windowTarget) * 100}%` }}
                      />
                    )}
                  </span>
                  {m.sets > 0 && (
                    <span className="text-xs text-muted">{s.analytics.setsDetail(m.primarySets, m.secondarySets)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
