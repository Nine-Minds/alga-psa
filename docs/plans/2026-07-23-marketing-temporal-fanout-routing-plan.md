# Marketing Temporal Fan-out Routing

- Date: 2026-07-23
- Branch: `fix/marketing-workflow-fanout-routing`
- Status: Approved design; implementation pending

## Objective

Replace the three per-tenant Enterprise marketing schedules with three global
Temporal schedules. Each scheduled workflow discovers every tenant, runs the
selected marketing operation as tenant-scoped Temporal activities with bounded
parallelism, waits for every tenant, and reports a truthful aggregate result.

Community Edition keeps its existing pg-boss scheduling.

## Production finding

Production Loki logs on 2026-07-23 prove the current failure path:

1. Startup creates a Temporal Schedule for every tenant and each of these three
   jobs:
   - `marketing:flip-due-posts`
   - `marketing:expire-stale-targets`
   - `marketing:send-sequence-steps`
2. Each schedule starts `genericJobWorkflow` on the `alga-jobs` task queue.
3. The workflow reaches `temporal-worker`.
4. `temporal-worker` rejects the activity with
   `No handler registered for job type: marketing:<job>`.
5. Its advertised handler registry contains no marketing handlers.

The workflow IDs in the same log window contain different tenant IDs for the
same five-minute fire, confirming the current per-tenant workflow fan-out.

## Settled design

1. Create one global schedule per marketing job, not one combined schedule.
2. Preserve the existing cadences:
   - flip due posts: every five minutes;
   - send sequence steps: every five minutes;
   - expire stale targets: hourly at minute 11.
3. Run the global workflows on the existing `tenant-workflows` queue owned by
   `temporal-worker`.
4. Temporal owns the tenant loop. There is one visible activity execution per
   tenant, with at most ten tenant activities running concurrently.
5. Activities execute `@alga-psa/marketing` domain operations directly inside
   `temporal-worker`. Do not route through `genericJobWorkflow`, the server, or
   the event bus.
6. Marketing PostHog flags are UI-only. Background activities run for every
   tenant; tenants with empty marketing tables are successful no-ops.
7. A thrown tenant activity error receives up to three attempts with
   exponential backoff. Exhausted tenant failures are recorded without
   preventing later tenants from running.
8. The workflow waits for every tenant. It completes when all tenant activities
   succeed and fails after fan-out when one or more tenants exhausted retries.
   The full aggregate summary is returned or attached to the failure.
9. `sendDueSequenceStepsInternal` may report handled enrollment failures after
   applying its 30-minute domain backoff. That is a successful activity result,
   not a reason for an immediate Temporal retry.
10. Use schedule overlap `SKIP` and a short catch-up window so slow runs and
    downtime do not create replay storms.
11. Upsert the three global schedules before deleting the legacy per-tenant
    schedules.
12. Use Pareto testing: focused unit and contract coverage for the high-risk
    boundaries, with full end-to-end behavior verified by smoke testing.

## Implementation

### 1. Define a worker-safe marketing job contract

Add a small worker-safe module under `packages/marketing/src/lib/` that owns:

- the three canonical marketing job-name constants;
- a `MarketingJobName` union;
- input and operation-result types shared by activities, workflows, schedules,
  and the existing server handlers;
- a runtime guard for rejecting unknown job names.

Update `server/src/lib/jobs/handlers/marketingJobs.ts` to import the canonical
constants instead of declaring its own copies. Preserve the current CE handler
behavior; the EE fan-out will bypass these server handlers.

Avoid importing the marketing package root from the worker. Import the narrow
Node-safe library subpaths needed for posts, sequences, and the shared job
contract.

### 2. Add direct marketing activities

Create
`ee/temporal-workflows/src/activities/marketing-activities.ts` with two
activities.

#### `listMarketingTenantIds`

- Open the admin database connection.
- Enumerate `tenants.tenant` through an explicitly unscoped `tenantDb` query.
- Return stable string tenant IDs in deterministic order.
- Do not query PostHog or filter tenants by the UI feature flag.

#### `runMarketingJobForTenant`

Accept `{ jobName, tenantId }`, establish the tenant execution context, and
dispatch through an exhaustive switch:

- `marketing:flip-due-posts` ->
  `flipDuePostsInternal(knex, tenantId)`;
- `marketing:expire-stale-targets` ->
  `expireStaleTargetsInternal(knex, tenantId, 48)`;
- `marketing:send-sequence-steps` ->
  `sendDueSequenceStepsInternal(knex, tenantId, executionConfig)`.

For sequence sends:

- build the canonical public base URL from the worker's deployment URL
  configuration using the same precedence as the current server handler;
- obtain the existing `NEXTAUTH_SECRET` already injected into
  `temporal-worker`;
- fail before sending when the signing secret is absent;
- return the sequence operation's domain summary unchanged, including handled
  enrollment failures.

Return a discriminated result containing the job name, tenant ID, operation
summary, and completion timestamp. Log structured start, success, and thrown
failure events without logging secrets or message content.

