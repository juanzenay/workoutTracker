"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Button, linkButtonClass } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { PROGRESSION_RULES, WEEKDAYS, type ProgressionRule, type Weekday } from "@/domain/block";
import { formatRepTarget, parseRepTarget, type Routine } from "@/domain/routine";
import type { WeightUnit } from "@/domain/workout";
import type { StoredBlock } from "@/server/commands/blocks";
import { useStrings } from "@/strings/provider";
import { ExercisePicker, type CatalogueEntry } from "../../workout/workout-logger";
import { createBlock, updateDraftBlock, type BlockDraft } from "../actions";

/** Editor rows hold text as typed; parsed on save. `key` is a local React key only. */
interface DraftExercise {
  key: string;
  exerciseId: string;
  sets: string;
  reps: string;
  startWeight: string;
  unit: WeightUnit;
  rule: ProgressionRule;
  /** Set ramp target, as typed (rule "ramp" only). */
  rampTo: string;
}

interface DraftSession {
  key: string;
  name: string;
  weekday: Weekday;
  exercises: DraftExercise[];
}

const key = () => crypto.randomUUID();

/** Next Monday (today if it is Monday), as YYYY-MM-DD in the device's zone. */
function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const newExercise = (exerciseId: string): DraftExercise => ({
  key: key(),
  exerciseId,
  sets: "3",
  reps: "10–15",
  startWeight: "",
  unit: "lb",
  rule: "double",
  rampTo: "",
});

/** A routine's exercises as block rows: set count, the first working set's rep target and weight. */
function fromRoutine(routine: Routine): DraftExercise[] {
  return routine.exercises.map((exercise) => {
    const working = exercise.sets.filter((set) => set.setType !== "warmup");
    const first = working[0];
    return {
      ...newExercise(exercise.exerciseId),
      sets: String(Math.max(1, working.length)),
      reps: (first && formatRepTarget(first)) || "10–15",
      startWeight: first?.weight == null ? "" : String(first.weight),
      unit: first?.unit ?? "lb",
    };
  });
}

/** A saved (draft) block's sessions as editor rows. */
function fromBlock(block: StoredBlock): DraftSession[] {
  return block.sessions.map((session) => ({
    key: key(),
    name: session.name,
    weekday: session.weekday,
    exercises: session.exercises.map((e) => ({
      key: key(),
      exerciseId: e.exerciseId,
      sets: String(e.sets),
      reps: formatRepTarget({ reps: null, repRangeStart: e.repRangeStart, repRangeEnd: e.repRangeEnd }),
      startWeight: e.startWeight === null ? "" : String(e.startWeight),
      unit: e.unit,
      rule: e.rule,
      rampTo: e.rampTo == null ? "" : String(e.rampTo),
    })),
  }));
}

function toNumber(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  return trimmed === "" ? null : Number(trimmed);
}

/** Default deload placement: the block's last week, for blocks of 4+ weeks. */
const defaultDeloads = (weeks: number) => (weeks >= 4 ? [weeks] : []);

function toPayload(
  name: string,
  startDate: string,
  weeks: string,
  deloadWeeks: number[],
  sessions: DraftSession[],
  initial?: StoredBlock,
): BlockDraft | null {
  const out: BlockDraft = {
    name,
    startDate,
    weeks: Number(weeks),
    timeZone: initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    notes: initial?.notes ?? null,
    deloadWeeks: deloadWeeks.filter((w) => w <= Number(weeks)),
    sessions: [],
  };
  for (const session of sessions) {
    const exercises = [];
    for (const e of session.exercises) {
      const target = parseRepTarget(e.reps);
      const start = target?.repRangeStart ?? target?.reps;
      const end = target?.repRangeEnd ?? target?.reps;
      if (start == null || end == null) return null;
      exercises.push({
        exerciseId: e.exerciseId,
        sets: Number(e.sets),
        repRangeStart: start,
        repRangeEnd: end,
        startWeight: toNumber(e.startWeight),
        unit: e.unit,
        rule: e.rule,
        rampTo: e.rule === "ramp" ? toNumber(e.rampTo) : null,
      });
    }
    out.sessions.push({ name: session.name, weekday: session.weekday, exercises });
  }
  return out;
}

/**
 * The block designer: designs a new block (started right away, or saved as a
 * draft), or edits a draft block (`initial`, e.g. one the coach drafted).
 */
