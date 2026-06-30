"""
ORBIT human-vs-judge response grading -- backend-free (works on share.streamlit.io).

Each annotator scores model RESPONSES to open-ended / troubleshooting questions on a 1-5
quality rubric -- the SAME rubric the automatic LLM judge uses -- WITHOUT seeing the model's
name or the judge's score (blind). Their scores are compared against the LLM judge afterwards.

No database: scores live in the browser session and are saved by clicking "Download my
annotations". To resume later, upload the file you downloaded. The maintainer collects everyone's
JSON files and runs compute_judge_human_agreement.py.

Run:  streamlit run response_grading_app.py
Needs only: response_annotation_set.json (bundled in this folder).
"""
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import streamlit as st

st.set_page_config(page_title="ORBIT Response Grading", layout="wide")
DATA_PATH = Path(__file__).parent / "response_annotation_set.json"

RUBRIC = {
    5: "Fully correct - identifies the specific root cause / fix / value; complete and accurate.",
    4: "Mostly correct - right answer with minor omissions or imprecision.",
    3: "Partially correct - on the right track but missing key elements, or partly wrong.",
    2: "Mostly incorrect - largely wrong; only tangentially related.",
    1: "Incorrect - wrong, vague, evasive, or off-topic.",
}


@st.cache_data(show_spinner=False)
def load_items():
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


st.title("ORBIT - Response Grading (Human vs. Judge)")

# ---- state ----
st.session_state.setdefault("annotator", "")
st.session_state.setdefault("scores", {})        # response_id -> {"score": int, "notes": str}
st.session_state.setdefault("idx", 0)
st.session_state.setdefault("order", [])

# ---- login / resume ----
with st.sidebar:
    st.header("Start")
    name = st.text_input("Your name", value=st.session_state.annotator)
    if st.button("Begin / continue") and name.strip():
        st.session_state.annotator = name.strip()
    st.caption("Tip: to resume earlier work, upload the file you downloaded last time.")
    resume = st.file_uploader("Resume from a downloaded file", type=["json"])
    if resume is not None:
        try:
            payload = json.load(resume)
            st.session_state.scores = payload.get("scores", {})
            if not st.session_state.annotator:
                st.session_state.annotator = payload.get("annotator", "")
            st.success(f"Loaded {len(st.session_state.scores)} previous scores.")
        except Exception as e:
            st.error(f"Could not read that file: {e}")

if not st.session_state.annotator:
    st.info("Enter your name in the sidebar and click **Begin / continue** to start.")
    st.markdown(
        "**What to do:** You'll see a question and one AI model's answer. Read the reference "
        "answer, then rate the model's answer **1-5** with the rubric. You will *not* see which "
        "model wrote it or the automatic judge's score - that keeps your rating unbiased."
    )
    st.warning(
        "Your work is stored **in your browser only**. Click **Download my annotations** in the "
        "sidebar before you close the tab, and send the file to the study maintainer."
    )
    st.stop()

annotator = st.session_state.annotator
items = load_items()
scores = st.session_state.scores

# per-annotator stable shuffle
key = f"{annotator}:{len(items)}"
if len(st.session_state.order) != len(items) or st.session_state.get("order_key") != key:
    rng = random.Random(key)
    order = list(range(len(items)))
    rng.shuffle(order)
    st.session_state.order = order
    st.session_state.order_key = key
    st.session_state.idx = 0

# ---- sidebar: rubric + always-available download ----
with st.sidebar:
    st.markdown(f"**Active:** {annotator}")
    payload = {
        "annotator": annotator,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "scores": scores,
    }
    fname = f"orbit_grades_{annotator.replace(' ', '_')}.json"
    st.download_button(
        "⬇ Download my annotations",
        data=json.dumps(payload, indent=2),
        file_name=fname,
        mime="application/json",
        use_container_width=True,
    )
    st.caption("Download often (it's your only backup). Send the final file to the maintainer.")
    st.markdown("### Rubric")
    for s in (5, 4, 3, 2, 1):
        st.markdown(f"**{s}** - {RUBRIC[s]}")

# ---- progress ----
done = len(scores)
c1, c2, c3 = st.columns(3)
c1.metric("Responses to grade", len(items))
c2.metric("You have graded", done)
c3.metric("Remaining", max(len(items) - done, 0))
if done and done % 20 == 0:
    st.info("Good progress - remember to click **Download my annotations** in the sidebar to back up.")

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
    if st.button("Skip to next ungraded"):
        for off in range(1, n + 1):
            j = (pos + off) % n
            if items[st.session_state.order[j]]["response_id"] not in scores:
                st.session_state.idx = j; break
        st.rerun()

item = items[st.session_state.order[pos]]
rid = item["response_id"]
badge = " :white_check_mark: graded" if rid in scores else ""
st.markdown(f"**Response {pos + 1} of {n}**  ({item['qtype_label']}){badge}")

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
prev = scores.get(rid, {})
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
    scores[rid] = {"score": int(score), "notes": notes}
    for off in range(1, n + 1):
        j = (pos + off) % n
        if items[st.session_state.order[j]]["response_id"] not in scores:
            st.session_state.idx = j; break
    st.rerun()
