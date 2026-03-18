# Service-Driven Invoicing Cutover Runbook

## Purpose

Use this runbook when recurring due rows are missing or stale during the service-driven invoicing cutover.

It is the operator/developer entrypoint for:

- confirming whether a ready-to-invoice gap is caused by missing persisted `recurring_service_periods`
- assessing whether future service periods reach the required generation horizon
- running backfill or regeneration planning with the shared cutover helpers
- validating that repaired rows reappear in the due-work reader

Until a dedicated billing-maintenance UI exists, the supported maintenance entrypoint is the shared helper layer under `shared/billingClients/*.ts`, invoked through `pnpm exec tsx`.

## Quick Diagnosis

### 1. Confirm the gap is materialization-related

If the due-work reader returns a row with:

- `reason: missing_service_period_materialization`
- a `billing_cycle_id`
- no persisted canonical row for the same execution identity

then the system is falling back to a compatibility billing-cycle row because the recurring service-period ledger is missing for that window.

The first validation step is the focused due-work reader harness:

```bash
cd server
pnpm exec vitest run src/test/unit/billing/recurringDueWorkReader.integration.test.ts -t "T075" --coverage.enabled=false
```

### 2. Inspect persisted rows directly

```sql
select
  record_id,
  schedule_key,
  period_key,
  lifecycle_state,
  cadence_owner,
  charge_family,
  service_period_start,
  service_period_end,
  invoice_window_start,
  invoice_window_end,
  invoice_id,
  invoice_charge_detail_id
from recurring_service_periods
where tenant = :tenant
  and client_id = :client_id
order by invoice_window_end desc, service_period_start desc;
```

### 3. Inspect the recurring obligations that should have generated rows

```sql
select
  ccl.client_id,
  ccl.contract_line_id,
  cl.cadence_owner,
  cl.billing_frequency,
  cl.billing_timing,
  cl.start_date,
  cl.end_date
from client_contract_lines ccl
join contract_lines cl
  on cl.contract_line_id = ccl.contract_line_id
 and cl.tenant = ccl.tenant
where ccl.tenant = :tenant
  and ccl.client_id = :client_id
  and cl.is_recurring = true
order by ccl.contract_line_id;
```

If the recurring obligation exists but the matching `recurring_service_periods` row does not, continue with coverage assessment and backfill/regeneration planning.

## Coverage Assessment Entry Point

Use this when you already have the current future records for one schedule or contract line and need to know whether the generated horizon is sufficient.

Prepare a JSON file with the current future rows, for example `tmp/recurring-service-period-existing.json`.

```bash
pnpm exec tsx <<'TS'
import fs from 'node:fs';
import { assessRecurringServicePeriodGenerationCoverage } from './shared/billingClients/recurringServicePeriodGenerationHorizon.ts';

const existingRecords = JSON.parse(
  fs.readFileSync('./tmp/recurring-service-period-existing.json', 'utf8'),
);

const coverage = assessRecurringServicePeriodGenerationCoverage({
  existingRecords,
  generatedThrough: '2026-03-18T00:00:00Z',
});

console.log(JSON.stringify(coverage, null, 2));
TS
```

Interpretation:

- `meetsTargetHorizon: false` means the schedule does not extend far enough ahead
- `needsReplenishment: true` means the remaining future horizon has dropped below the operational threshold
- continuity issues mean fix the stored rows before running generation again

## Backfill Entry Point

Use this when active recurring obligations have no persisted future rows yet and the system is falling back to compatibility billing-cycle rows.

Prepare:

- `tmp/recurring-service-period-candidates.json` with the candidate rows to materialize
- `tmp/recurring-service-period-existing.json` with any already-persisted rows for the same schedule

```bash
pnpm exec tsx <<'TS'
import fs from 'node:fs';
import { backfillRecurringServicePeriods } from './shared/billingClients/backfillRecurringServicePeriods.ts';

const candidateRecords = JSON.parse(
  fs.readFileSync('./tmp/recurring-service-period-candidates.json', 'utf8'),
);
const existingRecords = JSON.parse(
  fs.readFileSync('./tmp/recurring-service-period-existing.json', 'utf8'),
);

const plan = backfillRecurringServicePeriods({
  candidateRecords,
  existingRecords,
  backfilledAt: '2026-03-18T00:00:00Z',
  sourceRuleVersion: 'service-driven-invoicing-cutover-v1',
  sourceRunKey: 'manual-backfill-2026-03-18',
});

console.log(JSON.stringify(plan, null, 2));
TS
```

