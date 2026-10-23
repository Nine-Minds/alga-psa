# Shared calendar provider emulator fixtures

These fixtures exercise the production Google and Microsoft adapters with isolated synthetic credentials. They do not read or modify the wired development database, existing provider rows, event mappings, or external calendars.

## Google Calendar

Run the adapter contract test from `server/`:

```bash
npx vitest run --config vitest.config.ts src/test/integration/googleCalendarEmulator.integration.test.ts
```

The test starts a stateful loopback emulator on an ephemeral port. Its `fixture-google-client`, `fixture-google-secret`, `fixture-refresh-token`, and `fixture-access-token` are synthetic test values. It asserts the adapter refresh request, authenticated event create/read/update requests, and persisted-token callback. The isolated provider ID is `google-emulator-fixture`; its tenant is `isolated-google-emulator-fixture`. Teardown closes the listener and discards its event state.

The shared OAuth WireMock service also has calendar-specific mappings in `test-config/wiremock-oauth/mappings/google-calendar.json`. When using the E2E compose stack, the mock listens at `http://localhost:8081`; configure only the test app process with `GOOGLE_CALENDAR_API_ROOT_URL=http://localhost:8081/` and `GOOGLE_OAUTH_TOKEN_URL=http://localhost:8081/token`. Never apply those endpoint overrides to a production process. The WireMock event response is a fixed fixture response; the stateful adapter test above is the create/read/update contract.

## Microsoft Graph

Run the real-adapter emulator suite:

```bash
npx vitest run --config vitest.config.ts src/test/integration/microsoftCalendarEmulator.integration.test.ts
```

It uses an ephemeral `EmulatorHost` and isolated provider configurations for both shared and enterprise adapters. The suite performs OAuth code exchange, token refresh, and actual Graph event requests, including create/read/update/delete. Its fixture provider ID and tenant are `calendar-provider` and `calendar-tenant`; each test resets only the in-memory emulator. It does not validate the persisted Microsoft provider tokens in the shared development database, and those rows and mappings must remain untouched.

## Wired development fixtures and cleanup

The wired fixtures and their lifecycle are described below. The isolated integration tests above do not modify or validate them. Never delete a wired fixture without checking its tenant-scoped mappings and provider-side copies. The two pre-existing Microsoft rows and their mappings are outside the cleanup boundary.

## Database-backed acceptance setup (2026-09-29 takeover)

The reusable runner is `scripts/calendar-fixtures/provision.ts`. It targets only
`127.0.0.1:6472/server`, Emerald tenant `dd8cb218-d46d-47f3-be27-8aa50aad5fce`, and
Glinda `6684ee32-8f0a-46fb-b84c-4563337b2766`. It refuses another database target.
It does not start the application, migrate, reseed, or reset the database.

From `server/`:

```bash
npx tsx --tsconfig tsconfig.json ../scripts/calendar-fixtures/provision.ts --apply
```

This starts temporary provider emulators, loads encrypted credentials through
`CalendarProviderService`, and verifies connection plus event create/read/update/delete
with the enterprise adapters. Google refresh is forced and persisted through the
real provider service. The probe checks the body marker and Outlook event category.
The Graph emulator now supports master-category lookup/create and category persistence.
Probe events are deleted; existing events, providers and mappings are preserved.
The runner compares all pre-existing non-fixture provider rows and all mapping rows
before and after verification.

`--verify-login` additionally invokes development credential provisioning and the
actual `authenticateUser` function against the wired DB. It prints only the result,
never the credential. This updates only the development account's password hash.
It does not test browser sign-in or issue a browser session.

The provisioned records are:

| Provider | ID | Ownership |
| --- | --- | --- |
| Google | `15b2d092-9fbc-4883-9ed7-0cda79350f52` | Completed the previous token-free placeholder after checking it had no mappings |
| Microsoft | `ba2d3aa4-20d4-48fb-b25a-a1579800bb7f` | New Glinda fixture; existing Scarecrow/Tinman providers untouched |

Both are connected and contain encrypted credentials, but are deliberately inactive
while the emulators are stopped.

