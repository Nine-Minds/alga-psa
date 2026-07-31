# AI gateway

Standalone service for authenticated AI provider proxying, account state,
credit pricing, admission, and ledger persistence. It exposes the
OpenAI-compatible `POST /v1/chat/completions` route plus account, usage,
auto-top-up settings, appliance consent, manual grant, and health APIs. Stripe
webhooks apply subscription and credit changes, while a durable PostgreSQL
poller initiates configured off-session auto-top-ups.

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
| `AI_GATEWAY_SERVICE_SECRET` | none | Shared HMAC secret used to verify short-lived hosted HS256 JWTs. |
| `AI_GATEWAY_ADMIN_TOKEN` | none | Bearer token protecting `POST /v1/admin/grants`. The endpoint returns 503 when unset. |
| `AI_GATEWAY_STRIPE_SECRET_KEY` | none | Stripe secret key used for subscription lookup, Checkout line items, and off-session PaymentIntents. |
| `AI_GATEWAY_STRIPE_WEBHOOK_SECRET` | none | Signing secret for `POST /webhooks/stripe`. The route returns 503 when unset. |
| `AI_GATEWAY_TIER_CONFIG` | none | Single-tier JSON fallback used when `tier_config` has no row; see the format below. |
| `AI_GATEWAY_AUTO_TOPUP_POLL_INTERVAL_MS` | `5000` | Interval between durable auto-top-up job claims. |
| `AI_GATEWAY_AUTO_TOPUP_MAX_ATTEMPTS` | `3` | Maximum PaymentIntent initiation attempts before auto-top-up is disabled. |
| `AI_GATEWAY_AUTO_TOPUP_RETRY_BASE_MS` | `60000` | Initial retry delay; subsequent failures use exponential backoff. |
| `AI_GATEWAY_EVENTS_WEBHOOK_URL` | none | Optional destination for non-blocking gateway event POSTs; every event is always logged as structured JSON. The hosted app consumes these at `/api/webhooks/ai-gateway`. |
| `AI_GATEWAY_EVENTS_WEBHOOK_SECRET` | none | Shared secret sent as `X-Alga-Webhook-Secret` on event POSTs; the receiver rejects deliveries without it. |
| `AI_GATEWAY_MODEL_ROUTES` | `{}` | JSON object mapping case-sensitive model globs to `openrouter` or `vertex`, for example `{"gemini-*":"vertex"}`. |
| `AI_GATEWAY_DEFAULT_PROVIDER` | `openrouter` | Provider used when no model route matches: `openrouter` or `vertex`. |
| `OPENROUTER_API_KEY` | none | OpenRouter bearer credential. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API base URL; useful for compatible providers and tests. |
| `OPENROUTER_API` | none | Legacy base-URL alias used only when `OPENROUTER_BASE_URL` is unset. |
| `VERTEX_OPENAPI_BASE_URL` | none | Explicit Vertex OpenAI-compatible base URL. Takes precedence over project/location construction. |
| `VERTEX_PROJECT_ID` | none | Google Cloud project used to construct the Vertex base URL. |
| `VERTEX_LOCATION` | none | Vertex location used with `VERTEX_PROJECT_ID`; `global` selects the global host. |
| `GOOGLE_CLOUD_ACCESS_TOKEN` | none | Optional configured Vertex bearer token. A 401 retries once with ADC when ADC yields a different token. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google ADC default | Optional path used by `google-auth-library` for Vertex Application Default Credentials. |
| `ALGA_LICENSE_URL` | none | Base URL for alga-license; appliance credentials are posted to `/verify-appliance`. |
| `ALGA_LICENSE_SERVICE_TOKEN` | none | Service bearer token sent to alga-license. |
| `ALGA_LICENSE_STUB` | `false` | When `true`, accepts non-JWT appliance credentials locally without calling alga-license. |
| `ALGA_LICENSE_STUB_TENANT_ID` | `00000000-0000-4000-8000-000000000001` | Fixed tenant UUID returned by the appliance stub. |
| `ALGA_LICENSE_STUB_EDITION` | `enterprise` | Fixed edition returned by the appliance stub. |
| `AI_GATEWAY_TEST_DATABASE_URL` | none | Scratch PostgreSQL URL for DB-backed integration and concurrency tests. |

The tier loader accepts at most one `tier_config` row and otherwise reads
`AI_GATEWAY_TIER_CONFIG`. It reads the source on each operation so tier changes
do not require a gateway deployment. Credit values should be decimal strings:

```json
{
  "monthlyIncludedCredits": "100000",
  "gracePercentDefault": "1000",
  "topupPacks": [
    { "priceId": "price_example", "credits": "25000" }
  ],
  "lowBalanceThresholdDefault": "10000"
}
```

`gracePercentDefault` is expressed in basis points (`1000` = 10%). New
accounts receive that percentage of the monthly allotment as their grace
limit. Top-up pack price IDs must map to a positive credit amount; unconfigured
Stripe prices are rejected rather than granted.

The default pricing variables deliberately have no built-in numeric value.
Rates are commercial configuration, but the pricing engine rejects missing,
zero, or negative fallback rates so an unknown model is never free.
Configured `model_pattern` values use case-sensitive glob syntax: `*` matches
zero or more characters and `?` matches one character. More literal characters
make a match more specific; equally specific matches use the latest effective
date that is not in the future.

Hosted callers send a short-lived HS256 JWT with `tenant_id`, `iat`, and `exp`
claims as a bearer token. Non-JWT bearer credentials use the appliance
verification path. Successful appliance verifications are cached in memory for
five minutes under a SHA-256 credential hash; raw credentials are never cache
keys. Appliance accounts also require an active consent record before metered
traffic is admitted.

## Local commands

```sh
npm install
npm run build
npm run migrate
npm run test:unit
AI_GATEWAY_TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/ai_gateway_test npm test
# From the repository root, using the shared lint configuration:
npx eslint 'services/ai-gateway/src/**/*.ts' --max-warnings=0
```

The integration suite runs only when `AI_GATEWAY_TEST_DATABASE_URL` is set. Use
a disposable database: the suite truncates all AI gateway tables between tests.
The container entrypoint waits for PostgreSQL, runs all local Knex migrations,
and then starts the service.

Stripe webhooks are signature-verified against the raw request body. Event IDs
are inserted transactionally before processing, so a failed handler can be
retried and a committed event is not applied twice. Auto-top-up initiation and
credit grants are intentionally separate: the poller creates and confirms the
PaymentIntent, and only the signed success webhook writes the `grant_topup`
ledger entry. One active database job is permitted per account.

Credit and token inputs cross JavaScript boundaries as integer strings or
`bigint`. PostgreSQL `bigint` values are left as strings by `pg`; credit math is
performed only with `bigint`.
