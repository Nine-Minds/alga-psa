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

### The CI read at `fb2e696645`: the first error is finally named

[Run 35522723445](https://github.com/Nine-Minds/alga-psa/actions/runs/35522723445), job
[106110228049](https://github.com/Nine-Minds/alga-psa/actions/runs/35522723445/job/106110228049),
Integration shard 1, `VITEST_SEED=20260610`. **2 failed / 2169 passed (2171)**. Raw capture:
[`raw-logs/ci-shard1-fb2e696645.txt`](raw-logs/ci-shard1-fb2e696645.txt).

The requester-deferral case **still fails**, so the duck-typing repair did not fix it — consistent
with the control run, which had already shown the local shard cannot discriminate. What is new is
that the bounded diagnostics landed in round 2 fired, and they name the first exception:

```
[inbound-email-diagnostic] {"stage":"rollback","tenant":"3b2af6e8…","inboxId":"05450c9a…",
  "claimed":true,"errorName":"RangeError","errorCode":null,
  "errorMessage":"Maximum call stack size exceeded","errorCause":null}
[inbound-email-diagnostic] {"stage":"lifecycle_classification", … ,"classifiedAsLifecycle":false,
  "candidateName":"RangeError","candidateCode":null,
  "candidateLifecycleState":null,"candidateCanWrite":null}
[inbound-email-diagnostic] {"stage":"disposition", … ,"disposition":"retry",
  "reason":"commit_failure","errorName":"RangeError",
  "errorMessage":"Maximum call stack size exceeded"}
```

**There are two distinct stack overflows, and conflating them is what cost the earlier rounds.**

1. A **product-path** `RangeError: Maximum call stack size exceeded`, thrown inside the commit
   transaction and caught by `processInboundInbox`. It is not a lifecycle error, so
   `isCoManagedLifecycleError` correctly declines it and the disposition is `retry`. **This is the
   cause of the failed assertion**, and it is a real defect, not a reporting artifact.
2. A **reporter-level** `Failed to fully serialize error: Maximum call stack size exceeded`, which
   is what the run summary prints. The round-2 diagnosis of this one is confirmed by the *other*
   failing test in the same shard — `customer period jobs roll back generated dates` — whose inner
   error is an ordinary knex `insert into "time_periods"` rejection and which shows the identical
   reporter message. So the serializer blows its stack on a knex error graph regardless of the
   co-managed path, exactly as described, and it is independent of (1).

### What (1) narrows to, and what it does not

The `admission` stage did **not** fire. Both adapters emit that stage from their `catch` before
rethrowing anything they do not recognise, so the `RangeError` did not pass through
`admitCoManagedRequesterReply`. The test calls the real adapter first and only then throws its
duck-typed lifecycle error, so the overflow happens *after* admission returns — between the
injected `throw` and `processInboundInbox`'s `catch`, i.e. in the transaction rejection/rollback
path, where the lifecycle error is replaced by a `RangeError`.

That is as far as name, code and message can take it. **No repair is attempted here**: the
recursion site is unknown, it does not reproduce on this workstation in either arm, and guessing at
a fix for an unreproducible infinite recursion is how a wrong change gets shipped.

What this round adds instead is the next observation, at the same bounded, primitives-only standard:
`summarizeInboundError` now carries `frames` — the topmost stack frames, each truncated, at most 14.
For a stack-overflow `RangeError` the repeating cycle sits at the top of the stack, so these frames
name the recursion site, which is the one thing the current diagnostics cannot say. Note V8's default
`Error.stackTraceLimit` is 10, so a real overflow yields ten frames of the cycle; the ceiling exists
so an environment that raises that limit cannot turn an overflow stack into the unbounded payload
this module exists to prevent. Both bounds are mutation-checked
(`server/src/test/unit/email/inboundErrorDiagnostics.test.ts`, 15 tests: dropping the per-frame
truncation fails one case, raising `MAX_FRAMES` fails another).

**CF002-CF004 stay `failed`.** CF002's requirement — capture the first requester intake error — is
now partly met and partly not: the error is named, its location is not.

### Determinism, established rather than assumed

Integration shard 1 across this branch's completed Production-regression runs:

| run | SHA | shard 1 | the requester case |
| --- | --- | --- | --- |
| 35477498197 | `bda945b640` | success | present, passed |
| 35486497392 | `7b0b52c6c3` | failure | failed |
| 35492001110 | `618019c3e3` | failure | failed |
| 35522723445 | `fb2e696645` | failure | failed |

Three consecutive failures at three different SHAs, after one green. That is now strong evidence of
a **deterministic** regression rather than an intermittent, though still not proof in the strict
sense — no two completed runs share a SHA. The regression window `bda945b640..7b0b52c6c3` (ten
commits, including an `origin/main` merge and edits to the bootstrap suite itself) remains the
bisect target, and a stack-overflow cause fits a window that contains a merge.

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

> **Superseded in part by the `fb2e696645` CI read above.** This section is correct about the
> *reporter* overflow, and that diagnosis is now independently confirmed by a second, unrelated
> failing test in the same shard. It was wrong to assume the reporter overflow was the only one:
> there is also a genuine product-path `RangeError` on this path, and that is what actually
> produces `retry`.

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
1. ~~Read the `[inbound-email-diagnostic]` lines from the next CI shard-1 log.~~ **Done at
   `fb2e696645`.** The first error is `RangeError: Maximum call stack size exceeded`, thrown inside
   the commit transaction. `admission.sharedWorkConstructorMatched` never appeared, which rules the
   dual-constructor mechanism *out* as the cause of this failure — the overflow happens after
   admission returns.

   > **Superseded by the 2026-09-20 mitigation round (see the section at the end of this file).**
   > `admission` is emitted from inside the adapter's own `catch`, *after* an
   > `isCoManagedSharedWorkError` early return. Its absence is therefore consistent with three
   > states — adapter never invoked, adapter invoked and correctly quarantined, or overflow after
   > return — so neither the ordering claim nor the dual-constructor exclusion is established.
2. **Read the `errorFrames` from the next CI shard-1 log.** This round adds them; they name the
   recursion site. Nothing else about CF002-CF004 should be attempted first, because every candidate
   repair depends on which function is recursing.
3. Repair the recursion at its owner. The regression window `bda945b640..7b0b52c6c3` is the
   cross-check: whatever the frames name should be traceable to one of those ten commits.
4. Only then: mutation proof that the repaired case fails without the fix, focused pass, and a full
   original-shard pass at seed `20260610`.

A warning for whoever picks this up: do **not** read a green shard 1 as a fix unless the frames or a
named mechanism explain it. The case passed once already, at `bda945b640`.

## Forbidden shortcuts — none taken

No error was turned into `defer`; the test was not skipped, `.skip`-ed or moved out of the shard; the
expected disposition was not relaxed; requester admission was not loosened. Unknown
infrastructure/database failures still `retry` and authorization/token failures still quarantine —
the repair makes the quarantine path *more* reliable, not broader.

---

# 2026-09-20, mitigation round — static reconnaissance at `b17b7a80b4`

The CI read that names the recursion site had not completed when this section was written; the run
is `35524282543`, job `106114010249`, at `b17b7a80b4`. What follows is the work that did **not**
depend on it, recorded so the next round does not repeat it. **None of it closes CF002-CF004.**

## A premise the last round recorded is not supported by its evidence

The previous entry concluded, from `admission` never appearing in the log, that "the overflow
happens after admission returns, between the injected throw and `processInboundInbox`'s catch."

That does not follow. The `admission` stage is emitted from `packages/co-managed/src/inboundRequesterReply.ts:51`,
which sits **inside the adapter's own `catch`** — and, decisively, *after* the quarantine branch one
line above it:

```ts
  } catch (error) {
    if (isCoManagedSharedWorkError(error)) return { admitted: false };   // :50 — returns first
    recordInboundDiagnostic('admission', { ... }, error);                // :51 — never reached
    throw error;
```

So a silent `admission` stage is consistent with **three** states, not one:

1. the adapter was **never invoked** — the `RangeError` was thrown earlier in the same commit
   transaction, before `processInboundEmailInApp.ts:2069` calls the injected admission lambda;
2. the adapter **was invoked and correctly quarantined** a shared-work rejection, taking the `:50`
   early return *before* the diagnostic; or
3. the adapter returned normally and the overflow happened after it — what the last round assumed.

Only (3) was considered. Notably `assertCoManagedOperationalWrite` runs at
`shared/services/email/inboundEmailCoreProcessor.ts:241`, *before* admission, and the test's own
assertions (no comments, no effects, no outbox rows) hold under all three, so they do not
discriminate either. The search window is the whole `withAdminTransaction` callback
(`inboundEmailCoreProcessor.ts:238`), not the tail of it.

This matters for more than the ordering. The last round used the silent `admission` stage to
conclude that the failure "rules the dual-constructor mechanism OUT as the cause." Under state (2)
the dual-constructor path is not merely unexcluded — it is the branch that would *produce* the
silence. **That exclusion is unsupported, not just weak, and must not be carried forward.**

## A CI-vs-local difference that was proposed and is refuted

`server/src/test/setup.ts:172` carries the comment "CI's Node 20", which invites the hypothesis that
a different V8 stack limit explains why the overflow is CI-only. It does not apply to this lane:

```
$ grep -n "node-version" .github/workflows/integration-tests.yml
34,123,251,353,425,506,590:          node-version: '22'
$ node --version
v22.18.0
```

Integration shard 1 runs Node 22; this workstation runs Node 22.18.0. Same major, same V8 stack
regime. **The Node-version explanation is refuted** — the `setup.ts` comment is about an unrelated
jsdom `localStorage` global, not about this lane. Do not spend a round on it.

## Ranked candidate sites, to be matched against the frames

Anchors to compare the incoming `errorFrames` against. These are candidates, **not** findings.

1. **`Transaction.isCompleted()` — `node_modules/knex/lib/execution/transaction.js:95-99`.** Verified
   verbatim; the only literally self-recursive function that executes on the rollback path:
   ```js
   isCompleted() {
     return (this._completed || (this.outerTx && this.outerTx.isCompleted()) || false);
   }
   ```
   It is called for every query issued through a transaction client, including the `ROLLBACK` and
   `ROLLBACK TO SAVEPOINT` this test provokes, and it walks `outerTx` with no depth cap and no cycle
   guard. Real nesting on this path is admin trx → `inboundRequesterReply.ts:17` savepoint →
   a per-`assertCoManagedOperationalWrite` transaction → comment savepoints, i.e. depth 4-5, which is
   *not* enough by itself. So if the frames name `isCompleted`, the defect is whatever produced a
   long or cyclic `outerTx` chain, and that is the thing to repair — not `isCompleted` itself.
2. **Unguarded rich-text walkers on the comment-creation path**: `packages/tickets/src/lib/commentNoise.ts:13`
   (`collectBlockNoteText`) and `:31` (`hasMediaBlock`); `packages/tickets/src/lib/ticketRichText.ts:609`
   (`extractInlineTextFromBlockNote`) and `:657` (`collectBlockLines`). No depth cap, no visited set.
   Compare `packages/co-managed/src/conversationRichText.ts:40`, which *already* carries a budget —
   the hardening exists in one place and not these.

## Ruled out, with reasons — do not re-walk these

- **Self-delegating spy recursion in the fixture.** `withRequesterInboundFixture`
  (`coManagedBootstrap.integration.test.ts:8839-8866`) installs only bare `vi.spyOn` calls with no
  `mockImplementation`, plus `intake.process.mockImplementation(actual.processInboundEmailInApp)`
  from `vi.importActual`, all restored in `finally`. The failing test at `:9051` installs no spies.
  Separately, `tinyspy` unwraps an already-spied function to its original, so `spyOn`-on-`spyOn`
  cannot self-wrap.
- **The diagnostics module itself.** `inboundErrorDiagnostics.ts` is bounded at every recursion:
  `boundedString` recurses once onto a primitive, `summarizeInboundError` follows `cause` exactly one
  level, `boundedFrames` slices to `MAX_FRAMES`. It is what *caught* the overflow, not its source.
- **`isCoManagedLifecycleError`** (`packages/licensing/src/lib/co-managed-lifecycle.ts:24`) — pure
  field comparisons, no recursion. It correctly declines a `RangeError`; that is not the bug.
- **`runOwnedTransaction` / `withAdminTransaction` / `withTransaction` / `withSavepoint`**
  (`packages/db/src/index.ts:78-140`, `packages/db/src/lib/tenant.ts:163-272`) and
  **`flushAfterCommitHooks`** (`packages/db/src/lib/afterCommit.ts:58`) — no self-calls; the
  read-only retry helpers retry once, not recursively, and `READ_ONLY_ERROR_RE`
  (`readOnlyRetry.ts:17`) does not match `"Workspace became read-only"`, so the injected error never
  enters them.
- **Two compiled copies calling each other.** The failing test imports both
  `admitCoManagedRequesterReply` and `retainCoManagedInboundCommentEvent` from **source** relative
  paths, nothing under `shared/` imports `@alga-psa/co-managed`, and
  `packages/co-managed/dist/inboundRequesterReply.js` is a re-export with no import back into
  source. No src↔dist mutual call exists on this path.
- **`getConnection`** (`packages/db/src/lib/connection.ts:48`) is self-recursive but behind an
  `await`, so it cannot grow the JS stack. Ruled out as the `RangeError`; noted as a latent hang.
- **`packages/co-managed/src/nativeTimeDispatch.ts`** — the only new `packages/co-managed/src` module
  in the `bda945b640..7b0b52c6c3` regression window. Read in full: no recursion, and it is on the
  native *time* path, not the inbound email path.
- **`process.env.CI` / `NODE_ENV` branches on this path** — none exist.

## Expectation-setting for the frames

V8's default `Error.stackTraceLimit` is 10, so at most ten frames of the cycle will arrive even
though `MAX_FRAMES` is 14. vite-node installs a source-map `prepareStackTrace`, so frames should
return as `.ts` positions matchable against the anchors above.

## Status

CF002, CF003 and CF004 remain `failed`. Nothing above is a repair, and no repair may be attempted
until the frames name the site — the reason this round added no product change is unchanged from the
last: guessing at a fix for an unreproducible infinite recursion is how a wrong change ships.

---

# The CI read at `b17b7a80b4` — the frames are silent, and their silence is informative

Run [35524282543](https://github.com/Nine-Minds/alga-psa/actions/runs/35524282543), job
`106114010249`, Integration shard 1, concluded **`failure`** at 2026-09-20T17:18:58Z.
Shards 2, 3 and 4 concluded success. Full log preserved untrimmed at
`raw-logs/ci-shard1-b17b7a80b4.txt`.

```
 Test Files  1 failed | 77 passed (78)
      Tests  1 failed | 2170 passed (2171)

 × defers and rolls back requester email when a separately compiled admission adapter reports a lifecycle pause 453ms
   → Failed to fully serialize error: Maximum call stack size exceeded
Inner error message: expected { disposition: 'retry', …(1) } to match object { disposition: 'defer', …(1) }
```

Unchanged from `fb2e696645`: same single failing case, same disposition collapse. The duck-typing
repair did not fix it, which was already expected.

## 1. What the instrumentation returned

All three stages fired, and **`errorFrames` is absent from every one of them**:

```
$ grep -c errorFrames raw-logs/ci-shard1-b17b7a80b4.txt
0
```

```
[inbound-email-diagnostic] {"stage":"rollback","tenant":"d772a7e9-…","inboxId":"71cb6e4d-…","claimed":true,
  "errorName":"RangeError","errorCode":null,"errorMessage":"Maximum call stack size exceeded","errorCause":null}
[inbound-email-diagnostic] {"stage":"lifecycle_classification", … ,"classifiedAsLifecycle":false,
  "candidateName":"RangeError","candidateLifecycleState":null,"candidateCanWrite":null}
[inbound-email-diagnostic] {"stage":"disposition", … ,"disposition":"retry","reason":"commit_failure",
  "errorName":"RangeError","errorMessage":"Maximum call stack size exceeded"}
```

`recordInboundDiagnostic` emits `errorFrames` only when `summary.frames.length > 0`, so
`boundedFrames()` returned `[]`. **The recursion site is still not named.** That is a negative
result and it is reported as one — the round did not get the artifact it was waiting for.

## 2. But a second, unasked-for observation did land, and it is the real finding

`withAdminTransaction` logs unconditionally in its `catch` **before** it rethrows
(`packages/db/src/index.ts`):

```js
  } catch (error) {
    console.error(`[withAdminTransaction:${transactionId}] Transaction failed:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined      // <-- reads .stack
    });
    throw error;
  }
