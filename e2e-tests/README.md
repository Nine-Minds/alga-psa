# Production browser journeys

This standalone Playwright package runs against an already started production
build and its migrated services. The fresh-install workflow builds and starts
separate CE and EE installations, obtains each installation's seeded
credentials, and runs the tracked specs here. It installs dependencies from this package's lockfile.

## Run locally

Start an isolated production installation first. Set `E2E_USER_EMAIL` and
`E2E_USER_PASSWORD` to its credentials, then use Node 22.13 or later (through Node 26). The tenant fixtures
also require `E2E_DATABASE_ISOLATED=true`, `E2E_DB_NAME`, and `E2E_DB_PASSWORD`.
Set `E2E_DB_HOST`, `E2E_DB_PORT`, and `E2E_DB_USER` when they differ from
`127.0.0.1`, `5432`, and `postgres`:

```sh
cd e2e-tests
npm ci
npx playwright install chromium
E2E_BASE_URL=http://localhost:3000 E2E_EDITION=community npm test
```

The browser runs headed. On Linux without a display, install Playwright's
Chromium system dependencies and use `xvfb-run --auto-servernum npm test`.
`E2E_EDITION` accepts `community` or `enterprise`; it records the intended
edition and chooses the corresponding dashboard assertion. It does not build
an edition or enable features. CI provisions each edition on a separate runner
using its own production image,
migrated database, and edition-specific reports. The EE smoke stack covers the
web application; it does not provide Temporal, extension-runner, or Citus proof. Set
`E2E_REVISION` to the tested checkout for local report attribution; CI supplies
its actual checkout SHA. This metadata does not prove image digest provenance.

## Add a journey

The raw email journey additionally requires `E2E_EMAIL_TRANSPORT_ISOLATED=true`,
GreenMail 2.1.8, the built email-service image, and the SMTP sink from the
candidate emulator build. `docker-compose.e2e-emulators.yaml` shares tenant
secrets and attachment files between server and email-service. It exposes SMTP
and Redis through the fixed ingress proxy; the application network remains
internal. Set `E2E_SMTP_HOST`/`E2E_SMTP_PORT` and
`E2E_REDIS_HOST`/`E2E_REDIS_PORT` when they differ from localhost ports 3025 and
6379, and set `E2E_REDIS_PASSWORD` for an authenticated test Redis.

`inbound-email.spec.ts` creates its IMAP provider through real sign-in and the
settings form. It sends raw MIME through SMTP, waits for the built IMAP/queue
consumer to create a ticket, checks inline quotation preservation, downloads
the actual attachment, sends an agent reply through the UI, and checks the SMTP
sink's threading headers. A customer reply must become a comment on the same
ticket with old quoted history removed. Replaying the original IMAP pointers
through the shipped webhook must drain from the queue without dead letters or
duplicate tickets, comments, documents, processed-message rows, or agent mail.

GreenMail creates distinct disposable mailboxes with authentication disabled
inside the test network. The fixture supplies synthetic provider authentication
results; this journey does not validate Internet SPF, DKIM, DMARC, or live
provider authentication. Duplicate coverage means redelivery of the same
provider UID and MIME bytes. A fresh SMTP delivery changes its provider UID and
Received headers and is a different source message.

Add `tests/*.spec.ts` and import `test`, `expect` and `signIn` from
`fixtures/auth.ts`. Sign-in submits the product form and uses the resulting
browser session. New fixtures can seed preconditions, but the operation under
test must use real UI/API boundaries. Verify saved state after reload and the
corresponding business outcome. Provider journeys should additionally inspect
the emulator's actual records and wait for asynchronous work to complete.

The login specs verify dashboard content, tenant/user identity, session
persistence after reload, a rejected password, and unauthenticated access from
a separate browser context. Tenant specs cover administrator and technician
sign-in, saved client details, and cross-tenant client reads. Portal specs cover
separate client identities, persistence, tenant-specific sign-in, and refusal
to enter MSP pages. The portal ticket round trip submits a request, checks its
persisted client/contact/default assignment, adds public and internal technician
comments, and verifies the public reply after reload. Separate client and tenant
sessions must be denied access to the ticket. New journeys require successful
production execution before their plan items can be marked complete.

