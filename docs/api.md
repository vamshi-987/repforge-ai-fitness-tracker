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
