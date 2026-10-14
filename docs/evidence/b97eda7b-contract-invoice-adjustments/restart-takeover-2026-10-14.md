# Review restart takeover — 2026-10-14

Review remains blocked. No app service was started or restarted, and no shared
invoice fixtures were changed during this takeover.

## Restart candidate

Alga Dev branch `fix/open-review-remote-browser-handoff` now includes the deployed
fleet base `2b855c67725d154ecaa4847ce21a10b90ccf1b5c` through merge `50e4bb2`.
Publishing the older repair branch without that integration would have omitted
newer fleet behavior, including orphan-service cleanup and CAS handling.

The builder's `37b178fa` fixes candidate identity selection: the restart computes
HEAD plus the tracked diff fingerprint on the service host before stopping the
old process. It compares that attempt's intended identity with `/api/healthz`,
not with the previous service's facts. Wiring tests cover A-to-B replacement,
stale A, missing runtime identity, and a superseding operation owner.

Takeover commit `b54d33b` fixes an additional regression found by the existing
service tests: the shared operation wrapper required live status after a
successful conclude operation. Completion now verifies lease identity and expiry
without requiring the legitimately concluded service to remain live. Restart
still validates its live ownership before launch and success publication. The
older service test harness now models process liveness across stop and spawn.

Validation on the integrated source:

- 52 tests passed across restart wiring, restart protocol, remote-pane handoff,
  card services, orphan reaping, and local JSON state storage.
- `npm run build` passed.
- `npx tsc --noEmit -p tsconfig.node.json` still reports seven diagnostics in
  WorkflowCardFsm, WorkflowVerificationService tests, and hub-command-relay tests.
  These are the same paths/errors observed before the takeover; none names the
  restart implementation. This is not a clean project typecheck.

## PSA CI repairs

At PSA source `2672d974b2`, CI run `38529935619` exposed four obsolete null
expectations in `invoiceQueries.templateResolution.db.test.ts`. The resolver
returns structured permission errors so permission denial remains distinct from
expired authentication. Assertions now require the exact denial for another
client, a draft, a foreign tenant, and missing billing-read permission. Real
resolver and portal access queries remain under test. All six tests passed in
owned disposable database `test_pr3499_takeover_20261014`, which was removed.

The same run's affected-unit job exposed a missing `withOptionalAuth` export in
the quote action test mock. Adding that wrapper restored all 51 quote action
tests without changing production quote behavior.

Other checks:

- Health identity route: 2 tests passed.
- Changed PSA test-file lint: zero errors, 151 warnings; diff whitespace check passed.
- Infrastructure shard 3 timed out in `eventBusPublishLatency.test.ts`. The same
  test passed locally against Redis on 6419 in 2.5 seconds. This does not prove
  the CI timeout is fixed; no event-bus source or timeout was changed.
- At 08:11 UTC, the existing PSA source revision passed affected typecheck, the
  CE production image build, and combined Citus migrations. The EE production
  image and remaining jobs were pending. These results do not establish CI
  success for the subsequent test/evidence commit.

## Deployment evidence and remaining gates

At 08:03 UTC, port 23185 returned production health with no
`reviewBuildIdentity`. It is not serving the verified replacement identity.
The existing service and delivered invoice history were left intact.

Fleet host-status records reported running and desired version
`202610131629-g2b855c6772` on the Mac and card host. The Mac main checkout also
points at `2b855c6772`. The Mac is online and Alga Dev file transport works;
SSH port 22 refuses connections. A dedicated Mac terminal pane was created,
but content inspection timed out and history returned `Session not found`.
No deployment command was sent through that unverified terminal. This is more
specific than the earlier claim that the Mac is unavailable.

The authorized owner must publish the integrated Alga Dev repair from the Mac
using `npm run deploy:publish`, verify affected host activation, and update the
viewer runtime for CardReviewService. Only in the authorized live step should
the supervised review app be restarted to the PSA candidate. Verify old listener
exit, intended runtime identity, readiness, and two authenticated Open Review
calls in `review-app-b97eda7b-0e3f-4b09-be80-6b57f934d8a5-ts_robert-X670E-Pro-RS`.
Then rerun current-production recovery, PDF, portal, lifecycle, and safe
correlated cookie/rejection diagnostics on canonical 3185 and 23185. Neither
source publication nor this record closes those gates.
