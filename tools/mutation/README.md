# Scoped mutation pilot

Run `npm run test:mutation:pilot` from the repository root after `npm ci`, using Node 22 or newer within the repository's supported range. The command mutates only calendar month-end close eligibility and authorization scope intersection, runs their maintained behavioral tests, and writes HTML, JSON and a source-checked summary under `reports/mutation/`.

The `Scoped mutation pilot` workflow runs for changes to these modules, their tests or the pilot's dependencies/configuration, and supports manual dispatch. It fails on runner errors, missing scope, stale source, empty mutation sets and execution errors/timeouts. It reports surviving and uncovered mutants without imposing a mutation-score release gate. It does not substitute for browser, database or tenant-boundary testing.

## Compatibility and scope

Stryker core and its Vitest runner are pinned to 10.0.0. Their published packages require Node >=22 and Vitest >=2. The pilot was executed with the repository's root Vitest 4.1.10; the same strengthened test files also passed under the existing server Vitest 3.2.7. The plugin uses the installed Vitest and per-test coverage; see the [official runner documentation](https://stryker-mutator.io/docs/stryker-js/vitest-runner/).

The small sandbox contains the real policy modules and their dependencies. The authorization test imports the kernel package directly rather than bootstrapping the server authorization singleton. Neither policy is mocked. All mutation operators remain enabled and no survivors are excluded from the score.

## Reviewed baseline, 2026-09-06

The first run generated 83 mutants: 70 killed, seven survived and six uncovered, using 23 tests. It exposed a circular assertion that compared authorization output to its own mutable constant, a missing non-monthly-period rejection, and untested legacy ISO boundaries, timezone fallbacks and boolean eligibility callers.

After strengthening those behaviors, 31 tests killed 79 mutants; three survived and one remained uncovered. Both Stryker runs took about three seconds locally with two workers, excluding dependency installation. This is a local runtime observation, not a CI performance target. The [reviewed baseline](../../ee/docs/plans/2026-09-05-production-regression-prevention/evidence/mutation-pilot-baseline.json) records source hashes, versions, counts, remaining mutation locations and their explanations.

The three survivors preserve the public result: missing instants still lead to an ineligible result after conversion fails; an invalid default timezone still falls back to UTC; and undefined and null from failed conversion are both rejected by the only caller. The uncovered array fallback requires a missing `constraints` property, which is outside the required `AuthorizationScope` type. It remains visibly uncovered, not classified as a passing test.

Review new survivors against the business contract. Add behavioral assertions when a mutant changes a meaningful outcome, retain explanations for equivalent mutants, and keep uncovered behavior visible. Expanding the selected modules or changing test/runtime versions creates a new baseline; do not compare its percentage with this one as if the denominator were unchanged.
