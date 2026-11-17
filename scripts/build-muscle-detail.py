"""
Assigns each free-exercise-db exercise's muscles to finer muscles by name rules,
and writes both the review list (docs/muscle-split-review.md) and the migration
that stores the result in exercises.primary_detail / secondary_detail.

  python3 scripts/build-muscle-detail.py

Re-run after changing the rules or updating vendor/free-exercise-db, and write
the migration to a NEW file (never edit an applied one): pass its path as the
first argument with --refresh (which omits the column changes), e.g.
python3 scripts/build-muscle-detail.py supabase/migrations/<timestamp>_muscle_detail_refresh.sql --refresh.
Without an argument only the review list is rewritten.
"""
import json, re, collections, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
d = json.load(open(ROOT / 'vendor/free-exercise-db/exercises.json'))
def has(n, pat): return re.search(pat, n) is not None

FD, SD, RD = "front delts", "side delts", "rear delts"
UC, MC, LC = "upper chest", "mid chest", "lower chest"
TL, TM = "triceps long head", "triceps lateral/medial"
def unsplit(m): return [f"{m} (unsplit)"], "unsplit"

def rule0(muscle, name, sec):
    n = name.lower()
    if has(n, r"stretch|circles?\b|smr|balance board|pronation|supination|wrist rotation|reverse calf raise|car drivers|arm drill|side wrist pull|chest throw"): return unsplit(muscle)
    if has(n, r"pallof|sit-up|sit up|sled push|sled drag") and muscle in ("shoulders", "chest", "triceps"): return unsplit(muscle)
    pressing = has(n, r"(?<!leg )(?<!calf )press|push-up|push up|pushup|dips?\b|bench(?! pull)|jerk|clean and press")
    if muscle == "shoulders":
        if has(n, r"front raise"): return [FD], "high"
        if has(n, r"internal rotation|pullover|chest throw|shrug"): return unsplit(muscle)
        if has(n, r"side lateral.* to front raise"): return [FD, SD], "high"
        if has(n, r"(?<!pull-up)(?<!pull up)\brear(?! pull)|reverse fl|reverse machine|back fl|external rotation|row to neck|face pull|bent.over.*(lateral|raise)|pull.apart|reverse pec|reverse butterfly|prone"): return [RD], "high"
        if sec and has(n, r"incline.*\brows?\b|incline bench pull"): return [RD, SD], "med"
        if sec and has(n, r"incline bench pull|pulldown|pull-up|pull up|rear pull"): return [RD], "med"
        if has(n, r"upright|high pull|lateral raise|crucifix|iron cross|side lateral|lateral|side raise|leaning"): return [SD], "high"
        if has(n, r"\bfront\b.*\braise|plate raise|front delt"): return [FD], "high"
        if has(n, r"halo"): return [FD, SD, RD], "med"
        if has(n, r"snatch|jammer|battling rope|circus bell|pirate ship|power partial|return push|medicine ball.*throw|ball scoop"): return [FD, SD], "med"
        if has(n, r"bent press|neck press"): return [FD, SD], "med"
        if pressing: return ([FD] if sec else [FD, SD]), "high"
        if has(n, r"raise|scaption|thruster|log lift|get-up|clean|delivery|overhead"): return [FD, SD], "med"
        if sec and has(n, r"\brows?\b|pull(?!ey)|chin|curl"): return [RD], "med"
        return unsplit(muscle)[0], "review"
    if muscle == "chest":
        if has(n, r"pullover") and not has(n, r"incline|decline"): return unsplit(muscle)
        if has(n, r"incline|low.to.high"): return [UC], "high"
        if has(n, r"decline|feet elevated|dips?\b|high.to.low|high cable|high pulley"): return [LC], "high"
        if has(n, r"bench|fly|flye|crossover|cross over|pec deck|press|push|squeeze|floor"): return [MC], "high"
        if sec: return unsplit(muscle)
        return [MC], "med"
    if muscle == "middle back":
        if sec and (has(n, r"upright|reverse band") or not has(n, r"\brows?\b|pull(?!ey)|fly|flye|reverse|chin|rack")): return unsplit("middle back")
        return ["mid back"], "high"
    if muscle == "traps":
        if has(n, r"pull apart|(?<!upright )\brows?\b") and not has(n, r"upright"): return ["mid back"], "med"
        if has(n, r"scapular|face pull|prone|reverse shrug|y raise|rhomboid"): return ["mid back"], "med"
        if has(n, r"shrug|upright"): return ["upper traps"], "high"
        if sec and not has(n, r"deadlift|clean|snatch|rack|carry|farmer|\brows?\b|pull(?!ey)"): return unsplit("traps")
        return ["upper traps"], "med"
    if muscle == "biceps":
        if has(n, r"zottman"): return ["biceps", "brachialis", "brachioradialis"], "high"
        if has(n, r"reverse grip") and has(n, r"\brows?\b|pull(?!ey)|chin"): return ["biceps"], "high"
        if has(n, r"reverse") and has(n, r"curl"): return ["brachialis", "brachioradialis"], "high"
        if has(n, r"hammer|brachialis|cross.body"): return ["brachialis", "brachioradialis"], "high"
        if sec and not has(n, r"curl|\brows?\b|pull(?!ey)|chin|lat |rack|snatch|clean|hang|rope|climb"): return unsplit("biceps")
        return ["biceps"], "high"
    if muscle == "triceps":
        if has(n, r"squat|deadlift|clean|snatch|overhead lat"): return unsplit(muscle)
        if has(n, r"seated triceps press|body-up"): return [TL], "med"
        if has(n, r"decline.*extension|overhead|skull|french|behind|incline.*extension|seated.*extension") and not has(n, r"press(?!.*down)"): return [TL], "high"
        if has(n, r"pushdown|push.down|press.down|kickback|close.grip|diamond|push.?up|bench|press|dips?|tate|pressdown|floor|jm "): return [TM], "high" if not sec else "med"
        if has(n, r"lying"): return [TL], "med"
        if has(n, r"extension"): return [TL, TM], "med"
        if sec: return unsplit(muscle)
        return unsplit(muscle)[0], "review"
    if muscle == "forearms":
        if has(n, r"pronation|supination|rotation"): return unsplit(muscle)[0], "review"
        if has(n, r"reverse.*curl"): return ["wrist extensors"], "med"
        if has(n, r"pinch|carry|farmer|hand squeeze|finger|hang|grip|towel"): return ["grip"], "med"
        if has(n, r"palms.down|(?<!band )reverse (wrist|curl|barbell|dumbbell|ez)|wrist extension|extensor"): return ["wrist extensors"], "high"
        if has(n, r"palms.up|flexor|wrist curl|wrist roller"): return ["wrist flexors"], "high"
        if sec: return ["grip"], "med" if has(n, r"deadlift|clean|chin|pull(?!ey)|\brows?\b|shrug|snatch|curl") else "review"
        return unsplit(muscle)[0], "review"
    if muscle == "glutes":
        if has(n, r"flutter|leg lift"): return unsplit(muscle)
        if has(n, r"adduct") and not has(n, r"abduct"): return unsplit(muscle)
        if has(n, r"single.leg|one.leg|one legged|pistol|one-legged"): return ["glute max", "glute medius"], "med"
        if has(n, r"lateral (bound|box|cone)|carioca"): return ["glute medius"], "med"
        if has(n, r"abduct|side leg raise|side.lying|clam|fire hydrant|band walk|monster|lateral|side lunge|crab|hip circle"): return ["glute medius"], "high"
        return ["glute max"], "high" if has(n, r"thrust|bridge|squat|deadlift|lunge|kickback|good morning|hyperext|step") else "med"
    if muscle == "abdominals":
        if has(n, r"crunch") and has(n, r"twist|side bend|oblique"): return ["abs", "obliques"], "high"
        if has(n, r"smith.*hip raise|wind sprint|sprint"): return unsplit(muscle)
        if has(n, r"side plank|side bridge"): return ["obliques", "glute medius"], "high"
        if has(n, r"bicycle|air bike|cross.body crunch|twisting crunch|v-up"): return ["abs", "obliques"], "high"
        if has(n, r"oblique|side bend|side crunch|woodchop|wood chop|russian|windmill|side plank|side bridge|side jackknife|suitcase|hay baler|pallof|lateral|renegade|torso rotation|cable lift|180|judo|sledgehammer|spell caster|rotation|twist"): return ["obliques"], "high"
        return ["abs"], "high" if has(n, r"crunch|sit.?up|leg raise|plank|rollout|knee raise|hip raise|roll") else "med"
    if muscle == "calves":
        if sec: return ["gastrocnemius"], "high" if has(n, r"calf raise") else "unsplit" if False else "review"
        if has(n, r"tibialis|peroneal|foot|balance|ankle|reverse calf|stretch|smr"): return unsplit(muscle)[0], "review"
        if has(n, r"seated"): return ["soleus"], "med"
        if has(n, r"calf raise|standing|donkey|calf press|jump|rope"): return ["gastrocnemius"], "high"
        return ["gastrocnemius"], "review"
    if muscle == "abductors" and has(n, r"abduct|monster|band walk|side leg|clam|hydrant|lateral|side.lying|hip circle|crab"):
        return ["abductors", "glute medius"], "med"
    keep = {"quadriceps": "quadriceps", "hamstrings": "hamstrings", "lats": "lats", "lower back": "lower back",
            "abductors": "abductors", "adductors": "adductors", "neck": "neck"}
    return [keep[muscle]], "kept"

