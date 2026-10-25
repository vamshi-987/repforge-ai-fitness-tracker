# RepForge Architecture

CLAUDE.md §3 is the canonical overview. This file records how the pieces are wired in the repository.

## Runtime topology (dev: `docker compose up`)

```
 Expo app (phone / emulator)
   │  HTTPS + JWT  (EXPO_PUBLIC_API_URL)
   ▼
 api      FastAPI · uvicorn --reload · host :8010 → :8000
   │ ├── postgres  PostgreSQL 16   host :5442  (repforge, repforge_test)
   │ ├── redis     Redis 7         host :6389  (cache, rate limits, Celery broker/results)
   │ └── s3        SeaweedFS (S3)  host :9010  (buckets: media, food-photos, avatars; R2 in prod)
   │
 worker   Celery worker  (same image as api)
 beat     Celery beat    (same image as api)
```

## Backend layering

| Layer | Path | Rule |
|---|---|---|
| Routers | `app/routers/` | HTTP only: parse, call a service, return a schema |
| Schemas | `app/schemas/` | Pydantic v2 request/response models |
| Services | `app/services/` | Pure domain logic, unit-tested, ≥95% coverage |
| AI | `app/ai/` | Claude client, prompts, LLM output schemas |
| DB | `app/db/` | SQLAlchemy 2 async models and session |
| Cache | `app/cache/` | Redis client and helpers |
| Workers | `app/workers/` | Celery app and tasks |

Errors are raised as `AppError(code, message, status_code, details)` and rendered by one handler into the error envelope (`docs/api.md`).

## Caching

| Key | TTL | Purpose |
|---|---|---|
| `exlib:{library_version}:{filters_hash}` | 1 h | Exercise library list (plus ETag) |
| `foodsearch:{source}:{q_norm}` | 7 d | External food search results |
| `off:barcode:{code}` | 30 d (1 d negative) | Open Food Facts barcodes |
| `ai:text:{sha256}` | 24 h | Free-text food parse |
| `stats:{user}:{range}` | 10 min | Stats summary, deleted on workout save |
| `jwks:{google\|apple}` | 12 h | OAuth signing keys |
| `rl:photo:{user}:{yyyymmdd}` | 1 d | Photo analysis rate limit |
| `rl:login:{ip}` | sliding | Login throttling |

## Mobile

- Expo Router screens in `mobile/app/`, logic in `mobile/src/`.
- Local SQLite (Drizzle) is the source of truth while offline. Migrations live in `src/db/migrations/` and run on launch.
- Server state goes through TanStack Query. UI and in-progress workout state go through Zustand.
- The workout timer and rest timer are derived from stored timestamps (`startedAt`, `restEndsAt`), never incremented counters.

## Auth (Phase 1)

```
 register/login/google/apple ──► access JWT (HS256, 15 min) + refresh token (opaque, 30 d)
                                          │                         │ stored as SHA-256
 every API call: Bearer access ◄──────────┘                         ▼
 401 / about to expire ──► POST /auth/refresh ──► old token revoked, new one in the same family
                                                   reuse of a revoked token ⇒ whole family revoked
```

- **Backend:** `services/security.py` (argon2id, JWT, token hashing), `services/auth.py` (flows, rotation), `services/oauth.py` (Google/Apple JWKS, cached `jwks:{provider}` 12 h), `services/rate_limit.py` (sliding window, `rl:login:{ip}`). `deps.CurrentUser` loads the user for protected routes.
- **Mobile:** `src/auth/session.ts` keeps the tokens (SecureStore) and does single-flight refresh. `src/stores/auth.ts` holds the auth status and the cached `/me` (expo-sqlite kv-store). `src/auth/destination.ts` decides login → onboarding → app, and `Stack.Protected` guards in `app/_layout.tsx` and `app/(auth)/_layout.tsx` enforce it, with `app/index.tsx` as the anchor that redirects.

## Sync (Phase 4)

Outbox on device → `POST /v1/sync/push`. Pull with `GET /v1/sync/pull?since=<change_seq>`. Writes are idempotent by client UUID, and conflicts resolve last-write-wins per row. Finished workouts are immutable after 24 h.