export function BlockEditor({
  catalogue,
  routines,
  initial,
}: {
  catalogue: CatalogueEntry[];
  routines: Routine[];
  initial?: StoredBlock;
}) {
  const s = useStrings();
  // Exercises created from the picker this visit: the catalogue shipped with the page predates them.
  const [created, setCreated] = useState<CatalogueEntry[]>([]);
  const entries = useMemo(() => [...catalogue, ...created], [catalogue, created]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const [name, setName] = useState(initial?.name ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? nextMonday);
  const [weeks, setWeeks] = useState(initial ? String(initial.weeks) : "6");
  /** Weeks the owner ticked as deloads; null = not touched yet (default placement). */
  const [deloadChoice, setDeloadChoice] = useState<number[] | null>(initial?.deloadWeeks ?? null);
  const weekCount = Math.min(52, Math.max(0, Math.floor(Number(weeks)) || 0));
  const deloadWeeks = deloadChoice ?? defaultDeloads(weekCount);
  const [sessions, setSessions] = useState<DraftSession[]>(() =>
    initial ? fromBlock(initial) : [{ key: key(), name: "", weekday: 1, exercises: [] }],
  );
  const [error, setError] = useState(false);
  const [saving, startSaving] = useTransition();

  const updateSession = (k: string, fn: (session: DraftSession) => DraftSession) =>
    setSessions((all) => all.map((x) => (x.key === k ? fn(x) : x)));
  const updateExercise = (sk: string, ek: string, patch: Partial<DraftExercise>) =>
    updateSession(sk, (x) => ({ ...x, exercises: x.exercises.map((e) => (e.key === ek ? { ...e, ...patch } : e)) }));
  const addExercise = (sk: string, exerciseId: string) =>
    updateSession(sk, (x) => ({ ...x, exercises: [...x.exercises, newExercise(exerciseId)] }));

  const submit = (asDraft: boolean) => {
    const payload = toPayload(name, startDate, weeks, deloadWeeks, sessions, initial);
    if (!payload) {
      setError(true);
      return;
    }
    startSaving(async () => {
      const result = initial ? await updateDraftBlock(initial.id, payload) : await createBlock(payload, { asDraft });
      setError(result?.error === "invalid");
    });
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <h1 className="text-2xl font-semibold">{initial ? s.blocks.editorTitleDraft : s.blocks.editorTitle}</h1>
      <Field label={s.blocks.name}>
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={s.blocks.namePlaceholder}
          maxLength={120}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={s.blocks.startDate}>
          <TextInput
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            suppressHydrationWarning
          />
        </Field>
        <Field label={s.blocks.weeks}>
          <TextInput inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
        </Field>
      </div>

      {weekCount > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm text-muted">{s.blocks.deloadWeeks}</legend>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: weekCount }, (_, i) => i + 1).map((week) => (
              <label
                key={week}
                className="flex min-h-touch items-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={deloadWeeks.includes(week)}
                  onChange={(e) =>
                    setDeloadChoice(e.target.checked ? [...deloadWeeks, week] : deloadWeeks.filter((w) => w !== week))
                  }
                />
                {s.blocks.week(week)}
              </label>
            ))}
          </div>
          <span className="text-xs text-muted">{s.blocks.deloadWeeksHint}</span>
        </fieldset>
      )}

      <h2 className="font-semibold text-muted">{s.blocks.sessions}</h2>
      {sessions.map((session, index) => (
        <section
          key={session.key}
          aria-label={s.blocks.sessionLabel(index + 1)}
          className="flex flex-col gap-2 rounded-card bg-surface p-3"
        >
          <div className="grid grid-cols-[1fr_8rem_2.75rem] items-end gap-2">
            <Field label={s.blocks.sessionName}>
              <TextInput
                value={session.name}
                placeholder={s.blocks.sessionNamePlaceholder}
                maxLength={120}
                onChange={(e) => updateSession(session.key, (x) => ({ ...x, name: e.target.value }))}
              />
            </Field>
            <Field label={s.blocks.weekday}>
              <Select
                value={session.weekday}
                onChange={(e) =>
                  updateSession(session.key, (x) => ({ ...x, weekday: Number(e.target.value) as Weekday }))
                }
              >
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {s.weekdays[d]}
                  </option>
                ))}
              </Select>
            </Field>
            <button
              type="button"
              aria-label={s.blocks.removeSession(session.name)}
              disabled={sessions.length === 1}
              onClick={() => setSessions((all) => all.filter((x) => x.key !== session.key))}
              className="min-h-touch text-muted disabled:opacity-30"
            >
              ✕
            </button>
          </div>
          {routines.length > 0 && (
            <Field label={s.blocks.fromRoutine}>
              <Select
                value=""
                onChange={(e) => {
                  const routine = routines.find((r) => r.id === e.target.value);
                  if (routine)
                    updateSession(session.key, (x) => ({
                      ...x,
                      name: x.name || routine.name,
                      exercises: fromRoutine(routine),
                    }));
                }}
              >
                <option value="">{s.blocks.fromRoutineNone}</option>
                {routines.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {session.exercises.length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_5rem_2.75rem] items-center gap-2 text-xs uppercase text-muted">
              <span />
              <span className="text-center">{s.blocks.sets}</span>
              <span className="text-center">{s.blocks.repRange}</span>
              <span className="text-center">{s.blocks.startWeight("lb")}</span>
              <span />
            </div>
          )}
          {session.exercises.map((exercise) => {
            const exerciseName = byId.get(exercise.exerciseId)?.name ?? exercise.exerciseId;
            return (
              <div key={exercise.key} role="group" aria-label={exerciseName} className="flex flex-col gap-1">
                <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_5rem_2.75rem] items-center gap-2">
                  <span className="line-clamp-2 font-medium text-accent-text">{exerciseName}</span>
                  <TextInput
                    aria-label={s.blocks.sets}
                    inputMode="numeric"
                    value={exercise.sets}
                    onChange={(e) => updateExercise(session.key, exercise.key, { sets: e.target.value })}
                    className="px-1 text-center font-numeric"
                  />
                  <TextInput
                    aria-label={s.blocks.repRange}
                    value={exercise.reps}
                    onChange={(e) => updateExercise(session.key, exercise.key, { reps: e.target.value })}
                    className="px-1 text-center font-numeric"
                  />
                  <TextInput
                    aria-label={s.blocks.startWeight(exercise.unit)}
                    inputMode="decimal"
                    value={exercise.startWeight}
                    onChange={(e) => updateExercise(session.key, exercise.key, { startWeight: e.target.value })}
                    className="px-1 text-center font-numeric"
                  />
                  <button
                    type="button"
                    aria-label={s.workout.removeExercise}
                    onClick={() =>
                      updateSession(session.key, (x) => ({
                        ...x,
                        exercises: x.exercises.filter((e) => e.key !== exercise.key),
                      }))
                    }
                    className="min-h-touch text-muted"
                  >
                    ✕
                  </button>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2">
                  <Select
                    aria-label={s.blocks.rule}
                    value={exercise.rule}
                    onChange={(e) =>
                      updateExercise(session.key, exercise.key, { rule: e.target.value as ProgressionRule })
                    }
                    className="text-sm"
                  >
                    {PROGRESSION_RULES.map((rule) => (
                      <option key={rule} value={rule}>
                        {s.blocks.rules[rule]}
                      </option>
                    ))}
                  </Select>
                  {exercise.rule === "ramp" && (
                    <TextInput
                      aria-label={s.blocks.rampTo}
                      placeholder={s.blocks.rampTo}
                      inputMode="numeric"
                      value={exercise.rampTo}
                      onChange={(e) => updateExercise(session.key, exercise.key, { rampTo: e.target.value })}
                      className="px-1 text-center text-sm font-numeric"
                    />
                  )}
                </div>
              </div>
            );
          })}
          <ExercisePicker
            catalogue={entries}
            onPick={(exerciseId) => addExercise(session.key, exerciseId)}
            onCreated={(exercise) => {
              setCreated((all) => [...all, exercise]);
              addExercise(session.key, exercise.id);
            }}
          />
        </section>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          setSessions((all) => [
            ...all,
            { key: key(), name: "", weekday: (((all.at(-1)?.weekday ?? 0) % 7) + 1) as Weekday, exercises: [] },
          ])
        }
      >
        + {s.blocks.addSession}
      </Button>

      {error && (
        <p role="alert" className="text-danger">
          {s.blocks.invalid}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button className="min-h-touch-lg w-full" disabled={saving} onClick={() => submit(false)}>
          {initial ? s.blocks.saveDraft : s.blocks.save}
        </Button>
        <div className="flex gap-2">
          {!initial && (
            <Button variant="secondary" className="min-h-touch-lg flex-1" disabled={saving} onClick={() => submit(true)}>
              {s.blocks.saveAsDraft}
            </Button>
          )}
          <Link
            href={initial ? `/blocks/${initial.id}` : "/blocks"}
            className={linkButtonClass("ghost", "min-h-touch-lg flex-1")}
          >
            {s.blocks.cancel}
          </Link>
        </div>
      </div>
    </div>
  );
}
