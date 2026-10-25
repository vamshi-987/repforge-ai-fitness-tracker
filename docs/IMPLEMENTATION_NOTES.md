# RepForge: Implementation Notes and Interview Guide

What was built in each phase, how it was built, why, and the trade-offs, written so it can be explained in an interview. Each phase window adds its section when the phase is merged.

---

## 1. The 30-second pitch

> RepForge is an offline-first workout tracker, in the style of Hevy, with AI-assisted nutrition and coaching. It's a React Native (Expo) app over a FastAPI + PostgreSQL backend, with Redis for caching and as the queue broker, and Celery workers for background jobs such as food-photo analysis. Workouts are logged on the device first and synced with idempotent writes, so a bad gym connection never loses or duplicates a session. The AI layer uses Claude for **perception** (reading a food photo, parsing "2 rotis and dal") and **explanation** (coaching tips). Every number, from calories and macro targets to the next weight to lift, comes from deterministic, unit-tested Python services. The LLM is never the source of truth.

## 2. Architecture

```
 Mobile (Expo / React Native, TypeScript)
   UI → Zustand (UI + live workout) / TanStack Query (server state)
   SQLite + Drizzle  ← source of truth while offline
   Sync engine: outbox → POST /v1/sync/push · GET /v1/sync/pull?since=
        │ HTTPS + JWT
        ▼
 FastAPI (async)   routers → services (pure logic) → SQLAlchemy 2 async
        │                 └→ ai/ (Claude client, prompts, JSON schemas)
   ┌────┼──────────────┬───────────────────┐
 PostgreSQL 16     Redis 7            Celery worker + beat ──► Claude API
 (all data)        (cache, rate        (photo analysis, weekly
                    limits, broker)     reports, push fan-out)
        │
 S3-compatible storage + CDN (SeaweedFS in dev, Cloudflare R2 in prod)
```

**Request path, using health readiness as the example:** phone → `RequestContextMiddleware` (assigns a request ID, writes the access log) → router (`app/routers/health.py`) → service (`app/services/health.py`), which checks Postgres and Redis concurrently, each with a timeout → Pydantic response schema → JSON. Errors are raised as `AppError` and rendered once, by a central handler, into `{"error": {code, message, details}}`.

## 3. Tech stack: choice, reason, trade-off

| Layer | Choice | Why | Alternatives considered | Trade-off accepted |
|---|---|---|---|---|
| Mobile | **Expo (React Native) + TypeScript** | One codebase for iOS and Android. Expo handles native builds (EAS), OTA updates and camera/SQLite/notification modules | Flutter, native Swift/Kotlin | Native-heavy features (watch apps, Live Activities) need dev builds or native modules |
| Routing | **Expo Router** | File-based routes, deep links for free, typed navigation | React Navigation by hand | Conventions to learn; the file layout is the navigation tree |
| Local DB | **expo-sqlite + Drizzle ORM** | Offline-first needs a real relational store on the device. Drizzle gives typed queries and generated SQL migrations | AsyncStorage, WatermelonDB, Realm | The sync engine is ours to write and maintain |
| State | **Zustand** (UI) + **TanStack Query** (server) | Keeps client state and server cache apart. Query gives caching, retries and invalidation | Redux Toolkit, RTK Query | Two libraries instead of one |
| Backend | **FastAPI + Pydantic v2** | Async, request/response validation and OpenAPI docs built in. Python has the strongest AI/data ecosystem | Node/NestJS (what Hevy uses), Django | Python is slower per request than Go/Node, but this workload is I/O-bound, so async closes most of the gap |
| ORM | **SQLAlchemy 2 (async) + Alembic** | Mature, explicit SQL control, reviewed migrations | Django ORM, Tortoise, raw SQL | More boilerplate than Django |
| Database | **PostgreSQL 16** | Relational data (workouts → exercises → sets), JSONB for AI results, `pg_trgm` for fuzzy food/exercise search | MongoDB, MySQL | Schema migrations required. That's intentional, because it keeps the data consistent |
| Cache / queue | **Redis 7** | One component does three jobs: response cache, rate-limit counters and Celery broker | RabbitMQ (broker), Memcached (cache) | It's a single point of failure in the MVP, so prod uses managed Redis |
| Jobs | **Celery** (+ beat) | Long or flaky work (LLM calls, weekly reports) moves out of the request path, with retries and scheduling | RQ, Dramatiq, Arq | Heavier setup, and Celery is untyped (handled with a mypy override) |
| Object storage | **S3 API** (SeaweedFS in dev, Cloudflare R2 in prod) | Presigned uploads go straight from the phone and never pass through the API | Storing blobs in Postgres | Another moving part in dev |
| AI | **Claude (`claude-sonnet-5-5`)** with JSON schema validation | Vision for food photos, structured output, short coaching copy | Self-hosted vision models | Per-call cost and latency, so it's async, cached and rate-limited |
| Infra | **Docker Compose** (dev), multi-stage images, **GitHub Actions** | `make up` gives the whole stack. CI runs the same checks as local | Kubernetes from day one | Not autoscaled. Fine for the MVP, with a simple path to Fly.io/Render |

