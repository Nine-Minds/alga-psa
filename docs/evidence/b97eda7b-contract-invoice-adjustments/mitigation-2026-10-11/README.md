# PR #3499 mitigation checkpoint — 2026-10-11

Current production checkpoint for PR HEAD
`0826a475429d25fe5a3647ef6a5e7df7c241e7cf`. The review build stamp matches
that commit and `/api/health` returns 200. Entry:
<http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=contract-templates>.

## Open Review

Two calls to `workflow-open-review --activate=false` reproduced
`Browser pane not found` for the expected named pane while a separate card
browser remained authenticated and usable. Host and pane suffix match. The
failure is a remote-pane creation/registration handoff race: tab creation is
acknowledged before the remote browser backend registers, while sign-in tries
the local wake path. The owning Alga Dev repair is committed separately at
`df8e9c219b38049f60fca8bd332e698181ddc46` on
`fix/open-review-remote-browser-handoff`; focused tests (20 + 3) and TypeScript
check passed. The running Alga Dev release has not activated it, so absent-pane,
existing-pane, duplicate-avoidance, and signed-in handoff remain live gaps.

## Review-owned template fixture

Created through the production Contract Templates authoring UI:

- Name: `REVIEW-3499-MITIGATION-TEMPLATE`
- ID: `533a7ca9-a6f1-49f0-a8a6-dd1ed27306b2`
- State: published October 11, 2026; monthly, client schedule, arrears, no
  proration; one fixed-fee contract-line block containing two billable services
  (`Managed Services Plan` and `Managed Workstation`), quantity 1 each.
- Default discount: `REVIEW-3499-Default-10-Percent`, 10%, starts October 11,
  2026, scope “This contract”.
- Entry: the production billing URL above with
  `&contractId=533a7ca9-a6f1-49f0-a8a6-dd1ed27306b2`.

The retained older `REVIEW-3499-DISCOUNTS` shared template was not modified. No
client copies were instantiated. Copy independence, subsequent template/client
edits, separate same-method line targeting, automatic invoice generation,
retries, preview/PDF parity, and posted ledger behavior are not established.
Production actions logged HTTP 500 because relation `time_tracking_sessions`
is absent. Do not repair this by altering shared review data or credentials.

The captured inventory before authoring is
[`production-template-inventory.png`](production-template-inventory.png); it
shows the authenticated route and the prior shared template. A screenshot of
the new template state was not captured. To reset this isolated fixture, use the
production template detail and delete `REVIEW-3499-MITIGATION-TEMPLATE` and its
`REVIEW-3499-Default-10-Percent` discount after reviewer inspection. Do not
delete the shared `REVIEW-3499-DISCOUNTS` template or delivered QBO fixture.

## Current-production versus older evidence

This checkpoint is not production automatic-generation or retry proof. The
prior exact-HEAD scope smoke in `../repair-0826a475/` is dev-environment evidence:
all eligible charges: 390000 + eligible unattributed manual 15000 gives -40500
and 364500; this-contract scope gives -39000 and 366000. It includes repeat
identity, stable ledger, and actual PDF/CSV evidence, but must not be presented
as current-production generation.

## Delivered QBO history — preserve unchanged

`REVIEW-3499-QBO-NEXT` is delivered history: invoice
`5a1e0000-0000-4000-8000-202610079004`, batch
`3ac31e06-9479-4f5d-9c73-170a880d80d9`, simulator invoice `invoice-21`,
principal/total 385000 minor units and simulator `TotalAmt`/`Balance` 3850.
Existing evidence remains in `../final-rerun-0826/`. Do not unlock, reset,
delete, or re-export it.
