#!/usr/bin/env python3
"""
Expert check of the thread-based troubleshooting items and of the LLM judge that grades them.

prep     writes, for each expert, (1) an item sheet over the sampled items, with the scenario
         first so it is judged before the thread is opened, and (2) a blind judge sheet with every
         model's answer to the same items, shuffled, with model names and judge verdicts hidden.
         The key that maps blind rows back to item and model is written separately and is not
         given to experts.
analyze  reads the returned sheets and reports item validity (pass rates with Wilson intervals,
         agreement between experts) and judge validity (agreement of the strict prompt and the
         root-cause rubric with the experts' majority verdict).

Run from the repo root:
    python qa/human_check.py prep --experts A B C
    python qa/human_check.py analyze
"""
import argparse, csv, glob, json, math, os, random, collections
from itertools import combinations

TS = "Results/Expansion/ts_threads"
SAMPLE = f"{TS}/human_check_sample.csv"
OUT = f"{TS}/human_check"
PREDS = "benchmark/results/ts_threads"
MODELS = {  # preds file slug -> name used in reports
    "meta-llama_llama-3-3-70b-instruct": "Llama 3.3 70B",
    "mistralai_mistral-small-3-1-24b-instruct-2503": "Mistral Small 3.1",
    "meta-llama_llama-4-maverick-17b-128e-instruct-fp8": "Llama 4 Maverick",
    "ibm_granite-4-h-small": "Granite 4.0 H Small",
    "mistralai_mistral-medium-2505": "Mistral Medium",
}
ITEM_COLS = ["id", "scenario", "your_guess_of_root_cause", "solvable_from_scenario(Y/N)",
             "scenario_hides_cause(Y/N)", "source_url", "reference_answer", "key_points",
             "faithful_to_thread(Y/N)", "notes"]
CRITERIA = ["solvable_from_scenario(Y/N)", "scenario_hides_cause(Y/N)", "faithful_to_thread(Y/N)"]
JUDGE_COLS = ["row", "incident", "reference_answer", "key_points", "candidate_answer",
              "correct(Y/N)", "notes"]

INSTRUCTIONS = """EXPERT CHECK OF ORBIT TROUBLESHOOTING ITEMS

Work alone. Do not discuss items with the other experts until everyone has finished.
Answer every Y/N cell with exactly Y or N. Open the CSV files in Excel or Google Sheets.

PART 1. items_<you>.csv (one row per item, about 3-5 minutes each)
Work left to right and do not open source_url until step 4.
 1. Read only the scenario. Write your own guess at the root cause in your_guess_of_root_cause.
 2. solvable_from_scenario: Y if an experienced engineer could reach the reference cause from the
    scenario alone (your guess matches it, or the scenario holds the evidence that points to it).
 3. scenario_hides_cause: N if the scenario states or strongly hints at the cause, for example by
    naming the misconfigured setting. Y otherwise.
 4. Now open source_url and read the question and the accepted answer.
 5. faithful_to_thread: Y if reference_answer and key_points say what the accepted answer says,
    with nothing invented or overstated.
 6. notes: anything off, such as "fix right but cause oversimplified" or "two plausible causes".

PART 2. judge_<you>.csv (one row per model answer, about 1-2 minutes each)
Each row is one model's answer to one of the same incidents. Rows are shuffled and the model is
hidden.
 correct: Y if the candidate's main diagnosis is the same root cause as the reference (the same
 underlying mechanism, not merely the same component) and its main fix would resolve that cause.
 It need not repeat secondary details or exact commands. N if it names a different cause, lists
 several causes without committing to the right one, is vague, or its fix would not resolve the
 cause. If the answer is right but misses something you consider essential, mark Y and say what
 in notes.

Return both files with your name in the file name unchanged.
"""


def wilson(k, n, z=1.96):
    if n == 0:
        return (float("nan"),) * 3
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return 100 * p, 100 * (c - h), 100 * (c + h)


def kappa(a, b):
    """Cohen's kappa for two lists of labels."""
    n = len(a)
    if n == 0:
        return float("nan")
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = collections.Counter(a), collections.Counter(b)
    pe = sum(ca[k] * cb[k] for k in set(a) | set(b)) / (n * n)
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)


