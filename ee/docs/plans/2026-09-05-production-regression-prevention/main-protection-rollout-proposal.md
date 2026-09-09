# Proposed main required-check rollout

**Local proposal only. Do not activate before the baseline and current-source candidate are green.** No GitHub settings were changed.

Use the existing classic required-status-check protection, scoped only to `main`, instead of modifying an active ruleset that also targets release branches. The exact reviewed body is [main-required-status-checks-proposed.json](evidence/main-required-status-checks-proposed.json):

```text
PATCH /repos/Nine-Minds/alga-psa/branches/main/protection/required_status_checks
```

This endpoint changes only required status checks. `strict: true` preserves the current classic freshness setting; each check is bound to the observed GitHub Actions application ID `15368`. [GitHub API contract](https://docs.github.com/en/rest/branches/branch-protection#update-status-check-protection).

The four check identities cover repaired unit completeness, Tier-1 integration completeness, repository discovery, and the aggregate browser/workflow readiness verdict. They are literal check-run names, not workflow display names or inferred job IDs. Browser discovery and individual browser lanes remain independently reconciled inputs to the overall readiness verdict.

Latest completed candidate inspected: run `34308610232`, attempt 1, head `a0d0771b8dbc61eb56b618f8c6a734f150329466`, tested merge `3db700f653e28ddd322dfdb652f1689a54f6b65d`. It is **not eligible for activation**:

| Required context | Observed conclusion | Evidence |
| --- | --- | --- |
| unit / Server unit execution complete | failure | [job](https://github.com/Nine-Minds/alga-psa/actions/runs/34308610232/job/102344151391) |
| integration / Integration execution complete | success | [job](https://github.com/Nine-Minds/alga-psa/actions/runs/34308610232/job/102334968372) |
| Repository test inventory | success | [job](https://github.com/Nine-Minds/alga-psa/actions/runs/34308610232/job/102344222203) |
| Production regression readiness | failure | [job](https://github.com/Nine-Minds/alga-psa/actions/runs/34308610232/job/102344313846) |

## Preserved settings and bypass limits

Baseline: [main-enforcement-refresh-sep9.json](evidence/main-enforcement-refresh-sep9.json), observed 2026-09-09T05:58:42.201Z. Classic check arrays were empty, strictness true, admin enforcement false; review requirements remain one approval with the recorded freshness/review settings. The narrow PATCH changes none of those other settings.

Leave both active rulesets untouched: `7438254` requires `Run ext-v2 guard and ESLint`, and `13189070` requires `Check for new circular dependencies`. Their non-strict settings and existing Integration actor `2787854` bypass records remain unchanged. Leave evaluation-only rulesets and all release-branch conditions untouched.

The new classic checks follow existing classic protection semantics, including `enforce_admins: false`. A ruleset-specific Integration bypass does **not** itself grant exemption from a separate classic check requirement. This proposal does not invent such an exemption. If that Integration must bypass the new checks too, the desired policy needs an explicit decision before activation; do not silently copy a bypass actor into a new rule. Likewise, an alternative new ruleset needs an explicit bypass and strictness policy rather than guessed defaults.

## Activation prerequisites

1. Obtain a green baseline and a green current candidate, including the repaired unit completeness gate with no required TODO/skipped/missing assertions, Tier-1 gate, repository inventory and production regression aggregate. Historical partial passes and local fixtures do not satisfy this prerequisite.
2. Confirm the exact four names and application IDs on that current candidate. Confirm the relevant workflow versions are available for normal PRs to main; assess representative eligible/non-eligible paths through the aggregate rather than making absent jobs required by guesswork.
3. Immediately reread classic protection, effective main rules and ruleset definitions. Abort/reconcile the proposal if any required checks, bypasses or freshness settings differ from the recorded baseline; the supplied body must not replace newly added checks accidentally.
4. Review the concrete body and bypass implications against the existing task authorization. Resolve any genuinely missing policy decision before activation; do not request permission again for actions already authorized in the session.

## Verify after activation

- Read back classic protection: all four `(context, app_id)` pairs are required and strictness remains true. Read back effective rules and confirm both existing guards, review requirements, bypass settings and release-branch rules are unchanged.
- Use a disposable PR to main for the planned enforcement rehearsal under an ordinary non-bypass actor. A deliberately failing required test must block merging; incomplete/cancelled readiness must not satisfy the aggregate. Record actual mergeability/check evidence without merging the PR.
- Restore the fixture and demonstrate the complete required checks passing on the up-to-date candidate. Verify an out-of-date candidate is blocked by the retained strict policy.
- Record actual actor and bypass behavior; do not infer enforcement merely from successful CI or an API payload. This is the remaining T008 proof.

If the rollout must be reversed, first reread current settings and remove only these newly added check pairs as part of the rollback. The baseline was `strict: true`, empty check arrays; never blindly restore that snapshot over intervening protection edits.
