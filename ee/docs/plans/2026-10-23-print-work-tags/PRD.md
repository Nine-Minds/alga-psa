# PRD: Print work tags from tickets and assets (alga-2026-0002683 C2)

Design of record: `ee/docs/plans/2026-10-20-physical-work-tags/design-C2-print-work-tags.md` (wins over ANALYSIS.md / PLAN.md).

## Problem
C1 shipped the label rendering foundation (providers, AST templates, PDF route) with no user-facing entry points, no tenant control over label content, and no per-class defaults.

## Goals
- Ticket detail: **Print work tag**. Asset detail: **Print asset label** (page print button relabelled **Print page**).
- Batch printing from the ticket list and asset list (disabled above 200 with a tooltip).
- A print dialog: template, layout preset (remembered), single-ticket Item/Reason edits and linked-asset picker, skip count, 422 failure list with "Use {template}" / "Skip these".
- Tenant templates choose which fields appear (`labelSettings.hiddenFields`); per-class defaults (`label_class` assignment scope).
- Printing is read-only: no writes, no events, no print record.

## Non-goals
Scanning, mobile, custody fields, ZPL, client-scoped templates, splitting batches over 200, recording prints.

## Invariants
QR = recordUrl only. Unreadable records are skipped and counted (`X-Label-Skipped`); all-unreadable or single unreadable = uniform 404. Render failure stays an all-or-nothing 422. Serial suffix = last 4 chars of serials >= 8 chars; the full serial never enters the view model. `url` and `identifier` cannot be hidden. Billing never imports tickets/assets; tickets never import assets.

## Work reason
Subcategory, else category, else null (design §9; the dossier's board fallback is not used).

## Acceptance
See `features.json` / `tests.json`. Live smoke test (design §7) is pending.

## Smoke test steps (for the later smoke tester; not run yet)
Sign in as the canonical QA user (see dossier). Needs a ticket with exactly one linked asset whose serial is >= 8 chars, and a second restricted user for step 3.
1. Ticket detail: click **Print work tag** (`<id>-print-work-tag-button`). PDF shows logo, MSP name, client, title, ticket number, reason (subcategory else category), `Asset {tag}`, `S/N ...last4`, QR. Edit Item/Reason in the dialog and reprint: edits appear, QR unchanged.
2. Asset detail: Actions dropdown / **Print asset label** (`asset-print-label-button`); choose the Code 128 template. Check tag, name, client, QR, barcode. The page **Print page** button still prints the page.
3. Ticket list: select 3 tickets including one the restricted user cannot read; Print work tags: PDF has 2 labels, dialog reports 1 skipped. Same for assets. Select > 200: action disabled with tooltip.
4. Hide client name in a tenant work-tag template (designer: Fields shown on the label), Set as Default for the ticket class, reprint: no client name. Asset default unaffected.
5. Scan both QRs with a phone while signed out: sign-in, then land on the ticket / asset (callbackUrl round trip). A scan by a user who cannot open the record reveals nothing.
6. In the DB confirm the T-noside tables (stock_*, invoices, invoice_charges, time_entries, assets, asset_history, tickets, documents, audit_logs) are unchanged after the prints.