Extend fixtures by business domain so later journeys can reuse identities,
contracts, invoices and provider controls. Keep each scenario's preconditions
isolated. A useful journey checks three boundaries: what the user can do, what
Alga persists, and what the external service receives. For financial operations,
replay the actual authenticated request and verify that invoice, charge and
transaction rows do not duplicate or change unexpectedly. For permissions,
send that request under the denied user's own session and verify unchanged data.

`fixtures/usage.ts` supplies overlapping usage/bucket contracts for Add Usage
and invoice generation. `fixtures/invoice-document.ts` parses the PDF downloaded
by the product and checks its invoice number, client, service and total. A
rendered HTML preview alone does not establish that document download works.
The invoice generation cases cover recurring usage and manually entered invoice
numbers; their complete production execution remains pending at the time of this
addition. See the plan's evidence and checklist for verified scope.

`fixtures/recurring-billing.ts` shares tenant, Finance-role, service, billing-profile
and scheduled-period setup between usage and hourly journeys. The time journey
creates a ticket and empty timesheet as preconditions, then logs/submits time as
a technician, attempts billing before approval, approves as a manager, and
generates the invoice as Finance. It checks an explicit approval-required refusal
from a stale Finance selection, unchanged billing data before approval, and the
exact hours, rate, amount and billed state afterward.
Replaying generation must preserve invoice, charge, transaction and time rows.

For concurrent user identities, use `sessions.create('finance')` from the auth
fixture and submit the normal sign-in form in its new page. This creates a
separate browser context and closes it in fixture teardown. Playwright manages
its trace; the fixture adds named actor screenshots and videos on failure and
discards those extra diagnostics on success. Let the fixture close these
contexts so it can capture failed-session state before cleanup.

When a new journey exposes a defect, retain its intended before-fix assertion
failure and the successful after-fix execution. Record the missing boundary,
owning suite and reproduction command in the
[regression evidence ledger](../ee/docs/plans/2026-09-05-production-regression-prevention/evidence/regression-ledger.json).
Distinguish a product assertion failure from a test setup or runner failure.

The worker fixture creates two tenants, each with an administrator, technician,
and two portal users linked to different clients. Each tenant has a support
board, open/closed statuses, and a normal priority; its technician is the board's
default assignee. It uses the migration's
canonical role grants and copies the disposable installation's initialized
password hash. Every browser still submits the real sign-in form with the
installation password. Fixture creation is transactional; an error rolls back
both tenants. Reports attach synthetic identities without passwords or hashes.
Each worker/retry has a fresh run identity. Dispose of the entire database after
the run; the fixture deliberately retains failed-run data until that cleanup.
CI owns this database and removes its Docker volumes in the cleanup step.

## Provider fixtures

CI builds algasim from the candidate checkout with
`packages/emulators/build-image.sh --stage-only`, tests its controls, and exports
the resulting image alongside the application images. Each edition gets its
own instance without a persisted state volume. The browser artifact includes
the emulator catalog and local image ID; this does not establish release digest
promotion provenance.

For local production stacks, add `docker-compose.e2e-emulators.yaml` to the
Compose files and build `alga-e2e-test-algasim:latest` using
`packages/emulators/build-image.sh alga-e2e-test-algasim:latest`. Add
`127.0.0.1 algasim.test` to the browser host's hosts file for Microsoft login.
Before loading this Compose override, generate fresh callback TLS files in an
owned temporary directory:

```sh
export E2E_CALLBACK_TLS_DIR="$(mktemp -d)"
node e2e-tests/harness/create-calendar-callback-tls.mjs "$E2E_CALLBACK_TLS_DIR"
```

The emulator trusts that certificate through `NODE_EXTRA_CA_CERTS`. The private
key is mounted only into the fixed callback proxy. Its internal
`https://calendar-callback:3443/api/calendar/webhooks/microsoft` endpoint forwards
POSTs to the real application's calendar webhook; other paths and methods are
rejected. The application retains its HTTPS requirement. CI verifies both proxy
health and certificate trust from algasim before starting application journeys.
Remove the temporary TLS directory after the stack is stopped.

The `algasim.test` name resolves through a Docker alias for server-side token exchange.
QBO/Xero browser authorization uses localhost; token/API calls use the algasim
container. Seed Stripe's `hostedBaseUrl` with `ALGASIM_PUBLIC_STRIPE_URL` and its
webhook target with `ALGASIM_CALLBACK_BASE_URL` plus the actual webhook path.
Do not use a browser-facing localhost address for a container callback.

