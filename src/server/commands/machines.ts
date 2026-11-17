import { z } from "zod";
import type { Gym, Machine } from "@/domain/workout";
import { defineCommand } from "./define";

/** Every machine, by exercise: the logger ships this once so its pickers work offline. */
export const listMachines = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    const rows = await tx<{ id: string; exercise_id: string; gym_id: string | null; name: string; notes: string | null }[]>`
      select id, exercise_id, gym_id, name, notes from public.machines order by lower(name), created_at`;
    const machines: Machine[] = rows.map((r) => ({
      id: r.id,
      exerciseId: r.exercise_id,
      gymId: r.gym_id,
      name: r.name,
      notes: r.notes,
    }));
    return { machines };
  },
});

/** Every gym, by name, and the one the last finished workout was done at (new workouts start there). */
export const listGyms = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    const rows = await tx<{ id: string; name: string }[]>`
      select id, name from public.gyms order by lower(name), created_at`;
    const [last] = await tx<{ gym_id: string | null }[]>`
      select gym_id from public.workouts
      where finished_at is not null and discarded_at is null
      order by finished_at desc limit 1`;
    const gyms: Gym[] = rows.map((r) => ({ id: r.id, name: r.name }));
    return { gyms, lastGymId: last?.gym_id ?? null };
  },
});
