# RepForge API

Base URL: `/v1`. All requests and responses are JSON unless noted.

## Conventions

- **Auth:** `Authorization: Bearer <access_token>` (JWT, 15 min). Refresh tokens last 30 days and are rotated on every use.
- **Errors:** every non-2xx response has this shape:
  ```json
  {"error": {"code": "not_found", "message": "Workout not found", "details": null}}
  ```
  Validation errors use `code: "validation_error"` and put the field errors in `details`.
- **Request IDs:** every response carries `X-Request-ID`. If the client sends one, it is echoed back.
- **Pagination:** cursor-based, `?cursor=<opaque>&limit=<n>` → `{"items": [...], "next_cursor": "..." | null}`.
- **Units:** weights in kg, lengths in cm, energy in kcal. Clients convert for display.
- **Time:** timestamps are UTC ISO-8601. `log_date` is a date in the user's timezone.

---

## Health

### `GET /v1/health`
Liveness. Never touches dependencies.

**200**
```json
{"status": "ok", "version": "0.1.0"}
```

### `GET /v1/health/ready`
Readiness. Checks PostgreSQL and Redis.

**200** (all dependencies up) or **503** (any down):
```json
{"status": "ok", "version": "0.1.0", "checks": {"database": "ok", "redis": "ok"}}
```
`status` is `"ok"` or `"degraded"`. Each check is `"ok"` or `"down"`.

---

## Auth

Access tokens are HS256 JWTs (15 min). Refresh tokens are opaque random strings (30 days), stored only as SHA-256 hashes, and **rotated on every refresh**: the old token is revoked and a new one is returned in the same *family*. Presenting a revoked refresh token again is treated as theft: every token in that family is revoked (`refresh_token_reused`) and the user must sign in again. Other devices (other families) are unaffected.

`/auth/register`, `/auth/login`, `/auth/google` and `/auth/apple` share a sliding-window rate limit per client IP (default 10 per 15 min): **429** `rate_limited`, with a `Retry-After` header and `details.retry_after_s`.

Every 401 carries `WWW-Authenticate: Bearer`. Error codes clients act on:

| Code | Meaning | Client action |
|---|---|---|
| `not_authenticated` | No bearer token | Sign in |
| `token_expired` | Access token expired | Refresh, then retry once |
| `invalid_token` | Bad signature/claims, or the user was deleted | Sign out |
| `invalid_credentials` | Wrong email or password (same for unknown email) | Show error |
| `invalid_refresh_token` / `refresh_token_expired` / `refresh_token_reused` | Session is over | Sign out |
| `invalid_id_token` | Google/Apple token failed verification | Show error |