def fleiss(rows):
    """Fleiss' kappa. rows is a list of per-item label lists, one label per rater."""
    cats = sorted({x for r in rows for x in r}); N = len(rows); m = len(rows[0])
    if N == 0 or m < 2:
        return float("nan")
    P = [(sum(r.count(c) ** 2 for c in cats) - m) / (m * (m - 1)) for r in rows]
    pj = [sum(r.count(c) for r in rows) / (N * m) for c in cats]
    pe = sum(p * p for p in pj)
    return 1.0 if pe == 1 else (sum(P) / N - pe) / (1 - pe)


def yn(v):
    v = (v or "").strip().upper()[:1]
    return v if v in ("Y", "N") else None


def write_csv(path, cols, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:  # BOM so Excel reads UTF-8
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def prep(args):
    os.makedirs(OUT, exist_ok=True)
    sample = read_csv(SAMPLE)
    ids = [r["id"] for r in sample]
    recs = {r["id"]: r for r in json.load(open(f"{TS}/ts_threads.json"))}
    rows, key = [], []
    for slug in MODELS:
        preds = {p["id"]: p for p in map(json.loads, open(f"{PREDS}/preds_WATSONX_{slug}.jsonl"))}
        for i in ids:
            rows.append((i, slug, preds[i]))
    random.Random(args.seed).shuffle(rows)
    judge_rows = []
    for n, (i, slug, p) in enumerate(rows, 1):
        r = recs[i]
        judge_rows.append({"row": f"J{n:03d}", "incident": r["question"].strip(), "reference_answer": r["answer"],
                           "key_points": r.get("solution", ""), "candidate_answer": p["raw"].strip(),
                           "correct(Y/N)": "", "notes": ""})
        key.append({"row": f"J{n:03d}", "id": i, "model": slug})
    for e in args.experts:
        write_csv(f"{OUT}/items_{e}.csv", ITEM_COLS,
                  [{**{c: s.get(c, "") for c in ITEM_COLS}, **{c: "" for c in CRITERIA}} for s in sample])
        write_csv(f"{OUT}/judge_{e}.csv", JUDGE_COLS, judge_rows)
    os.makedirs(f"{OUT}/key", exist_ok=True)
    write_csv(f"{OUT}/key/judge_key.csv", ["row", "id", "model"], key)
    open(f"{OUT}/INSTRUCTIONS.txt", "w").write(INSTRUCTIONS)
    print(f"{len(sample)} items and {len(judge_rows)} blind answers for experts {', '.join(args.experts)} -> {OUT}/")
    print(f"Send each expert INSTRUCTIONS.txt, items_<name>.csv and judge_<name>.csv. Keep {OUT}/key/ private.")


def analyze(args):
    # Item validity
    sheets = {os.path.basename(p)[6:-4]: {r["id"]: r for r in read_csv(p)} for p in sorted(glob.glob(f"{OUT}/items_*.csv"))}
    experts = [e for e, s in sheets.items() if any(yn(r[c]) for r in s.values() for c in CRITERIA)]
    print(f"ITEM VALIDITY ({len(experts)} experts with answers: {', '.join(experts) or 'none'})")
    if experts:
        ids = sorted(set.intersection(*(set(sheets[e]) for e in experts)))
        for c in CRITERIA + ["all three"]:
            lab = {e: [("Y" if all(yn(sheets[e][i][k]) == "Y" for k in CRITERIA) else "N") if c == "all three"
                       else yn(sheets[e][i][c]) for i in ids] for e in experts}
            for e in experts:
                got = [x for x in lab[e] if x]
                p, lo, hi = wilson(got.count("Y"), len(got))
                print(f"  {c:30s} {e:>8s}  {got.count('Y')}/{len(got)} = {p:.0f}% [{lo:.0f}, {hi:.0f}]")
            full = [j for j in range(len(ids)) if all(lab[e][j] for e in experts)]
            if len(experts) >= 2:
                for a, b in combinations(experts, 2):
                    print(f"  {c:30s} kappa {a}-{b} = {kappa([lab[a][j] for j in full], [lab[b][j] for j in full]):.2f}")
            if len(experts) >= 3:
                print(f"  {c:30s} Fleiss kappa = {fleiss([[lab[e][j] for e in experts] for j in full]):.2f}")
            maj = [collections.Counter(lab[e][j] for e in experts).most_common(1)[0][0] for j in full]
            p, lo, hi = wilson(maj.count("Y"), len(maj))
            print(f"  {c:30s} majority  {maj.count('Y')}/{len(maj)} = {p:.0f}% [{lo:.0f}, {hi:.0f}]  (share of GPT-audited items experts accept)")
            print()

    # Judge validity
    key = {r["row"]: r for r in read_csv(f"{OUT}/key/judge_key.csv")}
    js = {os.path.basename(p)[6:-4]: {r["row"]: yn(r["correct(Y/N)"]) for r in read_csv(p)} for p in sorted(glob.glob(f"{OUT}/judge_*.csv"))}
    jexp = [e for e, s in js.items() if any(s.values())]
    print(f"JUDGE VALIDITY ({len(jexp)} experts with answers: {', '.join(jexp) or 'none'})")
    if not jexp:
        return
    strict, rc = {}, {}
    for slug in MODELS:
        for p in map(json.loads, open(f"{PREDS}/preds_WATSONX_{slug}.jsonl")):
            strict[(p["id"], slug)] = "Y" if p["correct"] else "N"
        for p in map(json.loads, open(f"{PREDS}/rejudge_preds_WATSONX_{slug}.jsonl")):
            rc[(p["id"], slug)] = p["verdict"][:1] if p["verdict"] else None
    rows = [r for r in key if all(js[e].get(r) for e in jexp)]
    print(f"  {len(rows)} of {len(key)} answers graded by every expert")
    if len(jexp) >= 2:
        for a, b in combinations(jexp, 2):
            print(f"  experts {a}-{b}: agree {sum(js[a][r] == js[b][r] for r in rows)}/{len(rows)}, kappa {kappa([js[a][r] for r in rows], [js[b][r] for r in rows]):.2f}")
    if len(jexp) >= 3:
        print(f"  experts Fleiss kappa = {fleiss([[js[e][r] for e in jexp] for r in rows]):.2f}")
    maj = {r: collections.Counter(js[e][r] for e in jexp).most_common(1)[0][0] for r in rows}
    k = {r: (key[r]["id"], key[r]["model"]) for r in rows}
    hum = [maj[r] for r in rows]
    print(f"  experts' majority: {hum.count('Y')}/{len(hum)} correct = {100 * hum.count('Y') / len(hum):.1f}%")
    for name, v in (("strict prompt", strict), ("root-cause rubric", rc)):
        jv = [v.get(k[r]) for r in rows]
        ok = [(h, j) for h, j in zip(hum, jv) if j]
        tp = sum(h == "Y" and j == "Y" for h, j in ok); fp = sum(h == "N" and j == "Y" for h, j in ok)
        fn = sum(h == "Y" and j == "N" for h, j in ok)
        print(f"  {name:18s} accuracy {sum(h == j for h, j in ok)}/{len(ok)}, kappa {kappa(*zip(*ok)):.2f}, "
              f"judge correct {sum(j == 'Y' for _, j in ok)} vs experts {sum(h == 'Y' for h, _ in ok)}, "
              f"wrongly accepted {fp}, wrongly rejected {fn}")
    print("  per model (experts' majority / strict / root-cause, % correct):")
    for slug, name in MODELS.items():
        rr = [r for r in rows if key[r]["model"] == slug]
        if rr:
            f = lambda xs: 100 * sum(x == "Y" for x in xs) / len(xs)
            print(f"    {name:20s} n={len(rr):3d}  {f([maj[r] for r in rr]):5.1f} / {f([strict[k[r]] for r in rr]):5.1f} / {f([rc.get(k[r]) for r in rr]):5.1f}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prep"); p.add_argument("--experts", nargs="+", default=["A", "B", "C"]); p.add_argument("--seed", type=int, default=11)
    sub.add_parser("analyze")
    args = ap.parse_args()
    (prep if args.cmd == "prep" else analyze)(args)


if __name__ == "__main__":
    main()
