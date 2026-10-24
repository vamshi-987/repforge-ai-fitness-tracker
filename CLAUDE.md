# CLAUDE.md — RepForge (Hevy-style workout tracker + AI nutrition & coaching)

> Working name: **RepForge**. This is an original app inspired by Hevy's feature set.
> Do NOT use Hevy's name, logo, UI assets, exercise animations, or copied text anywhere in the code or store listing.

---

## 0. How Claude should work in this repo

- Always output **complete files**, never partial diffs or "...rest unchanged" snippets.
- Read this file before any task. If a task conflicts with this file, ask before deviating.
- Keep business logic deterministic and testable. The LLM is used for **perception** (food photos, free-text parsing) and **explanation** (tips, coaching copy) — never as the source of truth for numbers (calories, targets, weights to lift).
- Every new endpoint needs: Pydantic schema, service function, unit test, and an entry in `docs/api.md`.
- Every DB change goes through an Alembic migration. Never edit an old migration.
- Mobile: TypeScript strict mode. No `any` unless commented with a reason.
- Run before committing: `make lint test` (backend) and `pnpm lint typecheck test` (mobile).

---

## 1. What Hevy is (public facts vs. inference)

### Confirmed from public sources (job posts, talks, help center)
| Area | Fact |
|---|---|
| Mobile | One React Native codebase for iOS + Android |
| Web | React (shares logic/patterns with mobile) |
| Backend | Node.js + TypeScript |
| Database | PostgreSQL (relational) |
| Scale | Millions of users; backend saves ~10–20 workouts/second; realtime sync is a stated challenge |
| Wearables | Apple Watch (watchOS) and Wear OS apps (native) |
| Exercise library | 400+ exercises, each with a demo animation, primary + secondary muscle targets, equipment filter; users can create/duplicate custom exercises; exercise *type* is immutable after save |

### Inferred (reasonable but not confirmed — treat as design guesses)
- Offline-first client: workouts are logged locally and synced; a client-generated UUID makes saves idempotent.
- Pre-rendered exercise animations (short looping MP4/GIF/WebP) served from a CDN, plus a separate SVG body map for the muscle-distribution stats screen.
- Push notifications via APNs/FCM; social feed fan-out on read for most users.
- Subscriptions via RevenueCat-style IAP wrapper (Hevy Pro).

### How Hevy shows "muscle highlighted in red" in exercise videos
The red muscles are **baked into the animation itself** — a 3D anatomical model is animated in a tool like Blender/Cinema 4D/Maya and the working muscles are rendered red. The app just plays the loop. This is a commercial asset category (licensed packs or commissioned work), not something generated at runtime.

**We cannot reuse Hevy's animations.** Our options (pick one in Phase 1, keep the media layer swappable):

| Option | Cost | Notes |
|---|---|---|
| A. Open/free dataset (ExerciseDB-style GIFs, RepDB free tier) | Free–low | Check each dataset's license; many GIF sets are copyrighted by third parties even if the JSON is open. Attribution required. |
| B. Licensed library (ExRx API, WorkoutLabs, Lottie fitness packs, Envato muscle-highlight clips) | $–$$ | Commercial-safe, consistent style |
| C. Commission 3D loops with red muscle highlights (freelancer, Blender) | $40–100/exercise | Exactly the Hevy look; start with 20 core lifts |
| **D. Runtime overlay (default for MVP)** | Free | Play any demo loop + render an SVG body map beside/under it with target muscles filled red (primary) and light red (secondary). Use `react-native-body-highlighter` or our own SVG. |

MVP ships **D**, built so the media URL can later point to licensed/commissioned red-muscle loops (B/C) with zero code change.

---

## 2. Tech stack (ours)

Chosen to mirror Hevy's architecture while using a Python backend (strong AI ecosystem, matches team skills).