# Splits the research found can't be trained apart, or aren't worth tracking apart, folded back into one muscle.
MERGE = {
    "mid chest": "chest", "lower chest": "chest",
    TL: "triceps", TM: "triceps",
    "brachialis": "biceps", "brachioradialis": "forearms",
    "wrist flexors": "forearms", "wrist extensors": "forearms", "grip": "forearms",
    "gastrocnemius": "calves", "soleus": "calves",
}

def rule(muscle, name, sec):
    fine, conf = rule0(muscle, name, sec)
    if conf == "review" and sec:
        return unsplit(muscle)
    merged = []
    for f in fine:
        f = MERGE.get(f, f)
        if f not in merged: merged.append(f)
    return merged, conf

rows = collections.defaultdict(list); stats = collections.Counter()
for e in d:
    for kind, ms in (("primary", e["primaryMuscles"]), ("secondary", e["secondaryMuscles"])):
        for m in ms:
            fine, conf = rule(m, e["name"], kind == "secondary")
            rows[m].append((e["name"], kind, fine, conf)); stats[(m, conf)] += 1
out = ["# Muscle split: proposed assignment for review", "",
 "Every free-exercise-db exercise, with each current muscle mapped to finer muscles by name rules. **Confidence:** `high` = name clearly says it; `med` = reasonable guess; `review` = no rule matched, please check or fix; `unsplit` = no hint in the name (or not a real load), left as the plain group; `kept` = group not split (see below).", "",
 "**Role** (primary/secondary) comes from free-exercise-db and is not changed here. Where the source lists a muscle that looks wrong (e.g. Bench Press with triceps primary), that stays; fix it as a custom override if it matters.", "",
 "**Conventions:** incline is upper chest; everything else that presses or flies is plain chest (mid and lower can't be told apart: both peak on a flat bench), so decline counts as chest. Triceps, forearms (wrist, grip and brachioradialis), calves (gastrocnemius and soleus) and biceps (with brachialis) are not split: the heads can't be trained apart or aren't worth tracking apart. Stretches, circles, foam rolling and balance work are left unsplit.", "",
 "To change one, edit the right-hand column.", "",
 "## Not split: quadriceps, hamstrings, lats, lower back, abductors, adductors, neck",
 "Exercise names can't tell the heads apart (a squat or leg curl loads all of them), so splitting would be made-up precision. Say if you want them split anyway.", ""]
