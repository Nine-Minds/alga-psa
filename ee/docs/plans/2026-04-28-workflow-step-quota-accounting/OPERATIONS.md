# Workflow Step Quota Operations Notes

## Quota Source Resolution

1. Active Stripe subscription period (`trialing`, `active`, `past_due`, `unpaid`) with valid `current_period_start`/`current_period_end`.
2. If unavailable, fallback to current UTC calendar month.

Limit precedence:

1. `stripe_prices.metadata.workflow_step_limit`
2. `stripe_products.metadata.workflow_step_limit`
3. Tier default (`solo=150`, `pro=750`, `premium=10000`)

`workflow_step_limit=unlimited` sets unlimited cap (`effective_limit = null`) while continuing to increment usage.

## Pause Behavior

- Reservation occurs at step start.
- On exhaustion, run is set to `WAITING` at current `node_path`.
- Quota pause is recorded in `workflow_run_waits` with `wait_type='quota'`, `status='WAITING'`, and payload including `usedCount`, `effectiveLimit`, and period metadata.
- Quota-blocked step does not create a `workflow_run_steps` row.

## Resume Behavior

Automatic resume:

- Recurring job `workflow-quota-resume-scan` scans quota waits.
- Uses `FOR UPDATE SKIP LOCKED` and batch sizing.
- Resumes at most tenant remaining finite capacity per scan.
- Sets wait to `RESOLVED`, run to `RUNNING`, then re-enters runtime execution.

Manual resume:

- `resumeWorkflowRunFromQuotaPauseAction` checks tenant ownership + permission.
- If still exhausted, returns a structured response with `usedCount`, `effectiveLimit`, and `periodEnd`.
- If eligible, resolves quota wait and resumes through runtime path (no quota bypass).

## Reconciliation Procedure

Use `workflowStepQuotaService.reconcileUsagePeriod(tenant, periodStart, periodEnd)`:

- Counter source: `workflow_step_usage_periods.used_count`
- Ledger source: `workflow_run_steps` joined to `workflow_runs` for tenant and step `started_at` inside period
- Drift: `counterUsedCount - ledgerStepCount`

Investigate non-zero drift by checking runtime paths that may create step rows without quota reservation.