| Layer | Choice |
|---|---|
| Mobile | Expo (React Native) + TypeScript, Expo Router |
| Local DB | `expo-sqlite` + Drizzle ORM (offline-first) |
| State | Zustand (UI state) + TanStack Query (server state) |
| Charts | `victory-native` |
| Body map | `react-native-svg` (+ `react-native-body-highlighter`) |
| Video | `expo-video` (looping, muted, autoplay) |
| Camera/Barcode | `expo-camera` (photo + barcode scanning) |
| Notifications | `expo-notifications` (water reminders, rest timer) |
| Health | Apple HealthKit / Google Health Connect (weight import, workout export) |
| Backend API | FastAPI (Python 3.12), Pydantic v2 |
| ORM/Migrations | SQLAlchemy 2.0 (async) + Alembic |
| DB | PostgreSQL 16 |
| Cache / queues | Redis (cache, rate limits, Celery broker) |
| Background jobs | Celery (photo analysis, weekly reports, feed fan-out) |
| Object storage | S3-compatible (Cloudflare R2) + CDN for media |
| Auth | JWT (access 15 min + refresh 30 days, rotated), Google & Apple sign-in |
| AI | Anthropic Claude API, model `claude-sonnet-5-5` (vision + structured JSON) |
| Food data | USDA FoodData Central, Open Food Facts (barcodes), Indian Food Composition Tables (IFCT) seed for Indian dishes |
| Payments | RevenueCat (Pro subscription) |
| Observability | Sentry (mobile + API), structured JSON logs, Prometheus metrics |
| Infra | Docker Compose (dev), single VPS/Render/Fly.io (MVP), GitHub Actions CI |

---

## 3. System architecture

```
┌──────────────────────── Mobile (Expo RN) ────────────────────────┐
│ UI screens → Zustand / TanStack Query                            │
│ Local SQLite (source of truth while offline)                     │
│ Sync engine: outbox queue → POST /sync/push, GET /sync/pull      │
└───────────────┬──────────────────────────────────────────────────┘
                │ HTTPS (JWT)
┌───────────────▼────────────── FastAPI ───────────────────────────┐
│ routers/  auth · workouts · routines · exercises · stats         │
│           nutrition · water · body · coach · social · sync       │
│ services/ pure domain logic (overload engine, calorie engine)    │
│ ai/       Claude client, prompts, JSON schema validation         │
└──────┬──────────────┬─────────────────┬──────────────────────────┘
       │              │                 │
  PostgreSQL        Redis          Celery workers ──► Claude API
  (all data)   (cache, limits,     (photo → food items,
                broker)             weekly reports, fan-out)
       │
  R2/S3 + CDN (exercise media, food photos, avatars)
```

### Key design decisions
1. **Offline-first logging.** A workout in progress lives only on the device. On finish, it is written to SQLite and enqueued. The server accepts `PUT /workouts/{client_uuid}` — idempotent, so retries never duplicate.
2. **Sync model.** Every syncable row has `id (uuid, client-generated)`, `updated_at`, `deleted_at` (soft delete), `version`. Pull uses `?since=<server_cursor>`. Conflict rule: last-write-wins per row, except finished workouts which are immutable after 24h (edits create a new version).
3. **Deterministic engines, LLM for words.** `services/overload.py` and `services/nutrition_engine.py` compute every number. The LLM receives those numbers and writes 2–4 short tips. If the LLM fails, show the numbers with template tips.
4. **Photo analysis is async.** Upload → `202 Accepted` with `analysis_id` → Celery calls Claude → client polls or gets a push. Result is a **draft** the user must confirm/edit before it becomes a food log.
5. **Denormalized stats.** Per-workout aggregates (volume, sets per muscle) are computed on save and stored, so charts never scan raw sets.

---

## 4. Feature list

### 4.1 Hevy parity (core)
- **Workout logging:** add exercises, sets (weight × reps, bodyweight reps, duration, distance), set types (warm-up, normal, drop, failure), RPE, notes per exercise, supersets, reorder, "previous" column showing last session's values.
- **Rest timer:** per-exercise default, auto-start on set complete, notification + haptic when done, works in background.
- **Routines:** create, edit, folders, duplicate, start workout from routine; explore pre-made programs.
- **Exercise library:** 400+ seeded exercises; filter by equipment & muscle; search; custom exercises (primary + secondary muscles, type immutable after save); duplicate to custom.
- **Exercise detail:** looping demo + red body map (see §1), instructions, history, PRs, charts (heaviest weight, est. 1RM, best set volume, session volume, total reps).
- **Personal records:** detected on save and celebrated.
- **Stats:** weekly workouts, volume, duration, sets per muscle group (body heat map), calendar view, streaks.
- **Body measurements:** weight, body fat %, circumferences, progress photos.
- **Tools:** plate calculator, 1RM calculator, warm-up set calculator.
- **Social:** follow users, feed of workouts, likes, comments, share workout card image, public/private profile.
- **Integrations:** Apple Health / Health Connect, CSV export/import.
- **Pro subscription:** unlimited routines, advanced charts, AI coach features.
- **Settings:** units (kg/lb, cm/in), theme, rest timer defaults, notifications.

