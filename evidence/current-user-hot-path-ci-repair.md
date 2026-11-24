# Current-user hot-path CI repair

The `hot-path-budget` job for PR #4155 at `a7057be787d647b3ccc5b3f691ba16fb1828ac0f`
failed because ordinary PSA requests read `co_managed_seat_arrangements`,
`co_managed_seat_assignments`, and `co_managed_unavailable_trial_assignments`.
Job: https://github.com/Nine-Minds/alga-psa/actions/runs/44853561649/job/136694367246.

The public-user allowlist had removed `seat_reader` from both database loading and
current-user resolution. Authorization distinguishes an explicit `false` (loaded
MSP staff, no seat query) from an absent marker (must resolve from the database).
The original failure reproduced locally against disposable PostgreSQL 15.

Authentication now composes the public fields with the database's seat marker,
without loading credentials. The internal current-user resolver preserves that
context. The public current-user action applies the existing public projection,
so neither the marker nor credentials leave that action. The public allowlist,
query budgets, and denylist are unchanged.

Behavioral regressions cover staff admission with no database query, both marker
values through ID/email/API-key resolution, marker removal from public responses,
and both database authentication loaders with credential-bearing rows. Four new
unit cases failed before the repair; the original hot-path test also failed with
the same three tables as CI.

Focused verification also exposed the PR's authentication-response fixture missing
the tenant-policy store added on main. That fixture now supplies policy data while
retaining real policy enforcement; a new case proves both credential boundaries
reject SSO-required password sign-in.

Validation:

- Unchanged `npm run budget:hot-path`: 2 tests passed, including all committed
  statement/lock budgets and unserved-tenant neutrality checks.
- Focused authentication, current-user, tenant-scoping, login-form, and ticket-user
  security suites: 87 tests passed across 10 files.
- PostgreSQL user projection suite: 6 tests passed; temporary tables rolled back.
- Types, auth, and db package builds passed.
- Full server typecheck passed with no diagnostics using
  `NODE_OPTIONS=--max-old-space-size=16384 npx tsc --noEmit --incremental false`.
  The initial attempt exhausted Node's default heap.
- Logs are in `/tmp/pr4155-ci-repair/`. The task-owned PostgreSQL container was
  stopped after verification. Existing `package-lock.json` edits were preserved
  byte-for-byte and excluded from this repair.

The final CI Watch reconciliation of the original head reported only the known
`hot-path-budget` failure, no `newFailures`, and no infrastructure entries. Pending
browser builds, workspace database tests, unit tests, typechecking, and the EE
workflow build guard remain CI Watch's responsibility after the push.
