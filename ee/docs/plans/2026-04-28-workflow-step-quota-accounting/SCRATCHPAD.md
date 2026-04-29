# Scratchpad — Workflow Step Quota Accounting

- Plan slug: `2026-04-28-workflow-step-quota-accounting`
- Created: `2026-04-28`

## What This Is

Rolling notes for the workflow step quota accounting plan. Keep decisions, discoveries, commands, links, and gotchas here as implementation proceeds.

## Decisions

- (2026-04-28) Count every workflow step attempt at step start. Retries, failed attempts, `forEach` item attempts, and wait/human-task entry attempts all count. Quota-blocked steps do not count because they never start.
- (2026-04-28) Quota exhaustion pauses workflow runs instead of failing them. Runs remain at the current `node_path` with `workflow_runs.status = 'WAITING'` and a `workflow_run_waits.wait_type = 'quota'` record.
- (2026-04-28) Use Stripe subscription periods as the primary payment period source: `stripe_subscriptions.current_period_start` through `current_period_end`.
- (2026-04-28) Do not use contract `recurring_service_periods`, cadence ownership, invoice windows, or contract-line periods for this feature. Workflow quota is tenant platform licensing usage, not client contract billing usage.
- (2026-04-28) If no valid active Stripe period exists, fall back to the current UTC calendar month with tier defaults.
- (2026-04-28) Tier defaults are `solo = 150`, `pro = 750`, and `premium = 10000` workflow step attempts per period.
- (2026-04-28) Use hybrid limit resolution: Stripe price metadata first, Stripe product metadata second, tier default last.
- (2026-04-28) Support `workflow_step_limit=unlimited`; unlimited tenants still record usage but are not quota-paused.
- (2026-04-28) Use a dedicated atomic counter table for enforcement and keep `workflow_run_steps` as the detailed audit/reconciliation ledger.
- (2026-04-28) Use column name `tenant` in new schema rather than `tenant_id`, per project schema convention and user instruction.
- (2026-04-28) Resume quota-paused workflows through both a recurring job and a manual resume action. Manual resume must not bypass quota.

## Discoveries / Constraints

- (2026-04-28) DB workflow runtime creates step rows in `shared/workflow/runtime/runtime/workflowRuntimeV2.ts` inside `executeRun()` after `resolveStepAtPath()` and before `executeStep()`.
- (2026-04-28) Temporal runtime creates projected step rows in `ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts` via `projectWorkflowRuntimeV2StepStart()`.
- (2026-04-28) Existing workflow runtime tables include `workflow_runs`, `workflow_run_steps`, `workflow_run_waits`, `workflow_action_invocations`, `workflow_run_snapshots`, and `workflow_runtime_events` from migration `server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs`.
- (2026-04-28) Tenant tiers are defined in `packages/types/src/constants/tenantTiers.ts` as `solo`, `pro`, and `premium`.
- (2026-04-28) `packages/types/src/constants/tierFeatures.ts` already notes that `WORKFLOW_DESIGNER` is available to all tiers and that a usage cap was planned separately.
- (2026-04-28) Stripe subscription table is created in EE migration `ee/server/migrations/20251014120000_create_stripe_integration_tables.cjs` and includes `current_period_start`, `current_period_end`, `stripe_price_id`, `status`, and `metadata`.
- (2026-04-28) Existing scheduled job infrastructure includes `server/src/lib/jobs/initializeScheduledJobs.ts`, `registerAllHandlers.ts`, and `jobHandlerRegistry.ts`.

## Commands / Runbooks

- (2026-04-28) Create plan folder: `mkdir -p ee/docs/plans/2026-04-28-workflow-step-quota-accounting`.
- (2026-04-28) Validate plan JSON manually or with the alga-plan validation helper after edits.

## Links / References

- `shared/workflow/runtime/runtime/workflowRuntimeV2.ts`
- `ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts`
- `server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs`
- `ee/server/migrations/20251014120000_create_stripe_integration_tables.cjs`
- `packages/types/src/constants/tenantTiers.ts`
- `packages/types/src/constants/tierFeatures.ts`
- `server/src/lib/jobs/initializeScheduledJobs.ts`
- `server/src/lib/jobs/registerAllHandlers.ts`
- `server/src/lib/jobs/jobHandlerRegistry.ts`

## Open Questions

- Should zero-limit metadata ever be valid, or should it remain invalid and fall back to tier default? Current PRD treats zero as invalid.
- What exact permission should gate manual quota resume if no dedicated workflow-run operation permission exists?
- Should rollout include an explicit enforcement feature flag, or is the plan to enforce immediately once shipped?

## Implementation Notes (2026-04-28)

- Added shared quota service at `shared/workflow/runtime/services/workflowStepQuotaService.ts`.
- Resolver behavior implemented:
  - Preferred Stripe subscription period from `stripe_subscriptions` with status priority `trialing > active > past_due > unpaid` and valid `current_period_start/end`.
  - Fallback period to UTC month boundaries when Stripe tables/subscription period are unavailable.
  - Tier defaults from `tenants.plan`: `solo=150`, `pro=750`, `premium=10000`.
  - Metadata precedence implemented: `stripe_prices.metadata.workflow_step_limit` -> `stripe_products.metadata.workflow_step_limit` -> tier default.
  - `workflow_step_limit=unlimited` maps to `effective_limit = null`.
  - Invalid metadata safely ignored (falls through to next source).
- Atomic reservation implemented in same service:
  - Upserts `workflow_step_usage_periods` by `(tenant, period_start, period_end)`.
  - Takes row lock (`FOR UPDATE`) before reservation decision.
  - Finite limits reject at/above limit without increment.
  - Unlimited limits always increment `used_count`.
- DB runtime enforcement integrated in `shared/workflow/runtime/runtime/workflowRuntimeV2.ts`:
  - Reservation now occurs before STARTED step row creation.
  - On exhaustion: run is set `WAITING`, `node_path` preserved, and quota wait (`wait_type='quota'`) is created/reused.
- Temporal projection enforcement integrated in `ee/temporal-workflows/src/activities/workflow-runtime-v2-activities.ts` and workflow handling in `ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts`:
  - Reservation happens before STARTED step projection.
  - On exhaustion: quota wait created/reused, run marked WAITING, activity returns `quotaPaused` result, workflow exits without treating it as failure.
- Added integration tests in `server/src/test/integration/workflowStepQuotaService.integration.test.ts` covering:
  - Stripe period resolution.
  - Fallback calendar month + tier default.
  - Metadata precedence and unlimited.
  - Finite reservation rejection-at-limit.
  - Unlimited reservation increments.
- Command run:
  - `cd server && npm test -- src/test/integration/workflowStepQuotaService.integration.test.ts` (pass).
- Added T005 coverage in `server/src/test/integration/workflowStepQuotaService.integration.test.ts` to verify uniqueness and upsert behavior on `(tenant, period_start, period_end)`.
