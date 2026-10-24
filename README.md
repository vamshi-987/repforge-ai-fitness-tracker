# RepForge

An offline-first workout tracker with AI-assisted nutrition and coaching.

- **Mobile:** Expo (React Native) + TypeScript, Expo Router, SQLite (Drizzle), Zustand, TanStack Query
- **Backend:** FastAPI (Python 3.12), SQLAlchemy 2 (async), Alembic, PostgreSQL 16, Redis, Celery
- **AI:** Anthropic Claude for food photo/text parsing and coaching copy. Every number (calories, targets, weights) comes from deterministic services, not the LLM.

> Estimates only, not medical advice.

## Repository layout

```
backend/   FastAPI API, Celery workers, Alembic migrations, tests
mobile/    Expo app
docs/      api.md, architecture.md, PROGRESS.md
PLAN.md    phased build plan (phases → feature branches)
CLAUDE.md  product spec and engineering rules
```

## Prerequisites

- Docker Desktop
- Node 24 + pnpm (`corepack enable pnpm`)
- Python 3.12 (dependencies are installed only into `backend/.venv`)
- Expo Go on your phone

## Quick start

```bash
cp .env.example .env
make up            # postgres, redis, minio, api, worker, beat
make migrate       # run Alembic migrations inside the api container
curl localhost:8000/v1/health

make backend-venv  # create backend/.venv and install deps (for local lint/test)
make backend-check # ruff + mypy + pytest

cd mobile && pnpm install && pnpm start
```

For a physical phone, set `EXPO_PUBLIC_API_URL` in `mobile/.env` to your computer's LAN IP, e.g. `http://192.168.1.20:8000`.

## Workflow

Every feature is built on `feat/pN-<name>`, checked locally (`make backend-check`, `pnpm lint typecheck test`), merged into `main` with `--no-ff`, and pushed. Progress is tracked in [docs/PROGRESS.md](docs/PROGRESS.md).

## Attributions

Food data: USDA FoodData Central (public domain), Open Food Facts (ODbL), Indian Food Composition Tables (NIN). Shown in-app under Settings → About.