### 4.2 New AI features

#### A. Weekly weight trend + calorie adjustment
- User logs weight (manually or from Health). Goal = `muscle_gain` | `fat_loss` | `maintain`.
- **Weekly average** = mean of that week's weigh-ins (need ≥3; else show "log more weigh-ins").
- **Weekly change** = `avg_this_week − avg_last_week` (kg) and as % of body weight.
- **Target rate per week:**
  - muscle_gain: +0.25% to +0.5% BW (beginners up to +0.5%, advanced +0.25%)
  - fat_loss: −0.5% to −1.0% BW
  - maintain: −0.2% to +0.2% BW
- **Adaptive TDEE** (once ≥14 days of intake + weight data):
  `TDEE ≈ avg_daily_kcal_intake − (Δweight_kg × 7700 / days)`
  Before that, use Mifflin-St Jeor BMR × activity factor.
- **Adjustment:** `delta_kcal = (target_rate_kg − actual_rate_kg) × 7700 / 7`, rounded to nearest 50, clamped to ±300/day per week. Never set a target below `max(BMR, 1200)` (women) / `max(BMR, 1500)` (men); if hit, the tip recommends slowing down instead.
- **Protein target:** 1.6–2.2 g/kg BW (default 1.8). Fat ≥ 0.6 g/kg. Carbs fill the rest.
- **Output card:** weekly avg, change, on-track/too-fast/too-slow badge, new kcal & macro targets, 2–4 LLM tips (food swaps, meal timing, training notes). User taps "Apply new targets" — never auto-applied.

#### B. Progressive overload coach
Runs per exercise when a routine is started and after each finished workout.
- Inputs: last 6 sessions of that exercise (sets, reps, weight, RPE), routine rep range (e.g. 8–12), equipment increment.
- **Rules (double progression):**
  1. All working sets hit top of rep range at RPE ≤ 8 → **increase weight** by smallest increment (barbell 2.5 kg, dumbbell 1–2 kg, machine 1 stack plate, bodyweight → add reps or weight vest).
  2. Reps within range → **same weight, aim +1 rep** on the weakest set.
  3. Below bottom of range two sessions in a row → **reduce weight 5–10%**.
  4. No e1RM improvement in 3+ sessions (plateau) → suggest **deload week** (−10% weight, −1 set) or a variation swap.
  5. Missing RPE → assume RPE 8.
- **e1RM (Epley):** `w × (1 + reps / 30)`; reps > 12 is flagged as low-accuracy.
- Shows suggested target per set in the "previous" column ("Try 62.5 kg × 8"). LLM adds one sentence of reasoning per exercise + a weekly overview.

#### C. Water tracker
- Daily goal default `35 ml × body_weight_kg`, +500 ml on workout days (editable).
- Quick-add buttons (250 / 500 / 750 ml, custom), undo, cup sizes editable.
- Progress ring on home screen; history chart.
- Reminders every N hours between wake/sleep times; suppressed once goal met.

#### D. Calorie & macro tracker
- **Meals:** breakfast, lunch, dinner, snacks (configurable).
- **Add food via:**
  1. Search (local custom foods → cached foods → USDA/Open Food Facts/IFCT).
  2. Barcode scan → Open Food Facts.
  3. **Photo** → Claude vision → draft list of items with estimated grams, kcal and macros + confidence → user edits each item (name, quantity, unit, macros) → confirm.
  4. Free text ("2 rotis and a bowl of dal") → Claude parses → same draft flow.
  5. Recent / frequent / saved meals.