Export the new activities from both activity index entry points used by the
production worker.

### 3. Add the global fan-out workflow

Create
`ee/temporal-workflows/src/workflows/marketing-fanout-workflow.ts`.

The workflow accepts `{ jobName }` and produces:

```ts
{
  jobName,
  total,
  succeeded,
  failed,
  results
}
```

Implementation behavior:

1. Call `listMarketingTenantIds`.
2. Process the returned IDs with a deterministic worker pool capped at ten
   concurrent promises.
3. Invoke `runMarketingJobForTenant` once per tenant.
4. Configure tenant activity retries for three attempts with exponential
   backoff and a timeout compatible with the existing five-minute sequence job
   handler.
5. Catch an exhausted activity failure inside the pool, add
   `{ tenantId, status: 'failed', error }`, and continue.
6. Preserve successful domain summaries in the result list.
7. After all workers settle, log the aggregate counts.
8. If `failed > 0`, throw a non-retryable `ApplicationFailure` whose details
   contain the complete summary. Otherwise return the summary.

Tenant-discovery failure is a workflow-level failure because there is no safe
fan-out set to process. It should use the activity retry policy and then fail
normally if retries are exhausted.

Export the workflow from both workflow index entry points loaded by the
production worker.

### 4. Converge three global schedules

Extend `ee/temporal-workflows/src/schedules/setupSchedules.ts` with three
schedule definitions:

| Schedule ID | Job | Cadence |
| --- | --- | --- |
| `marketing-fanout:flip-due-posts` | `marketing:flip-due-posts` | `*/5 * * * *` |
| `marketing-fanout:send-sequence-steps` | `marketing:send-sequence-steps` | `*/5 * * * *` |
| `marketing-fanout:expire-stale-targets` | `marketing:expire-stale-targets` | `11 * * * *` |

Each schedule:

- starts `marketingFanoutWorkflow`;
- targets `tenant-workflows`;
- uses `ScheduleOverlapPolicy.SKIP`;
- uses the existing short catch-up policy;
- has a one-hour workflow execution timeout.

Use the existing schedule upsert helper so repeated setup refreshes the
configuration without creating duplicates.

### 5. Remove legacy schedules safely

After all three global upserts succeed:

1. List Temporal schedules.
2. Select only IDs beginning with one of:
   - `marketing:flip-due-posts:`;
   - `marketing:expire-stale-targets:`;
   - `marketing:send-sequence-steps:`.
3. Delete each matching schedule through the existing not-found-tolerant
   deletion helper.
4. Log scanned, matched, deleted, and failed counts.

The cleanup must be idempotent and safe when several `temporal-worker` replicas
run schedule setup concurrently. A schedule disappearing between list and
delete is success, not an error. Never match the new `marketing-fanout:*`
schedule IDs or unrelated schedules.

Do not delete historical `jobs` or `job_details` rows in this change. Removing
tracker records is not required to stop execution and would destroy useful
history.

### 6. Stop EE from recreating tenant schedules

Update `server/src/lib/jobs/initializeScheduledJobs.ts` so the three per-tenant
marketing scheduling blocks run only outside the Enterprise workflow edition.

- EE/appliance: the Temporal worker's three global schedules are authoritative.
- CE: keep the current per-tenant pg-boss jobs and handlers unchanged.

Keep the edition decision next to the three marketing blocks so future
maintainers do not accidentally reintroduce dual scheduling.

### 7. Package the marketing runtime in `temporal-worker`

Update the Temporal worker build and package metadata so direct activity imports
work in the production image:

- add `@alga-psa/marketing` as an explicit Temporal worker dependency;
- build `packages/marketing` before compiling `ee/temporal-workflows`;
- copy `packages/marketing/dist` into production and prebuilt images;
- preserve the existing `@alga-psa/*` runtime symlink layout;
- add a Docker/runtime guard that imports the exact marketing subpaths and
  asserts the three required domain functions exist.

The current worktree already requires `@alga-psa/marketing` to be built before
the wired dev server starts. Do not rely on that incidental local artifact;
make the Temporal image build deterministic.

## Pareto test plan

### Workflow orchestration

Add focused tests under
`ee/temporal-workflows/src/workflows/__tests__/`:

- all discovered tenants are invoked exactly once;
- observed tenant activity concurrency never exceeds ten;
- one exhausted tenant failure does not prevent later tenants from running;
- zero failures returns the expected aggregate;
- one or more exhausted failures throws only after all tenants were attempted
  and attaches the aggregate summary.

Mock activities directly. Do not add a full Temporal test-environment suite for
this change.

### Activity routing

Add focused tests under
`ee/temporal-workflows/src/activities/__tests__/`:

- each canonical job name calls the corresponding marketing operation with the
  tenant;
- tenant discovery uses the explicit unscoped tenant enumeration;
- unknown job names are rejected;
- absent `NEXTAUTH_SECRET` prevents sequence sending;
- a returned sequence summary with handled enrollment failures resolves
  successfully;
- a thrown operation error is rethrown for Temporal to retry.

