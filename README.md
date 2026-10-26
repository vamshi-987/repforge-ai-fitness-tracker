# RepForge

[![backend](https://github.com/vamshi-987/repforge-ai-fitness-tracker/actions/workflows/backend.yml/badge.svg)](https://github.com/vamshi-987/repforge-ai-fitness-tracker/actions/workflows/backend.yml) [![mobile](https://github.com/vamshi-987/repforge-ai-fitness-tracker/actions/workflows/mobile.yml/badge.svg)](https://github.com/vamshi-987/repforge-ai-fitness-tracker/actions/workflows/mobile.yml)

An offline-first workout tracker with AI-assisted nutrition and coaching.

- **Mobile:** Expo (React Native) + TypeScript, Expo Router, SQLite (Drizzle), Zustand, TanStack Query
- **Backend:** FastAPI (Python 3.12), SQLAlchemy 2 (async), Alembic, PostgreSQL 16, Redis, Celery
- **AI:** Anthropic Claude for food photo/text parsing and coaching copy. Every number (calories, targets, weights) comes from deterministic services, not the LLM.

> Estimates only, not medical advice.

## Repository layout

```
backend/   FastAPI API, Celery workers, Alembic migrations, tests
mobile/    Expo app
docs/      api.md, architecture.md, RUNBOOK.md
```

## Prerequisites

- Docker Desktop
- Node 24 + pnpm (`corepack enable pnpm`)
- Python 3.12 (dependencies are installed only into `backend/.venv`)
- Expo Go on your phone

## Quick start

Full first-time setup, daily start, and what to run after each kind of change: [docs/RUNBOOK.md](docs/RUNBOOK.md).

```bash
cp .env.example .env
make up            # postgres, redis, s3 (SeaweedFS), api, worker, beat
make migrate       # run Alembic migrations inside the api container
make seed          # load the exercise library (idempotent)
curl localhost:8010/v1/health

make backend-venv  # create backend/.venv and install deps (for local lint/test)
make backend-check # ruff + mypy + pytest (unit + integration: needs `make up`)

make mobile-install
cp mobile/.env.example mobile/.env.local   # set EXPO_PUBLIC_API_URL
make mobile-check  # eslint + prettier + tsc + jest
make mobile-start  # scan the QR code with Expo Go

make check         # backend-check + mobile-check: run before every merge
```

For a physical phone, set `EXPO_PUBLIC_API_URL` in `mobile/.env.local` to your computer's LAN IP, e.g. `http://192.168.1.20:8010`.

Host ports (set in `.env`): API 8010, Postgres 5442, Redis 6389, S3 9010. They avoid the default ports so RepForge can run alongside other local stacks.

## Workflow

Every feature is built on `feat/pN-<name>`, checked locally (`make backend-check`, `pnpm lint typecheck test`), merged into `main` with `--no-ff`, and pushed.

## Attributions

Food data: USDA FoodData Central (public domain), Open Food Facts (ODbL), Indian Food Composition Tables (NIN). Shown in-app under Settings → About.
