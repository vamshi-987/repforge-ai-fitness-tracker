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