```

That `catch` is the *only* path by which `withAdminTransaction` can reject. So if
`processInboundInbox`'s handler ran — and it did, the `rollback` stage proves it — the line must
have been emitted. It was not, in **either** instrumented run:

| | `withAdminTransaction` lines | `Transaction failed` lines |
| --- | --- | --- |
| `ci-shard1-fb2e696645.txt` | 12 | **0** |
| `ci-shard1-b17b7a80b4.txt` | 12 | **0** |

Both counts are reproducible with `grep -c` against the committed logs; the `b17b7a80b4` log is
kept untrimmed precisely so this absence is checkable.

### What that forces

The rethrow did not complete normally. Something in that `catch` block threw before
`console.error` returned, and the error `processInboundInbox` finally saw is therefore **not known
to be the error the transaction raised**. The block contains exactly one expression that touches
the error: `error.stack`.

And reading `.stack` is not free. V8 formats it lazily on first access, and vite-node installs a
source-mapping `prepareStackTrace` that runs *at that moment* and costs stack to run. A `.stack`
read performed while the stack is already deep can therefore raise its own
`RangeError: Maximum call stack size exceeded` — from the getter, not from the code under test.

Two independent readers of `.stack` on this path both came back empty-handed in the same run:
`withAdminTransaction`'s unguarded read (log line never completed) and `boundedFrames`'s guarded
read (returned `[]`). That convergence is the substance of this finding.

### Two readings remain, and they call for opposite repairs

**(A) The catch manufactured the error.** The transaction raised the duck-typed
`CoManagedLifecycleError` the test throws; `error.stack` in `withAdminTransaction`'s catch
overflowed; the `RangeError` replaced it; `isCoManagedLifecycleError` correctly declined the
`RangeError`; disposition collapsed to `retry`. Under this reading the recursion is **not** in
product logic at all, and the repair belongs in `packages/db` — a catch that reports an error must
not be able to destroy it.

**(B) The transaction body genuinely overflowed.** Some product path recursed, the `RangeError` is
authentic, `retry` is the correct disposition for it, and the catch's `.stack` read merely failed
too (formatting a real overflow stack is exactly when it would). Under this reading the repair is
whatever is recursing, and `retry` is not the bug.

**Nothing in the current evidence distinguishes these**, and they are not variations on one theme —
under (A) `retry` is a defect, under (B) `retry` is correct behaviour. Guessing between them is how
a wrong change ships, so **no repair is attempted**. CF002, CF003 and CF004 stay `failed`.

## 3. The instrumentation this round adds, and why it is decisive

Two changes, both observation-only; neither alters control flow or any disposition.

**A `commit_body` stage** (`shared/services/email/inboundEmailCoreProcessor.ts`). The commit
callback's body is now wrapped in its own `try`/`catch` that records the error's identity *inside*
the transaction — before `withAdminTransaction`'s catch can touch it — and rethrows it unchanged.
It is passed `readStack: false`, which is load-bearing: an observation placed to see the error
before the suspect read must not perform that read itself.

This is a clean discriminator:

- `commit_body` reports `CoManagedLifecycleError` with `classifiedAsLifecycle: true`, then
  `rollback` reports `RangeError` → **reading (A)**. The error was destroyed in transit and the
  owner of the defect is `withAdminTransaction`.
- `commit_body` reports `RangeError` → **reading (B)**. The overflow is real and inside the body,
  and the next step is to bisect the body, not the transaction helper.

**Reason codes for empty frames** (`shared/services/email/inboundErrorDiagnostics.ts`). An absent
`errorFrames` key was consistent with four different failures and the round could not act on it.
Each branch now names itself in a new `errorFramesUnavailable` field —
`stack_getter_threw:<name>` / `stack_absent:<type>` / `stack_empty` / `no_frame_lines:<length>` /
`stack_not_read` — alongside `stackTraceLimit`, since a limit of `0` would explain the whole
observation on its own. If the next run reports `stack_getter_threw:RangeError`, reading (A) is
confirmed outright.

### Mutation evidence

`server/src/test/unit/email/inboundErrorDiagnostics.test.ts`, 22 tests, pass at this candidate.
Both new behaviours were individually reverted and the suite was rerun:

```
mutation 1 — `errorFramesUnavailable` emission removed (silent omission restored):
  × emits errorFramesUnavailable and the stack trace limit instead of a silent omission
  × records a commit_body stage without reading the stack
      Tests  2 failed | 20 passed (22)

