# Host provider browser testing

Reuse the existing application build and isolated PostgreSQL/Redis services. Run algasim and the HTTPS callback proxy as host Node processes. No application or Docker image rebuild is needed when the existing build is suitable for the test.

Host preparation must account for these differences from Compose:

- Export sourced environment files (`set -a` before sourcing, `set +a` afterward). Plain assignments are not inherited by the test runner.
- Replace Docker service names and internal ports with the task-owned host tunnel addresses on every application process. This workspace currently uses PostgreSQL127.0.0.1:55432 and Redis127.0.0.1:56379.
- Use a task-specific `REDIS_PREFIX` on every host application process. A separate test database does not isolate Redis consumers: this run found an unrelated active consumer in the shared schedule-event group. The calendar path progressed after switching both host processes to `alga-provider-host-82cc:`. Global workflow streams need separate isolation before worker coverage is claimed.
- Retain the build's public OAuth callback origin. The current host build embeds localhost:53010; merely starting it on53011 and overriding runtime URLs does not move that callback.
- OAuth profile creation writes tenant secrets. Use `SECRET_READ_CHAIN=env,filesystem`, `SECRET_WRITE_PROVIDER=filesystem`, and a private task-owned `SECRET_FS_BASE_PATH`. The earlier env-only configuration is read-only and cannot support profile creation.
- Generate callback TLS using `e2e-tests/harness/create-calendar-callback-tls.mjs`. Its certificate covers localhost and127.0.0.1. Set `NODE_EXTRA_CA_CERTS` on the emulator before starting it; keep certificate verification enabled.
- Run `createCalendarCallbackServer` from `e2e-tests/harness/calendar-callback-proxy.mjs` with an explicit host application destination. It permits only Microsoft calendar/email POST callbacks.
- Set `MICROSOFT_LOGIN_BASE_URL`, `MICROSOFT_GRAPH_BASE_URL`, `CALENDAR_MICROSOFT_WEBHOOK_BASE_URL`, and `APPLICATION_URL` on all application processes involved. Set `E2E_EMULATORS_ISOLATED=true`, `ALGASIM_CONTROL_URL`, and `E2E_CALENDAR_CALLBACK_BASE_URL` on the browser runner. The calendar assertion retains its Compose default when the last variable is omitted.

The current isolated host instance uses `/tmp/alga-provider-host-82cc.env` for generated endpoint assignments, `/tmp/alga-provider-host-tls-82cc` for TLS and `/tmp/alga-provider-secrets-82cc` for tenant secrets. Never commit these credentials or assume these temporary processes are running without checking their live handles/ports. No Temporal worker was started; this setup cannot establish worker coverage.

Run headed Playwright with the e2e-tests-local binary and explicit application revision. Keep each run's raw JSON and failure artifacts separately. A host run against an older build is development evidence, not current-source CI or production artifact validation. The complete three-case host calendar result is recorded in `evidence/host-calendar-iana-delta.json`; it does not replace current-source native CI or the remaining provider/worker scope.


## Mailbox and email-worker lane

The mailbox journey additionally needs the actual email-service process and a
separate Redis instance. A REDIS_PREFIX is insufficient because inbound queues
have fixed default keys. Native Redis is now installed through Homebrew; the
owned instance binds only127.0.0.1:53079, requires a generated password and has
persistence disabled. Its private config/env are under `/tmp/alga-email-redis-82cc`
and `/tmp/alga-email-redis-82cc.env`; never commit or print them. No system Redis
service was enabled. Both host apps and the email worker must source this env.

Build the worker with `npm run build --workspace email-service`, then run
`node dist/services/email-service/src/index.js` from services/email-service.
It must share the same database, provider endpoints, private filesystem secrets,
Redis connection, storage path and IMAP webhook secret as the application. Set
IMAP_WEBHOOK_URL to the host application callback and choose a free PORT for its
health endpoint. Do not count only the health response as ingestion evidence.

