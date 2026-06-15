#!/usr/bin/env python3
"""
Combine all results/summary_*.json (one per model) into a comparison table and
emit paste-ready LaTeX rows for Table~\\ref{tab:main_results} in the paper.

  python aggregate_results.py
"""
import json
from pathlib import Path

RES = Path(__file__).resolve().parent / "results"


def pct(x):
    return f"{100 * x:.1f}" if isinstance(x, (int, float)) else "--"


def main():
    summaries = sorted(RES.glob("summary_*.json"))
    if not summaries:
        print("No results/summary_*.json yet. Run run_benchmark.py first.")
        return
    rows = [json.loads(p.read_text()) for p in summaries]

    print(f"{'model':38s} {'MCQ':>6} {'open':>6} {'trbl':>6} {'overall':>8} {'n':>6} {'err':>4}")
    print("-" * 76)
    for s in rows:
        bq = s["by_qtype"]
        print(f"{s['model'][:38]:38s} "
              f"{pct(bq.get('mcq', {}).get('acc')):>6} "
              f"{pct(bq.get('open', {}).get('acc')):>6} "
              f"{pct(bq.get('troubleshooting', {}).get('acc')):>6} "
              f"{pct(s['overall_acc']):>8} {s['n']:>6} {s.get('errors', 0):>4}")

    print("\n% LaTeX rows for tab:main_results (paste in, replacing the \\fillme cells):")
    for s in rows:
        bq = s["by_qtype"]
        print(f"{s['model']} & {pct(bq.get('mcq', {}).get('acc'))} & "
              f"{pct(bq.get('open', {}).get('acc'))} & "
              f"{pct(bq.get('troubleshooting', {}).get('acc'))} & "
              f"{pct(s['overall_acc'])} \\\\")


if __name__ == "__main__":
    main()
