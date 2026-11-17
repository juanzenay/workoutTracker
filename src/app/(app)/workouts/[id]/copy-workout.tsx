"use client";

import { useMemo } from "react";
import { CopyWorkoutButton } from "@/components/copy-workout-button";
import type { Workout } from "@/domain/workout";
import { workoutPlainText } from "@/domain/workout-text";
import { getStrings } from "@/strings";

/** A past workout's paste-ready copy action. Formats it as the finish screen does: standard pack, viewer's time zone. */
export function CopyWorkout({ workout, names }: { workout: Workout & { finishedAt: string }; names: Record<string, string> }) {
  const text = useMemo(
    () =>
      workoutPlainText(
        workout,
        new Map(Object.entries(names)),
        getStrings(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    [workout, names],
  );

  return <CopyWorkoutButton text={text} />;
}