## 4. Design decisions that apply across the system

1. **Offline-first logging with idempotent writes.** A workout is written to SQLite first, then queued in an outbox. The server endpoint is `PUT /v1/workouts/{client_uuid}`: the client generates the UUID, so retrying the same request can never create a duplicate. *Trade-off:* we must handle conflicts. The rule is last-write-wins per row, and finished workouts become immutable after 24 hours.
2. **Timers are derived, not counted.** The workout duration is `now − startedAt` and the rest timer is `restEndsAt − now`, both re-rendered every second. A `setInterval` counter freezes when the app is backgrounded or killed; a timestamp doesn't. A scheduled local notification fires when the rest timer ends, even if the app is closed.
3. **Deterministic engines, LLM for words.** BMR, TDEE, calorie adjustments and progressive overload are pure functions with ≥95% test coverage. The LLM receives those numbers and only writes the tips. If it fails, template tips are shown. *Why:* LLM arithmetic is unreliable and can't be tested; a nutrition app giving wrong numbers is a safety problem.
4. **Async AI pipeline.** Photo upload → `202 Accepted` with `analysis_id` → Celery calls Claude → the result is a *draft* the user must confirm. This keeps API latency low, survives LLM timeouts through retries, and keeps a human in the loop.
5. **Denormalized stats.** Workout volume and sets per muscle are computed when a workout is saved, so charts never scan raw sets. *Trade-off:* a little write-time work and data that must be kept consistent.
6. **One error format everywhere.** `{"error": {code, message, details}}`. The mobile client maps it to a typed `ApiError`, and UI logic branches on a stable `code`, never on message text.
7. **Caching with explicit keys and TTLs** (see `docs/architecture.md`). Exercise-library responses carry a version in the key, so a seed bump invalidates everything. Per-user stats are deleted when a workout is saved. Redis runs with `noeviction` because it is also the job queue.

---

## Phase 0: Repo and infrastructure ✅

**Goal:** a production-shaped skeleton. One command starts the whole stack, every layer has lint, types and tests, and CI enforces them.

### 0.1 Repo skeleton (`feat/p0-repo-skeleton`)
- **What:** a monorepo (`backend/`, `mobile/`, `docs/`, `infra/`), README, MIT license, `PLAN.md`, `docs/PROGRESS.md`, API conventions doc.
- **Why a monorepo:** backend and mobile change together (an API contract change touches both), it gives one place for CI and docs, and it keeps atomic commits.
- **Workflow:** one `feat/pN-<name>` branch per feature, merged into `main` with `--no-ff` only after `make check` passes. `--no-ff` keeps a merge commit per feature, so history reads as a list of features and any one can be reverted in a single step.

### 0.2 Backend scaffold (`feat/p0-backend-scaffold`)
- **App factory** (`create_app()` in `app/main.py`): every test gets a fresh app, and settings are read once through a cached `get_settings()` (pydantic-settings, from env vars or `.env`).
- **Layering:** `routers/` (HTTP only) → `services/` (pure logic) → `db/` / `cache/`. Dependencies (`DbSession`, `RedisClient`, `SettingsDep` in `app/deps.py`) are injected with FastAPI `Depends`, so tests swap in fakes with `app.dependency_overrides` and need no real database.
- **Health checks:**
  - `GET /v1/health` is **liveness**: it touches nothing, so a slow database never gets the container killed.
  - `GET /v1/health/ready` is **readiness**: it checks Postgres (`SELECT 1`) and Redis (`PING`) **concurrently** with `asyncio.gather`, each wrapped in `asyncio.wait_for(timeout=2s)`, and returns **503** if either is down.
  - *Interview point:* liveness answers "should I restart this?", readiness answers "should I send it traffic?". Mixing them up causes restart loops during a database blip.
