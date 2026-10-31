# RepForge Runbook

How to start everything the first time, how to start it again every day after that, and what to run after a change: restart, rebuild, migrate or reinstall.

Run every command from the repo root (`hevy_clone/`) unless a step says otherwise.

---

## Services at a glance

| Service | What it is | Host address | Auto-reloads on code change? |
|---|---|---|---|
| `api` | FastAPI (uvicorn) | http://localhost:8010 (docs: `/docs`) | ✅ yes (`--reload`, code bind-mounted) |
| `worker` | Celery worker (background jobs) | n/a | ❌ no: restart it |
| `beat` | Celery beat (scheduled jobs) | n/a | ❌ no: restart it |
| `postgres` | PostgreSQL 16 (`repforge` and `repforge_test` databases) | localhost:5442 | n/a |
| `redis` | Redis 7 (cache, rate limits, Celery broker) | localhost:6389 | n/a |
| `s3` | SeaweedFS, S3-compatible (buckets: `media`, `food-photos`, `avatars`) | http://localhost:9010 | n/a |
| `s3-init` | One-shot job that creates the buckets, then exits | n/a | n/a |
| Mobile | Expo dev server (Metro) | QR code in terminal | ✅ yes (fast refresh) |

These ports are not the defaults (8000, 5432, 6379, 9000) because other local projects already use those. You can change them in `.env`.

---

## 1. First-time setup (once per machine)

### 1.1 Install the tools
- **Docker Desktop**, running.
- **Node 24**, plus pnpm: `corepack enable pnpm`.
- **Python 3.12**. With pyenv: `pyenv install 3.12.3`. `backend/.python-version` selects it automatically.
- **Expo Go** on your phone, latest version (the app uses Expo SDK 58).
- Optional: `gh auth login` so you can push to GitHub.

### 1.2 Configure
```bash
cp .env.example .env                    # backend + docker config (make up also does this)
cp mobile/.env.example mobile/.env.local
```
Edit `mobile/.env.local` and set your Mac's LAN IP so a phone can reach the API:
```bash
ipconfig getifaddr en0                  # e.g. 192.168.0.121
# mobile/.env.local
EXPO_PUBLIC_API_URL=http://192.168.0.121:8010
```
Use `http://localhost:8010` only for an iOS simulator running on the same Mac.

### 1.3 Start the backend stack
```bash
make up         # builds the backend image, starts all services, waits until healthy
make migrate    # creates/updates the database schema (Alembic)
make seed       # loads the exercise library (422 exercises, 20 muscles, 14 equipment types)
make ps         # all services "healthy"; s3-init "Exited (0)" is expected
```

### 1.4 Local dev tools (for lint, tests and new migrations)
```bash
make backend-venv     # creates backend/.venv and installs all Python deps there (never global)
make mobile-install   # pnpm install in mobile/
```

### 1.5 Verify everything
```bash
curl localhost:8010/v1/health          # {"status":"ok","version":"0.1.0"}
curl localhost:8010/v1/health/ready    # database ok, redis ok
make check                             # backend lint+types+all tests (needs the stack up), mobile lint+types+tests
make -C backend test-unit              # fast backend subset that needs no services
```

### 1.6 Run the app
```bash
make mobile-start      # scan the QR code with Expo Go (same Wi-Fi as the Mac)
```
The app opens on **Log in**. Tap **Create an account**, register, answer the 8 onboarding questions, and you land on Home, which shows a green **"API connected · v0.1.0"** badge. Kill the app and reopen it: you stay signed in, even in airplane mode (tokens are in the Keychain/Keystore and the profile is cached on the device). Log out is in Profile → Settings.

---

## 2. Every day after that

```bash
make up           # start the stack (fast; rebuilds only if something changed)
make migrate      # safe to run every time; does nothing if already up to date
make seed         # also safe every time; rewrites only exercises whose seed data changed
make mobile-start # run the app
```
When you're done:
```bash
make down         # stop the containers; data is kept in Docker volumes
```

