#!/usr/bin/env python3
"""
Compute human-vs-judge agreement (the number the reviewer asked for) once annotators have
graded the 120 responses in the Streamlit app.

Inputs:
  - human scores: pulled from the response_scores DB table (export_response_scores)
  - judge scores: --judge judge_scores.json  ->  {response_id: <1-5 int>} from the LLM-judge run
                  (response_id must match: "model::question_id")

Outputs (printed):
  - Human consensus (mean) vs judge: weighted Cohen's kappa, exact %, within-+-1 %, Spearman rho
  - Human-vs-human: weighted kappa + exact % (the reliability ceiling)
  - Coverage (how many response_ids matched between humans and judge)

Pure-Python (no scipy/sklearn needed).
"""
import argparse, json, collections, itertools, math


def weighted_kappa(x, y, k=5):
    """Quadratic-weighted Cohen's kappa for ordinal ratings in 1..k."""
    n = len(x)
    if n == 0:
        return float("nan")
    O = [[0] * k for _ in range(k)]
    for a, b in zip(x, y):
        O[a - 1][b - 1] += 1
    rx = [sum(O[i]) for i in range(k)]
    cy = [sum(O[i][j] for i in range(k)) for j in range(k)]
    W = [[((i - j) ** 2) / ((k - 1) ** 2) for j in range(k)] for i in range(k)]
    num = sum(W[i][j] * O[i][j] for i in range(k) for j in range(k))
    den = sum(W[i][j] * rx[i] * cy[j] / n for i in range(k) for j in range(k))
    return 1 - num / den if den else float("nan")


def exact_pct(x, y):
    return 100 * sum(a == b for a, b in zip(x, y)) / len(x) if x else float("nan")


def within1_pct(x, y):
    return 100 * sum(abs(a - b) <= 1 for a, b in zip(x, y)) / len(x) if x else float("nan")


def spearman(x, y):
    def rank(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(v):
            j = i
            while j + 1 < len(v) and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for t in range(i, j + 1):
                r[order[t]] = avg
            i = j + 1
        return r
    rx, ry = rank(x), rank(y)
    n = len(x)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    vy = math.sqrt(sum((b - my) ** 2 for b in ry))
    return cov / (vx * vy) if vx and vy else float("nan")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--judge", required=True, help="judge_scores.json: {response_id: 1-5}")
    args = ap.parse_args()
    from db import export_response_scores  # needs DATABASE_URL

    # human scores: {response_id: {annotator: score}}
    human = collections.defaultdict(dict)
    for response_id, annotator, score, notes, _ in export_response_scores():
        human[response_id][annotator] = int(score)
    judge = {k: int(round(v)) for k, v in json.load(open(args.judge)).items()}

    # human consensus = rounded mean across annotators
    matched = [rid for rid in human if rid in judge]
    h_cons = [int(round(sum(human[r].values()) / len(human[r]))) for r in matched]
    j_vals = [judge[r] for r in matched]

    print(f"Coverage: {len(matched)} responses graded by humans AND judge "
          f"(humans: {len(human)}, judge: {len(judge)})")
    annotators = sorted({a for d in human.values() for a in d})
    print(f"Annotators: {len(annotators)} ({', '.join(annotators)})\n")

    print("=== Human consensus vs. LLM judge ===")
    print(f"  Weighted Cohen's kappa : {weighted_kappa(h_cons, j_vals):.3f}")
    print(f"  Exact agreement        : {exact_pct(h_cons, j_vals):.1f}%")
    print(f"  Within +-1 agreement   : {within1_pct(h_cons, j_vals):.1f}%")
    print(f"  Spearman rho           : {spearman(h_cons, j_vals):.3f}")

    # human-vs-human ceiling (all annotator pairs, on commonly graded items)
    print("\n=== Human vs. human (reliability ceiling) ===")
    for a1, a2 in itertools.combinations(annotators, 2):
        common = [r for r in human if a1 in human[r] and a2 in human[r]]
        if len(common) < 5:
            continue
        x = [human[r][a1] for r in common]; y = [human[r][a2] for r in common]
        print(f"  {a1} vs {a2} (n={len(common)}): weighted kappa {weighted_kappa(x, y):.3f}, "
              f"exact {exact_pct(x, y):.0f}%")


if __name__ == "__main__":
    main()