### Auth response
Returned by register, login, google and apple:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "d8f...",
  "token_type": "bearer",
  "expires_in": 900,
  "refresh_expires_in": 2592000,
  "is_new_user": true,
  "user": {
    "id": "8b0c...", "email": "lifter@example.com", "username": "lifter",
    "display_name": "lifter", "avatar_url": null, "is_private": false, "is_pro": false,
    "auth_provider": "password", "created_at": "2026-10-25T10:00:00Z"
  }
}
```

### `POST /v1/auth/register`
```json
{"email": "lifter@example.com", "password": "at-least-8-chars", "username": "iron_ann", "display_name": "Ann"}
```
`username` and `display_name` are optional. Emails are lowercased. Usernames are 3–30 characters of `a-z 0-9 _ .`, case-insensitive, not starting or ending with `.` and without `..`. Without one, a username is derived from the email (with a numeric suffix if taken). Passwords are 8–128 characters, hashed with argon2id.

**201** auth response · **409** `email_taken` | `username_taken` · **422** `validation_error` · **429**

### `POST /v1/auth/login`
```json
{"email": "lifter@example.com", "password": "..."}
```
**200** auth response · **401** `invalid_credentials` (also for Google/Apple-only accounts) · **429**

### `POST /v1/auth/refresh`
```json
{"refresh_token": "d8f..."}
```
**200**
```json
{"access_token": "eyJ...", "refresh_token": "new...", "token_type": "bearer", "expires_in": 900, "refresh_expires_in": 2592000}
```
**401** `invalid_refresh_token` | `refresh_token_expired` | `refresh_token_reused`

Clients must store the new refresh token before using it; the old one is now revoked.

### `POST /v1/auth/logout`
```json
{"refresh_token": "d8f..."}
```
**204** always (an unknown token is a no-op). Revokes this device's token family. No access token needed.

### `POST /v1/auth/google`
```json
{"id_token": "<Google ID token>", "nonce": "optional raw nonce"}
```
### `POST /v1/auth/apple`
```json
{"id_token": "<Apple identity token>", "nonce": "optional raw nonce", "display_name": "Ann Apple"}
```
The ID token is verified against the provider's JWKS (cached in Redis for 12 h; an unknown `kid` triggers at most one refetch per minute): RS256 signature, issuer, audience (one of `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS`), expiry with 60 s skew, and the nonce if given (Apple compares `SHA-256(nonce)`). Pass Apple's `display_name` on the first sign-in, because Apple never puts it in the token.

Account resolution: the provider subject's account → else the account with the same **verified** email, which gets linked → else a new account (`is_new_user: true`).

**200** auth response · **401** `invalid_id_token` | `account_deleted` · **422** `email_required` (new account but no verified email) · **503** `provider_not_configured` | `provider_unavailable` · **429**

---

## Me (the signed-in user)

All `/me` endpoints need `Authorization: Bearer <access_token>`.

PATCH bodies are partial: omitted fields are unchanged, unknown fields are a 422, and an explicit `null` is a 422 except where a field is marked *clearable*.

### `GET /v1/me`
The account, onboarding profile and app settings in one response, so the app can decide on launch whether to show onboarding.

**200**
```json
{
  "id": "8b0c...", "email": "lifter@example.com", "username": "lifter", "display_name": "Lifter",
  "avatar_url": null, "is_private": false, "is_pro": false, "auth_provider": "password",
  "created_at": "2026-10-25T10:00:00Z",
  "onboarding_complete": true,
  "profile": {
    "sex": "female", "birth_date": "1995-03-01", "height_cm": 168.3, "weight_kg": 64.46,
    "activity_level": "moderate", "goal": "fat_loss", "experience": "beginner",
    "unit_weight": "kg", "unit_length": "cm", "water_goal_ml": null, "timezone": "Asia/Kolkata",
    "onboarding_completed_at": "2026-10-25T10:05:00Z"
  },
  "settings": {
    "theme": "system", "default_rest_s": 90, "keep_awake": true, "show_burned_kcal": false,
    "water_cup_sizes": [250, 500, 750], "water_reminder_every_h": 2,
    "wake_time": "07:00:00", "sleep_time": "22:00:00", "reminders_enabled": false
  }
}
```
`profile.weight_kg` is the latest weigh-in (`body_weights`), not a profile column. New accounts start with every profile answer `null`, units `kg`/`cm`, timezone `UTC` and the settings shown above.

### `PATCH /v1/me`
```json
{"username": "iron_ann", "display_name": "Ann", "is_private": true}
```
**200** the same body as `GET /v1/me` · **409** `username_taken` · **422**

### `PATCH /v1/me/profile`
Any subset of:

| Field | Type / range |
|---|---|
| `sex` | `male` \| `female` (used only for the BMR formula) |
| `birth_date` | `YYYY-MM-DD`, age 13–100 |
| `height_cm` | 100–250, stored to 0.1 (rounded half-up) |
| `weight_kg` | 25–350, rounded to 0.01. Each value **logs a new weigh-in** dated now |
| `activity_level` | `sedentary` \| `light` \| `moderate` \| `active` \| `very_active` |
| `goal` | `muscle_gain` \| `fat_loss` \| `maintain` |
| `experience` | `beginner` \| `intermediate` \| `advanced` |
| `unit_weight` / `unit_length` | `kg` \| `lb` / `cm` \| `in` (display only; data is always kg/cm) |
| `water_goal_ml` | 500–10000, *clearable* (`null` = computed goal) |
| `timezone` | IANA name, e.g. `Asia/Kolkata` |
| `onboarding_complete` | `true` finishes onboarding (once; later `true`/`false` are ignored) |

**200** the `profile` object · **422** `validation_error`, or `onboarding_incomplete` with the unanswered fields:
```json
{"error": {"code": "onboarding_incomplete", "message": "Answer every onboarding question first",
           "details": {"missing": ["birth_date", "weight_kg"]}}}
