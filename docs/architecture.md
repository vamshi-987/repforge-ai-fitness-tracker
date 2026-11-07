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

## Body and water (Phase 5)

- **Weigh-ins, measurements and drinks** are offline-synced rows (`body_weight`, `body_measurement`, `water_log`): logged on the phone, queued in the outbox, and written on the server through the same `put_*` services as REST. The phone keeps them in SQLite (`body_weights`, `body_measurements`, `water_logs`). Adding a synced entity bumps the phone's cursor key (`sync:cursor:v4` since Phase 6), so phones that already synced pull once from 0 and receive older rows of the new entities.
- **Weekly weight average** (server `services/body.py`, phone `src/body/trend.ts`, same rules): Monday weeks in local time, an average only from 3 weigh-ins. The trend chart draws every weigh-in as a dot and the weekly averages as a line on one shared scale.
- **Progress photos** never pass through the API. `POST /uploads/presign` signs a PUT URL (AWS Signature V4, written in `services/storage.py` and pinned to AWS's published example; path-style, so SeaweedFS in dev and R2 in prod) under `progress-photos/<user id>/…`; the phone uploads the file directly, then records the key. Listing signs 1-hour GET URLs, so the bucket stays private. `S3_PUBLIC_URL` is the address the phone sees (the signature covers the host).
- **Water goal** (server `services/water.py`, phone `src/water/rules.ts`): 35 ml per kg of the latest weigh-in, rounded to 50 ml, or the user's own goal; plus 500 ml on a day with a workout. Days are local dates bounded at local midnight.
- **Water reminders are local notifications** (PLAN.md deviation 1): every N hours between wake and sleep time, re-planned on every drink, launch, foreground and sync. Once the day's goal is met none remain for today; tomorrow's are always scheduled so they fire even if the app isn't opened.

## Nutrition (Phase 6)

- **Food library:** `foods` holds library foods (no owner) and each user's custom foods. The seed is 56 USDA FoodData Central foods (`make seed`). Search goes custom foods → library → USDA → Open Food Facts; what is found online is normalised to per-100 g, saved to the library, and the query's result ids are cached in Redis for 7 days. A record with impossible values (kJ in the kcal field, more than 100 g of a macro per 100 g) is dropped there, because a log of it could never validate. IFCT data isn't shipped (NIN/ICMR copyright); `app.commands.import_foods --source ifct` imports a licensed CSV from the git-ignored `backend/seeds/private/`.
- **Logs are snapshots.** A `food_logs` row keeps the food's name and per-100 g values, so editing or deleting a food never changes history. Its amounts come from one rule, on the server in `services/macros.py` and on the phone in `src/lib/macros.ts`: scaled by grams; edited macros make calories follow as 4P + 4C + 9F (`macros_overridden`); calories typed by hand stay as typed (`kcal_overridden`, shown as "manual").
- **Offline first:** custom foods, logs and saved meals sync as `food`, `food_log` and `saved_meal`. The phone works from SQLite (`foods`, `food_logs`, `saved_meals`). Library foods are not pulled: a food reaches the phone when the user picks it, which is what makes it available offline. Recent and Frequent are computed from the local logs, and repeating one starts from the earlier log's snapshot, so it works even if the food is gone. Only online search and new barcodes need a connection.
- **Targets** are computed once from the onboarding answers (`services/nutrition_engine.py`: Mifflin-St Jeor × activity, the goal's weekly rate, never below `max(BMR, 1200 or 1500)`; protein 1.8 g/kg, fat at least 0.6 g/kg, carbs fill the rest) and stored as dated `nutrition_targets` rows. They aren't a sync entity: the phone reads them from the API and keeps the last answer in SQLite for offline days.
- **Barcode scanning** uses `expo-camera`; a code goes to the device first, then `GET /foods/barcode/{code}`, which asks Open Food Facts for one it doesn't know.

## AI layer (Phase 7)

- **One rule:** the LLM perceives (food photos, free text) and explains (tips, one-line reasons). It never decides a number the user acts on. `services/nutrition_engine.py` and `services/overload.py` compute targets and lifts, and both work with the LLM off.
- **`app/ai/client.py`** is the only code that calls Claude: model `claude-sonnet-5-5`, 30 s timeout, 3 SDK retries with exponential backoff, and `model`, tokens, latency and feature logged per call. Every call asks for JSON through `output_config.format` from a Pydantic model and validates the reply; an invalid reply is retried once with the error appended, then the caller falls back. Sampling parameters aren't sent, because this model accepts only their defaults. `fallbacks: "default"` re-runs a safety decline on another model where that category allows it.
- **Food photos** are asynchronous: `POST /nutrition/photo` stores the image in the `food-photos` bucket and answers 202, a Celery task (`workers/tasks/photo.py`) reads it, and the app polls. Each task opens its own NullPool engine and client because it runs in its own event loop. `ai/food_vision.py` looks every item up with `closest_food` (pg_trgm similarity of at least 0.5): a match takes the database's per-100 g values, otherwise the model's estimate becomes per-100 g values so the draft still scales.
- **Drafts are not logs.** Photo and text give the same draft, the review screen edits each row with the same rules as any entry, and confirming writes ordinary offline-first logs with `source` `photo` or `text`.
- **Free text** is synchronous, with the model's answer cached in Redis for 24 hours by normalised text. Matching runs per request, because custom foods differ per user.
- **Limits:** photos 5 a day free and 50 Pro, new texts 20 and 200, on the existing Redis sliding window. Without an API key both answer 503 `ai_unavailable` and the app offers manual entry.
- **Weekly report** (Pro): a finished Monday-to-Sunday week in the user's timezone, computed on first read and by an hourly beat job at Monday 06:00 local. Stored once it has data; a report short of data is recomputed on each read. Targets change only through `POST /coach/weekly-report/{id}/apply`. New calories are the current target plus the clamped delta; adaptive TDEE is shown beside it, not used as the base, so a logging gap can't swing the target. Safety messages (the check-in and the calorie floor) are fixed text placed first, so they never depend on the LLM.
- **Overload coach** (Pro): `services/overload.py` is pure; `services/overload_coach.py` reads the last six sessions, keeps the latest suggestion in `overload_suggestions`, and only recomputes after a newer session or with another rep range, so starting a routine twice makes no LLM calls. New suggestions in one routine ask for their sentences concurrently, with no database transaction held open. The active workout shows the target as ghost text beside the previous set; free accounts and offline starts just don't see it.

## Social and push (Phase 8)

- **Who sees a workout** is one SQL expression, `_visible` in `services/social.py`, used by every read: the owner always; `private` nobody else; `followers` accepted followers; `public` anyone unless the profile is private, when it needs an accepted follow too. Anything hidden answers 404, so its existence isn't revealed.
- **The feed is fan-out on read:** one query over the viewer's accepted followees, paged on `(started_at, id)`, which the existing workouts index serves. There are no per-follower copies to keep in step. Likes and comments are counted per page, not per row.
- **Follows** have a status. A private profile gets `pending` rows until they're accepted; making a profile public accepts everything waiting. Removing a follower cuts their access at once, because nothing was copied to them.
- **Social data is online only.** It belongs to other people, so it lives in TanStack Query and says so when there's no connection. Workouts are still written offline first, and they reach the feed once they've synced.
- **Likes are optimistic:** the count moves at once and goes back if the server refuses.
- **Push** is best effort. Events call a `Notify` function, which queues a Celery task and never raises, so a dead broker can't fail a like. The worker posts to Expo in batches of 100 and forgets tokens that come back `DeviceNotRegistered`. Expo's delayed receipts aren't read, so a device that goes away later is only dropped on the next send's ticket. A token moves to whoever signed in last, and sign-out removes it, so a shared phone only notifies the person using it. A tapped push opens `data.path`, and the app only accepts `/social/…` and `/coach/weekly`.
- **Share cards** are a normal React Native view captured with `react-native-view-shot` and handed to `expo-sharing`.

## Integrations and operations (Phase 9)

- **Native extras are optional at runtime.** Apple Health, Health Connect and RevenueCat load through dynamic imports behind thin wrappers (`src/health/bridge.ts`, `src/pro/purchases.ts`) that answer null when the module isn't there, so Expo Go keeps working and the screens say what's missing.
- **Health** imports weigh-ins with `source: "health"` on launch and on return to the app. A sample's own UUID becomes the row's id, so it can only come in once. Finished workouts go out as strength sessions.
- **Pro** has one source of truth: `users.is_pro`, changed only by RevenueCat's webhook (`services/billing.py`). Event ids make redelivery harmless, and event times stop a late old event overriding a newer one. The app never decides Pro itself: after a purchase it polls `/me`.
- **Your data:** `GET /me/export` returns everything; workouts also go out and back as CSV. Import goes through `put_workout`, so totals and records are computed the same way as any save.
- **Closing an account** revokes sessions and push tokens and hides it at once. `account.purge_deleted` runs daily and erases accounts closed 28 days ago, photos first, so storage trouble delays an erase rather than orphaning a file. Workouts, records, routines and saved meals are deleted explicitly, because RESTRICT keys from them hold the custom exercises and foods that the cascade removes.
- **Observability:** Sentry reports from the API, workers and app when a DSN is set, without request bodies, tokens or personal details. `/metrics` serves Prometheus counters labelled by route template. `app.commands.ai_costs` turns `ai_call` log lines into a cost per day and feature, which covers workers too, since their counters aren't scraped.
- **Deployment:** one image, with `app`, `worker` and `beat` process groups on Fly.io, and migrations in the release step.