- **Quantity:** grams, ml, pieces, servings (each food can define serving sizes).
- **Editable macros:** on any log entry, user can override protein/carbs/fat/fiber. Calories recompute as `4P + 4C + 9F` unless the user sets an explicit kcal override (then flagged "manual").
- **Custom foods:** create, edit, delete own foods (per 100 g or per serving). Edits do not rewrite past logs (logs store a snapshot).
- **Remove/edit logs**, copy a meal to another day, save a meal as a template.
- **Daily dashboard:** kcal ring, macro bars vs targets from feature A, water, workouts burned (display only, not added back by default — setting).

---

## 5. Data model (PostgreSQL)

All PKs are UUIDs (client-generatable). All syncable tables include `created_at`, `updated_at`, `deleted_at`, `version INT`.

```sql
-- users & profile
users(id, email UNIQUE, password_hash NULL, auth_provider, username UNIQUE,
      display_name, avatar_url, is_private BOOL, is_pro BOOL, created_at, ...)
user_profiles(user_id PK FK, sex, birth_date, height_cm, activity_level,
              goal ENUM('muscle_gain','fat_loss','maintain'),
              experience ENUM('beginner','intermediate','advanced'),
              unit_weight ENUM('kg','lb'), unit_length ENUM('cm','in'),
              water_goal_ml INT NULL, timezone)

-- exercise library
muscles(id, slug UNIQUE, name, body_map_key)        -- body_map_key = SVG region id
equipment(id, slug UNIQUE, name, increment_kg NUMERIC)
exercises(id, owner_user_id NULL,                     -- NULL = global library
          name, type ENUM('weight_reps','bodyweight_reps','weighted_bodyweight',
                          'assisted_bodyweight','duration','distance_duration'),
          equipment_id FK, primary_muscle_id FK,
          media_video_url NULL, media_thumb_url NULL, media_license TEXT NULL,
          instructions TEXT[], is_archived BOOL)
exercise_secondary_muscles(exercise_id FK, muscle_id FK, PRIMARY KEY(both))

-- routines
routine_folders(id, user_id, name, position)
routines(id, user_id, folder_id NULL, name, notes, position)
routine_exercises(id, routine_id, exercise_id, position, superset_group INT NULL,
                  rest_seconds INT, rep_range_min INT NULL, rep_range_max INT NULL, notes)
routine_sets(id, routine_exercise_id, position, set_type, target_weight_kg NULL,
             target_reps NULL, target_duration_s NULL)

-- workouts (immutable-ish history)
workouts(id, user_id, routine_id NULL, title, notes, started_at, ended_at,
         total_volume_kg NUMERIC, total_sets INT, visibility ENUM('public','followers','private'))
workout_exercises(id, workout_id, exercise_id, position, superset_group NULL, notes)
workout_sets(id, workout_exercise_id, position,
             set_type ENUM('warmup','normal','drop','failure'),
             weight_kg NUMERIC NULL, reps INT NULL, duration_s INT NULL,
             distance_m NUMERIC NULL, rpe NUMERIC(3,1) NULL, completed BOOL)
workout_muscle_sets(workout_id, muscle_id, sets NUMERIC)   -- primary=1, secondary=0.5
personal_records(id, user_id, exercise_id, record_type ENUM('heaviest','e1rm',
                 'best_set_volume','session_volume','most_reps'),
                 value NUMERIC, workout_set_id, achieved_at)

-- body
body_weights(id, user_id, measured_at, weight_kg NUMERIC, source ENUM('manual','health'))
body_measurements(id, user_id, measured_at, kind, value NUMERIC)  -- waist, chest, bf% ...
progress_photos(id, user_id, taken_at, url)

-- nutrition
foods(id, owner_user_id NULL, source ENUM('usda','off','ifct','custom','ai'),
      external_id NULL, barcode NULL, name, brand NULL,
      kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g NULL,
      UNIQUE(source, external_id))
food_servings(id, food_id, label, grams NUMERIC)               -- "1 roti" = 40 g
food_logs(id, user_id, log_date DATE, meal ENUM('breakfast','lunch','dinner','snack'),
          food_id NULL, name_snapshot, quantity NUMERIC, unit, grams NUMERIC,
          kcal NUMERIC, protein_g, carbs_g, fat_g, fiber_g NULL,
          macros_overridden BOOL, kcal_overridden BOOL,
          source ENUM('search','barcode','photo','text','recent','manual'),
          photo_analysis_id NULL)
saved_meals(id, user_id, name) ; saved_meal_items(id, saved_meal_id, food_id, grams)
nutrition_targets(id, user_id, effective_from DATE, kcal, protein_g, carbs_g, fat_g,
                  reason ENUM('initial','weekly_adjustment','manual'))
photo_analyses(id, user_id, image_url, status ENUM('pending','done','failed'),
               result_json JSONB NULL, model, error NULL, created_at)

-- water
water_logs(id, user_id, logged_at, amount_ml INT)

-- AI coaching
weekly_reports(id, user_id, week_start DATE, avg_weight_kg, prev_avg_weight_kg,
               rate_pct NUMERIC, status ENUM('on_track','too_fast','too_slow','insufficient_data'),
               suggested_targets JSONB, tips TEXT[], applied BOOL, created_at,
               UNIQUE(user_id, week_start))
overload_suggestions(id, user_id, exercise_id, generated_at, rule ENUM('increase_weight',
                     'add_reps','reduce_weight','deload','swap'),
                     target_json JSONB, explanation TEXT)

-- social
follows(follower_id, followee_id, created_at, PRIMARY KEY(both))
workout_likes(workout_id, user_id, PRIMARY KEY(both))
workout_comments(id, workout_id, user_id, body, created_at)

-- sync
sync_cursors: use a global BIGSERIAL `change_seq` column on each syncable table,
              bumped by trigger on insert/update.
```

