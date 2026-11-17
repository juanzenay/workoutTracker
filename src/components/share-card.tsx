"use client";

import { useEffect, useState } from "react";
import type { WorkoutSummary } from "@/domain/records";
import { useStrings } from "@/strings/provider";
import type { Strings } from "@/strings";
import { fitStatValue, STAT_LINE_HEIGHT } from "./share-card-fit";

const W = 1080;
const H = 1350;

/** Reads a design token so the card matches the current theme and skin. */
function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return value || fallback;
}

const formatNumber = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

/** Draws the summary card. Runs on the device (no network), so it works straight after an offline finish. */
async function drawCard(summary: WorkoutSummary, s: Strings): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const colors = {
    bg: token("bg", "#0f0f10"),
    surface: token("surface", "#18181a"),
    fg: token("fg", "#f2f2ef"),
    muted: token("muted", "#9a9a94"),
    accent: token("accent", "#f5b83d"),
  };
  const font = token("font-body", "system-ui, sans-serif");
  const numeric = token("font-numeric", "monospace");
  const pad = 72;

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);

  const fit = (text: string, max: number) => {
    let out = text;
    while (out.length > 1 && ctx.measureText(out).width > max) out = out.slice(0, -2) + "…";
    return out;
  };

  let y = pad + 40;
  ctx.fillStyle = colors.accent;
  ctx.font = `600 40px ${font}`;
  ctx.fillText(new Date(summary.startedAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }), pad, y);
  y += 84;
  ctx.fillStyle = colors.fg;
  ctx.font = `700 72px ${font}`;
  ctx.fillText(fit(summary.name ?? s.workout.untitled, W - 2 * pad), pad, y);

  // Stat row: duration, sets, volume, PRs.
  y += 60;
  const stats: [string, string][] = [
    [s.summary.duration, s.history.duration(summary.durationMinutes)],
    [s.summary.sets, String(summary.totalSets)],
    [s.summary.volume, summary.volume ? `${formatNumber(summary.volume.value)} ${summary.volume.unit}` : "–"],
    [s.records.recentPrs, String(summary.prs.length)],
  ];
  const cell = (W - 2 * pad) / stats.length;
  stats.forEach(([label, value], i) => {
    const x = pad + i * cell;
    ctx.fillStyle = colors.muted;
    ctx.font = `500 30px ${font}`;
    ctx.fillText(label, x, y + 40);
    ctx.fillStyle = i === 3 && summary.prs.length > 0 ? colors.accent : colors.fg;
    const measure = (text: string, px: number) => {
      ctx.font = `700 ${px}px ${numeric}`;
      return ctx.measureText(text).width;
    };
    const { lines, px } = fitStatValue(value, cell - 16, measure);
    ctx.font = `700 ${px}px ${numeric}`;
    lines.forEach((line, n) => ctx.fillText(line, x, y + 100 + n * px * STAT_LINE_HEIGHT));
  });
  y += 160;

  // Exercises, then PRs, as many as fit above the footer.
  const footerTop = H - pad - 40;
  const prsByExercise = new Map<string, number>();
  for (const pr of summary.prs) prsByExercise.set(pr.exerciseId, (prsByExercise.get(pr.exerciseId) ?? 0) + 1);
  const rowHeight = 96;
  const room = Math.floor((footerTop - y - 20) / rowHeight);
  const shown = summary.exercises.slice(0, Math.max(0, summary.exercises.length > room ? room - 1 : room));
  for (const exercise of shown) {
    ctx.fillStyle = colors.surface;
    ctx.beginPath();
    ctx.roundRect(pad, y, W - 2 * pad, rowHeight - 16, 20);
    ctx.fill();
    const prs = prsByExercise.get(exercise.exerciseId) ?? 0;
    ctx.fillStyle = colors.fg;
    ctx.font = `600 36px ${font}`;
    ctx.fillText(fit(exercise.name, W - 2 * pad - 360), pad + 28, y + 52);
    const best = exercise.bestSet ? s.records.set(exercise.bestSet.weight, exercise.bestSet.unit, exercise.bestSet.reps) : "";
    const right = `${s.history.sets(exercise.sets)}${best ? ` · ${best}` : ""}`;
    ctx.font = `500 30px ${numeric}`;
    ctx.fillStyle = prs > 0 ? colors.accent : colors.muted;
    const label = prs > 0 ? `${s.records.prBadge} · ${right}` : right;
    ctx.fillText(label, W - pad - 28 - ctx.measureText(label).width, y + 52);
    y += rowHeight;
  }
  if (shown.length < summary.exercises.length) {
    ctx.fillStyle = colors.muted;
    ctx.font = `500 32px ${font}`;
    ctx.fillText(`+${summary.exercises.length - shown.length}`, pad, y + 40);
  }

  ctx.fillStyle = colors.muted;
  ctx.font = `500 30px ${font}`;
  ctx.fillText(s.summary.cardFooter, pad, H - pad);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))), "image/png"),
  );
}

/** Renders a workout's share card as a PNG, with Share (when the device supports sharing files) and Download. */
export function ShareCard({ summary }: { summary: WorkoutSummary }) {
  const s = useStrings();
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void drawCard(summary, s).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setCard({ blob, url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [summary, s]);

  if (!card) return <p className="text-sm text-muted">{s.summary.preparing}</p>;

  const fileName = `workout-tracker-workout-${summary.startedAt.slice(0, 10)}.png`;
  const file = typeof File === "undefined" ? null : new File([card.blob], fileName, { type: "image/png" });
  const canShare = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });

  return (
    <section aria-label={s.summary.shareCard} className="flex flex-col gap-3">
      <img src={card.url} alt={s.summary.cardAlt} className="w-full rounded-card border border-border" />
      <div className="flex gap-2">
        {canShare && (
          <button
            type="button"
            onClick={() => void navigator.share({ files: [file!] }).catch(() => {})}
            className="flex min-h-touch flex-1 items-center justify-center rounded-control bg-accent px-4 font-medium text-accent-fg"
          >
            {s.summary.share}
          </button>
        )}
        <a
          href={card.url}
          download={fileName}
          className="flex min-h-touch flex-1 items-center justify-center rounded-control bg-surface-raised px-4 font-medium"
        >
          {s.summary.download}
        </a>
      </div>
    </section>
  );
}
