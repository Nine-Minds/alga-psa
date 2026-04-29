# PRD — Workflow Step Quota Accounting

- Slug: `2026-04-28-workflow-step-quota-accounting`
- Date: `2026-04-28`
- Status: Draft

## Summary

Add tenant-level accounting and enforcement for workflow step executions. Each tenant receives a workflow step allotment per payment period. Every workflow step attempt consumes one unit when the step starts. When a tenant exhausts its allotment, workflows pause at the current step instead of failing. Paused workflows can resume automatically when quota becomes available or manually after the same eligibility check passes.

The payment period is the tenant's active Stripe subscription period. If no valid active Stripe subscription period exists, the system falls back to the current UTC calendar month and tier default limits.

## Problem

Workflow steps are a licensed resource, but the workflow runtime currently has no tenant-level accounting or enforcement for step executions. Existing `workflow_run_steps` rows provide an execution audit trail, but they are not designed for fast, concurrency-safe quota enforcement across both DB and Temporal workflow runtimes.

Without quota accounting, tenants can exceed plan allotments, runaway loops or retries can burn runtime capacity without licensing protection, and support/product teams lack a clear per-period usage object.

## Goals

- Count every workflow step attempt for a tenant when the step starts.
- Enforce tenant plan allotments per payment period.
- Use Stripe subscription `current_period_start` and `current_period_end` as the primary quota window.
- Fall back to the current UTC calendar month with tier defaults when no active Stripe period exists.
- Support tier defaults of:
  - `solo`: 150 steps per period
  - `pro`: 750 steps per period
  - `premium`: 10,000 steps per period
- Support Stripe metadata override via `workflow_step_limit`, including numeric values and `unlimited`.
- Pause workflows on quota exhaustion instead of failing them.
- Resume quota-paused workflows automatically via scheduled job and manually via user/admin action.
- Use one shared enforcement path for DB runtime, Temporal runtime, automatic resume, and manual resume.
- Preserve `workflow_run_steps` as the execution audit ledger while adding a dedicated counter table for enforcement.

## Non-goals

- Do not use contract-system `recurring_service_periods`, cadence ownership, invoice windows, or contract line periods for workflow quota windows.
- Do not bill customers directly from workflow step usage in this phase.
- Do not build a full customer-facing usage dashboard in this phase unless needed for manual resume messaging.
- Do not auto-repair counter drift initially; report drift for diagnosis first.
- Do not treat quota exhaustion as workflow failure or trigger normal retry policies.
- Do not change the semantics of action idempotency or workflow step retry policies except that retry attempts consume step quota when they start.

## Users and Primary Flows

### Tenant workflow executor

A workflow run starts or resumes. Before each step attempt, the runtime reserves one step unit. If quota is available, the step executes normally. If quota is exhausted, the run pauses at the current `node_path` and records a quota wait.

### MSP admin / tenant user

A user viewing a quota-paused run sees that the workflow is waiting because the tenant exhausted its workflow step allotment. The user can retry/resume manually. If quota is still exhausted, the system returns a clear message with current usage, limit, and reset time. If quota is available, the run resumes through normal runtime execution.

### Background scheduler

A recurring job scans quota waits. When a tenant's next payment period starts or the tenant's effective limit increases, the job resumes eligible quota-paused runs. Actual quota consumption still happens when the runtime re-enters step start.

### Support / operations

Support can inspect the tenant's current usage period, effective limit, source, and drift report comparing the enforcement counter to `workflow_run_steps` audit rows.

## UX / UI Notes

- Quota-paused runs should be displayed as waiting/paused, not failed.
- The run detail or inspector should surface a clear reason such as: "Workflow step quota exceeded for current billing period."
- Manual resume should be available only for quota-paused runs and should not bypass quota.
- If quota remains exhausted, the response should include:
  - used count
  - effective limit, or `unlimited`
  - reset/payment period end time
  - quota source, if useful for support
- UI changes can be minimal in the first implementation if existing run logs/wait records are visible enough for operators.

## Requirements

### Functional Requirements