Indexes: `(user_id, started_at DESC)` on workouts; `(user_id, log_date)` on food_logs; `(user_id, measured_at)` on body_weights; `(user_id, logged_at)` on water_logs; GIN trigram on `foods.name` and `exercises.name`; `(barcode)` on foods.

---

## 6. API (FastAPI, prefix `/v1`)

```
Auth        POST /auth/register · /auth/login · /auth/refresh · /auth/google · /auth/apple
Profile     GET/PATCH /me · PATCH /me/profile
Exercises   GET /exercises?q=&muscle=&equipment= · GET /exercises/{id}
            POST/PATCH/DELETE /exercises (custom) · POST /exercises/{id}/duplicate
            GET /exercises/{id}/history · GET /exercises/{id}/stats
Routines    CRUD /routines · CRUD /routine-folders · POST /routines/{id}/duplicate
Workouts    PUT /workouts/{client_uuid} (idempotent create/update)
            GET /workouts?cursor= · GET /workouts/{id} · DELETE /workouts/{id}
Stats       GET /stats/summary?range= · GET /stats/muscles?range= · GET /stats/calendar?month=
Body        CRUD /body/weights · CRUD /body/measurements · CRUD /body/photos
Water       POST /water · DELETE /water/{id} · GET /water?date= · GET /water/history?range=
Nutrition   GET /foods/search?q= · GET /foods/barcode/{code} · CRUD /foods (custom)
            CRUD /food-logs · GET /nutrition/day?date= · POST /food-logs/copy
            CRUD /saved-meals
            POST /nutrition/photo  (multipart) -> 202 {analysis_id}
            GET  /nutrition/photo/{analysis_id}
            POST /nutrition/parse-text {text} -> draft items
            GET/POST /nutrition/targets
Coach       GET  /coach/weekly-report?week=   (computes if missing)
            POST /coach/weekly-report/{id}/apply
            GET  /coach/overload?routine_id=  (per-exercise suggestions)
            GET  /coach/overload/{exercise_id}
Social      POST/DELETE /users/{id}/follow · GET /feed?cursor= · POST /workouts/{id}/like
            CRUD /workouts/{id}/comments · GET /users/{username}
Sync        POST /sync/push {changes[]} · GET /sync/pull?since=
Uploads     POST /uploads/presign {kind} -> presigned R2 URL
```

Conventions: cursor pagination (`?cursor=&limit=`), errors as `{"error": {"code", "message", "details"}}`, all weights stored in kg and converted on the client, all timestamps UTC ISO-8601, dates in the user's timezone for `log_date`.

---

## 7. AI layer (`backend/app/ai/`)