- **Error envelope** (`app/core/errors.py`): handlers for the domain `AppError`, Starlette HTTP errors (404/405), validation errors (422, with field locations) and a catch-all 500 that logs the stack trace but returns a generic message, so internals never leak.
- **Structured logging** (`app/core/logging.py`): one JSON object per line, with the request ID taken from a `ContextVar`, so every log line in a request can be correlated without passing IDs around.
- **Request-ID middleware** (`app/core/middleware.py`): written as **pure ASGI**, not `BaseHTTPMiddleware`. That avoids known problems with streaming responses and contextvars, and it's cheaper. It echoes a client-sent `X-Request-ID` only if the value matches `^[A-Za-z0-9._-]{1,64}$`, which prevents log injection, and writes one access-log line with the latency.
- **Database:** an async SQLAlchemy engine with `pool_pre_ping` (detects dropped connections), a 10+10 pool and a 5 s connect timeout. A **naming convention** on `MetaData` makes Alembic produce stable constraint names. The first migration enables `pg_trgm` for fuzzy search.
- **Quality gates:** ruff (lint and format), **mypy --strict**, pytest with `asyncio_mode=auto`, and a coverage gate of **≥95% on `app/services/`**, where the business logic will live.
- **Result:** 27 tests at merge (30 after Phase 0.3), 100% services coverage.

### 0.3 Docker Compose stack (`feat/p0-docker-compose`)
- **Services:** postgres, redis, s3 (SeaweedFS) + s3-init, api, worker, beat.
- **One image, three roles:** api, worker and beat share the backend image with different `command`s, defined once with a YAML anchor (`x-backend`).
- **Multi-stage Dockerfile:** the builder installs dependencies into `/opt/venv`, and the runtime copies only that venv and the source. It runs as a **non-root** user (uid 10001) and has a `HEALTHCHECK`. The project package is uninstalled after its dependencies are installed, so the source under `/app` is what runs, and a dev bind mount can hot-reload it.
- **Health-gated startup:** every service has a healthcheck. The backend services wait with `depends_on: condition: service_healthy`, and `make up` uses `docker compose up --wait`, so "done" really means ready.
- **Config:** `.env` holds host-side URLs (localhost ports) for local tests, and compose overrides them with in-network hostnames (`postgres:5432`) for the containers. One `.env` works in both places.
- **Redis config:** `appendonly yes` (persistence) plus `maxmemory-policy noeviction`. Because Redis is also the Celery broker, evicting keys under memory pressure would silently drop queued jobs.
- **Celery config** (`app/workers/celery_app.py`):
  - **JSON-only** serialization: pickle would allow remote code execution if the broker were compromised.
  - `task_acks_late` + `task_reject_on_worker_lost`: a job is re-delivered if a worker crashes mid-task, so tasks must be idempotent.
  - `worker_prefetch_multiplier=1`: fair scheduling for long LLM calls.
  - Soft and hard time limits.
- **Separate test database** (`repforge_test`), created by a Postgres init script. Integration tests migrate it to `head` themselves, so the dev database is never touched.
- **Integration tests:** readiness against the real services, the `pg_trgm` migration, and a real Celery round-trip (`ping.delay().get()` through Redis to the worker).

