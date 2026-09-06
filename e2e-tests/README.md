# Production browser journeys

This standalone Playwright package runs against an already started production
build and its migrated services. The fresh-install workflow builds and starts
separate CE and EE installations, obtains each installation's seeded
credentials, and runs the tracked specs here. It installs dependencies from this package's lockfile.

## Run locally

Start an isolated production installation first. Set `E2E_USER_EMAIL` and
`E2E_USER_PASSWORD` to its credentials, then use Node 22–26. The tenant fixtures
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
to enter MSP pages. Customer workflow mutations, client-to-client data isolation,
and EE production execution remain unfinished plan items.

The worker fixture creates two tenants, each with an administrator, technician,
and two portal users linked to different clients. It uses the migration's
canonical role grants and copies the disposable installation's initialized
password hash. Every browser still submits the real sign-in form with the
installation password. Fixture creation is transactional; an error rolls back
both tenants. Reports attach synthetic identities without passwords or hashes.
Each worker/retry has a fresh run identity. Dispose of the entire database after
the run; the fixture deliberately retains failed-run data until that cleanup.
CI owns this database and removes its Docker volumes in the cleanup step.

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