1. Count every step attempt at step start.
2. Do not count quota-blocked steps because they did not start.
3. Count retry attempts as new step attempts.
4. Count `forEach` body attempts per item/attempt.
5. Count `event.wait`, `time.wait`, and `human.task` steps when first entered.
6. Resolve quota windows from active Stripe subscription periods when available.
7. Fall back to current UTC calendar month when no valid active Stripe period is available.
8. Resolve effective limits using Stripe price metadata, then Stripe product metadata, then tier defaults.
9. Support `workflow_step_limit=unlimited` as an unlimited cap while still recording usage.
10. Atomically reserve quota across concurrent workers.
11. Pause runs at the current step when quota is exhausted.
12. Create or reuse a `workflow_run_waits` row with `wait_type = 'quota'` on quota exhaustion.
13. Preserve the current `workflow_runs.node_path` while quota-paused.
14. Resume eligible quota-paused runs via scheduled job.
15. Resume eligible quota-paused runs via manual user/admin action.
16. Prevent manual resume from bypassing quota.
17. Provide a reconciliation/reporting path comparing enforcement counters to `workflow_run_steps` audit rows.

### Non-functional Requirements

- Quota reservation must be concurrency-safe across DB runtime workers and Temporal activity workers.
- Runtime enforcement must avoid expensive aggregate counts on every step.
- Missing or invalid Stripe metadata must not crash workflow execution.
- Missing Stripe period data must not immediately disable workflows; use fallback calendar periods with tier defaults.
- Quota pause must not be treated as a workflow failure for retry or auto-pause failure-rate logic.
- The design must use `tenant` as the column name in new schema, not `tenant_id`.

## Data / API / Integrations

### New enforcement table

Create `workflow_step_usage_periods`:

```text
- tenant                  not null
- period_start            timestamptz not null
- period_end              timestamptz not null
- period_source           text not null -- stripe_subscription | fallback_calendar
- stripe_subscription_id  nullable
- effective_limit         integer nullable -- null means unlimited
- used_count              integer not null default 0
- limit_source            text not null -- stripe_price_metadata | stripe_product_metadata | tier_default | unlimited_metadata
- tier                    text not null
- metadata_json           jsonb nullable
- created_at              timestamptz not null
- updated_at              timestamptz not null
```

Use a composite primary key or unique key on `(tenant, period_start, period_end)`. Add indexes for `(tenant, period_end)` and `(period_end)`.

### Quota resolver

The resolver returns a normalized quota summary:

```ts
{
  tenant: string;
  periodStart: string;
  periodEnd: string;
  periodSource: 'stripe_subscription' | 'fallback_calendar';
  stripeSubscriptionId?: string | null;
  effectiveLimit: number | null; // null = unlimited
  usedCount: number;
  remaining: number | null; // null = unlimited
  tier: 'solo' | 'pro' | 'premium';
  limitSource:
    | 'stripe_price_metadata'
    | 'stripe_product_metadata'
    | 'tier_default'
    | 'unlimited_metadata';
}
```

### Stripe integration

Preferred active subscription selection:

- `status IN ('trialing', 'active', 'past_due', 'unpaid')`
- valid `current_period_start` and `current_period_end`
- if multiple subscriptions exist, prefer `trialing`, then `active`, then `past_due`, then `unpaid`

Metadata key:

```text
workflow_step_limit
```

Valid values:

- positive integer string/number, e.g. `750`
- `unlimited`

Precedence:

1. Stripe price metadata
2. Stripe product metadata
3. Tier default

### Runtime integration points

DB runtime:

- `shared/workflow/runtime/runtime/workflowRuntimeV2.ts`
- Enforcement point: immediately after `resolveStepAtPath()` and before `WorkflowRunStepModelV2.create()`.

Temporal runtime:

- `ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts`
- Enforcement point: `projectWorkflowRuntimeV2StepStart()` before `WorkflowRunStepModelV2.create()`.

### Quota wait payload

Use existing `workflow_run_waits` table with:

