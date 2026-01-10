# PRD — Contract Purchase Order Support (Invoice + Limit Advisory)

- Slug: `contract-purchase-order-support`
- Date: `2026-01-05`
- Status: Draft

## Summary

Add purchase order (PO) support to contract billing in two ways:

1) When an invoice is created from a PO-enabled client contract assignment, the invoice stores a **snapshot** of the PO number and surfaces it in the UI + default PDF header.
2) When a PO has an authorized spend amount, the system computes **advisory** overage warnings (do not block) and provides batch-invoicing upfront handling (allow vs skip) only when an overage is possible.

## Problem

MSPs frequently must include customer PO numbers on invoices to avoid AP rejections. Today, Alga stores PO context on the client contract assignment (`client_contracts`) but invoices do not reliably surface or export it, and PO authorized-spend limits are not enforced/advised during billing.

## Goals

- Invoice records created from contract billing include an invoice-level `po_number` snapshot (immutably tied to that invoice).
- PO number appears on:
  - Invoice metadata in-app
  - Default invoice PDF header (when present)
  - Accounting export/sync “reference” surfaces (QBO + Xero + CSV adapters where applicable)
- PO authorized spend (`po_amount`) is treated as an **advisory total spend cap**:
  - Warn (do not block) when a newly generated invoice would exceed remaining PO amount.
  - “Consume” PO amount only for **finalized** invoices; “unconsume” automatically when invoice is unfinalized (and if an invoice is cancelled/voided).
- Batch invoicing prompts **upfront** for overage handling when (and only when) at least one invoice *could* overrun a PO limit:
  - Allow overages
  - Skip invoices that would overrun

## Non-goals

- Supporting more than one PO per invoice.
- Full PO lifecycle management (creation, multi-PO allocation, splitting charges across POs).
- Blocking invoice generation due to PO limit overage.
- Retroactively changing historical invoices when contract PO values are edited later.

## Users and Primary Flows

- Billing admin / finance ops
  1) Configure contract assignment PO fields (`po_required`, `po_number`, optional `po_amount`).
  2) Generate invoice(s) (single or batch).
  3) Review invoice details and PDF; PO is visible.
  4) Export invoices to QBO/Xero; PO reference is available externally.

## UX / UI Notes

- Invoice detail view:
  - Display PO number when present.
  - Display PO “authorized” amount (from contract assignment) and “consumed/remaining” summary when `po_amount` is present.
  - If invoice would exceed remaining PO amount, show a warning banner with overage amount; provide an explicit “Proceed anyway” confirmation.
- Batch invoicing:
  - If none of the invoices being generated can overrun a PO limit, proceed without any extra prompts.
  - If one or more invoices could overrun, present a single prompt up front:
    - Allow overages (generate all)
    - Skip overages (generate only invoices that fit)
  - Summarize results (generated count, skipped count + reasons).

## Requirements

### Functional Requirements

- Invoice PO snapshot
  - Add `invoices.po_number` populated at invoice creation time from the associated `client_contracts.po_number`.
  - Add `invoices.client_contract_id` populated for invoices created from contract billing (single-contract assumption).
  - Invoices created without contract context (pure manual, etc.) may leave these fields null.
- PO-required behavior
  - If `client_contracts.po_required = true`, invoice generation remains blocked when `po_number` is missing.
- PO limit advisory (authorized total spend)
  - Finalized mapping (based on current UI + invoice modification logic):
    - Treat invoice as finalized when `finalized_at` is set OR `status` is one of `sent`, `paid`, `overdue`, `prepayment`, `partially_applied`.
    - Do not count `draft`, `pending`, or `cancelled` toward consumption.
  - If `client_contracts.po_amount` is set, compute:
    - `consumed`: sum of `invoices.total_amount` for invoices tied to the same `client_contract_id` where invoice is finalized per the mapping above.
    - `remaining`: `po_amount - consumed`.
    - `overage`: `max(0, invoice.total_amount - remaining)`.
  - Warn (do not block) if `overage > 0`.
- PDF header
  - Default invoice template includes PO number in the header when present.
- Accounting exports
  - Include PO number on exported invoices in the external system’s “reference/memo” surface(s):
    - QBO API export: include in `PrivateNote` (or other supported memo field).
    - QBO CSV export: include in `Memo`.
    - Xero API export: include in `reference` while preserving the invoice identifier (format TBD).
    - Xero CSV export: include in `Reference` while preserving existing matching identifiers (format TBD).

### Non-functional Requirements

- No new external dependencies.
- Overage checks should be query-efficient (indexes on new invoice columns; avoid N+1 in batch mode).

## Data / API / Integrations

- DB migration(s)
  - Add `invoices.po_number` (text, nullable).
  - Add `invoices.client_contract_id` (uuid, nullable; FK optional depending on schema conventions).
  - Add indexes to support lookups by `client_contract_id` and status.
- Invoice view models / API responses should include the new invoice-level PO fields for UI + exports.
- Accounting export adapters should load invoice `po_number` and include it in outbound payloads.

## Security / Permissions

- No new permissions beyond existing invoice read/generate/export permissions.
- Ensure client portal visibility rules remain unchanged (only show PO number where the invoice is visible).

## Observability

- Not in scope beyond existing logs/errors.

## Rollout / Migration

- Ship a migration adding invoice columns and backfill as “best effort” if feasible (optional).
- Ensure invoice generation still works when PO columns are absent (if runtime schema checks are used elsewhere).

## Open Questions

- Formatting rules for external-system references (length limits, delimiter choice, and preserving matching keys).

## Acceptance Criteria (Definition of Done)

- Creating an invoice from a PO-enabled contract assignment stores `invoices.po_number` and shows it in invoice UI + default PDF header.
- When `po_amount` is set, invoice preview/generation shows an overage warning when applicable and allows an explicit override.
- Batch invoicing prompts for overage handling only when an overage is possible, and can skip overage invoices when requested.
- QBO + Xero exports include PO reference content in their respective memo/reference field(s) without breaking existing matching/mapping.