After `git pull` or switching branches, use section 3 to decide what else to run.

---

## 3. "I changed X → what do I run?"

| What changed | What to run | Why |
|---|---|---|
| Python code in `backend/app/` | Nothing for `api`. `docker compose restart worker beat` if the change touches tasks or code they import | Only the API auto-reloads |
| A new file in `backend/alembic/versions/` (yours or pulled) | `make migrate` | Applies schema changes to the dev database |
| SQLAlchemy models, and you need a migration | `make -C backend revision m="add workouts table"`, review the generated file, then `make migrate` | Autogenerate compares the models with the live DB (localhost:5442) |
| `backend/pyproject.toml` (dependencies) | `make up` (rebuilds the image) **and** `make backend-venv` (updates the local venv) | Dependencies are baked into the image |
| `backend/Dockerfile` | `make up` | Rebuilds the image |
| `docker-compose.yml` or `.env` | `make up` | Compose recreates the affected containers |
| `backend/seeds/*.json` (exercise library) | `make seed` | Upserts the library; unchanged rows are not touched, removed exercises are archived. A seed that changes an existing exercise's `type` is refused |
| `infra/postgres/init/*.sql` | `make nuke && make up && make migrate` ⚠️ wipes data | Init scripts run only on a fresh volume |
| `infra/seaweedfs/s3.json` | `docker compose restart s3` | The config is read at startup |
| A new bucket in `docker-compose.yml` `s3-init` (Phase 5: `progress-photos`) | `docker compose up -d s3-init` (or `make up`) | The init job creates missing buckets and exits |
| `mobile/package.json` / `pnpm-lock.yaml` | `make mobile-install`, then restart `make mobile-start` | New JS packages (Phase 1 added `expo-secure-store`, `expo-localization`; Phase 2 added `react-native-svg`, `react-native-body-highlighter`, `expo-video`; Phase 3 added `expo-crypto`, `expo-notifications`, `expo-keep-awake`, `expo-haptics`; Phase 4 added `@react-native-community/netinfo`; Phase 5 added `expo-image-picker`) |
| `.env.example` gained variables (Phase 1: `JWT_SECRET`, `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`, `LOGIN_RATE_*`; Phase 3: `FREE_ROUTINE_LIMIT`) | Copy the new lines into `.env` if you want non-default values, then `make up` | Defaults work for dev; `make up` recreates containers with the new env |
| `mobile/src/db/schema.ts` (local SQLite tables) | `cd mobile && pnpm db:generate` and commit the new files in `src/db/migrations/` | The app runs these on launch |
| `mobile/app.json`, `babel.config.js`, `metro.config.js` | `cd mobile && pnpm start --clear` | Clears Metro's cache |
| `mobile/.env.local` | `cd mobile && pnpm start --clear` | `EXPO_PUBLIC_*` values are inlined at bundle time |
| You want a clean database | `make nuke && make up && make migrate && make seed` ⚠️ wipes all local data | |

### Database migrations: the rules
- Every schema change is a new Alembic migration. **Never edit a migration that is already merged to `main`.** Add a new one instead.
- `make migrate` runs `alembic upgrade head` inside the `api` container.
- Integration tests migrate the separate `repforge_test` database by themselves, so you never migrate it by hand.
- To check the current revision: `docker compose exec api alembic current`.
- To roll back one step (dev only): `docker compose exec api alembic downgrade -1`.

