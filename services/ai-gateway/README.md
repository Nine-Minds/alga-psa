# AI gateway

Standalone service for AI credit pricing, admission, and ledger persistence. In
this implementation stage its only HTTP route is `GET /healthz`; provider
proxying and billing webhooks are intentionally not present yet.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port. |
| `AI_GATEWAY_DATABASE_URL` | none | Complete PostgreSQL URL. Takes precedence over the individual DB variables. |
| `AI_GATEWAY_DB_HOST` | `127.0.0.1` | PostgreSQL host. Compose sets `ai-gateway-postgres`. |
| `AI_GATEWAY_DB_PORT` | `5432` | PostgreSQL port. |
| `AI_GATEWAY_DB_NAME` | `ai_gateway` | Service-owned database name. |
| `AI_GATEWAY_DB_USER` | `postgres` | PostgreSQL user. |
| `AI_GATEWAY_DB_PASSWORD` | empty | PostgreSQL password. |
| `AI_GATEWAY_DB_PASSWORD_FILE` | none | Docker-secret file used when the password variable is absent. |
| `AI_GATEWAY_DEFAULT_INPUT_CREDITS_PER_1K_TOKENS` | none | Required positive bigint fallback input rate before metered traffic is enabled. |
| `AI_GATEWAY_DEFAULT_OUTPUT_CREDITS_PER_1K_TOKENS` | none | Required positive bigint fallback output rate before metered traffic is enabled. |
| `AI_GATEWAY_TEST_DATABASE_URL` | none | Scratch PostgreSQL URL for DB-backed integration and concurrency tests. |

The default pricing variables deliberately have no built-in numeric value.
Rates are commercial configuration, but the pricing engine rejects missing,
zero, or negative fallback rates so an unknown model is never free.
Configured `model_pattern` values use case-sensitive glob syntax: `*` matches
zero or more characters and `?` matches one character. More literal characters
make a match more specific; equally specific matches use the latest effective
date that is not in the future.

## Local commands

```sh
npm install
npm run build
npm run migrate
npm run test:unit
AI_GATEWAY_TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/ai_gateway_test npm test
```

The integration suite runs only when `AI_GATEWAY_TEST_DATABASE_URL` is set. Use
a disposable database: the suite truncates all AI gateway tables between tests.
The container entrypoint waits for PostgreSQL, runs all local Knex migrations,
and then starts the service.

Credit and token inputs cross JavaScript boundaries as integer strings or
`bigint`. PostgreSQL `bigint` values are left as strings by `pg`; credit math is
performed only with `bigint`.
