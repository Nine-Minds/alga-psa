# Billing: fresh generation and duplicate exclusion (production build-1793009958637, 4e5f2ec5ad+da39a3ee5e6b)

Actor: QA (qa@emeraldcity.oz) via Open Review session. Tenant Oz. Client White Rabbit.

## Setup (all reverted, see Cleanup)
- Client contract `CM-REVIEW-20261026-09 hourly contract` restored through Billing > Client Contracts > Restore (was inactive/pending).
- Billing email set on White Rabbit Billing tab.
- QA timesheet 2026-10-12..18 submitted (UI), approved through Timesheet Approvals by a disposable team `DEPLOY-4E5F approvers (disposable)` led by QA (QA alone gets "Team lead access required").

## Fresh generation: PASS
- Automatic Invoices defaults its date filter to `to = today`, so October work (cycle end 11-01) is hidden; with To = 12/01/2026 the October White Rabbit group showed 2 unresolved line items, $30.00.
- Preview: Rabbit Tracking 0.2 h x $75.00 = $15.00, twice; subtotal $30.00, tax $0.00.
- Generated draft INV-000004 (`4cd3d0bc-…`): subtotal 3000, tax 0, total 3000 USD; sources = time entries 705281b3 and a05e236a (both co_managed MSP time), now invoiced.

## Exclusion of already-invoiced work: PASS
- Overlap between INV-000004 and INV-000003 sources: 0.
- INV-000003 unchanged: draft, subtotal/total 42500, 17 sources (17 x 0.25 h x $100).
- No time entry is linked to more than one invoice (0 duplicates tenant-wide).
- After generation the October group disappeared from Automatic Invoices; only the November/December hourly periods (no time) remain.

## Contract-rate generation of new time: FAIL (native, pre-existing, not this branch)
- A new approved 30-minute commercial entry on the hourly contract line (b01d616f, dated 2026-10-18, the earliest date QA's open timesheet allowed) is never offered: the October hourly service period is already `billed` by INV-000003, and the hourly loader bounds time by the billed service period (`loadTimeBasedObligation`, billingEngine.ts:5360-5362). No row, warning or adjustment appears; the only native remedy is reversing INV-000003. `git diff origin/main...HEAD -- packages/billing` does not touch this selection logic. The reference draft INV-000003 was deliberately not reversed.

## Cleanup
- INV-000004 reversed via Invoicing > Drafts > Reverse Draft; entries 705281b3/a05e236a released (invoiced=false, approval as before for 705281b3).
- Sheet approval reversed (Show Approved > Reverse approval): sheet and its two pre-existing entries are CHANGES_REQUESTED (originally DRAFT; DRAFT is not reachable through the UI after a submission).
- Test entry b01d616f deleted from the timesheet.
- Disposable approval team deleted.
- Contract terminated again: is_active=false, status=pending, no end date (as before).
- Billing email cleared (null).