```
The required answers are `sex`, `birth_date`, `height_cm`, `weight_kg`, `activity_level`, `goal` and `experience`. A request that fails is not partly applied.

### `GET /v1/me/settings`
**200** the `settings` object.

### `PATCH /v1/me/settings`

| Field | Type / range |
|---|---|
| `theme` | `system` \| `light` \| `dark` |
| `default_rest_s` | 0–900 |
| `keep_awake`, `show_burned_kcal`, `reminders_enabled` | boolean |
| `water_cup_sizes` | 1–6 distinct integers, 50–2000 ml (returned sorted) |
| `water_reminder_every_h` | 1–12 |
| `wake_time`, `sleep_time` | `HH:MM`; must differ, checked against the stored value when only one is sent |

**200** the `settings` object · **422**

---

## Exercises

All exercise endpoints need `Authorization: Bearer <access_token>`.

The **library** (about 420 exercises, `is_custom: false`) is the same for everyone and read-only. **Custom exercises** (`is_custom: true`) belong to one user and are visible only to them. Exercises reference muscles and equipment by **slug**; `GET /v1/muscles` and `GET /v1/equipment` give the names, the body map region of each muscle (`body_map_key`) and the load increment of each equipment type.

### Exercise object
```json
{
  "id": "e7b40f5a-46df-5073-9161-a5081fb0e120",
  "name": "Bench Press (Barbell)",
  "type": "weight_reps",
  "equipment": "barbell",
  "primary_muscle": "chest",
  "secondary_muscles": ["front_delts", "triceps"],
  "instructions": ["Lie on a flat bench ...", "Take a grip ...", "Lower the bar ...", "Press the bar ..."],
  "media_video_url": null, "media_thumb_url": null, "media_license": null,
  "is_custom": false, "is_archived": false, "version": 1,
  "created_at": "2026-10-26T09:00:00Z", "updated_at": "2026-10-26T09:00:00Z"
}
```
- `type` is one of `weight_reps`, `bodyweight_reps`, `weighted_bodyweight`, `assisted_bodyweight`, `duration`, `distance_duration`. It decides which inputs a set has and **never changes after the exercise is saved**.
- Library IDs are stable on every server (UUIDv5 of the exercise's slug), so they are safe to store on the device.
- `media_video_url` is null for now: the app shows the body map with the primary muscle in red and secondary muscles in light red. `media_license` records the licence of any media that is added later.
- `is_archived: true` marks a library exercise that has been retired. It is left out of lists but can still be fetched by ID, because old workouts point at it.

### `GET /v1/exercises`
Library exercises plus the caller's own custom exercises, ranked and paginated.

| Query | Meaning |
|---|---|
| `q` | Search text (max 80 chars). Matches names that contain every word, or that are similar enough to catch typos (`bnch press`). Shorthand is expanded: `db`, `bb`, `kb`, `ez`, `rdl`, `sldl`, `ohp`, `pushup`, `pullup`, `chinup`, `situp`. `%` and `_` are literal |
| `muscle` | Primary muscle slug; repeat for several (`muscle=chest&muscle=triceps` means either) |
| `equipment` | Equipment slug; repeatable the same way |
| `cursor` | `next_cursor` from the previous page |
| `limit` | 1–500, default 50. 500 returns the whole library in one page, for mirroring it on a device |

Without `q`, items are alphabetical. With `q`, the best matches come first: names that start with the query, then names containing every word, then fuzzy matches by similarity.

**200**
```json
{"items": [ /* exercise objects */ ], "next_cursor": "WzAuMCwiYXJub2xkIHByZXNzIC4uLiJd" }
```
`next_cursor` is `null` on the last page.

**Caching:** responses carry a weak `ETag` and `Cache-Control: private, no-cache`. Send the ETag back as `If-None-Match` to get **304 Not Modified** with an empty body when nothing changed. The ETag changes when the library is re-seeded or when the caller creates, edits or deletes a custom exercise, so new custom exercises appear immediately.

**422** `invalid_cursor` · `validation_error`

### `GET /v1/exercises/{id}`
A library exercise (archived ones included) or one of the caller's custom exercises.

**200** exercise object · **404** `not_found` (unknown, deleted, or another user's custom exercise)

### `POST /v1/exercises`
Create a custom exercise.
```json
{
  "id": "optional client-generated UUID",
  "name": "Landmine Press (Half Kneeling)",
  "type": "weight_reps",
  "equipment": "barbell",
  "primary_muscle": "front_delts",
  "secondary_muscles": ["chest", "triceps"],
  "instructions": ["Kneel on one knee ...", "Press up and forward ..."]
}
```
- `name`: 1–80 characters, inner whitespace collapsed.
- `secondary_muscles`: up to 6 distinct slugs, not including the primary muscle. Returned sorted.
- `instructions`: up to 10 lines of up to 300 characters. Blank lines are dropped. Defaults to `[]`.
- Media fields can't be set on custom exercises.

**201** exercise object · **409** `exercise_exists` (the `id` is already used) · **422** `validation_error` (unknown `equipment` or muscle slugs are reported on that field)

### `PATCH /v1/exercises/{id}`
Any subset of `name`, `equipment`, `primary_muscle`, `secondary_muscles`, `instructions`. `type` may be sent only with its current value. The primary/secondary rule is checked against the merged result. `version` goes up by one when something actually changed.

**200** exercise object · **403** `library_exercise_read_only` · **404** · **422** `exercise_type_immutable` (`details.type` is the current type) | `validation_error`

### `DELETE /v1/exercises/{id}`
Soft-deletes a custom exercise: it leaves lists and `GET` returns 404, but past workouts keep their reference.

**204** · **403** `library_exercise_read_only` · **404**

### `POST /v1/exercises/{id}/duplicate`
Copy a library exercise or one of your own into a new custom exercise. The body is optional:
```json
{"id": "optional client-generated UUID", "name": "optional, defaults to '<name> (Copy)'"}
```
The copy keeps the type, equipment, muscles, instructions and media.

**201** exercise object · **404** · **409** `exercise_exists` · **422**

### `GET /v1/muscles`
**200**
```json
[{"id": "…", "slug": "chest", "name": "Chest", "body_map_key": "chest"}]
```
20 muscles. `body_map_key` is the region id in the app's SVG body map.

### `GET /v1/equipment`
**200**
```json
[{"id": "…", "slug": "barbell", "name": "Barbell", "increment_kg": 2.5}]
```
14 types. `increment_kg` is the smallest load step the overload coach suggests; `null` means progress by reps (bodyweight, bands, suspension trainer).

Both lists carry an `ETag` tied to the library version and answer `If-None-Match` with **304**.

---

## Routines

All routine endpoints need `Authorization: Bearer <access_token>`. Routines and folders belong to one user; another user's IDs answer **404**.

A routine is a workout template. It is written **as a whole**: its exercises and sets are always sent and returned together, and `version` goes up by one per real change. Routines are ordered by `position` within their folder (or among routines with no folder); folders are ordered by their own `position`. Positions may have gaps; only their order matters.

**Free-tier limit:** a free account keeps up to `FREE_ROUTINE_LIMIT` routines (default 4); Pro is unlimited. Creating or duplicating past the limit returns **403** `routine_limit_reached` with `details: {"limit": 4}`. Deleting a routine frees a slot.

### Routine object
```json
{
  "id": "5d0c…",
  "folder_id": null,
  "name": "Push Day",
  "notes": "Bench first.",
  "position": 0,
  "exercises": [
    {
      "exercise_id": "e7b40f5a-46df-5073-9161-a5081fb0e120",
      "exercise_name": "Bench Press (Barbell)",
      "exercise_type": "weight_reps",
      "superset_group": null,
      "rest_seconds": 180,
      "rep_range_min": 6,
      "rep_range_max": 10,
      "notes": "Pause the first rep",
      "sets": [
        {"set_type": "warmup", "target_weight_kg": 40.0, "target_reps": 10, "target_duration_s": null},
        {"set_type": "normal", "target_weight_kg": 80.0, "target_reps": 8, "target_duration_s": null}
      ]
    }
  ],
  "version": 1,
  "created_at": "2026-10-27T09:00:00Z", "updated_at": "2026-10-27T09:00:00Z"
}
```
- `exercise_name` and `exercise_type` are read from the exercise, so a routine still reads well after a custom exercise is deleted.
- `superset_group`: adjacent exercises with the same number form a superset. The server renumbers groups `1, 2, …` in order and turns a one-exercise group into `null`.
- `rest_seconds`: 0–900, or `null` for the user's default rest (`/me/settings` `default_rest_s`).
- `rep_range_min` / `rep_range_max`: 1–100 each, min ≤ max; either may be `null`. The overload coach (Phase 7) uses them.
- `set_type`: `warmup`, `normal`, `drop` or `failure`. `target_weight_kg` 0–1000 (rounded half-up to 0.01), `target_reps` 0–1000, `target_duration_s` 0–86400. Send only the targets that fit the exercise type.
- Up to 50 exercises per routine and 30 sets per exercise. `name` 1–80 characters (inner whitespace collapsed), `notes` up to 2000.

### `GET /v1/routines`
Every routine of the caller, in `position` order (the app groups them by `folder_id`). Not paginated: the app mirrors the whole set.

**200**
```json
{"items": [ /* routine objects */ ], "routine_limit": 4}
```
`routine_limit` is `null` for Pro accounts.

### `POST /v1/routines`
```json
{
  "id": "optional client-generated UUID",
  "name": "Push Day",
  "notes": "",
  "folder_id": null,
  "exercises": [
    {"exercise_id": "…", "rest_seconds": 120, "rep_range_min": 8, "rep_range_max": 12,
     "superset_group": null, "notes": "", "sets": [{"set_type": "normal", "target_reps": 10}]}
  ]
}
```
Everything but `name` is optional. The routine is placed last in its folder. Exercises must be library exercises (archived ones included) or the caller's own custom exercises.

**201** routine object · **403** `routine_limit_reached` · **409** `routine_exists` · **422** `validation_error` (an unknown exercise is reported at `["body", "exercises", i, "exercise_id"]`, a superset whose members aren't adjacent at `["body", "exercises", i, "superset_group"]`, an unknown folder at `["body", "folder_id"]`)

### `GET /v1/routines/{id}`
**200** routine object · **404**

### `PATCH /v1/routines/{id}`
Any subset of `name`, `notes`, `folder_id` (`null` takes it out of its folder) and `exercises`. `exercises`, when sent, **replaces the whole list**. Moving to another folder places the routine last there. Re-sending the current content is not a change and leaves `version` alone. A custom exercise that was deleted may stay in a routine that already has it, but can't be added to another.

**200** routine object · **404** · **422**

### `DELETE /v1/routines/{id}`
Soft delete.

**204** · **404**

### `POST /v1/routines/{id}/duplicate`
Optional body: `{"id": "client UUID", "name": "defaults to '<name> (Copy)'"}`. The copy keeps the folder, notes, exercises and sets, and is placed last in the folder. Counts against the free-tier limit.

**201** routine object · **403** `routine_limit_reached` · **404** · **409** `routine_exists`

### `POST /v1/routines/reorder`
```json
{"folder_id": null, "routine_ids": ["…", "…"]}
```
Puts the listed routines into `folder_id` (`null` = no folder) at positions `0, 1, …`, moving them from other folders if needed. Routines already in that folder but not listed follow, in their previous order. Each routine that moved gets a new `version`.

**200** `{"items": [...], "routine_limit": …}` (same as `GET /v1/routines`) · **422** (unknown routine at `["body", "routine_ids", i]`, unknown folder, duplicate IDs)

### Folder object
```json
{"id": "…", "name": "Upper body", "position": 0, "version": 1,
 "created_at": "2026-10-27T09:00:00Z", "updated_at": "2026-10-27T09:00:00Z"}
```

### `GET /v1/routine-folders`
**200** list of folder objects in `position` order.

### `POST /v1/routine-folders`
`{"id": "optional client UUID", "name": "Upper body"}` (1–60 characters). Placed last.

**201** folder object · **409** `folder_exists` · **422**

### `PATCH /v1/routine-folders/{id}`
`{"name": "Push"}`

**200** folder object · **404** · **422**

### `DELETE /v1/routine-folders/{id}`
Soft-deletes the folder. Its routines are **kept**: they move out of the folder, to the end of the routines without one.

**204** · **404**

### `POST /v1/routine-folders/reorder`
`{"folder_ids": ["…"]}`. Listed folders first, in that order; the rest keep their order after them.

**200** list of folder objects · **422** (unknown folder at `["body", "folder_ids", i]`)
