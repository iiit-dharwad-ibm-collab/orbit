# Annotation Task: Grade AI Answers (Human-vs-Judge Study)

## Why we're doing this (1 paragraph)
A reviewer asked us to prove that our **automatic LLM judge** scores open-ended/troubleshooting
answers the way **humans** would. To show that, a few of us will grade the *same* 120 AI answers
the judge graded, using the *same* rubric. We then compare the two. That's it.

## What you'll do
You'll see **120 items**. Each item shows:
1. a **question**,
2. the **reference answer / solution** (what a correct answer looks like), and
3. **one AI model's answer** to that question.

Your job: read the model's answer and give it a score from **1 to 5** for how good it is.

You will **not** see which model wrote the answer or what the automatic judge scored it — this is
on purpose, so your rating is unbiased.

## The 1-5 rubric
| Score | Meaning |
|---|---|
| **5** | Fully correct - identifies the specific root cause / fix / value; complete and accurate. |
| **4** | Mostly correct - right answer with minor omissions or imprecision. |
| **3** | Partially correct - on the right track but missing key elements, or partly wrong. |
| **2** | Mostly incorrect - largely wrong; only tangentially related. |
| **1** | Incorrect - wrong, vague, evasive, or off-topic. |

Tip: compare the model's answer to the **reference solution**. If it reaches the same conclusion
for the right reasons → 5. If it's confidently wrong or dodges the question → 1-2.

## How to do it (5 minutes to start)
1. Open the grading app (link shared by the team), or run locally:
   `streamlit run response_grading_app.py`
2. Type **your name** in the sidebar and click **Start**.
3. For each item: read it, pick a score (1-5), optionally add a note, click **Save**.
   The app jumps you to the next item and remembers what you've done — you can stop and resume.
4. Please grade **all 120** if you can. At least **two** people must grade every item.

That's the whole task. ~120 short reads. Thank you!

---

### For the maintainer (not the annotators)
- Build/refresh the 120-item set: `python build_response_set.py --per-model-per-type 12`
  (60 open-ended + 60 troubleshooting, 5 models x 12 each; the judge's verdict is deliberately
  excluded so grading is blind).
- The same 120 responses must also be scored by the LLM judge on the 1-5 scale, keyed by the
  same `response_id` (`model::question_id`), saved as `judge_scores.json`.
- After annotation: `python compute_judge_human_agreement.py --judge judge_scores.json`
  reports human-vs-judge agreement (weighted Cohen's kappa, exact/+-1 %, Spearman) and
  human-vs-human agreement. Those numbers go in the paper's Internal-Validity discussion.
