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

Run headed Playwright with the e2e-tests-local binary and explicit application revision. Keep each run's raw JSON and failure artifacts separately. A host run against an older build is development evidence, not current-source CI or production artifact validation. See the accompanying evidence for the actual result; this runbook does not claim the full calendar scenario passes.
