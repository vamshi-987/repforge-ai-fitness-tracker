# RepForge — Build Progress

Every phase window reads this file first and updates it when a branch is merged.
Legend: ✅ merged to main · 🟡 in progress · ⬜ not started

## Phase 0 — Repo & infrastructure
- ✅ `feat/p0-repo-skeleton`
- ✅ `feat/p0-backend-scaffold`
- ✅ `feat/p0-docker-compose`
- ✅ `feat/p0-mobile-scaffold`
- ✅ `feat/p0-ci`
- ✅ `feat/p0-docs` (RUNBOOK.md, IMPLEMENTATION_NOTES.md; added after the plan was written)
- ✅ `feat/p0-ci-dispatch` (manual CI trigger, CI badges, repo name `repforge-ai-fitness-tracker`)

## Phase 1 — Auth, profile, onboarding, settings
- ✅ `feat/p1-auth-backend` (argon2id, rotating refresh families with reuse detection, Google/Apple JWKS verify, Redis login rate limit)
- ✅ `feat/p1-profile-backend` (also creates `body_weights` early: onboarding logs the first weigh-in; P5 adds its CRUD)
- ✅ `feat/p1-auth-mobile` (email/password only in the app; Google/Apple buttons need a dev build, backend endpoints are ready)
- ✅ `feat/p1-onboarding-mobile` (units step first; `lib/units.ts` landed here because onboarding needs it)
- ✅ `feat/p1-settings-mobile` (optimistic saves, serialized per section; theme preference drives `useTheme`)

**Phase 1 "done when" (2026-10-25):**
- ✅ Refresh-token reuse revokes the family: `tests/integration/test_auth_api.py::test_refresh_token_reuse_revokes_the_whole_family`, and replayed by hand against the live API.
- ✅ Register → onboarding → relaunch stays signed in: covered by mobile tests (`src/stores/__tests__/auth.test.ts` relaunch offline from SecureStore + cached `/me`, `src/__tests__/onboardingStep.test.tsx`) and replayed request by request against the live API. ⚠️ Still to do by hand: the same flow in Expo Go on a phone (not possible from the build machine).
- ✅ CI green on every Phase 1 branch and on `main`.

## Phase 2 — Exercise library & red body map
- ⬜ `feat/p2-exercise-models-seed`
- ⬜ `feat/p2-exercise-api`
- ⬜ `feat/p2-bodymap`
- ⬜ `feat/p2-exercise-library-mobile`

## Phase 3 — Routines & live workout logging
- ⬜ `feat/p3-routines-backend`
- ⬜ `feat/p3-routines-mobile`
- ⬜ `feat/p3-active-workout-store`
- ⬜ `feat/p3-active-workout-ui`
- ⬜ `feat/p3-rest-timer`
- ⬜ `feat/p3-finish-workout`

## Phase 4 — Workout backend, sync, history, stats, tools
- ⬜ `feat/p4-workouts-backend`
- ⬜ `feat/p4-sync`
- ⬜ `feat/p4-history-mobile`
- ⬜ `feat/p4-exercise-stats`
- ⬜ `feat/p4-stats-dashboard`
- ⬜ `feat/p4-tools`

## Phase 5 — Body & water
- ⬜ `feat/p5-uploads-body-backend`
- ⬜ `feat/p5-body-mobile`
- ⬜ `feat/p5-water-backend`
- ⬜ `feat/p5-water-mobile`

## Phase 6 — Nutrition (non-AI)
- ⬜ `feat/p6-food-models-seed`
- ⬜ `feat/p6-food-search`
- ⬜ `feat/p6-food-logs-backend`
- ⬜ `feat/p6-nutrition-mobile`
- ⬜ `feat/p6-home-dashboard`

## Phase 7 — AI layer
- ⬜ `feat/p7-ai-client`
- ⬜ `feat/p7-food-photo`
- ⬜ `feat/p7-food-text`
- ⬜ `feat/p7-weekly-report`
- ⬜ `feat/p7-overload-coach`

## Phase 8 — Social & push
- ⬜ `feat/p8-social-backend`
- ⬜ `feat/p8-push`
- ⬜ `feat/p8-social-mobile`

## Phase 9 — Integrations, Pro, observability, release
- ⬜ `feat/p9-health`
- ⬜ `feat/p9-data-portability`
- ⬜ `feat/p9-pro`
- ⬜ `feat/p9-observability`
- ⬜ `feat/p9-release`

## Notes
- Python dependencies are installed only into `backend/.venv` (no global installs).
- Dev object storage is SeaweedFS because MinIO stopped publishing Docker images. Prod uses Cloudflare R2.
- RepForge host ports: API 8010, Postgres 5442, Redis 6389, S3 9010 (defaults clash with other local stacks).
- Since Phase 1, `make -C backend test` (and `make check`) runs unit + integration tests against the compose stack, because the services coverage gate needs the DB-backed tests. `make -C backend test-unit` is the no-services subset.
- Google/Apple sign-in: backend done; app buttons wait for an EAS dev build (Expo Go cannot use the native Google SDK, and Apple tokens from Expo Go carry Expo's bundle ID). Set `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` to enable the endpoints.