The override applies provider endpoints to the server, email-service, and
workflow-worker. It makes the application network internal so containers cannot
fall back to live vendor endpoints. A TCP ingress publishes only fixed Alga,
PostgreSQL and emulator destinations for the host browser/test runner. The
current smoke job starts the server and
email-service; workflow/Temporal journeys must explicitly start their workers.
Teams' production override restriction and unsupported SSO behavior remain
coverage gaps; this fixture does not bypass those guards.

Import `test` from `fixtures/emulators.ts` and select providers with
`test.use({ emulatorProviders: ['stripe'] })`. Set
`E2E_EMULATORS_ISOLATED=true` and `ALGASIM_CONTROL_URL` to the disposable
instance. The fixture requires one worker, resets selected providers before
each scenario, and attaches request/fault-operation evidence afterward. Use
`emulators.seed`, `arm`, `disarm`, `action`, and `state` to control or inspect
external services. Perform the Alga operation through the actual product.

Await application jobs and the expected provider effects before finishing a
scenario. Reset refuses observable in-flight vendor requests, but cannot detect
future requests from an application job that is still queued. The default
attachment omits seed parameters, headers, and bodies; explicitly select and
redact any provider state attached by a journey. Unused provider fixtures do not
count as completed integration coverage.

Verify control behavior with built emulator dependencies from the repository
root: `node --test e2e-tests/harness/emulator-control.test.mjs`.

The Stripe specs collect three EE journeys: successful hosted payment with
signed webhook redelivery, decline/cancellation without settlement, and
Checkout creation failure followed by explicit fault removal and UI retry.
They use fresh tenant identities and a transactionally seeded finalized invoice
per scenario, avoiding stale customer mappings after an emulator reset. The
successful case checks the persisted invoice balance, single payment and ledger
entry, processed webhook identity, provider records and the reloaded success UI.
CE instead collects a named API assertion that the enterprise payment webhook
is unavailable. This distinction is visible in runner-derived case identities;
neither edition uses a skipped Stripe test to satisfy its required collection.
These three EE journeys and the CE availability assertion have passed production
execution; F032 records that completed scope. Provider parity and release
promotion are tracked separately and remain required for broader readiness.

The QBO and Xero specs each drive real OAuth, service mapping and invoice
export through the UI. They inject a failed export, expire provider access
tokens, and recover with one invoice in the intended company/organisation.
QBO also detects an external invoice-number edit through CDC and re-exports
with the current SyncToken. Xero's supported live context is the first returned
connection: the `select-organisation` emulator action controls that ordering
before OAuth, and the journey verifies Alga displays and persists that context.
This is not a separate Alga organisation picker or proof of live-provider OAuth
parity. Both specs collect an explicit enterprise-only refusal check in CE.

## Diagnose failures

Reports are written to `playwright-report/` and `test-results/`. Traces,
screenshots and videos are retained for the original failed attempt. CI allows
one retry for diagnosis, but a retry-only pass fails the command. Missing
credentials fail the tests rather than skipping them. Tests run serially
until data fixtures support independent concurrent execution.

`npm test` first collects the installed runner's cases and compares discovered
files with Git's independent inventory of `e2e-tests/tests/`. After execution it
reconciles file, project, nested test title and repeat count. Missing, skipped,
interrupted, expected-failure and retry-only cases cannot satisfy the required
set. Collection, raw results, discovery and source-attributed execution evidence
are saved in `execution-evidence/` and uploaded by CI. Use `npx playwright test`
directly for a filtered local investigation; that command is not the gate.

Use only isolated test credentials and data: browser traces include requests
and form interactions. CI uploads these reports with seven-day retention.

Verify the retry and artifact policy independently of an application:

```sh
npm run test:harness
```

This launches the installed Chromium runner using the production configuration
and a disposable test suite. It checks a first-attempt pass, then an intentional
failure that passes on retry, requiring the latter command to fail and retain
the first attempt's trace, screenshot and video. It also proves that skipped and
expected-failure cases fail required execution accounting even though plain
Playwright permits them. Results go to
`harness-results/`, separate from customer journey reports. These probes do not
count as application coverage.

The same command also runs an intentional assertion failure in an additional
manager session, verifies its trace/screenshot/video attachments, then verifies
that a passing session discards its extra diagnostics. It needs no application
credentials or database and does not count as a customer journey.