The state directory defaults to `/tmp/alga-shared-calendar-fixtures` (override with
`CALENDAR_FIXTURE_STATE_DIR`). It contains `providers.json`, `app.env`, `google.json`
and `graph.json`. Keep this directory outside Git. Google uses port **18481**, Graph
**18482**, and Graph control **18483**. Optional `CALENDAR_FIXTURE_*_PORT` overrides
must be consistent between provisioning and the app. The Google endpoint binds
loopback; use the repository Graph emulator only on the development host.

### Activate for the later Schedule smoke step

1. Copy the four endpoint settings from the generated `app.env` into this worktree's
   `server/.env.local` before the board starts its app. These are process-level
   settings, not stored vendor columns. Keep this worktree's unique `REDIS_PREFIX`
   in the same file so its Schedule publisher and calendar subscriber share an
   isolated stream route; see [Redis event namespace rollout](redis-event-namespace-rollout.md).
   Do not apply fixture endpoints or this prefix to other worktrees.
2. From `server/`, run the provisioning command with `--serve` appended. It verifies
   that `.env.local` has the exact endpoints, repeats the adapter checks, activates
   only the two journaled fixtures, and keeps their emulators in the foreground.
3. Let the board's authorized startup bring up the app. This draft step must not
   start it. Use the credentials from the new startup log; older unpatched servers
   sharing this DB can still rotate the development password.
4. Assign smoke entries to Glinda. Do not use Scarecrow/Tinman for this run: their
   original credentials were preserved, not verified against these new emulators.
   Endpoint overrides are process-wide; their real-provider usability is unclaimed.
5. Run the five flows with the exact stimuli and expected outcomes in
   [shared calendar delivery acceptance](shared-calendar-delivery-acceptance-handoff.md):
   group delivery; inbound note preservation/no marker-only rejection loop;
   group rename on the next update; archive and restore; and personal plus
   calendar-less controls. Inspect automatic provider delivery and mappings
   after UI saves. Direct adapter calls and the automatic-delivery harness are
   service/emulator evidence, not evidence of UI-to-provider delivery. Google
   events can be inspected/edited through its authenticated Calendar API; Graph
   state is available at `/control/msgraph/state/calendar-events` on port 18483.
6. Stop the foreground runner with SIGINT/SIGTERM. It disables only the two
   journaled fixture providers and saves emulator state. A forced kill cannot
   perform this cleanup; disable those exact fixture IDs before leaving the app
   running without its emulators. Do not delete a provider with mappings or
   external copies.

Microsoft emulator access tokens do not survive emulator restart. Always restart
through the provisioning runner so tokens are reissued and saved. Its seven-day
synthetic access token avoids changing Emerald's Microsoft profile binding;
Microsoft token refresh against that tenant binding is not tested by this runner.
The isolated Microsoft integration suite tests refresh separately. Do not reset
emulator state after creating UI acceptance copies.

### Takeover verification

The runner passed repeatedly on the wired DB, including password authentication,
Google token refresh, encrypted-at-rest checks, both providers' event operations,
body marker preservation, Outlook categories, and unchanged existing rows/mappings.
The app stayed stopped; all five authenticated Schedule flows (group delivery,
inbound/no-repush, rename, archive, personal/calendar-less) remain **unpassed**.
See [shared calendar delivery acceptance](shared-calendar-delivery-acceptance-handoff.md)
for concrete flow steps, expected outcomes, routing ledger migration notes, and
the current service/emulator versus UI evidence boundary.
No applicable approved task-specific design was found in `docs/plans` history.

Checks on this takeover: 64 focused tests passed (46 Graph calendar contracts,
12 Microsoft adapter/emulator cases, five dev-login cases, one Google adapter case).
Server TypeScript passed with a 12GB heap; Graph emulator TypeScript and its build
passed. A foreground runner activation followed by SIGTERM passed, including
read-back assertions that both fixture providers were inactive afterward. Endpoint
`localhost:3838` still refused connections; no app was started or restarted.
Local verification logs are `/tmp/calendar-fixture-provision.log`,
`/tmp/calendar-fixture-lifecycle.log`, `/tmp/calendar-takeover-tests.log`,
`/tmp/calendar-takeover-typecheck.log`, and `/tmp/calendar-emulator-typecheck.log`.
