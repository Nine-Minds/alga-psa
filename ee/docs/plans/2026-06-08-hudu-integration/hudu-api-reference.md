# Hudu API — Implementation Reference

Distilled from the local Hudu skills for executors of this plan (the skills live in gitignored `.claude/`; this committed copy is the source of truth for implementation). Pull-only; all calls are GET.

## Auth & base URL

- Header auth: `x-api-key: <API_KEY>` + `Content-Type: application/json`.
- Base URL is per-instance: `https://<instance>/api/v1/<resource>` (Hudu Cloud `*.huducloud.com` or self-hosted). Store `hudu_api_key` + `hudu_base_url` per tenant in the secret provider (Vault); never return the key to the client; never log it.
- Validate a connection with `GET /api/v1/companies?page=1`. Probe password capability with a `GET /api/v1/asset_passwords?page=1` — a `403` means the key lacks password access (surface that, don't crash).

## Endpoints used (Phase 1)

| Purpose | Endpoint | Key params |
| --- | --- | --- |
| Companies | `GET /api/v1/companies` | `?page=`, `?id_in_integration=`, `?name=`, `?search=` |
| Assets (by company) | `GET /api/v1/assets` | `?company_id=`, `?page=`, `?archived=false` |
| Articles (by company) | `GET /api/v1/articles` | `?company_id=`, `?page=` |
| Passwords (by company) | `GET /api/v1/asset_passwords` | `?company_id=`, `?page=` |
| Single password (reveal) | `GET /api/v1/asset_passwords/{id}` | — |
| Deep-link by PSA id | `GET /api/v1/companies/jump` | `?integration_id=&integration_slug=&integration_type=company` |

## Naming traps (UI label → API resource)

`Passwords` → `asset_passwords` · `Processes` → `procedures` · `Knowledge Base Article` → `articles` · `Company` → `companies`. Always use the API name.

## Pagination

Page-based, **fixed 25 items/page**: `?page=1,2,…`. A page returning `< 25` items (or empty) is the last page. Loop until then. Never bulk-enumerate across all clients on a page view — fetch per mapped company only.

## Rate limiting

**300 requests/minute.** On `429`, back off using the `Retry-After` header (+ jitter) and retry with a capped attempt count; on transient `5xx`, exponential backoff. No consumer webhooks / change-feed exist — polling only.

## Error mapping

| Code | Meaning | Handling |
| --- | --- | --- |
| 401 | bad/expired key | typed "invalid key" state |
| 403 | key lacks password permission | typed "no password access" state (not an error) |
| 404 | bad base URL or id | typed "not found" |
| 422 | validation | n/a for pull |
| 429 | rate limited | backoff + retry |
| 5xx | server | retry w/ backoff |

## Company ↔ Client matching

The PSA is the source of truth for companies; Hudu stamps imported companies with `id_in_integration` (+ `integration_slug`). Auto-suggest a Hudu company → Alga client by: (1) `id_in_integration` exact-equals an Alga `client_id`, else (2) exact name, else (3) fuzzy name (lower confidence). Admin confirms/overrides. One Hudu company ↔ one Alga client.

## Response shapes (illustrative)

- Single: `{ "company": { "id", "name", "id_in_integration", "url", … } }`
- Collection: `{ "companies": [ … ] }` (resource name is the plural key)
- `asset_password`: `{ id, company_id, name, username, password, url, password_folder_name, … }` — **the `password` field is plaintext.**

## SECURITY (hard constraint)

The reveal endpoint returns the credential **plaintext**. Phase 1: reveal on demand via a single live GET, return the value transiently to the browser (masked, reveal-on-click), **audit every reveal**, and **never persist the value** — not a DB column, not Vault, not a cache — and never log it. Lists carry metadata only (name/username/url/id), never the value.
