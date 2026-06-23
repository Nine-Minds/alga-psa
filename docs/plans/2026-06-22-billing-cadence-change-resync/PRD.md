# PRD — Re-materialize service periods when billing cadence changes

- Slug: `2026-06-22-billing-cadence-change-resync`
- Date: `2026-06-22`
- Status: Draft

## Summary

When a client's billing cadence changes (billing cycle or anchor), Alga must keep the recurring service period ledger in sync so the invoicing screen never strands a client in an unexplained "repair required" state. Today only some cadence-change paths re-materialize service periods; a plain billing-cycle change does not. We route every cadence-mutating action through one shared "apply cadence change" layer that previews the impact, applies only on confirm, re-materializes unbilled periods in the same transaction, and never disturbs already-billed periods. We also add a tenant-level "Repair all" action and plain-language recovery UX for tenants already stuck.

## Problem

The recurring service period ("RSP") ledger (`recurring_service_periods`) is the record of what is due to invoice. The Automatic Invoices screen computes the periods it expects from the client's billing schedule (`client_billing_cycles`), then flags any expected period with no matching RSP row as "repair required" (`packages/billing/src/actions/billingAndTax.ts:565-660`, filter at `:1386`).

The RSP ledger is materialized from the client's current cycle (`clients.billing_cycle` scalar) via `getClientBillingCycleAnchor` (`shared/billingClients/billingSchedule.ts:40-75`). Most cadence-change paths re-materialize correctly:

- Contract and contract-line edits call `syncRecurringServicePeriodsForContract*` (`packages/billing/src/actions/recurringServicePeriodSync.ts:58,96`), wired into `contractActions`, `contractLineAction`, `contractWizardActions`, `billingClientsActions`, `contractLinePresetActions`.
- The dedicated schedule and anchor actions call `regenerateClientCadenceServicePeriodsForScheduleChange` (`packages/billing/src/actions/clientCadenceScheduleRegeneration.ts:413`), wired into `billingScheduleActions.ts:141` and `billingCycleAnchorActions.ts:148`.

But `updateBillingCycle` (`packages/billing/src/actions/billingCycleActions.ts:40`) updates only the `clients.billing_cycle` scalar and does nothing else. A cycle change through that path leaves the ledger stale. The client's expected windows (from `client_billing_cycles`) no longer match the stale RSP rows, so every window is flagged "repair required," with no explanation of cause or fix.

Cadence is represented three ways that can drift: the `clients.billing_cycle` scalar (drives materialization and repair), the `client_billing_cycles` table (drives gap detection), and the `recurring_service_periods` ledger (the due-work record). Consistency currently depends on every write path remembering to call the right re-materialization helper.

Observed in production (tenant `4437fd51-50ef-4d3c-88a7-721da858cf4f`, "IT initiative"): a test client was switched monthly to weekly. The RSP rows stayed monthly while the scalar and the cycle table moved to weekly. The invoicing screen showed dozens of "repair required" rows with opaque copy, zero invoices existed, and the admin had no path to recovery he could understand.

## Goals

- One cadence-change path that all cadence-mutating actions use, keeping `clients.billing_cycle`, `client_billing_cycles`, and `recurring_service_periods` consistent in a single transaction.
- Before applying a cadence change, show the impact (how many unbilled periods regenerate, across how many lines, from what date) and apply only on confirm.
- Never modify billed or invoice-linked periods. Warn when billed periods fall in the affected range.
- A tenant-level "Repair all" action that re-materializes every stale schedule at once.
- Plain-language recovery UX: clear messages and a "Fix all" affordance instead of opaque per-schedule repair.

## Non-goals

- Rebuilding billing math, proration, or invoice generation.
- Fully collapsing the three cadence representations into one derived model. We unify the write path; making `client_billing_cycles` a pure projection of the scalar plus anchor is future work (see Open Questions).
- Changing contract-cadence behavior (`cadence_owner = 'contract'`). Those paths already re-sync and are only re-audited.
- The one-off manual cleanup of the IT initiative tenant. That is operational, and the Repair-all action will also cover it.

