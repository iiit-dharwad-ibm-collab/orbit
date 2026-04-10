# Dataset Generator (Next.js)

Internal web app to create, manage, and export ITOps training examples with optional AI-assisted drafting and vector-backed knowledge retrieval.

## Tech Stack

- Next.js 16 (App Router)
- React 19
- Neon Postgres (`@neondatabase/serverless`)
- `pgvector` extension in Postgres
- Gemini API (`@google/genai`) for:
  - draft generation
  - embeddings

## Features

- JWT-based auth (login/register API)
- Dataset lifecycle:
  - create dataset entries
  - versioned edits
  - browse all or only your own
  - delete entries
  - export JSON
- Knowledge Base:
  - store wiki-style documents
  - auto-chunk + embed into `document_chunks`
  - semantic search over vectors
- AI drafting:
  - generate structured dataset drafts
  - optional grounding from wiki search + Stack Overflow sources
  - concept registry support to reduce concept repetition

## Project Structure

- `src/app/login`: sign-in page
- `src/app/dashboard`: dataset and vector stats
- `src/app/create`: manual + AI-assisted dataset creation
- `src/app/knowledge`: wiki docs and embedding management
- `src/app/browse`: detail view + export
- `src/app/api`: backend routes (auth, datasets, wiki, vectors, generate)
- `src/lib/db.js`: Neon DB client + schema init
- `src/lib/auth.js`: JWT + password helpers
- `src/lib/embeddings.js`: Gemini embeddings
- `src/lib/chunker.js`: text chunking for vectorization

## Prerequisites

- Node.js 20+
- A Neon/Postgres database
- Postgres `vector` extension support (this app runs `CREATE EXTENSION IF NOT EXISTS vector`)
- Gemini API key

## Environment Variables

Create `.env.local` in the project root:

```bash
DATABASE_URL="postgres://..."
JWT_SECRET="replace-with-a-long-random-secret"
GEMINI_API_KEY="your-gemini-key"
```

Notes:

- `DATABASE_URL` is required for all DB-backed routes.
- `JWT_SECRET` currently falls back to `fallback-secret-change-me` if missing; always set a real value in non-local usage.
- `GEMINI_API_KEY` is required for `/api/generate` and vector embedding/search flows.

## Install And Run

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000`.

## First-Run Setup

There is no register UI page yet, so create your first account via API.

1. Register user

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

2. Save returned JWT token, then initialize DB tables

```bash
curl -X POST http://localhost:3000/api/init \
  -H "Authorization: Bearer <TOKEN>"
```

3. Open `http://localhost:3000/login` and sign in.

## API Overview

Auth:

- `POST /api/auth/register`
- `POST /api/auth/login`

Setup:

- `POST /api/init` (creates tables + vector extension)

Datasets:

- `GET /api/datasets?scope=all|mine`
- `POST /api/datasets`
- `GET /api/datasets/:id`
- `PUT /api/datasets/:id` (creates a new version)
- `DELETE /api/datasets/:id`
- `GET /api/datasets/export`

Knowledge + vectors:

- `GET /api/wiki?search=...`
- `POST /api/wiki` (stores doc + chunks + embeddings)
- `GET /api/wiki/:id`
- `DELETE /api/wiki/:id`
- `POST /api/vectors/search`
- `GET /api/vectors/stats`

AI + enrichment:

- `POST /api/generate`
- `POST /api/stackoverflow`
- `GET /api/concepts`

Most routes (except login/register) require `Authorization: Bearer <JWT>`.

## Data Model (high level)

- `users`: auth users
- `dataset_examples`: top-level examples
- `dataset_states`: versioned states per example
- `grounding_sources`: provenance per state
- `concept_registry`: concept usage counter
- `wiki_documents`: uploaded KB docs
- `document_chunks`: vectorized chunks for semantic retrieval

## Build For Production

```bash
npm run build
npm run start
```

## Troubleshooting

- `DATABASE_URL not set`:
  - add `DATABASE_URL` in `.env.local`
- `GEMINI_API_KEY not set`:
  - add `GEMINI_API_KEY` in `.env.local`
- Unauthorized redirects to login:
  - token may be missing/expired; log in again
- Vector queries failing:
  - ensure your Postgres supports `pgvector` and `/api/init` has been run successfully