```
ai/
  client.py          # Anthropic client, retries (3, exponential), timeout 30s, token logging
  schemas.py         # Pydantic models for every LLM JSON output
  prompts/
    food_photo.md
    food_text.md
    weekly_tips.md
    overload_explain.md
  food_vision.py
  coach_tips.py
```

Rules:
- Model: `claude-sonnet-5-5`. Temperature 0 for food extraction, 0.4 for tips.
- Every LLM call returns JSON validated against a Pydantic schema. On validation failure, retry once with the error appended; then fall back (template tips / "couldn't analyze, add manually").
- Never send PII beyond what's needed (no email, no name). Send age band, sex, goal, numbers.
- Cache: identical text parse inputs → Redis 24h.
- Rate limits (Redis): free users 5 photo analyses/day, Pro 50/day.
- Log `model, input_tokens, output_tokens, latency_ms, feature` per call for cost tracking.

### Food photo output schema
```json
{
  "items": [
    {
      "name": "chicken biryani",
      "estimated_grams": 350,
      "kcal": 560,
      "protein_g": 28,
      "carbs_g": 70,
      "fat_g": 18,
      "confidence": 0.7,
      "match_query": "chicken biryani"
    }
  ],
  "notes": "Portion estimated from plate size; oil content may be higher."
}
```
After the LLM returns, `food_vision.py` tries to match each `match_query` against the `foods` table; if a good match exists, recompute macros from that food's per-100g values × grams (more reliable than LLM numbers) and keep the LLM values only as fallback. Mark result as draft.

### Food photo prompt (summary)
"You are a nutrition estimation assistant. Identify each distinct food in the image, estimate cooked portion weight in grams using visible cues (plate ~25 cm, spoon, hand). Prefer Indian dish names when applicable. Return ONLY JSON matching the schema. If no food is visible, return `{"items": [], "notes": "no food detected"}`."

### Weekly tips prompt inputs
`goal, experience, weekly_avg, prev_avg, rate_pct, target_rate_range, status, old_targets, new_targets, avg_protein_g, avg_kcal_logged, days_logged, workouts_this_week` → returns `{"tips": [string, ...max 4], "headline": string}`. Prompt must forbid medical claims and suggest seeing a professional for rapid unexplained weight change.

### Overload explanation prompt inputs
Rule chosen by the engine + last 3 sessions + target → returns `{"explanation": string <= 160 chars}`.

---

## 8. Mobile app structure

```
mobile/
  app/                          # Expo Router
    (auth)/login.tsx, register.tsx, onboarding/[step].tsx
    (tabs)/
      home.tsx                  # feed + today's rings (kcal, water, workout)
      workout/index.tsx         # start empty / routines list
      workout/active.tsx        # live logging screen
      nutrition/index.tsx       # day view, meals
      nutrition/add.tsx         # search / barcode / photo / text tabs
      nutrition/review-photo.tsx# edit AI draft items
      nutrition/food/[id].tsx   # edit food & macros
      profile/index.tsx         # stats, calendar, measurements
    exercise/[id].tsx           # video + body map + history + charts
    routine/[id].tsx
    coach/weekly.tsx            # weekly report card
    water.tsx
    settings.tsx
  src/
    db/schema.ts, client.ts, migrations/
    sync/engine.ts, outbox.ts
    api/client.ts, hooks/*.ts
    stores/activeWorkout.ts, timer.ts
    components/
      BodyMap.tsx               # SVG front/back; props: primary[], secondary[]
      ExerciseMedia.tsx         # expo-video loop + BodyMap fallback
      SetRow.tsx, RestTimer.tsx, MacroBar.tsx, ProgressRing.tsx, WeightTrendChart.tsx
    lib/units.ts, e1rm.ts, macros.ts
```

### `ExerciseMedia` behavior (the "red muscle" feature)
- If `media_video_url` exists → loop it muted, autoplay; overlay small `BodyMap` in the corner.
- If not → show large `BodyMap` with primary muscles `#E5383B` (red) and secondary `#F4A3A5` (light red).
- `BodyMap` regions keyed by `muscles.body_map_key` (chest, front_delts, side_delts, rear_delts, biceps, triceps, forearms, abs, obliques, lats, upper_back, traps, lower_back, glutes, quads, hamstrings, adductors, abductors, calves, neck).
- Same component powers the stats "muscles trained this week" heat map (intensity = sets).