mutation 2 — the `readStack: false` guard removed, so the summary always reads `.stack`:
  × never touches the stack getter when readStack is false
  × records a commit_body stage without reading the stack
      Tests  2 failed | 20 passed (22)
```

Restored, `22 passed (22)`. `npx tsc --noEmit` is clean for both `server/tsconfig.json` and
`ee/temporal-workflows/tsconfig.json`.

## 4. What the next round should do

1. Read `commit_body` from the next shard-1 log. It settles (A) vs (B) in one line, and nothing
   else about CF002-CF004 should be attempted before it.
2. If (A): repair `withAdminTransaction` so its diagnostic catch cannot replace the error it is
   reporting — bound the `.stack` read the way `inboundErrorDiagnostics` already bounds every other
   read of a thrown value. The regression is a transaction whose body throws an identifiable error
   while `.stack` throws on access; it must arrive at the caller as the error the body raised.
3. If (B): bisect the commit body. `errorFramesUnavailable` will also say whether the frames were
   unreadable or merely absent, which decides whether frame capture can be made to work at all.
4. Only then: mutation proof, focused pass, and a full original-shard pass at seed `20260610`.

The standing warning still applies: do **not** read a green shard 1 as a fix unless a named
mechanism explains it. The case passed once already, at `bda945b640`.

## Forbidden shortcuts — none taken

No error was turned into `defer`; the test was not skipped, `.skip`-ed or moved out of the shard;
the expected disposition was not relaxed; requester admission was not loosened; the reverted
clone-source pin and `ALGA_SCHEMA_SOURCE_DB` were not reintroduced. Unknown infrastructure and
database failures still `retry` and authorization/token failures still quarantine — this round adds
observation only and changes no disposition on any path.