for m in sorted(rows):
    c = collections.Counter(r[3] for r in rows[m])
    out += [f"## {m} ({len(rows[m])} entries: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())) + ")", "", "| Exercise | Role | Proposed | Confidence |", "|---|---|---|---|"]
    for name, kind, fine, conf in sorted(rows[m], key=lambda r: ({"review":0,"med":1}.get(r[3],2), r[0])):
        out.append(f"| {name} | {kind} | {', '.join(fine)} | {conf} |")
    out.append("")
open(ROOT / 'docs/muscle-split-review.md', 'w').write("\n".join(out))
for k in sorted(stats):
    if k[1] != "kept": print(k, stats[k])


# --- migration -------------------------------------------------------------
FINE_ID = {"mid back": "middle back", "upper traps": "traps", "abs": "abdominals", "glute max": "glutes"}
def fine_id(f):
    if f.endswith(" (unsplit)"): return f[: -len(" (unsplit)")]
    return FINE_ID.get(f, f)

detail = {}
for e in d:
    prim, sec = [], []
    for muscles, out_list, sec_role in ((e["primaryMuscles"], prim, False), (e["secondaryMuscles"], sec, True)):
        for m in muscles:
            fine, _ = rule(m, e["name"], sec_role)
            for f in map(fine_id, fine):
                if f not in out_list: out_list.append(f)
    sec = [f for f in sec if f not in prim]
    detail[e["id"]] = (prim, sec)

args = [a for a in sys.argv[1:] if not a.startswith("--")]
refresh = "--refresh" in sys.argv
if args:
    def arr(l): return "array[" + ",".join("'" + x + "'" for x in l) + "]::text[]"
    values = ",\n  ".join(f"('{i.replace(chr(39), chr(39) * 2)}', {arr(p)}, {arr(s_)})" for i, (p, s_) in detail.items())
    header = (
        "-- Finer muscles per exercise (delt heads, upper chest, ...), used by the muscle heatmap.\n"
        "-- Generated by scripts/build-muscle-detail.py --refresh from vendor/free-exercise-db (rules\n"
        "-- reviewed in docs/muscle-split-review.md). Replaces the earlier assignment after some splits\n"
        "-- (mid/lower chest, triceps heads, brachialis, forearm parts, gastrocnemius/soleus) were merged.\n"
        if refresh else
        "-- Finer muscles per exercise (delt heads, upper chest, ...), used by the muscle heatmap.\n"
        "-- Generated by scripts/build-muscle-detail.py from vendor/free-exercise-db (rules reviewed in\n"
        "-- docs/muscle-split-review.md). A null detail means the exercise has no finer assignment and\n"
        "-- the heatmap uses its primary_muscles / secondary_muscles as they are.\n"
        "alter table public.exercises\n  add column primary_detail text[],\n  add column secondary_detail text[];\n\n"
    )
    sql = f"""{header}update public.exercises e
set primary_detail = v.primary_detail, secondary_detail = v.secondary_detail
from (values
  {values}
) as v(source_ref, primary_detail, secondary_detail)
where e.source = 'free-exercise-db' and e.source_ref = v.source_ref;
"""
    pathlib.Path(args[0]).write_text(sql)
