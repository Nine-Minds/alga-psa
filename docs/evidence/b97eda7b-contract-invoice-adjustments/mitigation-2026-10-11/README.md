# PR #3499 mitigation round 3 — 2026-10-11

> Historical round 3 checkpoint. The [takeover report](../takeover-2026-10-11/README.md) supersedes the generation, PDF and ledger gaps below and records two additional source repairs.

## Revision and production endpoint

Production build stamp: `0826a475429d25fe5a3647ef6a5e7df7c241e7cf+da39a3ee5e6b`. The PR evidence checkpoint recorded by the preceding round was `161a3a896ce14f1d79be2a0d82a7f63466169b1d`; that is a checkpoint revision, not this report's current HEAD. This round changes evidence only, not the application source. The production app at <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185> returned 200 and remained authenticated in the review browser.

## Owned production template and client-copy fixtures

The supported production authoring UI created template `REVIEW-3499-MITIGATION-TWO-FIXED-LINES` (`566a5bd6-2435-4818-b147-60edf805adbd`) with two distinct **Fixed** lines in **AUD**: Managed Workstation (`89e47435-bb9c-4d48-801c-91d80c1d4c4c`) and Cabling product (`edab1b08-848b-4946-8b1d-265dae4ee428`). Template defaults are active from 2026-09-01: 12% and A$25, contract scope.

Client A (`1992b9da-939c-4be1-a110-ed6356a5dd69`) and Client B (`ab0d087c-c435-42c8-90a3-256fd304f268`) are review-owned. Earlier wizard-created copies A (`8c28a27d-a433-4b3b-8de4-5bd373a21d35`, assignment `dbde35cf-559e-4259-9b25-392c7457e55a`) and B (`30f188a1-79c5-424b-bcc6-ac289a4dd8bc`, assignment `b30a81e6-a8c7-409a-b1a6-b88d9acc014b`) were independently edited and retained while later template edits were made. Their saved independent definitions are documented in the preceding evidence checkpoint.

For line-scope targeting, a fresh Client B copy `REVIEW-3499-LINE-SCOPE-COPY-B` was created through the supported wizard: contract `a8fcc363-f389-44fb-81e5-98fc0d3633ab`, assignment `42855623-69f8-4351-b36b-cb3fb21b989f`. Its Discounts tab shows the copied 10% `REVIEW-3499-LINE-CABLING-10P` attached to `...Products` / Cabling only, alongside the copied 12% and A$25 contract-wide defaults. Managed Workstation is a separate A$200 sibling line; when this window becomes eligible, the expected line-scope base is A$120 (12000 minor units) and expected line discount is −A$12, excluding the sibling. Those generated base/amount assertions remain pending because the window is not yet due. Screenshot: `client-b-line-discounts.png`.

The production build could not map a line discount when its target was the Managed Workstation service line, and the supported wizard rolled back with `Template line-scoped discount could not be mapped to a client contract line.` We retargeted the review fixture to the Cabling product line, whose template source ID is preserved through the wizard, and created the fresh copy above. This round proves target assignment in the client copy, but cannot prove the generated discount's persisted eligible base: this newly authored contract's first available recurring window is not yet due (see below). Do not interpret the target screenshot as generation evidence.

New authored-template and copy screenshots: `two-fixed-line-template.png`, `template-after-edit.png`, `client-a-created.png`, `client-a-copy-edited.png`, `client-b-copy-retained.png`, `client-b-line-discounts.png`.

## Current-production automatic generation and repeat protection

Client A's review-owned billing location was given a synthetic `example.invalid` address through the client UI; no email was sent and no shared client changed. The first production preview correctly refused with `NO_BILLING_EMAIL` and created no invoice. After setting that owned fixture prerequisite, the same supported **Automatic Invoices → Preview Selected → Generate** path was retried and generated draft `INV-000041`, invoice `7c0f201e-ada6-458f-8463-6b3d4ffbdc78`, for September 2026. It is AUD. The persisted invoice editor shows two source-generated fixed charges: Managed Workstation A$200 and Cabling A$120 (A$320 total). Both configured defaults use contract scope and the September service period 2026-09-01–2026-10-01: 12% of 32000 minor units = **−A$38.40**, and fixed **−A$25.00**. The generated invoice amount before manual addition is **A$256.60**; the UI marks tax pending.

After generation, the supported draft editor added an intentional non-taxable manual A$15 line, `REVIEW-3499 intentional manual addition`. Reloading the saved editor retained it. The displayed automated percentage base remained 32000 minor units, excluding this contract-unattributed manual line; the automatic discounts remained −A$38.40 and −A$25.00; saved editor/preview total is **A$271.60 with tax pending**. The visible automated rows retain the same source discount names and affected September period. See `generated-invoice-breakdown-aud.png` and `generated-invoice-preview-total-aud.png`; current Automatic Invoices schedule evidence is `current-automatic-invoices-aud.png`.

