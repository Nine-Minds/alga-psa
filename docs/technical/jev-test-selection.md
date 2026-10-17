# Jev test selection

CI asks TypeSafe's Jev model, for every integration suite and every browser
journey, whether it would plausibly fail if the change under test introduced a
bug. The answers are probabilities, recorded per PR. `JEV_SELECTION_MODE`
(workflow env, overridable by a repository variable) picks the mode:

- **shadow**: judgments are recorded and scored; nothing that runs changes.
- **enforce**: the integration runner and the production browser gate read the
  judgment for the exact revision under test and act on it, as described under
  *Enforcement policy*.

## Why a model, and where it sits

The integration gate already selects deterministically: the Tier-1 manifest
floor plus every suite whose import graph reaches the diff (`vitest --changed`).
That graph is exact for import edges and blind to everything else: migrations,
seeds, SQL strings, config, virtual mocks. When one of those changes, the gate
falls back to the full suite. It also over-selects through barrel files, where a
suite imports a package index that re-exports the changed module.

Jev fills the semantic gap. It never removes a suite the graph reached directly,
and it never removes the manifest floor. Its job is to rank the rest.

## What Jev sees

Nothing is hand-authored. Two digests are derived from source on every run:

- **Test digest** (`scripts/lib/test-digest.mjs`): file path, header comment,
  `describe`/`it`/`test` titles, imports, mocked modules, database tables
  referenced through knex calls or SQL, and routes visited by `page.goto`.
  Browser journeys are digested per test, integration suites per file.
- **Change digest** (`scripts/lib/change-digest.mjs`): PR title and body, each
  changed file with its kind (migration, seed, source, test, config, docs),
  hunk context, declared symbols, tables touched, and a bounded excerpt of the
  changed lines. Changed test files carry no detail; they always run.

One request carries the change once and as many candidates as fit under a
budget of about 36k input tokens (TypeSafe rejects requests somewhere between
42k and 48k tokens with `max_tokens_exceeded`; a rejected batch is halved and
retried). Measured on a 135-file PR: 13 requests, about 410k input tokens,
under three seconds wall clock.

## Artifacts

| Artifact | Producer | Contents |
|---|---|---|
| `jev-selection` | `scripts/select-tests-jev.mjs` | per-candidate probabilities, the policy decision at the configured threshold, request sizes, token usage |
| `jev-evaluation` | `scripts/evaluate-jev-selection.mjs` | recall against real failures and deferred share at thresholds 0.3, 0.5, 0.7, with every failure Jev would have deferred listed |

Both jobs write the same tables to the workflow step summary.

## Running it locally

Dry run (builds every request, sends nothing, writes a sample request):

```bash
JEV_DRY_RUN=1 JEV_BASE_SHA=origin/main node scripts/select-tests-jev.mjs
```

Live run needs `TYPESAFE_API_KEY` in the environment. Evaluate against
downloaded artifacts:

```bash
node scripts/evaluate-jev-selection.mjs --selection=path/to/jev-selection.json --inputs=path/to/artifacts
```

## Enforcement policy

Both runners load the judgment through `scripts/lib/jev-enforcement.mjs`, which
applies only when the artifact is present, `judged`, recorded in `enforce`
mode, and made for the revision being tested. Anything else runs everything.

**Integration** (`scripts/run-tier1-integration.mjs`):

- Harness changes (vitest config, test setup, test-utils, package and
  tsconfig files, scripts, workflows, `.env`) still run the full directory.
  No judgment about product behavior can narrow them.
- Otherwise the run is the manifest floor, plus every suite the import graph
  reaches, plus every suite Jev rates at or above the run threshold (0.5).
  Graph-reached suites Jev rates below the prune threshold (0.2, set
  `JEV_PRUNE_THRESHOLD=0` to disable) are deferred. Changed test files always run.
- Migrations, seeds and service changes, which used to force the full
  directory, now take this path too. Nightly and explicit full runs still force
  the directory (`INTEGRATION_FORCE_FULL`).
- The evidence records `selection.jev` with what was added and pruned.

**Browser** (`e2e-tests/run.mjs`):

- Collection is still the whole directory; execution is narrowed with
  Playwright `file:line` filters.
- Always run: every journey the provider-readiness policy names for the
  edition, `login.spec.ts`, changed spec files, and any collected case with no
  judgment (parameterized titles fall back to the file's strongest judgment).
- Deferred cases are recorded with their probability in `selection.jev.deferred`.
  The fresh-install gate accepts a `jev` selection only when every deferred
  identity exists in the collection, sits below the threshold, and the judgment
  revision matches; otherwise it fails as a filtered run, exactly as before.

## Fallbacks

Every failure path degrades to running everything; none blocks a PR.

| Situation | Recorded as | Integration lane | Browser lane |
|---|---|---|---|
| `TYPESAFE_API_KEY` not set | `unavailable` | deterministic selection | full directory |
| API error after retries, or a crash in the selector | `failed` with the reason, plus a workflow warning | deterministic selection | full directory |
| Artifact missing (nightly, dispatch, upload skipped) | not applicable | deterministic selection | full directory |
| Artifact recorded in shadow mode, or for another revision | `unavailable` | deterministic selection | full directory |
| Harness change in the diff | judged, but not applied | full directory | judgment applied |

"Deterministic selection" is the pre-existing behavior: manifest floor plus
graph-affected suites, or the full directory when the change sits outside the
import graph. The selection job itself never fails.

## Graduating from shadow to enforcing

The number that matters is **recall against real failures**: of the suites and
journeys that failed on a PR, what fraction did Jev score at or above the
threshold? Collect it over several weeks of PRs, then graduate in this order:

1. **Expansion.** Add suites Jev flags that the import graph missed. No coverage
   risk.
2. **Full-fallback reduction.** When a migration or config change forces the
   full suite today, run manifest floor + graph-affected + Jev's confident set
   instead. The nightly full run remains the backstop.
3. **Barrel pruning.** Defer suites the graph reached only through an index
   re-export when Jev is confident they are unrelated.
4. **Browser journeys per test.** The production browser lane is the PR
   critical path; per-journey deferral is where wall-clock time is saved.

Any TypeSafe failure (missing key, 429, 529, timeout after retries) records
`unavailable` and the pipeline runs everything, in every mode.

## Known limits

- Vitest per-test selection is deliberately not attempted. Measured on the
  nightly, about 60% of integration runtime is per-file overhead, and 131 of
  294 suites hold module-level state that later tests may depend on.
- Recall among deferred tests is only observable in the nightly full run,
  which never reads a judgment. The evaluation job measures recall among the
  tests that executed.
- Table extraction is regex-based. A suite that reaches tables only through
  shared fixtures is described by its titles and imports instead.
