import { Disclosure } from "@/components/ui/disclosure";
import { Field, Select, TextInput } from "@/components/ui/field";
import { EQUIPMENT, MUSCLES } from "@/domain/exercise";
import { useStrings } from "@/strings/provider";

function MusclePicker({ name, legend, hideLegend = false }: { name: string; legend: string; hideLegend?: boolean }) {
  const s = useStrings();
  return (
    <fieldset>
      <legend className={hideLegend ? "sr-only" : "mb-1.5 text-sm text-muted"}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {MUSCLES.map((m) => (
          <label
            key={m}
            className="flex min-h-touch cursor-pointer items-center rounded-control border border-border-strong px-3 text-sm has-checked:border-accent has-checked:bg-accent has-checked:text-accent-fg"
          >
            <input type="checkbox" name={name} value={m} className="sr-only" />
            {s.muscles[m]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The name, muscles and equipment of a custom exercise. Its form's submit and error live with the caller. */
export function CustomExerciseFields({ defaultName }: { defaultName?: string }) {
  const s = useStrings();
  return (
    <>
      <Field label={s.customExercise.name}>
        <TextInput
          name="name"
          required
          maxLength={120}
          defaultValue={defaultName}
          placeholder={s.customExercise.namePlaceholder}
        />
      </Field>
      <MusclePicker name="primaryMuscles" legend={s.customExercise.primaryMuscles} />
      <Disclosure summary={s.customExercise.secondaryMuscles}>
        <MusclePicker name="secondaryMuscles" legend={s.customExercise.secondaryMuscles} hideLegend />
      </Disclosure>
      <Field label={s.customExercise.equipment}>
        <Select name="equipment" defaultValue="">
          <option value="">{s.customExercise.noEquipment}</option>
          {EQUIPMENT.map((e) => (
            <option key={e} value={e}>
              {s.equipment[e]}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
