# Jev test selection

CI asks TypeSafe's Jev model, for every integration suite and every browser
journey, whether it would plausibly fail if the change under test introduced a
bug. The answers are probabilities, recorded per PR. Today they change nothing:
the pipeline runs in **shadow mode**, and a second job scores the judgments
against the tests that actually ran and failed. Enforcement is a policy switch
that stays off until the shadow evidence justifies it.

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
- The evidence gate (`scripts/lib/test-execution-evidence.mjs`) requires every
  collected test to execute. Enforcing mode must record deferred tests as
  deliberately deferred with their probability, which is not yet implemented.
- Table extraction is regex-based. A suite that reaches tables only through
  shared fixtures is described by its titles and imports instead.