## Users and Primary Flows

Persona: MSP billing admin setting up or adjusting client billing.

1. Admin changes a client's billing cycle. A dialog shows the impact. On confirm, the ledger re-materializes and the invoicing screen stays clean.
2. Admin opens invoicing and sees stale "repair required" rows from a past change. "Fix all" re-materializes the whole tenant, and the tenant self-heals.
3. Admin changes a cycle on a client with billed history. The dialog warns that billed periods are preserved, and only unbilled periods regenerate.

## UX / UI Notes

- Cadence-change dialog: triggered from the billing-cycle control (`packages/billing/src/components/billing-dashboard/BillingCycles.tsx` and the client billing settings surface). Shows old to new cadence, count of unbilled periods to regenerate, count of lines affected, the regeneration start date, and an explicit note that billed periods are preserved. Buttons: Apply, Cancel. A details expander lists affected schedules.
- Automatic Invoices gap panel (`packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`): replace "Recurring service periods were not materialized for this canonical client-cadence execution window" with plain language, for example "This client's billing schedule changed, so its upcoming charges need to be rebuilt." Add a "Fix all" action that calls Repair-all.
- Service Periods tab (`packages/billing/src/components/billing-dashboard/RecurringServicePeriodsTab.tsx`): keep per-schedule repair and add a tenant Repair-all entry point.

## Data / API / Integrations

- Tables: `recurring_service_periods` (lifecycle_state, invoice linkage `invoice_id`/`invoice_charge_detail_id`, service and invoice windows, revision, reason_code); `clients.billing_cycle`; `client_billing_settings` (anchor); `client_billing_cycles` (active windows).
- Reuse: `materializeClientCadenceServicePeriods`, `backfillRecurringServicePeriods` (`legacyBilledThroughEnd`), `regenerateClientCadenceServicePeriodsForScheduleChange`, `repairScheduleMaterialization`, `previewRecurringServicePeriodRegeneration`.
- New: `applyClientCadenceChange(trx, { tenant, clientId, newCycle, newAnchor })` used by `updateBillingCycle`, `updateClientBillingSchedule`, and the anchor actions. Updates all three representations atomically, regenerates unbilled periods, preserves billed periods.
- New: `previewClientCadenceChange(...)` returning impact counts without writing.
- New: `repairAllRecurringServicePeriodsForTenant(...)` enumerating and repairing stale schedules.

## Security / Permissions

- Cadence change requires `billing:update` (existing). Preview and repair require the existing recurring-service-period permission via `requireRecurringServicePeriodPermission` ('regenerate'). Repair-all requires the same. No new roles.

## Rollout / Migration

- No schema change. All required tables and columns exist.
- Backwards compatible: the existing per-schedule Repair button stays.
- Existing drifted tenants self-heal through user-initiated Repair-all. No data migration ships by default.

## Open Questions

- Should `client_billing_cycles` become a pure projection of the scalar plus anchor, removing the third source of truth?
- Should the impact dialog be skippable ("don't ask again") for power users?
- Should Repair-all run automatically for drifted tenants (for example on billing-page load), or stay manual?

## Acceptance Criteria (Definition of Done)

- Changing a client billing cycle via any path re-materializes unbilled RSP rows in the same transaction. Automatic Invoices shows no spurious "repair required" afterward.
- The change is gated by a preview dialog that reports impact. Cancel makes no changes.
- Billed or invoice-linked periods are never superseded or modified by a cadence change. A warning appears when billed periods are in range.
- "Repair all" re-materializes every stale schedule for a tenant and clears the gap panel, and is idempotent.
- Gap-panel and service-period copy is plain language with a working "Fix all".
- Integration tests cover: cycle change re-materializes; cancel is a no-op; billed periods preserved; repair-all heals seeded drift.