```text
wait_type = 'quota'
status = 'WAITING'
timeout_at = period_end
payload = {
  reason: 'workflow_step_quota_exceeded',
  tenant,
  periodStart,
  periodEnd,
  usedCount,
  effectiveLimit,
  periodSource,
  limitSource
}
```

### Scheduled job

Add a recurring job handler such as `workflow-quota-resume-scan` that scans quota waits and resumes eligible runs. Use the existing job system and batch/locking safeguards.

### Manual resume API/action

Add a user/admin action such as `resumeWorkflowRunFromQuotaPause(runId)` that verifies permissions, confirms the run is quota-paused, checks quota eligibility, and resumes the run only when allowed.

## Security / Permissions

- Quota counters and wait records must remain tenant-isolated.
- Manual resume must verify the user has permission to manage or operate the workflow run for the tenant.
- Manual resume must not allow cross-tenant run access.
- Manual resume must not bypass the runtime reservation path.
- If RLS policies apply to workflow runtime tables in the target environment, add matching policies for `workflow_step_usage_periods`.

## Observability

Use `workflow_run_logs` and service logs for:

- quota reservation success
- quota exceeded / run quota-paused
- quota-paused run resumed by scheduled job
- quota-paused run resumed by manual action
- resume skipped with reason
- invalid Stripe metadata fallback
- fallback-calendar period usage
- reconciliation drift findings

The counter table should store enough metadata to answer why a limit was applied, including period source, limit source, tier, Stripe subscription id, and fallback reason when applicable.

## Rollout / Migration

1. Add the enforcement table with indexes and tenant isolation/RLS if needed.
2. Add shared quota resolver/reservation service behind the runtime integration.
3. Integrate DB runtime step-start enforcement.
4. Integrate Temporal activity step-start enforcement.
5. Add quota wait/resume handling.
6. Add scheduled resume scan job.
7. Add manual resume action and minimal UI/API surfacing.
8. Add reconciliation/reporting helper.
9. Backfill is not required because enforcement starts from newly created usage period rows. Historical step-row reconciliation can report prior usage if needed.

Rollout should be staged so that quota resolution and counter creation can be tested before hard enforcement is enabled if a feature flag or environment toggle is desired during deployment.

## Risks

- Counter drift could occur if any runtime path creates step rows without using the quota service.
- Concurrent resume scans could resume more runs than remaining quota, but runtime reservation still protects final enforcement.
- Stripe sync gaps could cause fallback-calendar periods to be used unexpectedly.
- Temporal workflow behavior must treat quota as a controlled wait/pause, not an activity failure that causes unintended retries.
- Existing UI may not clearly distinguish quota wait from other waits until minimal UI surfacing is added.

## Open Questions

- Should zero-limit metadata ever be valid, or should it remain invalid and fall back to tier default? Current design treats zero as invalid.
- What exact permission should gate manual quota resume if no dedicated workflow-run operation permission exists?
- Should rollout include an explicit enforcement feature flag, or is the plan to enforce immediately once shipped?

## Acceptance Criteria (Definition of Done)

- A tenant's workflow step usage is counted in `workflow_step_usage_periods` per resolved payment period.
- The runtime atomically reserves one unit before each step attempt across DB and Temporal engines.
- A tenant at the finite limit is quota-paused before a new step starts.
- Quota-paused runs have `workflow_runs.status = 'WAITING'`, preserve `node_path`, and have a `workflow_run_waits.wait_type = 'quota'` record.
- Quota-blocked steps do not create `workflow_run_steps` rows and do not increment usage.
- Unlimited tenants continue executing while usage is still recorded.
- Stripe metadata overrides and tier defaults resolve as specified.
- Missing Stripe periods use the UTC calendar month fallback with tier defaults.
- Scheduled resume scan resumes eligible quota-paused runs without bypassing runtime quota checks.
- Manual resume resumes eligible quota-paused runs and returns a helpful exhausted-quota response otherwise.
- Tests cover quota resolution, atomic reservation, DB runtime enforcement, Temporal runtime enforcement, resume behavior, and reconciliation drift detection.
