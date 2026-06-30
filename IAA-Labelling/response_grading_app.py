"""
ORBIT human-vs-judge response grading.

Each annotator scores model RESPONSES to open-ended / troubleshooting questions on a 1-5
quality rubric --- the SAME rubric the automatic LLM judge uses --- WITHOUT seeing the model's
name or the judge's score (blind). Their scores are compared against the LLM judge afterwards
to report judge-human agreement.

Run:  streamlit run response_grading_app.py
Needs: response_annotation_set.json (built by build_response_set.py) and DATABASE_URL in .env.
"""
import json
import random
from datetime import datetime
from pathlib import Path

import os
import streamlit as st

# On Streamlit Community Cloud, DATABASE_URL is set in the Secrets manager; bridge it into the
# environment so db.py (which reads os.getenv) works without a local .env.
try:
    if not os.getenv("DATABASE_URL") and "DATABASE_URL" in st.secrets:
        os.environ["DATABASE_URL"] = st.secrets["DATABASE_URL"]
except Exception:
    pass

from db import init_response_db, save_response_score, fetch_response_scores, fetch_response_score_summary

st.set_page_config(page_title="ORBIT Response Grading", layout="wide")
DATA_PATH = Path(__file__).parent / "response_annotation_set.json"

RUBRIC = {
    5: "Fully correct - identifies the specific root cause / fix / value; complete and accurate.",
    4: "Mostly correct - right answer with minor omissions or imprecision.",
    3: "Partially correct - on the right track but missing key elements, or partly wrong.",
    2: "Mostly incorrect - largely wrong; only tangentially related to the correct answer.",
    1: "Incorrect - wrong, vague, evasive, or off-topic.",
}


@st.cache_data(show_spinner=False)
def load_items():
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


init_response_db()
st.title("ORBIT - Response Grading (Human vs. Judge)")

# ---- login ----
if "annotator" not in st.session_state:
    st.session_state.annotator = ""
if "idx" not in st.session_state:
    st.session_state.idx = 0
if "order" not in st.session_state:
    st.session_state.order = []

with st.sidebar:
    st.header("Annotator login")
    name = st.text_input("Your name", value=st.session_state.annotator)
    if st.button("Start") and name.strip():
        st.session_state.annotator = name.strip()
    st.caption("Name-only login. Your scores are saved under this name.")

if not st.session_state.annotator:
    st.info("Enter your name in the sidebar to begin.")
    st.markdown(
        "**What to do:** You will see a question and one AI model's answer to it. "
        "Read the reference answer, then rate how good the model's answer is on a **1-5** scale "
        "using the rubric. You will *not* see which model wrote it or the automatic judge's score "
        "- that keeps your rating unbiased."
    )
    st.stop()

annotator = st.session_state.annotator
items = load_items()
saved = fetch_response_scores(annotator)

# per-annotator stable shuffle
key = f"{annotator}:{len(items)}"
if len(st.session_state.order) != len(items) or st.session_state.get("order_key") != key:
    rng = random.Random(key)
    order = list(range(len(items)))
    rng.shuffle(order)
    st.session_state.order = order
    st.session_state.order_key = key
    st.session_state.idx = 0

# ---- progress ----
done = len(saved)
c1, c2, c3 = st.columns(3)
c1.metric("Responses to grade", len(items))
c2.metric("You have graded", done)
c3.metric("Remaining", max(len(items) - done, 0))

st.sidebar.markdown(f"**Active:** {annotator}")
st.sidebar.markdown("### Rubric")
for s in (5, 4, 3, 2, 1):
    st.sidebar.markdown(f"**{s}** - {RUBRIC[s]}")
with st.sidebar.expander("All annotators' progress"):
    for row in fetch_response_score_summary():
        st.write(f"{row[0]}: {row[1]} graded (mean {row[2]})")

# ---- navigation ----
pos = st.session_state.idx
n = len(items)
nav1, nav2, nav3 = st.columns([1, 2, 1])
with nav1:
    if st.button("Previous") and pos > 0:
        st.session_state.idx -= 1; st.rerun()
with nav3:
    if st.button("Next") and pos < n - 1:
        st.session_state.idx += 1; st.rerun()
with nav2:
    # jump to first ungraded
    if st.button("Skip to next ungraded"):
        for off in range(1, n + 1):
            j = (pos + off) % n
            if items[st.session_state.order[j]]["response_id"] not in saved:
                st.session_state.idx = j; break
        st.rerun()

item = items[st.session_state.order[pos]]
rid = item["response_id"]
graded_badge = " :white_check_mark: graded" if rid in saved else ""
st.markdown(f"**Response {pos + 1} of {n}**  ({item['qtype_label']}){graded_badge}")

# ---- the task (blind: no model name, no judge score) ----
st.markdown("#### Question")
st.write(item["question"])

with st.expander("Reference answer & solution (what a correct answer looks like)", expanded=True):
    if item.get("reference_answer"):
        st.markdown(f"**Reference answer:** {item['reference_answer']}")
    if item.get("reference_solution"):
        st.markdown("**Reference solution:**")
        st.write(item["reference_solution"])

st.markdown("#### Model's answer (grade this)")
st.info(item["response"])

# ---- scoring form ----
prev = saved.get(rid, {})
with st.form(key=f"score-{rid}"):
    score = st.radio(
        "How good is the model's answer? (1-5)",
        options=[5, 4, 3, 2, 1],
        format_func=lambda s: f"{s} - {RUBRIC[s]}",
        index=([5, 4, 3, 2, 1].index(prev["score"]) if prev.get("score") in (1, 2, 3, 4, 5) else 2),
    )
    notes = st.text_area("Notes (optional)", value=prev.get("notes", ""), height=70)
    submitted = st.form_submit_button("Save score and go to next")

if submitted:
    save_response_score(rid, annotator, int(score), notes)
    st.success(f"Saved score {score}.")
    # advance to next ungraded
    saved[rid] = {"score": int(score), "notes": notes}
    for off in range(1, n + 1):
        j = (pos + off) % n
        if items[st.session_state.order[j]]["response_id"] not in saved:
            st.session_state.idx = j; break
    st.rerun()