### Active workout screen rules
- State in Zustand, persisted to SQLite every change (survive app kill).
- "Previous" column pulls last session from local DB; overload suggestion shown as ghost text.
- Rest timer uses a scheduled local notification so it fires when backgrounded.
- Finish → compute volume, PRs, muscle sets locally → save → enqueue sync → show summary + PR celebration.

---

## 9. Backend structure

```
backend/
  app/
    main.py, config.py, deps.py
    db/base.py, session.py, models/*.py
    schemas/*.py
    routers/{auth,me,exercises,routines,workouts,stats,body,water,nutrition,coach,social,sync,uploads}.py
    services/
      overload.py            # pure functions, 100% unit-tested
      nutrition_engine.py    # BMR, TDEE, weekly report math, target clamps
      macros.py              # kcal from macros, scaling by grams
      records.py             # PR detection
      stats.py
      food_search.py         # local → USDA → OFF → IFCT, with caching
      sync.py
    ai/ (see §7)
    workers/celery_app.py, tasks/{photo,weekly,feed}.py
  alembic/
  seeds/exercises.json, muscles.json, equipment.json, ifct_foods.csv
  tests/
  Dockerfile, pyproject.toml, Makefile
docker-compose.yml  # api, worker, beat, postgres, redis, minio
```

Scheduled jobs (Celery beat):
- Monday 06:00 user-local: generate weekly report → push notification.
- Hourly: water reminders for users in their active window.
- Nightly: refresh cached popular foods, recompute stats drift check.

---

## 10. Core formulas (single source of truth: `services/`)

```
kcal_from_macros   = 4*protein + 4*carbs + 9*fat
scale(food, grams) = per_100g * grams / 100
BMR (Mifflin)      = 10*kg + 6.25*cm − 5*age + (5 male | −161 female)
TDEE initial       = BMR * activity (1.2, 1.375, 1.55, 1.725, 1.9)
TDEE adaptive      = avg_intake − (Δkg * 7700 / days)          # needs ≥14 days, ≥80% days logged
weekly_avg         = mean(weights in ISO week)                  # need ≥3 weigh-ins
rate_pct           = (avg − prev_avg) / prev_avg * 100
delta_kcal         = round50(clamp((target_kg − actual_kg) * 7700/7, −300, +300))
e1RM (Epley)       = w * (1 + reps/30)
set volume         = weight_kg * reps
water goal         = 35 ml * kg (+500 on training days)
```

---

## 11. Testing

- `services/` → pytest, table-driven, ≥95% coverage. Include edge cases: one weigh-in, missing RPE, bodyweight exercises, lb users, zero-calorie days.
- `ai/` → tests use recorded fixtures (no live calls in CI); one opt-in live smoke test.
- API → httpx AsyncClient + test Postgres in Docker.
- Mobile → Jest + React Native Testing Library for components; Maestro for 3 E2E flows (log workout offline then sync, photo → confirm food, apply weekly targets).

---

## 12. Build phases

1. **Foundation:** repo, docker-compose, auth, profile/onboarding, exercise seed + library screen with BodyMap.
2. **Logging:** routines, active workout, rest timer, offline SQLite, sync, history, PRs, exercise detail charts.
3. **Body & water:** weight log + trend chart, measurements, water tracker + reminders.
4. **Nutrition:** food search, barcode, custom foods, editable macros, meals, daily dashboard.
5. **AI:** photo + text food parsing, weekly report & calorie adjustment, overload coach.
6. **Social & polish:** follow, feed, likes/comments, share cards, Health integrations, Pro paywall, Sentry, store release.

---

## 13. Legal & safety notes

- Exercise media: record license per asset in `exercises.media_license`. No unlicensed GIFs in production.
- Food database attributions (USDA public domain; Open Food Facts ODbL — attribution + share-alike on DB) shown in Settings → About.
- Nutrition/coach screens show: "Estimates only, not medical advice."
- Block calorie targets below safe floors; if a user logs <1000 kcal/day for 7 days or loses >1.5% BW/week for 2 weeks, show a gentle check-in card recommending a professional instead of more cuts.
- GDPR/DPDP: data export (`GET /me/export`) and account deletion (`DELETE /me`, hard delete within 30 days).