The browser runner also sources the dedicated Redis env, which supplies
E2E_REDIS_HOST/PORT/PASSWORD and E2E_EMAIL_TRANSPORT_ISOLATED. The mailbox callback
assertion accepts the same E2E_CALENDAR_CALLBACK_BASE_URL as the shared HTTPS
proxy, retaining the Compose default. Full real-worker pass is recorded in
`evidence/host-microsoft-mailbox-real-worker.json`. App build and worker source
revisions are explicitly distinct in that host result.


## Accounting and payment lanes

QBO, Xero and Stripe can run as another EmulatorHost process using their built
packages and ephemeral ports. The current instance records endpoint assignments
in `/tmp/alga-accounting-host-82cc.env`. Source it on each consuming application
process and the browser runner. Its ALGASIM_CONTROL_URL selects this accounting
instance; use the original Graph control URL when running Microsoft journeys.

Set all OAuth/API URLs shown in docker-compose.e2e-emulators.yaml to the host
emulator ports. QBO module-load constants require a process restart. For Stripe,
set `NEXT_PUBLIC_APP_URL` explicitly to the canonical application origin as well
as NEXTAUTH_URL/NEXT_PUBLIC_BASE_URL: PaymentService uses it for Checkout success
and cancel URLs, otherwise falling back to localhost3000. Preserve synthetic
Stripe keys/webhook secrets and a callback base reachable from the emulator.

`evidence/host-accounting-provider-journeys.json` records QuickBooks and Xero
passes plus all three Stripe cases after fixing the return-origin configuration.
These use the same existing application build without Docker image builds.

## Teams calendar development journey

Start the host app with `NODE_ENV=development`, `TEAMS_EMULATOR_MODE=true`, and `NEXT_PUBLIC_FORCE_FEATURE_FLAGS=release-v1-6-feature:true`, in addition to the shared Graph endpoint and isolated database configuration. The calendar meeting button is behind this release flag; declare it on the server process so Next compiles the browser setting. The dedicated Teams CI development phase sets the same flag.

The browser fixture marks a validated Teams profile active and assigns a synthetic organizer. This prepares an installed tenant; it does not automate installation into a live Microsoft tenant. Calendar entry creation and meeting creation must then use the real UI, with database and provider-state assertions plus a reload check. Keep this lane separate from production-artifact evidence.

The validated host configuration now uses `NODE_OPTIONS=--max-old-space-size=12288` and `next dev --webpack --disable-source-maps`. The full Teams gate passed at a clean revision with no memory restart (evidence/host-teams-memory-budget.json). This disables Node source-map stack-trace mapping; Playwright traces remain available. An 8 GiB heap failed both in source and prebuilt-package modes. CI uses the 12 GiB configuration and stops the completed email/collaboration services before the final development phase, but Linux CI memory usage has not yet been validated.

For the product bot extension, set synthetic `TEAMS_BOT_APP_ID=e2e-teams-bot`, `TEAMS_BOT_APP_TENANT_ID=e2e-bot-tenant`, and `TEAMS_BOT_APP_PASSWORD=synthetic-e2e-teams-bot-secret` on the isolated app. Set `TEAMS_BOT_OPENID_CONFIG_URL` to the emulator origin plus `/v1/.well-known/openidconfiguration` and `TEAMS_BOT_SERVICE_URL_ALLOWLIST` to its exact origin. For a host run, supply `E2E_TEAMS_BOT_TARGET_URL` pointing to the app `/api/teams/bot/messages` endpoint and `E2E_TEAMS_BOT_SERVICE_URL` matching that allowed emulator origin. CI defaults use `http://server:3000` and `http://algasim:4010`, respectively; these names must resolve from the emulator container. All credentials above are synthetic test fixtures.

Use a fresh development server for the full Teams gate when reproducing CI, which recreates the app immediately before this phase. A full run passed with the rebuilt emulator at 12 GiB, but reuse of a long-lived app later triggered Next’s memory restart during sign-in. Preserve such failed runs; do not claim indefinite repeated-run stability or treat an automatic restart as a passing test (evidence/host-teams-rebuilt-emulator-gate.json).
