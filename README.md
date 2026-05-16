# IAA Labelling (Streamlit)

Simple inter-annotator labelling UI for the dataset in `combined_export.json`.

## Setup

1. Ensure `IAA-Labelling/.env` contains `DATABASE_URL` for Neon/Postgres.
2. Install dependencies:

```bash
pip install streamlit psycopg2-binary python-dotenv
```

## Import data

```bash
python IAA-Labelling/import_data.py
```

## Run app

```bash
streamlit run IAA-Labelling/app.py
```
