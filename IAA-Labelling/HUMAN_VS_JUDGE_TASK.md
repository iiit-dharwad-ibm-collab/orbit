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
You will **not** see which model wrote the answer or what the automatic judge scored it — on
purpose, so your rating is unbiased.

## The 1-5 rubric
| Score | Meaning |
|---|---|
| **5** | Fully correct - identifies the specific root cause / fix / value; complete and accurate. |
| **4** | Mostly correct - right answer with minor omissions or imprecision. |
| **3** | Partially correct - on the right track but missing key elements, or partly wrong. |
| **2** | Mostly incorrect - largely wrong; only tangentially related. |
| **1** | Incorrect - wrong, vague, evasive, or off-topic. |

Tip: compare the model's answer to the **reference solution**. Same conclusion for the right
reasons → 5. Confidently wrong or dodges the question → 1-2.

## How to do it
1. Open the app link the team shares (it runs on Streamlit Cloud — nothing to install).
2. Type **your name** in the sidebar → **Begin / continue**.
3. For each item: read it, pick a score (1-5), optionally add a note, click **Save score and go
   to next**.
4. **IMPORTANT — your work lives in your browser only.** Click **"⬇ Download my annotations"**
   in the sidebar **regularly** (and definitely before you close the tab). It saves a file like
   `orbit_grades_<yourname>.json`.
5. To take a break and resume later: come back, and in the sidebar **upload the file you
   downloaded** — it restores your progress. Then keep going.
6. When you finish all 120, click **Download my annotations** one last time and **send the file
   to the maintainer**.

Please grade **all 120** if you can; at least **two** people must grade every item.

That's the whole task. ~120 short reads. Thank you!

---

### For the maintainer (not the annotators)
- **No database needed** — the app reads `response_annotation_set.json` (bundled in the repo) and
  each annotator downloads their own results JSON. Deploys to share.streamlit.io with no secrets.
- Rebuild the 120-item set: `python build_response_set.py --per-model-per-type 12`
  (60 open-ended + 60 troubleshooting, 5 models x 12 each; judge verdict held out for blindness).
- The same 120 responses must also be scored by the LLM judge on the 1-5 scale, keyed by the same
  `response_id` (`model::question_id`), saved as `judge_scores.json`.
- Collect everyone's downloaded JSON files into a folder, then:
  `python compute_judge_human_agreement.py --human-dir ./collected --judge judge_scores.json`
  → human-vs-judge agreement (weighted Cohen's kappa, exact/+-1 %, Spearman) + human-vs-human.
  Those numbers go in the paper's Internal-Validity discussion.
