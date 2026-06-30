import os
from contextlib import contextmanager

from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import Json

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in IAA-Labelling/.env")


@contextmanager
def get_conn():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS dataset_items (
                item_id TEXT PRIMARY KEY,
                question TEXT NOT NULL,
                qtype INTEGER NOT NULL,
                choices JSONB NOT NULL DEFAULT '[]'::jsonb,
                a TEXT NOT NULL DEFAULT '',
                b TEXT NOT NULL DEFAULT '',
                c TEXT NOT NULL DEFAULT '',
                d TEXT NOT NULL DEFAULT '',
                answer TEXT NOT NULL,
                solution TEXT NOT NULL,
                reasoning_thought TEXT NOT NULL,
                grounding JSONB NOT NULL DEFAULT '[]'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS annotators (
                name TEXT PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS annotations (
                id SERIAL PRIMARY KEY,
                item_id TEXT NOT NULL REFERENCES dataset_items(item_id) ON DELETE CASCADE,
                annotator TEXT NOT NULL REFERENCES annotators(name) ON DELETE CASCADE,
                verdict TEXT NOT NULL CHECK (verdict IN ('accept', 'reject')),
                corrected_answer TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (item_id, annotator)
            )
            """
        )
        conn.commit()


def upsert_annotator(name: str) -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO annotators (name)
            VALUES (%s)
            ON CONFLICT (name) DO NOTHING
            """,
            (name.strip(),),
        )


def upsert_item(item: dict) -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dataset_items (
                item_id, question, qtype, choices, a, b, c, d,
                answer, solution, reasoning_thought, grounding
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (item_id) DO UPDATE SET
                question = EXCLUDED.question,
                qtype = EXCLUDED.qtype,
                choices = EXCLUDED.choices,
                a = EXCLUDED.a,
                b = EXCLUDED.b,
                c = EXCLUDED.c,
                d = EXCLUDED.d,
                answer = EXCLUDED.answer,
                solution = EXCLUDED.solution,
                reasoning_thought = EXCLUDED.reasoning_thought,
                grounding = EXCLUDED.grounding
            """,
            (
                item.get("id"),
                item.get("question", ""),
                int(item.get("qtype", 0)),
                Json(item.get("choices", [])),
                item.get("A", ""),
                item.get("B", ""),
                item.get("C", ""),
                item.get("D", ""),
                item.get("answer", ""),
                item.get("solution", ""),
                item.get("reasoning_thought", ""),
                Json(item.get("grounding", [])),
            ),
        )


def upsert_annotation(
    item_id: str,
    annotator: str,
    verdict: str,
    corrected_answer: str = "",
    notes: str = "",
) -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO annotations (item_id, annotator, verdict, corrected_answer, notes)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (item_id, annotator) DO UPDATE SET
                verdict = EXCLUDED.verdict,
                corrected_answer = EXCLUDED.corrected_answer,
                notes = EXCLUDED.notes,
                created_at = NOW()
            """,
            (item_id, annotator, verdict, corrected_answer, notes),
        )


def save_annotation(
    item_id: str,
    annotator: str,
    verdict: str,
    corrected_answer: str = "",
    notes: str = "",
) -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO annotators (name)
            VALUES (%s)
            ON CONFLICT (name) DO NOTHING
            """,
            (annotator.strip(),),
        )
        cur.execute(
            """
            INSERT INTO annotations (item_id, annotator, verdict, corrected_answer, notes)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (item_id, annotator) DO UPDATE SET
                verdict = EXCLUDED.verdict,
                corrected_answer = EXCLUDED.corrected_answer,
                notes = EXCLUDED.notes,
                created_at = NOW()
            """,
            (item_id, annotator, verdict, corrected_answer, notes),
        )


def fetch_items(limit: int = 50, offset: int = 0):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT item_id, question, qtype, choices, a, b, c, d, answer,
                   solution, reasoning_thought, grounding
            FROM dataset_items
            ORDER BY item_id
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        )
        rows = cur.fetchall()
    return rows


def fetch_item(item_id: str):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT item_id, question, qtype, choices, a, b, c, d, answer,
                   solution, reasoning_thought, grounding
            FROM dataset_items
            WHERE item_id = %s
            """,
            (item_id,),
        )
        return cur.fetchone()


def fetch_counts():
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM dataset_items")
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM annotations")
        annotated = cur.fetchone()[0]
    return total, annotated


def fetch_annotations_total():
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM annotations")
        return cur.fetchone()[0]


def fetch_annotations_by_item(item_id: str):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT annotator, verdict, corrected_answer, notes, created_at
            FROM annotations
            WHERE item_id = %s
            ORDER BY created_at DESC
            """,
            (item_id,),
        )
        return cur.fetchall()


def fetch_annotations_summary():
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT annotator, COUNT(*) AS total,
                   SUM(CASE WHEN verdict = 'accept' THEN 1 ELSE 0 END) AS accepted,
                   SUM(CASE WHEN verdict = 'reject' THEN 1 ELSE 0 END) AS rejected
            FROM annotations
            GROUP BY annotator
            ORDER BY annotator
            """
        )
        return cur.fetchall()


def fetch_item_annotation_counts():
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT item_id, COUNT(*) AS total,
                   SUM(CASE WHEN verdict = 'accept' THEN 1 ELSE 0 END) AS accepted,
                   SUM(CASE WHEN verdict = 'reject' THEN 1 ELSE 0 END) AS rejected
            FROM annotations
            GROUP BY item_id
            """
        )
        return cur.fetchall()
