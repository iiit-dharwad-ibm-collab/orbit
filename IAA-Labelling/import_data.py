import json
from pathlib import Path

from db import init_db, upsert_item

DATA_PATH = Path(__file__).parent / "combined_export.json"


def main() -> None:
    init_db()
    items = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    for item in items:
        if not isinstance(item, dict):
            continue
        if not item.get("id"):
            continue
        upsert_item(item)

    print(f"Imported {len(items)} items into dataset_items")


if __name__ == "__main__":
    main()
