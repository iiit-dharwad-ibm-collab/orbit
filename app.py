import json
import random
from datetime import datetime
from pathlib import Path

import streamlit as st

from db import init_db, save_annotation

st.set_page_config(page_title="IAA Labelling", layout="wide")

init_db()

DATA_PATH = Path(__file__).parent / "combined_export.json"


@st.cache_data(show_spinner=False)
def load_items():
    if not DATA_PATH.exists():
        return []
    items = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    return [item for item in items if isinstance(item, dict) and item.get("id")]

st.title("Inter-Annotator Labelling")

if "annotator" not in st.session_state:
    st.session_state.annotator = ""
if "annotations" not in st.session_state:
    st.session_state.annotations = {}
if "item_index" not in st.session_state:
    st.session_state.item_index = 0
if "item_order" not in st.session_state:
    st.session_state.item_order = []
if "order_key" not in st.session_state:
    st.session_state.order_key = ""

with st.sidebar:
    st.header("Annotator Login")
    annotator = st.text_input("Your name", value=st.session_state.annotator)
    if st.button("Start"):
        annotator = annotator.strip()
        if annotator:
            st.session_state.annotator = annotator
    st.caption("Name-only login. Your labels are saved under this name.")

if not st.session_state.annotator:
    st.info("Enter your name to begin.")
    st.stop()

st.sidebar.markdown(f"**Active annotator:** {st.session_state.annotator}")

col1, col2, col3 = st.columns(3)

items_data = load_items()
total = len(items_data)
annotated = len(st.session_state.annotations)
with col1:
    st.metric("Total items", total)
with col2:
    st.metric("Total annotations", annotated)
with col3:
    st.metric("Remaining (approx)", max(total - annotated, 0))

st.subheader("Session Summary")
accepted = sum(1 for v in st.session_state.annotations.values() if v.get("verdict") == "accept")
rejected = sum(1 for v in st.session_state.annotations.values() if v.get("verdict") == "reject")
st.table(
    [
        {
            "Annotator": st.session_state.annotator,
            "Total": annotated,
            "Accepted": accepted,
            "Rejected": rejected,
        }
    ]
)

st.subheader("Annotate")
items_sorted = sorted(items_data, key=lambda x: x.get("id", ""))
if not items_sorted:
    st.warning("No items found in combined_export.json")
    st.stop()

order_key = f"{st.session_state.annotator}:{len(items_sorted)}"
if st.session_state.order_key != order_key or len(st.session_state.item_order) != len(items_sorted):
    rng = random.Random(order_key)
    st.session_state.item_order = list(items_sorted)
    rng.shuffle(st.session_state.item_order)
    st.session_state.order_key = order_key
    st.session_state.item_index = 0

items_ordered = st.session_state.item_order

max_index = len(items_ordered) - 1
if st.session_state.item_index > max_index:
    st.session_state.item_index = max_index

nav_col1, nav_col2, nav_col3 = st.columns([1, 2, 1])
with nav_col1:
    if st.button("Previous") and st.session_state.item_index > 0:
        st.session_state.item_index -= 1
with nav_col2:
    st.markdown(f"**Item {st.session_state.item_index + 1} of {len(items_ordered)}**")
with nav_col3:
    if st.button("Next") and st.session_state.item_index < max_index:
        st.session_state.item_index += 1

item = items_ordered[st.session_state.item_index]
item_id = item.get("id")
question = item.get("question", "")
qtype = int(item.get("qtype", 0))
a = item.get("A", "")
b = item.get("B", "")
c = item.get("C", "")
d = item.get("D", "")
answer = item.get("answer", "")
solution = item.get("solution", "")
reasoning_thought = item.get("reasoning_thought", "")
grounding = item.get("grounding", [])

st.markdown(f"### {item_id}")
st.write(question)

if qtype == 0:
    st.write("**Choices**")
    st.write({"A": a, "B": b, "C": c, "D": d})
    st.write(f"**Answer**: {answer}")
else:
    st.write(f"**Answer**: {answer}")

with st.expander("Solution / Reasoning", expanded=False):
    st.write(solution)
    st.write(reasoning_thought)

with st.expander("Grounding", expanded=False):
    grounding_list = grounding if isinstance(grounding, list) else []
    if grounding_list:
        for g in grounding_list:
            st.write(f"- {g.get('type','')}: {g.get('title','')} ({g.get('url','')})")
    else:
        st.write("No grounding sources.")

existing = st.session_state.annotations.get(item_id, {})
default_verdict = existing.get("verdict", "accept")
default_corrected = existing.get("corrected_answer", "")
default_notes = existing.get("notes", "")

with st.form(key=f"label-form-{item_id}"):
    st.markdown("#### Label")
    verdict = st.radio(
        "Verdict",
        ["accept", "reject"],
        horizontal=True,
        index=0 if default_verdict == "accept" else 1,
    )
    corrected = st.text_area("Corrected answer (if rejecting)", value=default_corrected, height=100)
    notes = st.text_area("Notes", value=default_notes, height=80)
    submitted = st.form_submit_button("Save label")

if submitted:
    save_annotation(
        item_id=item_id,
        annotator=st.session_state.annotator,
        verdict=verdict,
        corrected_answer=corrected,
        notes=notes,
    )
    st.session_state.annotations[item_id] = {
        "annotator": st.session_state.annotator,
        "verdict": verdict,
        "corrected_answer": corrected,
        "notes": notes,
        "at": datetime.utcnow().isoformat() + "Z",
    }
    st.success("Label saved.")
