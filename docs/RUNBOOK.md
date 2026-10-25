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
make check                             # backend lint+types+unit tests, mobile lint+types+tests
make backend-test-integration          # tests against real postgres/redis/worker
```

### 1.6 Run the app
```bash
make mobile-start      # scan the QR code with Expo Go (same Wi-Fi as the Mac)
```
The Home tab should show a green **"API connected · v0.1.0"** badge.

---

## 2. Every day after that

```bash
make up           # start the stack (fast; rebuilds only if something changed)
make migrate      # safe to run every time; does nothing if already up to date
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
| `infra/postgres/init/*.sql` | `make nuke && make up && make migrate` ⚠️ wipes data | Init scripts run only on a fresh volume |
| `infra/seaweedfs/s3.json` | `docker compose restart s3` | The config is read at startup |
| `mobile/package.json` / `pnpm-lock.yaml` | `make mobile-install`, then restart `make mobile-start` | New JS packages |
| `mobile/src/db/schema.ts` (local SQLite tables) | `cd mobile && pnpm db:generate` and commit the new files in `src/db/migrations/` | The app runs these on launch |
| `mobile/app.json`, `babel.config.js`, `metro.config.js` | `cd mobile && pnpm start --clear` | Clears Metro's cache |
| `mobile/.env.local` | `cd mobile && pnpm start --clear` | `EXPO_PUBLIC_*` values are inlined at bundle time |
| You want a clean database | `make nuke && make up && make migrate` ⚠️ wipes all local data | |

### Database migrations: the rules
- Every schema change is a new Alembic migration. **Never edit a migration that is already merged to `main`.** Add a new one instead.
- `make migrate` runs `alembic upgrade head` inside the `api` container.
- Integration tests migrate the separate `repforge_test` database by themselves, so you never migrate it by hand.
- To check the current revision: `docker compose exec api alembic current`.
- To roll back one step (dev only): `docker compose exec api alembic downgrade -1`.

### Mobile local database
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
make check                       # must be green
make backend-test-integration    # with the stack up
```

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
| Celery task changes have no effect | `docker compose restart worker beat` |
| Database is in a weird state locally | `make nuke && make up && make migrate` ⚠️ wipes local data |