### 0.4 Mobile scaffold (`feat/p0-mobile-scaffold`)
- **Expo SDK 58 + Expo Router.** Route groups `(tabs)` (Home, Workout, Nutrition, Profile) and `(auth)`. Each tab section has its own Stack layout, so later phases can push detail screens without restructuring.
- **TypeScript strict** plus `noUncheckedIndexedAccess`: array and record lookups are typed `T | undefined`, which catches a whole class of runtime crashes. The `@/` alias points to `src/`.
- **API client** (`src/api/client.ts`): a typed `apiRequest<T>()` that turns every failure into one `ApiError` shape. HTTP errors carry the server's `code`, a non-JSON error becomes `http_error`, and a network failure becomes `network_error` with status 0. UI code only ever deals with one error type.
- **TanStack Query** retry policy: retry network errors and 5xx up to twice, **never retry 4xx**, because a 404 won't fix itself.
- **Local DB:** Drizzle schema (`sync_state` table) → `drizzle-kit generate` produces SQL migrations → bundled as strings (Babel `inline-import` + Metro `sql` extension) → applied on launch by `useMigrations` in `DatabaseProvider`, which blocks the UI until the schema is ready. SQLite runs with `journal_mode=WAL` (better concurrent reads and writes) and `foreign_keys=ON`.
- **Theme tokens** for light and dark. The body-map reds (`#E5383B` primary, `#F4A3A5` secondary) are defined now.
- **`ApiStatus` badge** on Home: an end-to-end check that the phone reaches the API.
- **Tests:** Jest 30 (`jest-expo`) + React Native Testing Library: 15 tests covering URL config, the client's error mapping, the retry policy and component rendering.
- **pnpm details:** `node-linker=hoisted` (Metro expects a flat `node_modules`). pnpm 10+ blocks dependency install scripts by default, so only `esbuild`, `unrs-resolver` and `@parcel/watcher` are allowlisted, which is a supply-chain protection.

### 0.5 CI (`feat/p0-ci`)
- **backend.yml:** Postgres and Redis as GitHub service containers → venv → ruff + mypy → unit tests + coverage gate → a **detached Celery worker** → integration tests → a separate Docker image build job.
- **mobile.yml:** Node 24, pnpm pinned through the `packageManager` field (corepack), `--frozen-lockfile` (CI fails if the lockfile is stale), then lint, typecheck and test.
- **Path filters** run only the affected pipeline. **Concurrency groups** cancel superseded runs.

### Problems hit in Phase 0 and how they were solved (good interview stories)
| Problem | Cause | Fix | Lesson |
|---|---|---|---|
| `docker compose up` failed: `pull access denied for minio/mc` | MinIO stopped publishing images to Docker Hub | Switched dev storage to **SeaweedFS** (Apache-2.0, S3-compatible), with an `aws-cli` container creating buckets idempotently (`head-bucket` before `create-bucket`) | Code against the **S3 API, not a vendor**, so storage can be swapped (SeaweedFS in dev, R2 in prod) without changing app code |
| Ports 5432/6379/8000 already in use | Other local projects | Every host port is configurable in `.env`, with non-default values (8010/5442/6389/9010) | Never hard-code host ports in shared compose files |
| ESLint crashed: `getFilename is not a function` | ESLint 10 removed APIs that `eslint-plugin-react` still uses | Pinned ESLint to 9 | "Latest" isn't always compatible. Check peer support and pin |
| `pnpm install` failed with `ERR_PNPM_IGNORED_BUILDS` | pnpm blocks install scripts by default | Explicit `allowBuilds` allowlist | Supply-chain hardening shapes tooling choices |
| mypy: Redis `ping()` didn't match our `Protocol` | Redis types `ping` as returning `Awaitable[bool]` and takes `**kwargs` | Typed the protocol as `def ping(self) -> Awaitable[object]` (structural typing) | Protocols let tests pass fakes without inheriting from real classes |
| `expo start` rewrote `tsconfig.json` and broke Prettier | Expo auto-manages parts of tsconfig | Keep Expo's content, apply Prettier formatting (documented in the runbook) | Generated config needs a formatter step |

### Numbers worth quoting
- Backend: **30 unit tests + 3 integration tests**, mypy strict clean, **100%** coverage on services.
- Mobile: **15 tests**, strict TypeScript clean, `expo-doctor` 20/20 checks.
- Whole stack up and healthy with one command (`make up`).

---

