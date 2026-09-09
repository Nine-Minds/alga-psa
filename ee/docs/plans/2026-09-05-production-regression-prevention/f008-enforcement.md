# F008 — requiring the readiness check on main

Prepared 2026-09-09. Not yet applied; see Ordering.

## What becomes required

One check: **`Production regression readiness`**.

The parent workflow reduces nine independently verified execution verdicts to
that single always-running job, so it is the only name worth requiring. The
child names are not stable enough to depend on — reusable-workflow calls rename
them, and the browser matrix names are generated and truncated by GitHub, for
example `browser / build-images (server, Dockerfile.build, alga-e2e-test_server…`.

`scripts/readiness-enforcement.mjs` adds this as its own ruleset rather than
editing the two existing active ones, so `Run ext-v2 guard and ESLint` and
`Check for new circular dependencies` are untouched and enforcement can be
withdrawn in a single call.

```bash
node scripts/readiness-enforcement.mjs status
node scripts/readiness-enforcement.mjs enable --dry-run
node scripts/readiness-enforcement.mjs enable
node scripts/readiness-enforcement.mjs disable   # rollback
```

## Ordering

`.github/workflows/production-regression.yml` does not exist on `main`. It
arrives with this pull request.

Thirteen other pull requests are open against `main` and none of them carry the
workflow. A required check that a branch's workflows never produce is never
reported, and GitHub treats "not reported" as "not satisfied" — so enabling this
before the merge would block all thirteen until each rebased. Enforcement
therefore follows the merge.

`enable` refuses to run while the workflow is absent from `origin/main`, so the
ordering is enforced by the tool rather than by memory.

## Effective protection before this change

Read from the live API on 2026-09-09:

| Ruleset | Enforcement | Required check |
| --- | --- | --- |
| ext-v2 guard and ESLint | active | `Run ext-v2 guard and ESLint` |
| no new circular dependencies | active | `Check for new circular dependencies` |
| fresh-install-e2e | evaluate | `fresh-install-e2e` |
| code-review-ruleset | evaluate | — |
| tenant_management | evaluate | `Validate Tenant Management Schema` (targets `release/0.16.0`) |

Only the two `active` rows gate anything. `evaluate` is dry-run: it reports but
does not block. Classic branch protection on `main` adds one required review and
carries an empty required-status-checks list.

Anything asserting that this repository already gates merges on its test suites
is describing the `evaluate` rows, not enforcement.

## Bypass

The new ruleset grants the **Nine-Minds Release Bot** (app `2787854`)
`bypass_mode: always`, matching both existing active rulesets. Release
automation keeps working; the cost is that anything acting as that app can merge
past a failed readiness result.

Classic protection separately lets the Release Bot bypass the review
requirement, and lists three users under dismissal restrictions.
`enforce_admins` is `false`, so repository administrators are not themselves
held to these rules.

None of that is changed here. It is written down because a gate with an
undocumented bypass invites the belief that it is stronger than it is. Deciding
whether the bot should keep this bypass is a separate call for the release
owner.

## Freshness

`strict_required_status_checks_policy` is `false`, matching the existing guards.
A pull request can merge on a readiness result computed against an older base,
so a semantic conflict between two independently green branches can still reach
`main`. Setting it to `true` would force every open pull request to rebase
before merging. Worth revisiting once the check has been green on `main` for a
while; not worth paying for on day one.

## Validation after enabling

F008 is not complete until enforcement is observed, not merely configured.

1. `node scripts/readiness-enforcement.mjs status` — confirm the ruleset reads
   back as `active` with the expected check.
2. Open a disposable pull request with a trivial change. Confirm readiness runs,
   passes, and that the branch reports as mergeable.
3. On that same branch, force a failure that readiness must catch — for example
   a deliberately failing assertion in a suite feeding one of the nine verdicts.
   Confirm the check goes red **and** that GitHub actually refuses the merge.
   A red check that still permits merging is the exact failure this work exists
   to prevent, so this step is the one that matters.
4. Confirm a cancelled run and a run missing an artifact both read as non-green
   rather than disappearing.
5. Delete the disposable branch.

Record the outcomes against T008. Until step 3 is observed, the correct
description of this work is "configured", not "enforced".