### Schedule cutover and edition boundary

Extend schedule tests or add
`setupSchedules.marketing-fanout.test.ts`:

- the three global IDs, cron expressions, workflow type, queue, overlap policy,
  and arguments are exact;
- global schedules are upserted before legacy deletion begins;
- only the three legacy prefixes are deleted;
- not-found races are tolerated;
- repeated setup remains idempotent.

Add a small server scheduling test proving:

- EE does not call the three per-tenant marketing scheduling functions;
- CE still calls them with the existing cadences.

### Registration and artifact contracts

Extend `ee/temporal-workflows/src/__tests__/worker-registration.test.ts` to
assert the workflow and activities are exported.

Extend the production runtime-import validation to assert the built marketing
subpaths load and expose:

- `flipDuePostsInternal`;
- `expireStaleTargetsInternal`;
- `sendDueSequenceStepsInternal`.

### Suggested verification commands

Run the narrow suites first, then the affected package builds:

```bash
npm run test --workspace=temporal-workflows -- --run \
  src/workflows/__tests__/marketing-fanout-workflow.test.ts \
  src/activities/__tests__/marketing-activities.test.ts \
  src/schedules/__tests__/setupSchedules.marketing-fanout.test.ts \
  src/__tests__/worker-registration.test.ts

npm run test --workspace=server -- --run \
  src/test/unit/initializeScheduledJobs.marketing.test.ts

npm run build --workspace=@alga-psa/marketing
npm run build --workspace=temporal-workflows
```

Adjust only the command syntax if the repository's current Vitest workspace
wrapper requires it; do not broaden this task into unrelated failing suites.

## Smoke testing

Use the already wired development stack after implementation:

1. Run schedule setup twice and confirm it remains idempotent.
2. List schedules and confirm exactly the three `marketing-fanout:*` schedules
   exist and no legacy marketing tenant schedule remains.
3. Trigger the safe flip-due-posts global schedule.
4. Confirm Temporal shows one workflow with tenant activities, never more than
   ten concurrently.
5. Confirm the workflow returns aggregate counts and empty-data tenants are
   successful no-ops.
6. Confirm worker logs contain no missing-handler errors.

After deployment, verify from Temporal and Loki:

- only three marketing schedules remain;
- each fire creates one workflow per job rather than one per tenant;
- per-tenant activity outcomes and final counts are visible;
- `No handler registered for job type: marketing:*` no longer appears;
- real handler completion logs appear.

Do not force a production tenant failure as part of acceptance.

## Acceptance criteria

1. EE/appliance has exactly three global marketing schedules and no legacy
   per-tenant marketing schedules.
2. CE keeps its existing pg-boss marketing schedules.
3. Each global run discovers all tenants, executes no more than ten tenant
   activities concurrently, waits for all tenants, and exposes the aggregate.
4. One exhausted tenant activity does not prevent later tenants from running.
5. A partially failed fan-out ends as failed with the full summary; a clean
   fan-out completes.
6. Direct worker activities execute all three marketing operations without
   PostHog gating or server/event-bus routing.
7. Sequence-email tracking remains signed and sending fails closed without the
   signing secret.
8. Handled sequence enrollment failures retain their existing 30-minute domain
   backoff and do not cause an immediate Temporal retry.
9. The production worker artifact loads the marketing runtime exports.
10. The production missing-handler error storm stops.

## Risks and mitigations

- **Worker runtime dependency drift:** direct marketing imports add a new package
  boundary to a worker image with a history of missing runtime exports.
  Explicit build/copy steps and an import guard make this a build-time failure.
- **Multi-replica schedule convergence:** many workers may upsert and clean up
  simultaneously. Existing already-exists handling plus not-found-tolerant
  deletion keeps the operation idempotent.
- **Database and email load:** ten-way concurrency matches the existing
  maintenance fan-out limit. Schedule overlap `SKIP` prevents stacking.
- **At-least-once activity execution:** the post transitions and sequence-send
  claims are already idempotent. Preserve those domain operations rather than
  reproducing them in the activity.
- **All-tenant execution:** the previous handler used a UI feature flag as a
  background gate. The approved behavior removes that gate; tenants without
  marketing data perform no writes or sends.
- **Legacy tracker rows:** deleting schedules leaves old tracking rows in the
  database. They are inert and retained as history.

## Out of scope

- Redesigning the generic Temporal job runner or its handler registry.
- Moving unrelated per-tenant jobs to global fan-out.
- Changing marketing domain behavior, email content, sequence limits, or the
  48-hour stale-target grace period.
- PostHog feature-flag behavior in the UI.
- Deleting historical job tracking records.
- Building a full Temporal integration test suite.

## Commit plan

The implementation agent should use small, reviewable commits:

1. Shared contract, direct activities, workflow, and focused tests.
2. Global schedule convergence, EE/CE cutover, legacy cleanup, and tests.
3. Temporal worker packaging/runtime guards and final smoke-test adjustments.

This plan document is committed separately before implementation begins.
