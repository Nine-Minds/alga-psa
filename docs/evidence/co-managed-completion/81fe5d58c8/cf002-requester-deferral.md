# CF002 / CF003 / CF004 — requester lifecycle deferral divergence

**Status at the end of this round: still open.** A structurally confirmed defect was repaired at its
owner and the reporting failure that hid the original exception was fixed, but the cause of the CI
divergence is **not established**. Do not read this document as a closure.

## The failure

[Run 35492001110](https://github.com/Nine-Minds/alga-psa/actions/runs/35492001110), job
[106030872598](https://github.com/Nine-Minds/alga-psa/actions/runs/35492001110/job/106030872598),
Integration shard 1, `VITEST_SEED=20260610`, at `618019c3e3`. 1 failed / 2170 passed.

```
× defers and rolls back requester email when a separately compiled admission adapter reports a lifecycle pause  395ms
  → Failed to fully serialize error: Maximum call stack size exceeded
Inner error message: expected { disposition: 'retry', …(1) } to match object { disposition: 'defer', …(1) }
(1 matching property omitted from actual)
```

The case
(`ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts:9051`)
injects its own `qualifiedReplyAdmission`: it calls the real source-imported
`admitCoManagedRequesterReply`, then throws a **duck-typed** lifecycle error —
`Object.assign(new Error('Workspace became read-only'), { name: 'CoManagedLifecycleError', code:
'CO_MANAGED_READ_ONLY', lifecycle: { state: 'read_only', canWrite: false, graceEndsAt: null } })` —
standing in for what a dist-compiled worker adapter throws. It asserts
`{ disposition: 'defer', reason: 'co_managed_read_only' }`.

## Reproduction attempts

| # | Attempt | Result |
| --- | --- | --- |
| 1 | The single case, standalone, `VITEST_SEED=20260610`, CE+EE overlay, `DB_NAME_SERVER=server_co_managed` | **passed** |
| 2 | The whole `coManagedBootstrap.integration.test.ts` file at the same seed, full intra-file shuffle | **1416/1416 passed** |
| 3 | "Real shard" with `INTEGRATION_SHARD_TOTAL=1`, `TIER1_BASE_SHA=<merge base>` — **312 files** | bootstrap suite **passed**; see below, this was not the failing shard |
| 4 | Faithful shard: `INTEGRATION_SHARD_TOTAL=4`, `INTEGRATION_SHARD_INDEX=1`, `TIER1_BASE_SHA=''` — **78 files** | bootstrap suite **1416/1416 passed** (265s) |
| 5 | **CONTROL**: attempt 4 rerun with `isCoManagedSharedWorkError` reverted to `instanceof` | bootstrap suite **1416/1416 passed** (284s) — see "The control run settles it" |

Attempts 1 and 2 rule out intra-file ordering and the migration overlay. The documented harness
rules were followed throughout: the CE+EE overlay was built from `server/migrations` +
`ee/server/migrations` (1101 + 70 → 1165 files after 6 EE-over-CE collisions) and
`TEST_MIGRATIONS_DIR` was exported; the bootstrap harness's runtime `DB_NAME_SERVER` selection was
left alone, and the reverted clone-source pin and `ALGA_SCHEMA_SOURCE_DB` were **not** reintroduced.

### Attempt 3 was the wrong shard, and that is the round's most useful finding

The PRD asks for shard membership and order to be preserved. They were not, in two ways:

| | `INTEGRATION_SHARD_TOTAL` | `TIER1_BASE_SHA` | Gate decision | Files |
| --- | --- | --- | --- | --- |
| CI job 106030872598 | **4** | *(empty)* | `Change evidence unavailable; full suite required` | **78** |
| attempt 3 | 1 | `8120314513` | `manifest + affected suites` | 312 |
| attempt 4 | **4** | *(empty)* | `Change evidence unavailable; full suite required` | **78** |

1. **The matrix is four wide.** `gh run view 35492001110` shows `Integration shard 1` (failure)
   alongside shards 2, 3 and 4, all success. Listing only the *failed* jobs — which is how the
   commissioning snapshot describes the run — hides that. With `TOTAL=1`, `partitionTestFiles` hands
   one process all ~310 integration files instead of shard 1's 78, so the cross-file state a
   `singleFork` process accumulates before reaching `coManagedBootstrap` is a different set in a
   different order. For an order-dependent failure that is a different experiment.
2. **`TIER1_BASE_SHA` must be empty.** CI passed it empty, so `readChangedFiles` finds no change
   evidence, `selectIntegration` returns `full`, and the gate selects both integration directories.
   Supplying the merge base instead yields `manifest + affected suites` — a different selection again.

So attempt 3's pass is **not** evidence that the defect is fixed, and it would not have been evidence
that it was absent either.

The faithful invocation, which reproduces CI's gate line verbatim and collects exactly 78 files with
`coManagedBootstrap.integration.test.ts` among them:

```bash
INTEGRATION_SHARD_INDEX=1 INTEGRATION_SHARD_TOTAL=4 TIER1_BASE_SHA='' \
VITEST_SEED=20260610 REQUIRE_DB=1 REAL_REDIS=1 REDIS_HOST=localhost REDIS_PORT=6379 \
TEST_MIGRATIONS_DIR="$PWD/server/.ci-combined-migrations" \
npm run test:integration:tier1     # from server/
```

It needs two services this workstation does not otherwise run, because the card's own ports do not
match what the lane expects (`REDIS_PASSWORD` must be unset; the card's Redis on `:6374` has one):

```bash
docker run -d --name cm-redis-ci -p 6379:6379 redis:7-alpine
docker run -d --name cm-greenmail -p 33025:3025 -p 38080:8080 \
  -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled' \
  greenmail/standalone:2.1.8
```

### What attempt 4 does and does not establish

The faithful shard executed `coManagedBootstrap.integration.test.ts` and it **passed, 1416/1416, in
265 seconds**, with the case under test among them:

```
 ✓ ../ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts (1416 tests) 265509ms 857 MB heap used
```

Checked, because a green line is not enough here:

- **It executed; it was not skipped.** Zero `↓ defers and rolls back requester email …` skip markers
  and zero `skipped` in the file's summary. Contrast the discarded first faithful attempt, which
  reported `1416 tests | 1416 skipped` because an interrupted predecessor had left `test_database`
  dropped — a green-looking file that ran nothing.
- **Zero `[inbound-email-diagnostic]` lines is expected, not suspicious.** `server/vitest.config.ts`
  sets `silent: 'passed-only'`, so console output is retained only for failing tests. The
  diagnostics are designed to surface exactly when the case fails, which is what the next CI shard-1
  log will show if it still diverges.

**What this does establish:** the "original-shard pass at seed 20260610" the exit criteria ask for,
at the correct composition, with the case genuinely executed.

**What this does NOT establish — and this is the important half:** that the fix caused it. No
**control run** was made. The same 78-file shard was never run with `isCoManagedSharedWorkError`
reverted to `instanceof`, so a pass here is equally consistent with:

- the duck-typing repair having fixed a real, CI-only manifestation; or
- the divergence being specific to the GitHub runner — timing, or the `packages/co-managed` dist that
  `npm ci` produces there versus the explicit `npx tsup` build here — in which case this shard would
  have passed before the fix too.

CF002-CF004 therefore stay **`failed`** in the inventory. Until the control run distinguishes those
two, the causal claim is unproven, and the authoritative signal is mandatory CI at the new head.

### The control run settles it: the local shard is not a discriminating experiment

Attempt 4 passing was not attributable to the fix without a control, so the control was run: the
identical 78-file shard, same seed, same services, with `isCoManagedSharedWorkError` reverted to

```js
return error instanceof CoManagedSharedWorkError;
```

in **both** `packages/co-managed/src/sharedWorkIdentity.ts` and the tsup `dist` the integration lane
actually resolves (rebuilt before the run; verified in `dist/chunk-QBUECOF2.js`).

```
 ✓ ../ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts (1416 tests) 284350ms
```

**The control passed too**, and it genuinely executed: 0 skip markers for the case, 0 `skipped` in the
file summary.

Both arms pass. So:

- The duck-typing repair is **not demonstrated to be the cause** of the CI failure. CF002-CF004 stay
  `failed`, and CF003's causal claim is now explicitly unsupported rather than merely unproven.
- It is **not refuted** either. The local shard never reproduces the divergence in the first place,
  so it cannot distinguish the two arms - nothing in this environment throws a
  `CoManagedSharedWorkError` across the compiled-module boundary during that case. A test that
  cannot fail under the defect cannot exonerate the fix.
- What **is** established: this workstation cannot discriminate, at the correct shard composition,
  with the correct seed. The divergence lives in the CI environment - GitHub runner timing, or the
  `packages/co-managed` dist that `npm ci` produces there versus the explicit `npx tsup` build here.
  Four local attempts have now failed to reproduce it. **Stop trying to reproduce it locally.**

The repair itself remains correct and is kept: the split export map really can put two
`CoManagedSharedWorkError` constructors in one process, `instanceof` really does silently report
false across that boundary, and `@alga-psa/licensing` already solved the identical problem for its
sibling error. It is a latent defect fixed on its merits, not a fix for the observed failure.

The call sites are now pinned too. `coManagedAdmissionAdapters.test.ts` drives both adapters with a
foreign-constructor rejection, a same-realm one, and an unrelated infrastructure error. Mutation runs,
each adapter independently:

| Mutation | Result |
| --- | --- |
| `inboundRequesterReply` -> `instanceof` | 2 failed / 6 passed |
| `inboundEmailReply` -> `instanceof` | 1 failed / 7 passed |

The infrastructure-error cases stay green under both, so the repair is not broadening quarantine -
unknown database failures still propagate to `retry`.

### CI history: the case regressed, it did not always fail

Round 2 concluded "the divergence lives in the CI environment". That is too weak. Reading Integration
shard 1 across this branch's completed Production-regression runs narrows it to a window:

| run | SHA | when | shard 1 | the requester case |
| --- | --- | --- | --- | --- |
| 35477498197 | `bda945b640` | 2026-09-19 23:57Z | **success** (all four shards green) | present in the file, passed |
| 35486497392 | `7b0b52c6c3` | 2026-09-20 03:24Z | **failure**, 2 failed / 2166 passed | **failed** |
| 35492001110 | `618019c3e3` | 2026-09-20 05:34Z | **failure**, 1 failed / 2170 passed | **failed** |

The case was not new: `git show bda945b640:…/coManagedBootstrap.integration.test.ts` contains it, and
shard 1 was green in that run. So it passed in CI, then failed in the next two runs. It was
introduced by `b316bd523f`, well before the green run.

That reframes it. Two consecutive failures at two different SHAs is evidence of **persistence**, not
of a flake — but it is not proof of determinism either, because no two completed runs exist at the
same SHA to compare. The honest statement is: persistent across two candidates, with one earlier
green.

The regression window is `bda945b640..7b0b52c6c3` — ten commits, including a merge of `origin/main`
and `ad14eb6919` ("Log time refused on shared work because two dispatch guards disagreed on scope"),
which touches `packages/co-managed/src/nativeTimeDispatch.ts` and its siblings. The window also
touches `coManagedBootstrap.integration.test.ts` itself, so an ordering or fixture change inside the
suite is as plausible as a product change. Shard composition also shifts between runs (2168 vs 2171
tests), so "the same shard" is only approximately true across SHAs.

This is the most actionable lead the card has for CF002–CF004, and it is a better next step than any
further local reproduction: bisect that window against CI shard 1, not against this workstation.

### The 8 `Comment Reactions` failures were my harness, not the product

Round 1 carried these as "probably local contention". They are not. Diagnosed:

```
[Redis] Client error { error: 'ERR AUTH <password> called without any password configured
                               for the default user. Are you sure your configuration is correct?' }
[publishTicketUpdate] Failed to publish live ticket update: ReconnectStrategyError: Max reconnection attempts reached
```

`packages/event-bus/src/config/redisConfig.ts:101` resolves the password with
`getSecret('redis_password', 'REDIS_PASSWORD')`, and `getSecret` reads the **secrets file first**. This
checkout has a leftover `secrets/redis_password` (32 bytes) from the card's password-protected Redis
on `:6374`, so `unset REDIS_PASSWORD` in the shard runner did nothing — the client still sent `AUTH`.
The CI-shaped Redis the reproduction uses (`redis:7-alpine` on `:6379`) has `requirepass` **empty**, so
it rejects the `AUTH`, reconnection attempts exhaust, `publishTicketUpdate` blocks, and each test hits
the 20 000 ms vitest timeout.

CI does not hit this because its `Create secrets files` step writes only `secrets/postgres_password`
and `secrets/db_password_server` — never `secrets/redis_password` — so there is no password to send.

Ruled out along the way, each with evidence rather than assertion:

| Hypothesis | Verdict |
| --- | --- |
| CPU contention from a concurrent typecheck | **No.** Reproduces with the suite running alone. |
| Shared-`test_database` contention inside the shard | **No.** Reproduces on a private `test_database_cr_branch` via `TEST_DB_NAME`. |
| A product defect in comment reactions | **No.** The suite passes in CI shard 1, and the hang is in the Redis publish path, not the insert. Postgres shows `idle in transaction` / `ClientRead` after `insert into "comment_reactions"` — the database is done and waiting on a client that is stuck retrying Redis. |

**Consequence for the shard evidence above:** any suite in those local runs that publishes to Redis was
running against a mis-authenticated client. That can only *cause* failures, never mask them, so it
does not weaken the `coManagedBootstrap` passes — but a future reproduction should either delete
`secrets/redis_password` or start the container with a matching `requirepass`.

One more trap, learned the hard way: **do not kill a running shard and immediately start another.**
`createTestDbConnection` drops and recreates `test_database`, so an interrupted run leaves it absent
and the next run collapses with `database "test_database" does not exist` and
`Connection terminated unexpectedly` across ~160 files. That looks like a product failure and is not
one. The first faithful attempt was discarded for exactly this reason.

## The reporting failure came first

The PRD is right that the stack overflow is a candidate *reporting* failure, not the established
cause — and it is worse than that: it is why the first exception was never named. The `retry`
disposition carries `error: message`, and the assertion message was truncated by chai, so the CI log
contains no statement of what actually threw.

Two mechanisms make the reporter's walk unbounded, and they are both real on this path:

- knex 3.1.0 mutates the thrown error **in place** (`lib/execution/runner.js` assigns `sql`,
  `bindings`, `timeout`, and `error.sql`/`error.bindings`). `bindings` can hold arbitrary values
  passed into the query.
- Vitest 4's `@vitest/utils` `serializeValue` walks every own property of every prototype in the
  chain with **no depth cap**, and takes its `toJSON` shortcut *before* its cycle guard.

So the fix has to be upstream of the reporter: never hand a raw thrown value to anything that
reports.

`shared/services/email/inboundErrorDiagnostics.ts` reduces a thrown value to primitives:
`name`, `code` (only when string/number), a message bounded at 2000 characters, and **exactly one**
level of `cause`. It never reads `sql`, `bindings`, `client`, a transaction or any credential field,
and it survives a self-referential cause, a 20 000-deep cause chain, a `message` that is an object,
and a `toString` that throws. All of that is asserted in
`server/src/test/unit/email/inboundErrorDiagnostics.test.ts`.

`inboundEmailCoreProcessor` now uses `inboundErrorMessage(error)` where it previously used
`error?.message || String(error)`. The value is unchanged for a normal `Error` — sentinel
comparisons such as `message === 'inbox_fence_superseded'` and the provenance persisted by
`markRetryable` behave identically — but it is now guaranteed to be a bounded string, so a thrown
value whose `message` is an object can no longer put a walkable graph into a disposition or into
`inbound_email_inbox`.

## Bounded diagnostics, at the boundaries the PRD names

`recordInboundDiagnostic(stage, context, error?)` emits one line of primitives. Vitest keeps console
output for failing tests (`silent: 'passed-only'`), so on the next CI candidate the first exception
will be named in the shard log. Stages wired:

| Stage | Where | What it answers |
| --- | --- | --- |
| `admission` | `packages/co-managed/src/inboundRequesterReply.ts`, `inboundEmailReply.ts` | An admission rejection that was **not** recognised, plus `sharedWorkConstructorMatched` — whether `instanceof` agreed with the contract match |
| `rollback` | `inboundEmailCoreProcessor.ts`, in the commit `catch` | The original exception's name/code/message/cause, before anything can serialize it |
| `lifecycle_classification` | same `catch`, only when the typed match declines | `candidateName`, `candidateCode`, `candidateLifecycleState`, `candidateCanWrite` — the exact fields that failed `isCoManagedLifecycleError` |
| `disposition` | the `retry` return | That `retry` was chosen, with the error that chose it |

## The defect that was repaired

`packages/co-managed`'s export map is **split**: the root and two pure modules resolve to source,
while every worker-facing subpath (`./inboundRequesterReply`, `./inboundEmailReply`,
`./inboundConversationEvents`, …) resolves to the tsup bundle. `sharedWorkIdentity` is not an
export-map entry, so the class it defines is bundled into the dist chunks as a **second, distinct
constructor**. `server/vitest.config.ts` has no alias for `@alga-psa/co-managed` (it does have them
for `@alga-psa/licensing`), so both copies can be live in one process.

Both worker admission adapters classified their terminal rejection with
`error instanceof CoManagedSharedWorkError`. Across that boundary `instanceof` silently reports
false, the rejection is **rethrown** instead of returning `{ admitted: false }`, it escapes as an
unclassified error, misses `isCoManagedLifecycleError`, and the durable inbox reports **`retry`** —
the exact collapse observed.

`@alga-psa/licensing` already solved this for its sibling error, with the reason written down:

> Worker adapters can load a separately compiled copy of this package. Match the explicit error
> contract rather than relying on a shared JS constructor.

`isCoManagedSharedWorkError` is that predicate's counterpart, and the two adapters the PRD names now
use it.

**This is a real defect and its repair is real. It is not established as the cause of the CI
failure.** Without a reproduction, the causal claim is unproven, so CF002–CF004 stay `failed`.

The remaining 85 `instanceof CoManagedSharedWorkError` sites were left alone: they are outside this
card's entry points and changing them is a broad edit with no evidence behind it.

## Commands and results

```
$ cd server && SKIP_DB_TESTS=1 npx vitest run src/test/unit/email/inboundErrorDiagnostics.test.ts
  Test Files  1 passed (1)      Tests  10 passed (10)
```

Mutation — `isCoManagedSharedWorkError` reverted to `return error instanceof CoManagedSharedWorkError`:

```
 × shared-work classification survives a separately compiled copy > matches the error contract rather than the constructor
      Tests  1 failed | 9 passed (10)
```

`packages/co-managed` typechecks clean and `npx tsup` was rerun, so the dist the integration lane
resolves carries the duck-typed predicate (`dist/chunk-HLLCNPFH.js:31`).

## What is next

0. ~~Run the control.~~ **Done - it passed.** The local shard cannot discriminate, so no further
   local reproduction attempt is worth making.
1. Read the `[inbound-email-diagnostic]` lines from the next CI shard-1 log. The `rollback` and
   `lifecycle_classification` stages name the first exception and say precisely which contract field
   declined. `admission.sharedWorkConstructorMatched: false` would confirm the dual-constructor
   mechanism directly.
2. If the divergence persists with a named first error, repair that error's owner.
3. Only then: mutation proof that the repaired case fails without the fix, focused pass, and a
   full original-shard pass at seed `20260610`.

## Forbidden shortcuts — none taken

No error was turned into `defer`; the test was not skipped, `.skip`-ed or moved out of the shard; the
expected disposition was not relaxed; requester admission was not loosened. Unknown
infrastructure/database failures still `retry` and authorization/token failures still quarantine —
the repair makes the quarantine path *more* reliable, not broader.