### Mobile local database
- Phase 2 added the offline exercise library (`muscles`, `equipment`, `exercises`). The app downloads it the first time it opens online after sign-in (Workout → Exercise library shows "Downloading…"), then only revalidates. Run `make seed` first, or the server has no library to send.
- Phase 3 added `routines` and `routine_folders` (a mirror of the server's routines, refreshed when the Workout tab opens or is pulled down), `active_workout` (the workout being logged, saved 300 ms after each change), and the local history: `workouts`, `workout_exercises`, `workout_sets`, `workout_muscle_sets`, `personal_records`. Finished workouts stay on the phone with `synced_at = NULL` until Phase 4's sync engine sends them.
- Phase 4 added the sync `outbox` and a `version` column on `workouts`. Routine, folder, custom-exercise and workout changes are saved on the phone first and sent by the sync engine; workouts saved in Phase 3 are queued once on the next launch. Signing out clears the outbox, the sync cursor and the workout history (they come back from the server on the next sign-in).
- Phase 5 added `body_weights`, `body_measurements` and `water_logs` (synced like workouts) and moved the sync cursor to `sync:cursor:v3`, so the first sync after updating pulls everything once.
- The phone's SQLite database is migrated automatically when the app launches (`DatabaseProvider`).
- To start fresh on the device, delete the app's data: long-press Expo Go → App info → Clear storage (Android), or reinstall Expo Go (iOS).

---

## 4. Useful commands

```bash
make logs                                 # follow api / worker / beat logs (JSON lines)
docker compose logs -f postgres           # any single service
docker compose exec postgres psql -U repforge repforge   # SQL shell
docker compose exec redis redis-cli       # Redis shell
docker compose exec api alembic history   # list migrations
make -C backend format                    # auto-fix Python formatting
cd mobile && pnpm format                  # auto-fix TS formatting
```

### Before merging a feature branch
```bash
make up                          # backend tests need postgres + redis + worker
make check                       # must be green: lint, types, all tests, services coverage >= 95%
```
`make -C backend test-unit` runs only the tests that need no services (quick feedback while coding).

### Trying the workout flow by hand (Phase 3)
1. Allow notifications when the app asks (first workout). The rest timer and, on Android, the "workout in progress" notification need it.
2. Workout tab → **New routine** → add exercises → **Save**, then **Start** on its card.
3. Tick a set: the rest timer starts (routine rest → Settings default → 90 s). Lock the phone or switch apps: the "Rest is over" notification arrives on time.
4. Leave the app for a few minutes and come back: the clock in the workout header and the bar above the tabs are right at once (they are `now − startedAt`, not a counter).
5. Kill the app mid-workout (swipe it away) and reopen it: **Resume your workout?** brings everything back.
6. **Finish** → adjust the duration if you forgot to stop → **Save workout**. Repeat with a heavier set later to see the 🏆 personal-record card. All of this works in airplane mode.

Free accounts can keep 4 routines (`FREE_ROUTINE_LIMIT`). To test as Pro:
```bash
docker compose exec postgres psql -U repforge repforge -c "update users set is_pro = true where email = 'me@example.com'"
```
Pull down on the Workout tab afterwards to refresh the limit. Pro also unlocks the 1-year and all-time stats and charts.

### Trying sync, history and stats by hand (Phase 4)
Run `make migrate` first (0006 workouts, 0007 the sync cursor).
1. Turn on airplane mode. Finish a workout, create a routine and a custom exercise: all of it works.
2. Turn the network back on. Within a second the app pushes (NetInfo reconnect skips the backoff); the workout is on the server once: `docker compose exec postgres psql -U repforge repforge -c "select id, title, version from workouts order by created_at desc limit 3"`.
3. Sign in to the same account on a second phone (or Expo Go after clearing its storage): the routine, custom exercise and workout arrive on the first sync (pull from cursor 0).
4. Profile → **Workout history** → a workout → **Edit workout** (within 24 h of its end): change a weight, untick a set, save. The other phone shows the change after its next sync. Older workouts show only **Delete**.
5. Profile shows weekly totals, the streak and the muscle heat map; an exercise's **Charts** tab shows its progress. `1 year` / `All` are Pro (make yourself Pro with the SQL below).
6. Profile → **Tools** for the plate, 1RM and warm-up calculators (offline, in your units).

To watch sync on the API: `make logs` and look for `/v1/sync/push` and `/v1/sync/pull`.

### Trying body and water by hand (Phase 5)
Run `make migrate` (0008, 0009) and `docker compose up -d s3-init` (creates the `progress-photos` bucket). For photos on a physical phone, set `S3_PUBLIC_URL` in `.env` to `http://<your LAN IP>:9010` and `make up`: upload URLs are signed for that host.
1. Profile → **Body**: log a weight on three days of one week (or three times today) — the weekly average appears, and the chart draws it as a line over the daily dots. Works in airplane mode.
2. **Measurements**: pick a kind, enter a value (in or cm per Settings), save twice to see the change.
3. **Progress photos**: take or pick a photo; it uploads straight to SeaweedFS (`docker compose exec s3 ls` won't show it, but `GET /v1/body/photos` returns a signed URL that opens it).
4. Settings → **Water reminders** on. Home → the water ring → add cups until the goal: "Goal reached. Reminders are done for today." Long-press a cup to change its size.

### Auth in development
```bash
# Unlock a login lockout (10 attempts per 15 min per IP) after testing wrong passwords
docker compose exec redis sh -c "redis-cli --scan --pattern 'rl:login:*' | xargs -r redis-cli DEL"

# Try the API by hand
curl -s -XPOST localhost:8010/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"long-enough"}'
```
- Google / Apple sign-in endpoints answer **503 `provider_not_configured`** until `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` are set in `.env` (JSON lists of client IDs / bundle IDs). The app's buttons need an EAS dev build (Phase 9).
- In prod, `JWT_SECRET` **must** be a random 32+ character value; the API refuses to start with the dev default when `ENVIRONMENT=prod`. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Changing it signs every user out of their *access* tokens; refresh tokens keep working.

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `make up` says "port is already allocated" | Another stack is using that port. Change `API_PORT`, `POSTGRES_PORT`, `REDIS_PORT` or `S3_PORT` in `.env` (and the matching URLs in that file) |
| `/v1/health/ready` returns 503 | `make ps` and look for an unhealthy service, then `docker compose logs <service>` |
| App shows **"API unreachable"** | Phone on the same Wi-Fi? Correct LAN IP in `mobile/.env.local`? Restart with `pnpm start --clear`. Open `http://<LAN-IP>:8010/v1/health` in the phone's browser; if that fails, allow Docker in the macOS firewall |
| Expo Go says the SDK version is unsupported | Update Expo Go from the store |
| `pnpm lint` fails on `tsconfig.json` after `expo start` | Expo rewrote the file. Run `cd mobile && pnpm prettier --write tsconfig.json` |
| `make backend-venv` can't find `python3.12` | `pyenv install 3.12.3`, or `make backend-venv PYTHON=/path/to/python3.12` |
| Integration tests skip with "TEST_DATABASE_URL is not set" | `.env` is missing. Run `cp .env.example .env` |
| `make check` fails with connection errors to `localhost:5442` | The backend tests need the stack: run `make up` first |
| App says **"Too many attempts. Try again in N min."** | The login rate limit tripped. Wait, or clear it (see *Auth in development*) |
| App shows **"Can't reach RepForge"** right after signing in | First launch on this device and the API is unreachable, so the profile has never been cached. Fix the connection and tap *Try again* |
| App signs you out unexpectedly | The refresh token was rejected (expired after 30 days unused, or reused). Reuse can happen if the app was killed in the instant between the server rotating the token and the phone saving it; sign in again |
| Celery task changes have no effect | `docker compose restart worker beat` |
| Database is in a weird state locally | `make nuke && make up && make migrate && make seed` ⚠️ wipes local data |
| The rest timer never notifies | Notifications are off for Expo Go: turn them on in the phone's Settings. In the app the timer still counts down and buzzes while the app is open |
| No "workout in progress" notification on iOS | Expected: it is Android-only. iOS gets a Live Activity in Phase 9 |
| A screen test times out only on CI (or after `jest --clearCache`) | A cold Jest cache transforms React Native's lazily loaded components during the first render. `jest.setup.ts` loads them up front; add any newly used lazy component there |
| `make seed` says `seed refused: exercise type is immutable` | An edit to `backend/seeds/exercises.json` changed the `type` of an exercise that already exists. Workout history depends on the type, so add a new exercise (new slug) instead |
