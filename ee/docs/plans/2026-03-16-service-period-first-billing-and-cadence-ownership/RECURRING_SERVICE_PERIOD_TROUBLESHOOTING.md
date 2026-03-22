# Recurring Service-Period Troubleshooting Runbook

## Purpose

This runbook covers the staged-rollout period where future recurring work is materialized in `recurring_service_periods`, but not every downstream workflow has been fully rewritten around that ledger yet.

Use it to diagnose:

- missing future materialized rows
- preserved user edits that now conflict with regenerated candidates
- unexpected gaps or overlaps after regeneration
- billed rows whose invoice linkage looks wrong

## Generation Failure Triage

1. Query `recurring_service_periods` by `tenant`, `obligation_id`, `obligation_type`, and `schedule_key`.
2. Confirm whether future active rows exist at all.
3. Compare `source_rule_version` and `source_run_key` across the active future set.
4. Distinguish ordinary missing future rows from continuity problems that need repair.

Suggested query:

```sql
select
  record_id,
  lifecycle_state,
  service_period_start,
  service_period_end,
  invoice_window_start,
  invoice_window_end,
  provenance_kind,
  reason_code,
  source_rule_version,
  source_run_key,
  supersedes_record_id
from recurring_service_periods
where tenant = :tenant
  and obligation_id = :obligation_id
order by service_period_start, revision;
```

## Override Conflict Investigation

When regeneration preserved an edited row, inspect the conflict kind before attempting repair.

The v1 conflict kinds are:

- `missing_candidate`
- `service_period_mismatch`
- `invoice_window_mismatch`
- `activity_window_mismatch`

Treat the preserved edited row as the active future truth until a deliberate repair step supersedes it.

## Regeneration Troubleshooting

When source rules changed and the future schedule looks wrong:

1. Check whether the row was eligible for ordinary regeneration.
2. Use `supersedes_record_id` to follow revision lineage.
3. Separate continuity repair from ordinary regeneration.

Ordinary regeneration may replace `generated` future rows, but it must not silently repair continuity drift or overwrite preserved edits.

## Invoice Linkage Repair Triage

If billed history looks inconsistent:

1. Load the billed row from `recurring_service_periods`.
2. Confirm `invoice_id`, `invoice_charge_id`, and `invoice_charge_detail_id` are either all present or all null.
3. Join the row to `invoice_charge_details`.
4. If the linkage is wrong, use `invoice_linkage_repair`; do not mutate the billed row through ordinary edit or regeneration flows.

Suggested query:

```sql
select
  rsp.record_id,
  rsp.lifecycle_state,
  rsp.invoice_id,
  rsp.invoice_charge_id,
  rsp.invoice_charge_detail_id,
  icd.item_detail_id,
  icd.service_period_start,
  icd.service_period_end
from recurring_service_periods rsp
left join invoice_charge_details icd
  on icd.tenant = rsp.tenant
 and icd.item_detail_id = rsp.invoice_charge_detail_id
where rsp.tenant = :tenant
  and rsp.record_id = :record_id;
```

## Guardrails

- Do not delete canonical `invoice_charge_details` rows to make persisted linkage look cleaner.
- Do not rewrite billed historical coverage through ordinary regeneration.
- Do not treat edited future rows as disposable staging data.
