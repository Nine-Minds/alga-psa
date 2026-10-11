# PR #3499 mitigation status — 2026-10-11

## Revisions and live entry

Production build stamp: `0826a475429d25fe5a3647ef6a5e7df7c241e7cf+da39a3ee5e6b`. This is distinct from the later evidence-only PR head `161a3a896ce14f1d79be2a0d82a7f63466169b1d`; this mitigation has no application source changes. Production health returned 200 at <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185>.

## Production authoring fixtures

The production authoring UI created and published template `REVIEW-3499-MITIGATION-TWO-FIXED-LINES` (`566a5bd6-2435-4818-b147-60edf805adbd`) with two distinct Fixed lines: Managed Workstation (`89e47435-bb9c-4d48-801c-91d80c1d4c4c`) and Cabling product (`edab1b08-848b-4946-8b1d-265dae4ee428`). Both map to separate client line IDs and distinct catalog services, proving same-method line targeting.

Clients A (`1992b9da-939c-4be1-a110-ed6356a5dd69`) and B (`ab0d087c-c435-42c8-90a3-256fd304f268`) were instantiated through the supported wizard. Contracts: A `8c28a27d-a433-4b3b-8de4-5bd373a21d35` / assignment `dbde35cf-559e-4259-9b25-392c7457e55a`; B `30f188a1-79c5-424b-bcc6-ac289a4dd8bc` / assignment `b30a81e6-a8c7-409a-b1a6-b88d9acc014b`. Client A's 8%, Client B's 10%, and post-instantiation template edits (12% plus fixed $25) were saved in the respective UI editors. Persisted definitions are independent. Screens: `two-fixed-line-template.png`, `template-after-edit.png`, `client-a-created.png`, `client-a-copy-edited.png`, `client-b-copy-retained.png`.

A separate Client A generation assignment was created via the wizard: contract `e4ec9f7f-7cb6-476e-8d54-493698067745`, assignment `ce560c5f-79c4-4eab-bb38-40f0bc72f644`, start 2026-09-01. Its copied defaults are 12% and fixed $25 starting 2026-09-01. Automatic Invoices shows its September period available and October period not yet due.

## Schema diagnosis and repair

The missing `time_tracking_sessions` relation came from a billing-shell StopwatchProvider read, not client creation. The actual wizard HTTP 500 was separately traced to `recurring_service_periods.obligation_type` remaining NOT NULL while current inserts no longer supplied it. Current migration `20261010120000_collapse_recurring_service_period_obligation_type.cjs` was missing from the review migration history. Preflight found zero key mismatches, collisions, double-billed rows, uniqueness collisions, or overlaps. It was applied via its migration module in configured non-transactional mode and recorded in batch 63; all 1004 rows remained and the obsolete column was dropped. No server was started and no shared fixture was reset. The wizard then succeeded.

## Automatic generation: attempted, blocked before invoice creation

Authenticated production Automatic Invoices was filtered to Client A and September. Supported Preview Selected reached invoice validation and reported: `REVIEW-3499-MITIGATION-CLIENT-A has no billing email. Set a billing contact, a client billing email, or an email on the billing or default location, then try again.` No invoice was created. Current-production fixed/percentage totals, settlement provenance/uniqueness, retry, persisted principal, ledger idempotency, manual-addition preservation, and PDF comparison remain unproven. The older development scope examples (-40500/364500 all-eligible; -39000/366000 this-contract) are not current-production generation evidence.

## Open Review pane repair

The named-pane failure was a remote browser registration/handoff race, not stale ID or host/space mismatch. Separate owning Alga Dev repo has fix commit `69cb91d`, including wake-refresh, timeout, and disappearance tests; preceding implementation commit is `df8e9c219b38049f60fca8bd332e698181ddc46`. Focused tests passed (25) and TypeScript passed using writable private `TMPDIR=/dev/shm/alga-dev-review-vitest`. Supported activation requires `npm run deploy:publish` from the Mac checkout per its fleet runbook. That checkout/release command is unavailable on this host; fleet activation and live absent/existing/repeated Open Review calls remain pending. No shared credentials were reset.

## Preserve delivered QBO history

`REVIEW-3499-QBO-NEXT` remains delivered: invoice `5a1e0000-0000-4000-8000-202610079004`, batch `3ac31e06-9479-4f5d-9c73-170a880d80d9`, simulator invoice `invoice-21`, total/principal 385000 minor units and simulator `TotalAmt`/`Balance` 3850. Do not unlock, reset, delete, or re-export. Existing proof is in `../final-rerun-0826/`.

## Entry links and cleanup

Template: <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=contract-templates&contractId=566a5bd6-2435-4818-b147-60edf805adbd>. Automatic invoices: <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=invoicing&subtab=generate>. A contract: <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=client-contracts&contractId=8c28a27d-a433-4b3b-8de4-5bd373a21d35>. B contract: <http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:23185/msp/billing?tab=client-contracts&contractId=30f188a1-79c5-424b-bcc6-ac289a4dd8bc>.

After review, remove only these review-owned contracts, clients, and template through supported UI after confirming no invoice history was created. Preserve shared fixtures, billed periods, QBO history, and shared credentials.
