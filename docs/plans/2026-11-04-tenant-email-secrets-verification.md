# Tenant outbound email secrets: mitigation verification

## Revisions

The email implementation follows [the approved plan](2026-10-13-tenant-email-secrets-plan.md).
PSA revision `7bcf4cf79bc1d62f645d7cf2c78ddc43d92091c9` retains the recorded
`20261013120000` migration as a no-op and puts the guarded Citus heap purge in
`20261104120000`.

[PR #3695](https://github.com/Nine-Minds/alga-psa/pull/3695) merged on
2026-11-04 at 02:27:28 UTC with head `62a2531483302ffab2af955ded503fb2df917f57`.
Its successful checks do not validate the subsequent migration repairs.

The board repair is in the separate
[alga-dev branch](https://github.com/Nine-Minds/alga-dev/tree/fix/card-service-concluded-wake):

- `a127ac9da2709cec0f9278186581681b819f797a`: wake a concluded registration through
  the existing service resume/admission path; retain explicit replacement after
  conclusion and preserve failure status.
- `518a7e91b716e5125a7e1a6d1499895aace3c40b`: publish and watch the active
  `compatible-release.v1` protocol.

## Board deployment

The host supervisor promoted `202611040722-g518a7e9` at 07:22:16 UTC. Its service
process owns `/tmp/ghostty-pane-ide/cli.sock` and `agent-cli.sock`. The release
has no `next` or `rolled-back` marker.

This command accepts the saved registration without `--command`:

```sh
alga-dev workflow-ensure-service \
  --projectId=2ff07240-b1ae-4f1e-a3db-664063fffcf6 --name=dev-server
```

The saved launch configuration is `PORT=3590 npm run dev` in this worktree's
`server` directory on `ts:robert-X670E-Pro-RS`. At verification time, the board
returned the existing session suspended in its resource queue. Admission needs
6 GiB above reservations and an 8 GiB host floor. Port 3590 did not respond.
No resource limits were lowered and no unrelated services were stopped.

## Automated checks

| Check | Result |
| --- | --- |
| Board lifecycle and release-promotion suites at `518a7e9` | 20/20 passed |
| Email provider secrets, provider resolution, settings freshness | 34/34 passed |
| All `packages/integrations/src/actions/email-actions` suites | 42/42 passed |
| Postgres/filesystem backfill integration suite | 4/4 passed |
| Email package `tsc --noEmit -p tsconfig.json` | Passed |
| Integrations package `tsc --noEmit -p tsconfig.json` | Passed |
| Server backfill script and integration test, explicitly listed in a scoped server tsconfig | Passed |
| Email package `npx tsup` | Passed; emitted both providerSecrets module formats |
| CI migration lint against `origin/main` | Both purge identities scanned; zero violations or undecided results |
| Exact forward migration on throwaway Citus 12.1 | Passed; stale parent heap 32768 to 0 bytes, all 200 visible rows retained, repeat `up` and `down` safe |
| `git diff --check origin/main...HEAD` | Passed |

The backfill integration suite used its own database,
`alga2693_takeover_20261104`, on `127.0.0.1:5472`. It did not recreate the shared
`server` or `test_database` databases.
The Citus container was removed after verification.

The CI migration-lint tool is present on the newer main checkout, so it was run
against this worktree with:

```sh
node /tmp/alga-migration-lint-3695/scripts/ci/migration-lint.mjs \
  --repo /home/robert/alga-copies/feature-move-tenant-smtp-resend-secrets-out-of-plaintext \
  --base origin/main
```

Explicit `--files` mode does not preserve the historical migration's modified-file
classification and is not the equivalent PR check.

The board Node typecheck reports 23 errors. Its diagnostic output exactly matches
clean base `692866e2971f4c0808cf25b4f9ac1f1e02f4fd5f`; it is not a passing full
typecheck. The earlier five-error result came from the different `a8376b8` tree.

ESLint separately rejects `20261104120000` as a future timestamp at the current
time. With the host's America/New_York timezone, that filename parses as
2026-11-04 17:00 UTC. The migration identity was preserved. This is an outstanding
lint failure, independent of the passing CI migration-safety check.

## QA runtime checks

The historical action before `eca0c3649a` merged incoming credentials with stored
values and serialized the resulting provider configs directly into
`tenant_email_settings.provider_configs`. That confirms the plaintext write path
for SMTP `password` and Resend `apiKey`. `TenantEmailService.loadTenantEmailSettings`
reads that JSON; provider construction now resolves references in
`EmailProviderManager.resolveProviderConfig`. Client-facing settings pass through
`redactProviderConfigs` in `emailSettingsActions.ts`.

The checks used QA tenant `6d178771-ad9a-4d43-8809-83992745f8f9`, its existing
filesystem secret store, and this card's GreenMail simulator on SMTP port 3725
and REST port 8690. They did not access SMT-Tech's production credential.

A temporary runtime harness exercised the real `providerSecrets` functions and
`EmailProviderManager` against the live database and secret store. It confirmed:

- Legacy SMTP and Resend fields are masked and references are absent from the
  redacted view.
- Legacy SMTP settings deliver to the simulator.
- Persisting the masked view moves both legacy credentials into the store and
  leaves references in the database. SMTP delivery succeeds afterward.
- A display-name edit preserves the references and creates no new secrets.
- A missing secret raises `EMAIL_PROVIDER_SECRET_MISSING`. Entering a replacement
  restores SMTP delivery.
- Backfill dry-run leaves the row unchanged. Execution moves both fields,
  preserves `updated_at`, and becomes a no-op on repetition. SMTP delivery succeeds
  through the backfilled reference.

Every successful send was also found in the simulator's recipient inbox.
These checks exercised the runtime helpers and provider manager directly. They
do not establish authenticated HTTP-action or browser behavior.
The runtime harness and its counts-only results are retained under
`/home/robert/alga-reviews/feature-move-tenant-smtp-resend-secrets-out-of-plaintext/evidence/2026-11-04-takeover/`.
To repeat the harness, copy it temporarily into `server/scripts/`, load
`server/.env.local`, and run it from `server` with `npx tsx`; it expects the
existing `reset.sh legacy` fixture and is limited to the QA tenant and simulator.

The actual operator script was also run against the QA fixture with `--tenant`:
dry-run reported two fields, execution migrated two fields, and repetition
reported zero fields with zero failures. Output was filtered to counts and
field labels. No secret values are included in this report.

## Remaining verification

### 2026-11-04 board wake follow-up

At 2026-11-04 11:12 UTC, `alga-dev workflow-ensure-service` was run with only
`--projectId` and `--name=dev-server`. It succeeded without `--command`, reused
the registered `PORT=3590 npm run dev` launch in the worktree's `server`
directory, and reported the service live on `ts:robert-X670E-Pro-RS`. The
card-origin URL
`http://feature-move-tenant-smtp-resend-secrets-out-of-plaintext.localhost:3590`
returned HTTP 307 to the MSP sign-in route. This verifies registration recovery;
the earlier 6 GiB admission queue is no longer blocking the service. The
host supervisor's current release marker was independently read at
`/home/robert/.alga-dev/releases/current` and confirms release
`202611040722-g518a7e9`.

The authenticated continuation ran on branch revision
`39e29740e7d7bd276be93209f79c9db50c0dc215`, against QA tenant
`6d178771-ad9a-4d43-8809-83992745f8f9`. The review dossier's documented QA
account `qa@emeraldcity.oz` was confirmed in that tenant and signed in
successfully. SMTP and Resend values were not recorded in evidence.

The first settings navigation returned HTTP 500 because this local QA tenant's
`product_code` was `co_managed`, which this checkout does not recognize. For this
QA-only run, the value was temporarily changed to supported `psa`; after the
checks it was restored to `co_managed`. No application code or startup
configuration was changed.

The documented legacy fixture loaded in the authenticated settings page with the
expected SMTP host, port, username, sender and display name, and an empty
password input. A page scan found no `secretRefs` or secret names. A sanitized
inspection of the settings/test action responses found no `secretRefs` or
`email_outbound_*` names; any returned credential fields were blank or masked.
Clicking Test Connection migrated both SMTP and Resend credentials to the tenant
secret store and removed inline values from `provider_configs`. The simulator
inbox contained the expected outbound test message.

A non-secret display-name edit retained the same SMTP secret reference. A
subsequent Test Connection succeeded and produced another inbox receipt. The
`broken` fixture then removed the SMTP secret while leaving its reference. Test
Connection reported: “The saved SMTP password could not be read from the secret
store; re-enter it in Outbound Email settings.” Re-entering the fixture password
restored successful delivery.

For the backfill flow, the legacy fixture was seeded again. Dry-run reported two
fields and left the row unchanged; execution migrated two fields; rerun migrated
zero fields with zero failures. A before/after comparison confirmed `updated_at`
was preserved. With those backfilled references present, the running app loaded
the settings with an empty password field and sent successfully; GreenMail
recorded the receipt.

After verification, `fixtures/reset.sh legacy` restored the documented review
starting state, and the QA tenant's original `co_managed` product code was
restored. The fixture's `show` output was redacted; no SMTP password or Resend
key is included in this record. Direct runtime helper and Citus purge checks
remain as previously recorded. Production Vault/worker access, CE shared-secret
volume behavior, and production heap size remain deployment checks from the
approved plan.

After shipment, SMT-Tech must rotate its SMTP password and re-enter it in
Outbound Email settings. Track that follow-up on PSA ticket `alga-2026-0002693`.

### 2026-11-04 fresh authenticated Playwright verification

Ran a new local Playwright/Chrome browser session against the card origin on
application code revision `90ce9ab9a4d577fc3d4e4b4217202c7f380892b1`. The
Alga Dev browser-control socket was unavailable, so this run used the checkout's
Playwright dependency and system Chrome. The registered dev-server remained live
under its saved `PORT=3590 npm run dev` command and normal admission policy.

The authenticated QA session verified that email settings rendered with an empty
SMTP password input and that relevant server-action responses and rendered
settings contained no credential values, `secretRefs`, or `email_outbound_*`
references. Saving the simulator SMTP credential moved SMTP and Resend fixture
credentials into the tenant secret store and left only references in
`provider_configs`. GreenMail recorded the authenticated SMTP test message.
A non-secret sender-name edit preserved the existing SMTP reference. Removing
that referenced secret caused the expected actionable missing-secret error;
re-entering the simulator credential restored sending, with a second GreenMail
receipt.

The operator backfill dry-run detected two fields; execution migrated both;
rerunning migrated zero. `updated_at` was unchanged. The running application then
sent successfully through the backfilled SMTP reference, with a third GreenMail
inbox receipt. The QA fixture was restored to its pre-run legacy state, generated
feature secrets were removed, and the QA tenant's original `co_managed` product
code and internal-user password hash were restored and equality-checked. The
simulator inbox was cleared by the fixture reset. Counts-only evidence is stored
outside the repository at
`/home/robert/alga-reviews/feature-move-tenant-smtp-resend-secrets-out-of-plaintext/evidence/2026-11-04-fresh-playwright/summary.txt`.

At this same application code revision, the focused migration-history integration
suite passed 2/2 on a disposable PostgreSQL 15 database named
`alga2693_migration_20261104`; that database/container was removed afterward.
The earlier exact Citus 12.1 exercise remains documented above. No email runtime
code changed in this verification round.

PR #3695 is already merged at head
`62a2531483302ffab2af955ded503fb2df917f57` and does not include the subsequent
migration repairs. The repairs are published separately in [PR #4198](https://github.com/Nine-Minds/alga-psa/pull/4198).
The fresh authenticated browser pass and focused migration-history integration
suite both ran against application code revision
`90ce9ab9a4d577fc3d4e4b4217202c7f380892b1`; the only later change before the PR
was opened was this verification record. PR #4198 was opened with head
`a4df3fb0e3287d4565b30fb161eb91ceb932e204`. Its GitHub checks were still pending
when this record was updated.
