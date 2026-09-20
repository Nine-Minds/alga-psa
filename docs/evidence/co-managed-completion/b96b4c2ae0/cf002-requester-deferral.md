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

| Attempt | Result |
| --- | --- |
| The single case, standalone, `VITEST_SEED=20260610`, CE+EE overlay, `DB_NAME_SERVER=server_co_managed` | **passed** |
| The whole `coManagedBootstrap.integration.test.ts` file, `VITEST_SEED=20260610` (full intra-file shuffle at the CI seed), CE+EE overlay | **1416/1416 passed** |

So the divergence is **not** intra-file ordering and **not** the migration overlay. It requires the
real shard — cross-file state in a single `singleFork` process. The documented harness rules were
followed: the CE+EE overlay was built from `server/migrations` + `ee/server/migrations`
(1101 + 70 → 1165 files after 6 EE-over-CE collisions) and `TEST_MIGRATIONS_DIR` was exported; the
bootstrap harness's runtime `DB_NAME_SERVER` selection was left alone and the reverted clone-source
pin and `ALGA_SCHEMA_SOURCE_DB` were **not** reintroduced.

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
