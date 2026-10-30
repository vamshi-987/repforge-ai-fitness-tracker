# RepForge Architecture

How the pieces of RepForge are wired together in this repository.

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
| `exlib:version` | 5 min | Exercise library version; deleted by `make seed` |
| `exlib:{version}:all` · `exlib:{version}:q:{sha}` | 1 h | Whole library · matching IDs for one search |
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

## Exercise library (Phase 2)

- **Tables:** `muscles` (20, each with the `body_map_key` of its SVG region), `equipment` (14, with `increment_kg` for the overload coach; NULL = progress by reps), `exercises` (library rows have `owner_user_id` NULL; custom rows belong to a user), and `exercise_secondary_muscles`. A GIN trigram index on `exercises.name` serves fuzzy search.
- **Seed:** `backend/seeds/{muscles,equipment,exercises}.json`, written for RepForge (names and muscle targets are facts; instructions are our own words). `python -m app.commands.seed` (`make seed`) validates the files, then upserts in one transaction.
  - IDs are **UUIDv5 of the slug** (`services/library_seed.library_id`), so every machine and every run produces the same IDs, and phones, routines and workouts can reference library exercises safely.
  - `INSERT … ON CONFLICT (id) DO UPDATE … WHERE (columns) IS DISTINCT FROM (excluded)`: unchanged rows are not rewritten, so `updated_at` and `version` only move when the library really changed. `RETURNING xmax = 0` tells inserts from updates.
  - Library exercises are never deleted, because history points at them: one that leaves the seed is archived (`is_archived`), and restored if it comes back. A seed that changes an existing exercise's `type` is refused.