What to look for:

- `backfilledRecords` are new future rows to persist
- `realignedRecords` are regenerated replacements for mismatched untouched rows
- `skippedHistoricalCandidates` confirms the helper did not rewrite billed history
- any overlap error means the candidate set crosses the billed-history boundary and must be corrected before persistence

## Regeneration Entry Point

Use this when rows already exist but cadence-owner, timing, anchor, or activity-window changes mean untouched future rows must be refreshed.

Prepare:

- `tmp/recurring-service-period-existing.json`
- `tmp/recurring-service-period-candidates.json`

```bash
pnpm exec tsx <<'TS'
import fs from 'node:fs';
import { regenerateRecurringServicePeriods } from './shared/billingClients/regenerateRecurringServicePeriods.ts';

const existingRecords = JSON.parse(
  fs.readFileSync('./tmp/recurring-service-period-existing.json', 'utf8'),
);
const candidateRecords = JSON.parse(
  fs.readFileSync('./tmp/recurring-service-period-candidates.json', 'utf8'),
);

const plan = regenerateRecurringServicePeriods({
  existingRecords,
  candidateRecords,
  regeneratedAt: '2026-03-18T00:00:00Z',
  sourceRuleVersion: 'service-driven-invoicing-cutover-v1',
  sourceRunKey: 'manual-regeneration-2026-03-18',
});

console.log(JSON.stringify(plan, null, 2));
TS
```

What to look for:

- `preservedRecords` remain authoritative because they were billed, locked, or user-edited
- `regeneratedRecords` replace untouched future rows
- `supersededRecords` are the rows that should no longer be considered active
- `conflicts` must be reviewed before persisting because they mean a preserved override no longer matches regenerated candidates

## Persistence Rules

When applying a backfill or regeneration plan to the database:

- do not mutate `billed`, `edited`, or `locked` rows in place
- insert new generated/regenerated rows first
- only supersede untouched future rows that the plan explicitly replaced
- keep `invoice_id`, `invoice_charge_id`, and `invoice_charge_detail_id` intact for billed history
- if a deleted recurring invoice has already reopened linked rows to `locked`, treat those rows as preserved history-aware records, not disposable generated rows

## Post-Repair Validation

### Due-work reader validation

Run the focused due-work reader check after persisting repaired rows:

```bash
cd server
pnpm exec vitest run src/test/unit/billing/recurringDueWorkReader.integration.test.ts --coverage.enabled=false
```

The repaired execution window should either:

- appear as a canonical persisted due-work row, or
- disappear entirely because the row is not actually due

It should not continue surfacing only as a compatibility billing-cycle fallback unless materialization is still missing.

### DB-backed recurring linkage validation

Use the local Postgres listener on `127.0.0.1:57433` for focused recurring cutover checks:

```bash
cd server
DB_HOST=127.0.0.1 DB_PORT=57433 DB_NAME=server DB_NAME_SERVER=server DB_USER_SERVER=app_user DB_USER_ADMIN=postgres DB_PASSWORD_SERVER=postpass123 DB_PASSWORD_ADMIN=postpass123 pnpm exec vitest run --coverage.enabled=false src/test/integration/billingInvoiceTiming.integration.test.ts -t "T019|T020|T021"
```

What this proves:

- billed recurring service periods link back to canonical invoice detail rows
- unbridged contract-cadence invoices still link correctly
- deleting a linked recurring invoice reopens the affected service period instead of leaving it permanently hidden

## Reverse/Delete Repair Notes

If a recurring invoice was deleted during cutover testing and the due row did not come back:

1. query `recurring_service_periods` for the original `invoice_id`
2. confirm `invoice_id`, `invoice_charge_id`, and `invoice_charge_detail_id` were cleared
3. confirm `lifecycle_state = 'locked'`
4. rerun due-work validation

`locked` is the expected restored state after delete-repair because the system cannot safely infer whether the prior mutable state was exactly `generated` or `edited`.

## Escalate Instead Of Forcing A Repair

Stop and investigate before persisting a plan if any of the following are true:

- regeneration conflicts mention `missing_candidate`, `service_period_mismatch`, `invoice_window_mismatch`, or `activity_window_mismatch`
- continuity issues show gaps or overlaps inside the active future ledger
- a billed row would need to move service-period boundaries
- the only available history for a disputed invoice exists in `invoice_charge_details` and not in persisted `recurring_service_periods`

In those cases, preserve the existing records, capture the conflicting rows, and repair the source cadence/timing inputs first.