## Phase 1: Auth, profile, onboarding, settings ⬜
_To be written when Phase 1 is merged._ Key points to cover:
- JWT access tokens (15 min) + **rotating refresh tokens with reuse detection**. Refresh tokens are stored hashed and grouped in a `family_id`. Reusing an already-rotated token revokes the whole family, because it indicates theft.
- argon2 password hashing. Google/Apple sign-in verified against cached JWKS.
- Mobile: tokens in the secure store; on a 401, a **single-flight refresh** (one refresh shared by all concurrent requests), then retry.

## Phase 2: Exercise library and red body map ⬜
_To be written._ Key points: an originally written seed of 400+ exercises with stable UUIDv5 IDs (idempotent seeding), trigram search, Redis + ETag caching, the SVG body map (primary and secondary muscle reds) reused as a heat map.

## Phase 3: Routines and live workout logging ⬜
_To be written._ Key points: Zustand store persisted to SQLite (debounced), the **derived timer** (`now − startedAt`), resume after the app is killed, a rest timer backed by a scheduled notification, PR detection on finish, all offline.

## Phase 4: Workout backend, sync, history, stats ⬜
_To be written._ Key points: idempotent `PUT /workouts/{client_uuid}`, `change_seq` cursors for pull, outbox with exponential backoff, last-write-wins plus the 24 h immutability rule, denormalized stats.

## Phase 5: Body and water ⬜
_To be written._ Key points: presigned uploads, weekly-average weight trend, water goal (35 ml/kg, +500 ml on training days), local reminder scheduling.

## Phase 6: Nutrition (non-AI) ⬜
_To be written._ Key points: food search across sources (local → cache → USDA → Open Food Facts), snapshots on logs (editing a food never rewrites history), macro overrides (`4P + 4C + 9F`).

## Phase 7: AI layer ⬜
_To be written._ Key points: schema-validated LLM output with retry-then-fallback, the 202 async photo pipeline, DB-matched macros overriding LLM estimates, the deterministic weekly calorie engine, the double-progression overload coach.

## Phase 8: Social and push ⬜
_To be written._ Key points: fan-out on read for the feed, visibility rules, follow requests for private profiles, Expo push via Celery.

## Phase 9: Integrations, Pro, observability, release ⬜
_To be written._ Key points: HealthKit / Health Connect, an idempotent RevenueCat webhook, Sentry + Prometheus, GDPR export and delete, EAS builds.

---

## Likely interview questions (with short answers)

**How do you stop a workout from being saved twice when the network retries?**
The client generates the workout's UUID and saves with `PUT /workouts/{uuid}`. PUT is idempotent: the second request updates the same row instead of creating a new one.

**How does the workout timer stay right if the app is killed?**
It never counts. We store `startedAt` in SQLite and show `now − startedAt`. After a restart the store rehydrates from SQLite and the arithmetic still holds.

**Why not let the LLM calculate calories and targets?**
LLM arithmetic is non-deterministic and can't be unit-tested. Numbers come from pure Python functions with ≥95% coverage. The LLM only identifies foods and writes the explanation, and if it fails we fall back to template text.

**What's the difference between your two health endpoints?**
Liveness (`/health`) checks only the process, so the orchestrator restarts a hung process but not a healthy API during a database outage. Readiness (`/health/ready`) checks dependencies, with timeouts, and returns 503 so the load balancer stops sending traffic.

**Why is Redis set to `noeviction`?**
Redis is also the Celery broker. With an LRU policy, memory pressure could evict queued jobs silently. Better to fail loudly.

**Why `acks_late` in Celery?**
The broker only drops a message after the task finishes, so a worker crash re-delivers the job instead of losing it. The cost is that tasks must be idempotent.

**Why pure ASGI middleware instead of `BaseHTTPMiddleware`?**
`BaseHTTPMiddleware` has known problems with streaming responses and contextvar propagation, and it adds overhead. A pure ASGI wrapper only intercepts `http.response.start` to add the header.

**How do tests avoid needing a real database?**
Dependencies are injected with `Depends`, and tests override them with fakes. A separate integration suite runs against real Postgres, Redis and a worker, in Compose locally and as service containers in CI.

**How would you scale this?**
The API is stateless, so it scales horizontally behind a load balancer. Workers scale separately by queue. Postgres gets a read replica for feeds and stats, Redis moves to a managed service, and media is served from a CDN. Denormalized stats and cursor pagination keep queries cheap as data grows.
