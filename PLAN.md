# RepForge — Master Build Plan

## Context

`/Users/lallu/Desktop/hevy_clone` is empty apart from `CLAUDE.md`, which specifies RepForge: an original Hevy-style workout tracker with AI nutrition and coaching (Expo RN + FastAPI + Postgres + Redis + Celery + Claude). The user wants a plan that:
- builds the whole thing,
- fills the gaps in the spec (for example, the live elapsed-time counter from starting a workout until finishing it),
- is split into **phases → feature branches**, sized so that each phase runs in **its own chat window, one after another**,
- is pushed to a **public GitHub repo `repforge-ai-fitness-tracker` (https://github.com/vamshi-987/repforge-ai-fitness-tracker)**, with one feature branch per feature, **merged locally into `main` after local tests pass**, then pushed.

CLAUDE.md stays the source of truth for the stack, data model, API, formulas and AI rules. This plan adds sequencing, the missing pieces, and the workflow. It lives at the repo root as `PLAN.md` and is committed in Phase 0, so every later chat window can read it.

Environment facts (checked): macOS 12, Node 24, Python 3.12.3 via pyenv (all Python deps live in `backend/.venv` only — no global installs), Docker 24, pnpm via corepack.

---

## Prerequisites (user does these once, before Phase 0)
1. `gh auth login` (HTTPS, with repo scope).
2. `corepack enable && corepack prepare pnpm@latest --activate`.
3. Docker Desktop running.
4. Expo Go on a physical phone. macOS 12 caps Xcode, so iOS simulators for the latest Expo SDK may not run. Use a phone, or an Android emulator.
5. Get these later, when their phase starts: USDA FDC API key (P6), Anthropic API key (P7), Google/Apple OAuth client IDs (P1, optional, stubbed until present), RevenueCat + EAS account (P9).

---

## Gaps filled (additions to CLAUDE.md)

### G1. Workout elapsed timer + "workout in progress" bar (like Hevy)
- Starting a workout (empty or from a routine) writes `startedAt` (an epoch-ms UTC timestamp) to the Zustand `activeWorkout` store. The store is persisted to a local SQLite table `active_workout(id, payload_json, updated_at)` with a 300 ms debounce.
- **The timer is derived, not counted:** `elapsed = now − startedAt`. A `useNow(1000)` hook re-renders once a second. Because nothing is incremented, the time stays correct after backgrounding, app kill, phone reboot or clock-tick drift.
- On app launch, if an `active_workout` row exists, the store is rehydrated and a **"Resume workout"** prompt appears.
- The **mini bar** is pinned above the tab bar on every tab: it shows the title, a live `HH:MM:SS` and the next set. Tapping it opens `workout/active.tsx`.
- The active screen header shows the live duration, total volume and completed sets.
- **Finish** sets `endedAt = now`. The summary screen lets the user edit start time and duration (for a forgotten finish), title, notes and visibility. **Discard** asks for confirmation, then deletes the row.
- `expo-keep-awake` is on while the active screen is focused (a setting).
- Android shows an ongoing notification with a chronometer (`expo-notifications`, sticky). An iOS Live Activity needs a dev build, so it is deferred to P9 as an optional extra.

### G2. Rest timer details
- Stores `restEndsAt`, never a countdown. Supports +15 s, −15 s and skip.
- Auto-starts when a set is ticked complete, using the per-exercise default (routine value → user default → 90 s).
- Schedules a local notification at `restEndsAt` with a haptic and sound, and cancels it on skip or when the app is in the foreground at expiry.

### G3. Data model additions (new Alembic migrations, in the phase that needs them)
- `refresh_tokens(id, user_id, token_hash, family_id, expires_at, revoked_at, replaced_by)`: rotation with reuse detection, which revokes the whole family.
- `user_settings(user_id PK, theme, default_rest_s, keep_awake, show_burned_kcal, water_cup_sizes INT[], water_reminder_every_h, wake_time, sleep_time, reminders_enabled)`.
- `push_tokens(id, user_id, expo_token UNIQUE, platform, last_seen_at)`.
- `follows.status ENUM('pending','accepted')`: follow requests for private profiles.
- `subscriptions_events(id, user_id, rc_event_id UNIQUE, type, payload JSONB)`: RevenueCat webhook idempotency.
- Mobile local-only: `active_workout`, `outbox(id, entity, entity_id, op, payload, attempts, next_try_at)`, `sync_state(key, value)`.

### G4. Exercise seed content
- 400+ exercises are authored originally in `seeds/exercises.json`: name, type, equipment, primary and secondary muscle slugs, and 3–5 instruction lines in our own words.
- Exercise names and muscle targets are facts and safe to use. Instructions must not be copied from Hevy or ExRx.
- `media_video_url` stays NULL (Option D: a large red BodyMap).
- The seed is idempotent, using stable UUIDv5 values from the slug. A `library_version` bump busts caches.

### G5. Pro limits
- `FREE_ROUTINE_LIMIT=4`, configurable.
- Advanced charts (anything older than 3 months) and the AI coach are Pro-gated through one `require_pro` dependency.
- Until RevenueCat lands in P9, a dev setting `is_pro` is used.

### G6. Timezones
- `log_date` and water days use `user_profiles.timezone`.
- The weekly report job runs **hourly** and picks users whose local time is Monday 06:xx. This satisfies the CLAUDE.md requirement for "06:00 user-local".

### G7. Dev ergonomics
- `make seed-demo` creates a demo user with 8 weeks of workouts, weights and food logs, so charts and coach features can be tested.
- Mobile reads `EXPO_PUBLIC_API_URL`, which must be the LAN IP for a physical phone.

### G8. Phase handoff
- `docs/PROGRESS.md` is a checklist of every feature branch with ✅ or ⬜ and notes. Each phase window reads it first and updates it at the end.

---

## Deviations from CLAUDE.md (approving this plan approves them)
1. **Water reminders are local scheduled notifications.** They are rescheduled on every water log and cancelled once the goal is met. This replaces the hourly Celery push. Reasons: it works offline, and in Expo Go remote push is limited. The Celery job is not built.
2. **Phases are finer-grained than §12** (10 phases instead of 6, same order), so each one fits a single chat window.
3. **The extra tables in G3.**

Everything else follows CLAUDE.md exactly: complete files, every endpoint ships with a schema + service + test + `docs/api.md` entry, Alembic-only DB changes, TypeScript strict mode, and the LLM never acts as the source of truth for numbers.

---

## Repo layout
```
repforge/
  CLAUDE.md  PLAN.md  README.md  LICENSE (MIT)  Makefile  docker-compose.yml  .env.example
  docs/ PROGRESS.md api.md architecture.md
  .github/workflows/ backend.yml mobile.yml
  backend/   (structure per CLAUDE.md §9; pyproject + venv/pip (`backend/.venv`); ruff + mypy + pytest)
  mobile/    (structure per CLAUDE.md §8; pnpm; eslint + tsc + jest)
```

## Docker & caching design
- **docker-compose:**
  - `postgres:16` (with a `pg_trgm` init script)
  - `redis:7`
  - `s3` (SeaweedFS; MinIO no longer publishes Docker images) + `s3-init` (aws-cli creates buckets `media`, `food-photos`, `avatars`)
  - `api` (uvicorn with `--reload` and a bind mount)
  - `worker` (celery)
  - `beat` (celery beat)
  - All have healthchecks. Profile `test` adds a throwaway Postgres for pytest.
- **Backend Dockerfile:** multi-stage build (pip wheel build stage → slim runtime, non-root user). The same image serves api, worker and beat.
- **Redis usage (key → TTL):**
  - `exlib:{library_version}:{filters_hash}` → 1 h. `GET /exercises` also returns an ETag and `Cache-Control: max-age=300`.
  - `foodsearch:{source}:{q_norm}` → 7 d. `off:barcode:{code}` → 30 d (1 d for negative results).
  - `ai:text:{sha256(text)}` → 24 h (as CLAUDE.md requires).
  - `stats:{user}:{range}` → 10 min, deleted when a workout is saved.
  - `jwks:{google|apple}` → 12 h.
  - Rate limits: `rl:photo:{user}:{yyyymmdd}` (5 free / 50 Pro) and `rl:login:{ip}` (sliding window).
- **Client caching:**
  - TanStack Query: exercises `staleTime` 24 h, nutrition day 30 s.
  - SQLite mirrors the exercise library and recent foods for offline use.
  - Media comes from the CDN with long max-age.

## Sync design (P4)
- Every syncable table has `change_seq BIGSERIAL`, bumped by a trigger.
- `GET /sync/pull?since=` returns rows with `change_seq > since` for the user, plus a new cursor.
- `POST /sync/push` takes a batch of `{entity, id, op, payload, version}`. Rules:
  - last-write-wins on `updated_at`
  - finished workouts older than 24 h are rejected with `409 immutable`, and the client then creates a new version
  - every write is idempotent by its client UUID
- Mobile engine:
  - Triggers: app foreground, NetInfo reconnect, after a local write, and every 5 min while foregrounded.
  - Pushes the outbox with exponential backoff, then pulls.

---

## Git workflow (every feature, in every phase)
```bash
git switch main && git pull --ff-only
git switch -c feat/pN-<name>
# implement → small conventional commits (feat:, fix:, test:, docs:)
make -C backend lint test            # if backend touched
(cd mobile && pnpm lint typecheck test)   # if mobile touched
git push -u origin feat/pN-<name>
git switch main && git merge --no-ff feat/pN-<name> && git push origin main
# tick the branch in docs/PROGRESS.md (commit on main)
```
- Merge only when the checks are green.
- If checks fail, fix them on the branch. Never merge red.
- Commit messages end with the `Co-Authored-By` attribution line.
- GitHub Actions also runs on every push, as a second safety net.

## How to run each phase (paste into a new chat window)
> Read CLAUDE.md, PLAN.md and docs/PROGRESS.md. Execute **Phase N** only. For each feature branch listed for Phase N, in order: branch from main, implement fully (complete files, tests, docs/api.md entries, migrations), run the checks, merge `--no-ff` into main, push the branch and main, and tick it in PROGRESS.md. When the phase is done, write its section in docs/IMPLEMENTATION_NOTES.md (what was built, how, why, trade-offs, problems hit) and update docs/RUNBOOK.md if setup or run steps changed. At the end, run the phase's "Done when" checks and report.

---

## Phases

### Phase 0 — Repo & infrastructure
1. `feat/p0-repo-skeleton`
   - `git init`, `.gitignore`, README, MIT license (PLAN.md already at repo root), `PROGRESS.md`, an `api.md` stub, `architecture.md`.
   - `gh repo create repforge-ai-fitness-tracker --public --source . --push`, then `gh auth setup-git` so plain `git push` works.
2. `feat/p0-backend-scaffold`
   - FastAPI `main.py`, `config.py` (pydantic-settings), `/v1/health`.
   - Error envelope handler (`{"error":{code,message,details}}`), JSON logging with a request-id middleware.
   - Async SQLAlchemy session, `alembic init`, pytest + httpx AsyncClient fixtures, Makefile (`lint`, `test`, `migrate`, `seed`), Dockerfile.
3. `feat/p0-docker-compose`
   - The compose stack above, `.env.example`, root Makefile (`up`, `down`, `logs`, `migrate`, `seed`), Celery app with a ping task.
4. `feat/p0-mobile-scaffold`
   - `create-expo-app` (TypeScript), strict tsconfig, Expo Router with the `(auth)` and `(tabs)` groups as placeholders.
   - ESLint/Prettier, Jest + RNTL, a theme tokens file, QueryClient provider, `api/client.ts` (fetch wrapper that parses the error envelope).
   - `expo-sqlite` + Drizzle setup with an empty schema and the migration runner.
5. `feat/p0-ci`
   - `backend.yml` (postgres + redis services → ruff, mypy, pytest) and `mobile.yml` (pnpm lint, typecheck, test).

**Done when:** `make up` gives a healthy stack, `curl /v1/health` returns 200, the app boots in Expo Go and shows the tabs, and CI is green on main.

### Phase 1 — Auth, profile, onboarding, settings
1. `feat/p1-auth-backend`
   - `users` and `refresh_tokens` tables, argon2 hashing.
   - register, login, refresh (rotation + reuse detection), logout.
   - `/auth/google` and `/auth/apple`: verify the id_token against the cached JWKS. Login rate limiting.
2. `feat/p1-profile-backend`
   - `user_profiles` and `user_settings`.
   - `GET/PATCH /me`, `PATCH /me/profile`, `GET/PATCH /me/settings`.
3. `feat/p1-auth-mobile`
   - Login and register screens. Tokens in `expo-secure-store`.
   - 401 → single-flight refresh → retry. Auth gate redirect in the root layout.
4. `feat/p1-onboarding-mobile`
   - `onboarding/[step].tsx`: sex, birth date, height, weight, activity, goal, experience, units, timezone (auto-detected).
5. `feat/p1-settings-mobile`
   - `settings.tsx` (units, theme, rest default, keep awake).
   - `lib/units.ts` (kg↔lb, cm↔in, display rounding) with tests.

**Done when:** a user can register in the app, finish onboarding, kill the app and stay logged in, and a refresh-token reuse revokes the token family (test).

### Phase 2 — Exercise library & red body map
1. `feat/p2-exercise-models-seed`
   - `muscles`, `equipment` and `exercises` tables, plus secondary muscles and trigram indexes.
   - Original seeds: 20 muscles, about 12 equipment types, 400+ exercises. Idempotent `make seed`.
2. `feat/p2-exercise-api`
   - `GET /exercises` (q, muscle, equipment, cursor) with Redis + ETag, `GET /exercises/{id}`.
   - Custom exercise create/update/delete (type immutable after save; returns 422 if changed), `POST /exercises/{id}/duplicate`.
3. `feat/p2-bodymap`
   - `BodyMap.tsx` (front/back views; primary `#E5383B`, secondary `#F4A3A5`, heat-map intensity mode), a mapping from `body_map_key` to the highlighter's regions.
   - `ExerciseMedia.tsx` (video + corner BodyMap, or a large BodyMap fallback). Snapshot tests.
4. `feat/p2-exercise-library-mobile`
   - Library screen with search and equipment/muscle filter chips, mirrored to SQLite for offline use.
   - `exercise/[id].tsx` (media, body map, instructions; History and Charts tabs are placeholders until P4).
   - Custom exercise form with a duplicate action.

**Done when:** searching "bench" offline shows results, and the detail screen shows chest in red with triceps and front delts in light red.

### Phase 3 — Routines & live workout logging (includes G1 and G2)
1. `feat/p3-routines-backend`
   - Folders, routines, routine_exercises and routine_sets CRUD; duplicate; reorder; free-tier limit.
2. `feat/p3-routines-mobile`
   - Routine list with folders, routine editor (pick exercises, sets, rep range, rest, superset grouping, drag reorder), `routine/[id].tsx`, "Start routine".
3. `feat/p3-active-workout-store`
   - Zustand `stores/activeWorkout.ts` (start empty or from a routine, add/remove/reorder exercises and sets, update a set, toggle complete, supersets, notes).
   - Debounced SQLite persistence, rehydrate on launch with a Resume prompt.
   - `useNow` hook and the derived elapsed time. Unit tests, including the kill/rehydrate case.
4. `feat/p3-active-workout-ui`
   - `workout/active.tsx`: header with live timer, volume and sets.
   - `SetRow` with inputs per exercise type, set-type picker (W/N/D/F), RPE sheet, complete tick, and a "Previous" column read from local history.
   - Mini workout bar on all tabs, keep-awake, Android ongoing chronometer notification.
5. `feat/p3-rest-timer`
   - `stores/timer.ts` with `restEndsAt`, the `RestTimer.tsx` sheet (+15, −15, skip), scheduled local notification and haptic.
6. `feat/p3-finish-workout`
   - Finish flow: warns about empty sets, summary with editable start time, duration, title, notes and visibility.
   - `lib/e1rm.ts` and a local records module that compute volume, muscle sets and PRs.
   - Saves to local SQLite `workouts` tables. Summary screen with PR celebration. Discard flow.

**Done when:** you can start a routine, background the app for 3 minutes, and the timer shows the right time. The rest notification fires while the app is backgrounded. You can kill the app mid-workout and resume it, finish, and see a summary with PRs, all offline.

### Phase 4 — Workout backend, sync, history, stats, tools
1. `feat/p4-workouts-backend`
   - Workout tables, `PUT /workouts/{client_uuid}` (idempotent), list (cursor), get, soft delete.
   - `services/stats.py` (volume, `workout_muscle_sets`) and `services/records.py` (PRs) run on save.
   - 24 h immutability rule, Redis stats invalidation.
2. `feat/p4-sync`
   - `change_seq` columns and triggers migration, `services/sync.py`, `/sync/push` and `/sync/pull`.
   - Mobile `sync/outbox.ts` and `sync/engine.ts` (NetInfo, backoff). Covers routines, workouts and custom exercises.
3. `feat/p4-history-mobile`
   - Workout history list, workout detail, edit within 24 h, delete, calendar view.
4. `feat/p4-exercise-stats`
   - `GET /exercises/{id}/history` and `GET /exercises/{id}/stats`.
   - Exercise detail charts in victory-native: heaviest weight, e1RM, best set volume, session volume, total reps. PR list.
5. `feat/p4-stats-dashboard`
   - `/stats/summary`, `/stats/muscles` and `/stats/calendar`, plus streaks.
   - Profile screen with weekly charts and a muscle heat map (BodyMap intensity mode).
6. `feat/p4-tools`
   - Plate calculator (kg and lb plate sets), 1RM calculator, warm-up calculator: pure libs with tests, plus screens.

**Done when:** you can log a workout in airplane mode, turn the network back on, and the workout appears on the server exactly once (retry test). A second device sees it after a pull, and the charts render.

### Phase 5 — Body & water
1. `feat/p5-uploads-body-backend`
   - `/uploads/presign` (SeaweedFS in dev / R2 in prod).
   - CRUD for body weights, measurements and photos. Weight history includes weekly averages.
2. `feat/p5-body-mobile`
   - Weight log with `WeightTrendChart` (daily dots + weekly average line), measurements form, progress photos (camera or library → presigned upload).
3. `feat/p5-water-backend`
   - `water_logs`; `POST /water`, `DELETE /water/{id}`, `GET /water?date=`, `GET /water/history`.
   - Goal service: 35 ml/kg, +500 ml on days with a workout.
4. `feat/p5-water-mobile`
   - `water.tsx` and the home `ProgressRing`, quick-add (editable cup sizes), undo snackbar, history chart.
   - Local reminders between wake and sleep time, cancelled once the goal is met (deviation 1).

**Done when:** a weight logged on 3+ days shows a weekly average, and water reminders stop after the goal is hit.

### Phase 6 — Nutrition (non-AI)
1. `feat/p6-food-models-seed`
   - `foods`, `food_servings` (trigram and barcode indexes), `food_logs`, `saved_meals`, `nutrition_targets`.
   - Curated IFCT seed with attribution. Check the IFCT licence before committing any data.
2. `feat/p6-food-search`
   - `services/food_search.py`: local/custom → cached → USDA FDC → Open Food Facts, normalised to per-100 g and upserted, with Redis caching.
   - `/foods/search` and `/foods/barcode/{code}`.
3. `feat/p6-food-logs-backend`
   - `services/macros.py` (4P+4C+9F, scaling, override flags).
   - Food log CRUD with snapshots, `/nutrition/day`, `/food-logs/copy`, saved meals CRUD, custom foods CRUD.
   - `services/nutrition_engine.py` covers BMR, TDEE and initial targets: `GET/POST /nutrition/targets`, created from the onboarding data.
4. `feat/p6-nutrition-mobile`
   - `nutrition/index.tsx` (meals and daily totals).
   - `nutrition/add.tsx` with Search, Barcode (expo-camera), Recent/Frequent and Saved tabs; Photo and Text tabs are stubbed until P7.
   - `nutrition/food/[id].tsx` (quantity/unit/serving, macro overrides with kcal recompute and a "manual" flag), custom food form, copy meal, save as template.
5. `feat/p6-home-dashboard`
   - `home.tsx` rings (kcal, macros vs targets, water, today's workout) and the "Estimates only, not medical advice" footer.

**Done when:** scanning a real barcode logs the food, and editing protein recomputes kcal. Editing a custom food leaves past logs unchanged.

### Phase 7 — AI layer
1. `feat/p7-ai-client`
   - `ai/client.py` (`claude-sonnet-5-5`, 3 retries with exponential backoff, 30 s timeout, token, latency and feature logging), `ai/schemas.py`, prompt loader.
   - Validate → retry once with the validation error → fall back.
   - Recorded-fixture test harness and an opt-in live smoke test. Redis rate limiter.
2. `feat/p7-food-photo`
   - `POST /nutrition/photo` → 202 → Celery `tasks/photo.py` → vision → `match_query` lookup recomputes macros from the DB → draft. `GET /nutrition/photo/{id}`.
   - Mobile Photo tab, polling, `nutrition/review-photo.tsx` (edit each item, then confirm into food_logs with `source=photo`).
3. `feat/p7-food-text`
   - `POST /nutrition/parse-text` with a 24 h Redis cache, then the same review screen.
4. `feat/p7-weekly-report`
   - Weekly math in `nutrition_engine`: weekly average (needs ≥3 weigh-ins), rate %, adaptive TDEE (≥14 days and ≥80% of days logged), delta_kcal round50 and clamp, safety floors, and the §13 check-in triggers.
   - `weekly_reports`, `GET /coach/weekly-report` and `POST /coach/weekly-report/{id}/apply`.
   - `coach_tips.py` with template fallback, and the hourly beat job for Monday 06:00 local (G6).
   - `coach/weekly.tsx` card with an "Apply new targets" button.
5. `feat/p7-overload-coach`
   - `services/overload.py` (rules 1–5, Epley, increments per equipment, lb users), with table-driven tests at ≥95% coverage.
   - `overload_suggestions`, `/coach/overload` and `/coach/overload/{exercise_id}`, a one-sentence explanation from the LLM.
   - Ghost text in the Previous column ("Try 62.5 kg × 8") on routine start.

**Done when:** a food photo produces an editable draft. With the fixtures, the weekly report matches the hand-computed numbers. Turning off the API key still shows the numbers with template tips.

### Phase 8 — Social & push
1. `feat/p8-social-backend`
   - `follows` (with status), likes, comments, `/feed` (fan-out on read using visibility rules), `/users/{username}`, user search, private profile requests.
2. `feat/p8-push`
   - `push_tokens`, an Expo Push service in a Celery task, events (like, comment, follow, weekly report ready).
3. `feat/p8-social-mobile`
   - Feed on home, user profiles, follow and requests, like and comment, a share workout card (react-native-view-shot + expo-sharing).

**Done when:** user B follows A, sees A's public workout in the feed, likes it, and A gets a push (dev build).

### Phase 9 — Integrations, Pro, observability, release
1. `feat/p9-health`
   - HealthKit / Health Connect: weight import and workout export. Requires an EAS dev build.
2. `feat/p9-data-portability`
   - CSV export/import, `GET /me/export`, `DELETE /me` (hard-delete Celery job within 30 days).
3. `feat/p9-pro`
   - RevenueCat SDK and paywall, webhook → `is_pro` (idempotent), all Pro gates wired to `require_pro`.
4. `feat/p9-observability`
   - Sentry (mobile and API), Prometheus `/metrics`, AI cost dashboard query.
5. `feat/p9-release`
   - EAS build profiles, backend deploy (Fly.io + managed Postgres/Redis + R2), Settings → About attributions (USDA, OFF ODbL, IFCT), store listing copy (no Hevy references), optional iOS Live Activity for the workout timer.

**Done when:** a TestFlight/internal-track build works against the deployed API.

---

## Verification (applies to every phase)
- Backend: `make -C backend lint test` (ruff, mypy, pytest; services coverage ≥95%) against Postgres from docker-compose.
- Mobile: `pnpm lint typecheck test`. Run it manually in Expo Go on the phone, pointed at `make up`.
- Each phase's **Done when** list is checked by hand and recorded in `docs/PROGRESS.md`.
- Maestro E2E (CLAUDE.md §11) is added in P9 for the three flows: offline workout → sync, photo → confirm, apply weekly targets.

## Immediate next step after approval (this window)
Run Phase 0. First confirm that `gh auth status` succeeds and pnpm is available; if either fails, stop and ask the user to finish the prerequisites.