This is current-production generated financial evidence for fixed and percentage contract-scope discounts plus manual-line preservation. It is a smaller AUD case; the exact 390000-minor-unit scope examples (all-eligible −40500/364500 and this-contract −39000/366000) remain historical development evidence, not a current-production rerun. UI evidence shows one settlement row per configured discount, but direct settlement IDs, ledger deltas, principal and database uniqueness were not independently read from production storage in this round. No duplicate is visible after the saved-editor reload; that is not a substitute for a database-level ledger assertion.

The billed September candidate disappeared from Automatic Invoices and appears in recurring history for Client A with service period `2026-09-01` to `2026-10-01` and invoice window `2026-10-01` to `2026-11-01`. The supported history menu has no regenerate/retry action. Client B's new contract is grouped with its existing contract and appears as October 2026 **Not yet due**, opening November 1. No retry was forced and no protected billed period was bypassed. The fixture-prerequisite retry is verified; duplicate-free generation on a still-open source period and persisted ledger deltas are **not** established.

Invoice preview was captured in the actual editor and shows the saved AUD total and rows. Download PDF was attempted from the same invoice; the production review log reports Chromium failed to launch during both filing and unfiled render (`[downloadInvoicePDF] ... Failed to launch the browser process: Code: null`, stages `store` and `render`; redacted excerpt in `pdf-download-attempt.log`). A current-production downloaded PDF comparison is unavailable. Do not substitute older development PDFs for this result.

## Schema repair context

The earlier wizard HTTP 500 was traced to `recurring_service_periods.obligation_type` remaining NOT NULL while current inserts no longer supplied it. After zero-collision preflight, migration `20261010120000_collapse_recurring_service_period_obligation_type.cjs` ran through its supported migration module in configured non-transactional mode (migration batch 63); all 1004 rows remained and the obsolete column was dropped. The separate missing `time_tracking_sessions` log came from a billing-shell StopwatchProvider read, not client creation. No app server was started and no shared fixture was reset.

## Open Review release status

The named-pane defect belongs to the separate Alga Dev `ghostty-pane-ide` repository. Repair commit is **`69cb91dd5b58a5aa5560e2c7a0b11aa5ae6cd562`**; preceding implementation is **`df8e9c219b38049f60fca8bd332e698181ddc46b`**. The resolver preserves `wakePane`'s activity/reaper refresh for registered remote panes. Focused timeout/disappearance and related tests passed (25/25) with writable private test storage; TypeScript passed. The supported activation is `npm run deploy:publish` from the Mac checkout, as specified in that repository's fleet runbook. The Mac tailnet host is active, but this Linux host has no remote terminal pane, and `nc -vz -w 3 100.70.145.1 22` returns `Connection refused`; no supported remote executor is exposed here. Activation is therefore outstanding. Absent-pane creation, valid-pane reuse, duplicate-free repeated calls, and authenticated Open Review remain unverified after activation. Do not report this as repaired live.

## Delivered QBO history — preserve

`REVIEW-3499-QBO-NEXT` remains delivered and untouched: invoice `5a1e0000-0000-4000-8000-202610079004`, batch `3ac31e06-9479-4f5d-9c73-170a880d80d9`, simulator invoice `invoice-21`, principal/total 385000 minor units, simulator `TotalAmt`/`Balance` 3850. Keep the earlier delivered export evidence at `../final-rerun-0826/`. Do not unlock, reset, delete or re-export it.

## Review links and cleanup

- Production template: <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=contract-templates&contractId=566a5bd6-2435-4818-b147-60edf805adbd>
- New line-target copy: <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=client-contracts&contractId=a8fcc363-f389-44fb-81e5-98fc0d3633ab&clientContractId=42855623-69f8-4351-b36b-cb3fb21b989f>
- Automatic Invoices: <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=invoicing&subtab=automatic>
- Generated Client A invoice: <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=invoicing&subtab=drafts&invoiceId=7c0f201e-ada6-458f-8463-6b3d4ffbdc78>

Retain the generated `INV-000041` draft and the copied contracts until human review is complete. For later cleanup, use the invoice's supported **Reverse Draft** action only after the reviewer confirms its audit is complete; then confirm the Client A recurring history and invoice are no longer needed before removing only review-owned template/client contracts/clients and their synthetic billing locations through supported UI. Client A and B currently have synthetic billing locations ending in `.invalid`. Do not delete any shared fixture, finalized/billed history or the QBO delivery.