- **API** (`services/exercises.py`, `routers/exercises.py`): `GET /exercises` merges the library (cached) with the caller's custom exercises (read live, they change often and are few), ranks them together and paginates in memory with a keyset cursor `(−score, name, id)`.
  - **Library version** = hash of `count` and `max(updated_at)` over library rows, kept in Redis `exlib:version` (5 min). The seed deletes that key after a change, so the version moves at once. Every library cache key contains the version, so old entries are simply never read again and expire on their own.
  - `exlib:{version}:all` holds the whole library as JSON (1 h). Muscle and equipment filters run in Python over it. `exlib:{version}:q:{sha}` holds only matching IDs and scores for one search text (1 h), so free-text searches cost little Redis memory.
  - Search runs in Postgres: names containing every word (`ILIKE`, using the trigram index) or fuzzy matches (`name %> q`, word similarity ≥ 0.6). Score = 2 for a prefix match, 1 for contains-all, plus `word_similarity`.
  - **ETag** = hash(library version, the user's custom-exercise stamp (`count`, `max(updated_at)`), filters, cursor, limit). `If-None-Match` → 304 before any listing work. `Cache-Control: private, no-cache` (not `max-age`), so a just-created custom exercise is never hidden by a stale HTTP cache.
  - Redis errors are logged and ignored: the API answers from Postgres, just slower.
- **Body map** (`mobile/src/components/BodyMap.tsx`, logic in `src/bodymap/regions.ts`): drawn with `react-native-body-highlighter` (MIT, SVG). `REGIONS` maps each `body_map_key` to a highlighter region and the figures it shows on: the highlighter has one deltoid and one upper-back region, so front delts light only the front figure, rear delts only the back, and lats share the upper back. Primary muscles are `#E5383B`, secondary `#F4A3A5`, and a primary wins a shared region. Heat-map mode shades each muscle relative to the most-trained one (4 steps). Every other region gets an explicit neutral fill, because the library's male figure hard-codes a dark grey that would ignore the theme.
- **ExerciseMedia** loops `media_video_url` muted (expo-video) with a small body map in the corner showing the figure that holds the primary muscles; without a URL it shows the large front-and-back map. Licensed red-muscle loops can replace it later by setting the URL, with no code change.
- **Offline library on the phone** (`mobile/src/exercises/`): SQLite tables `muscles`, `equipment` and `exercises` mirror the server. `sync.ts` revalidates each list with its stored ETag (kept in `sync_state`), so an unchanged library costs three empty 304s; a changed one is downloaded in full (one page of up to 500) and replaces the rows in one transaction. It runs when the tabs mount and when the library screen opens; concurrent calls share one run. Screens read SQLite through TanStack Query with `networkMode: 'always'`, so nothing waits for the network.
  - **Search runs on the device** (`search.ts`): the server's normalization and alias table (a test checks they match), prefix > contains-every-word > typo-tolerant (each word a subsequence of a name word, e.g. `bnch`). Filters are by primary muscle and equipment.
  - **Custom exercises** are created, edited, duplicated and deleted on the device and queued in the sync outbox (Phase 4), so they work offline. A library refresh keeps custom rows that still have queued changes. Signing out deletes custom rows and the exercises ETag, so the next account never sees them.
  - Screens: `app/exercises/index.tsx` (search, filter chips, "New"), `app/exercise/[id].tsx` (media/body map, muscles, instructions; History from the device, Charts from `/exercises/{id}/stats`; Duplicate, plus Edit/Delete for your own), `app/exercise/form.tsx` (create, or edit with the type shown read-only).

## Sync (Phase 4)

Synced entities: custom exercises, routine folders, routines and finished workouts. Every row has a client-generated UUID, so every write is idempotent.

**Server** (`app/services/sync.py`, `app/db/change_lock.py`)
- Every syncable table has `change_seq BIGINT`, set from one global sequence `sync_change_seq` by a `BEFORE INSERT OR UPDATE` trigger (migration 0007), with an `(owner, change_seq)` index.
- `GET /sync/pull?since=` returns the user's rows with `change_seq > since` across the four tables, oldest first, as full objects or tombstones, plus the new cursor. It reads `(change_seq, id, deleted)` first to pick the page, then loads only those rows.
- **Gap-free cursor:** a sequence value is taken at write time but visible only at commit, so two writers committing out of order could let a pull skip a row forever. Writers hold a per-user transaction advisory lock (exclusive); pull takes it shared and waits for in-flight writes. A `before_flush` hook takes the lock for any syncable row being written; services that lock rows first take it explicitly, to keep one lock order.
- `POST /sync/push` applies up to 100 full-state upserts/deletes in order, each through the same service as its REST endpoint and each on its own (a rejected change is rolled back alone). Conflicts are detected by `base_version` and resolved last-write-wins on the device's `updated_at` (`stale` returns the server copy); deletes win over edits; the workout 24-hour rule answers `workout_immutable` with the server copy.

**Workouts** (`app/services/workouts.py`): `PUT /workouts/{client_uuid}` replaces the whole workout; an identical resave is a no-op. Totals and `workout_muscle_sets` are computed on save; personal records are recomputed from the whole history of the touched exercises in start-time order, so a workout synced late lands in place, and later workouts whose records changed get a new `version`. Saving or deleting bumps the user's stats cache generation (`stats:{user}:gen`).

**Phone** (`mobile/src/sync/`)
- `outbox` SQLite table: one item per row; a second edit replaces the queued state *in place* (keeps its turn, so a custom exercise still goes before the routine using it) and bumps a `revision`.
- `SyncEngine`: push due items in batches of 50, apply each answer's server copy locally, unless the row was edited during the push (then it stays queued, rebased on the server's new version); exponential backoff with jitter (5 s … 5 min) on failure; then pull pages after the stored cursor, skipping rows with queued edits. A finished workout the server refuses is never dropped from the phone (only a deletion elsewhere removes it). Single-flight, with one extra run for changes made mid-sync.
- Triggers (`useSyncEngine`, mounted in the tabs layout): launch, app foreground, NetInfo reconnect (these ignore the backoff), 500 ms after any local change, and every 5 minutes while open. Workouts saved before sync existed are queued once. Logging out with unsent changes asks first; sign-out clears the outbox, cursor and local history.

## Stats (Phase 4)

`GET /stats/summary|muscles|calendar` read the stored aggregates only. Weeks are Monday–Sunday and days are dates in `user_profiles.timezone`. Results are cached 10 minutes under `stats:{user}:{generation}:{kind}`; a workout save or delete bumps the generation, so stale entries become unreachable without scanning keys, and Redis trouble falls back to computing. Ranges past 3 months (`1y`, `all`) go through the single `ensure_pro` gate (PLAN.md G5). Charts on the phone are small `react-native-svg` components over pure geometry in `src/charts/` (victory-native's current release needs a newer Skia than Expo Go ships).
