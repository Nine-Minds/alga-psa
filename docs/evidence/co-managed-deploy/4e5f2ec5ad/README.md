# Deploy-fix acceptance at 4e5f2ec5ad (production build-1793009958637)

Candidate `4e5f2ec5ad` ("offer Enable only where client setup is actually open") was served by the board-admitted `review-app` as a production build. Its stamp is `4e5f2ec5ad…+da39a3ee5e6b` (clean tree), its dist is `server/.next-review-final-4e5f2ec5`, and it answered at `http://feature-co-managed-it.localhost:23374`. Both workers were rebuilt at the same HEAD and cold-restarted. Provenance, PIDs and hashes are in [runtime-provenance.json](runtime-provenance.json).

All actions went through the real UI in the card browser:
- **QA** (`qa@emeraldcity.oz`) signed in through Open Review.
- **Alice** (White Rabbit IT) and the **Kansas Farms admin** signed in through the app's own credential endpoints.

Database reads used the card's `server_co_managed`. Email was read from the local SMTP sink simulator. No Stripe, Graph or other external provider was used.

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Header action: active White Rabbit and ended Kansas show no Enable; not-enabled clients show one Enable | **pass** | [01-header-action](01-header-action/) |
| 1b | Summary refreshes after a seat change (1→2→1) without a reload | **pass** | [01-header-action](01-header-action/) |
| 2a | Fresh invoice generation (INV-000004, $30.00) excludes INV-000003's 17 entries; nothing is offered twice | **pass** | [02-billing/receipt.md](02-billing/receipt.md) |
| 2b | Contract-rate billing of new approved time dated in the already-billed October period | **fail (native, pre-existing)** | [02-billing/receipt.md](02-billing/receipt.md) |
| 3 | T09: audiences across in-app, email and requester delivery; internal notes reach requesters 0 times; requester control delivered exactly once | **pass** (portal, search and export not run) | [03-t09-privacy](03-t09-privacy/) |
| 4 | T13: customer operational time, MSP commercial time and approval, native billing of co-managed time | **pass for the exercised clauses**; MSP edit and native-only regression not run | [04-t13-time](04-t13-time/), [02-billing](02-billing/) |
| 5 | F003: stale-revision write rejected; ended workspace keeps reads and offers no writes | **pass** (UI level; direct write probes not re-sent) | [05-f003-stale-and-state](05-f003-stale-and-state/) |
| 6 | T009: onboarding Retry after a lost response recovers the same operation | **pass** | [06-t009-onboarding-retry](06-t009-onboarding-retry/receipt.md) |
| 7a | Revoked delegated approval shows its reason, with no retry and no write | **pass** | [07-latest-fixes/revoked-delegation](07-latest-fixes/revoked-delegation/receipt.md) |
| 7b | Archive snapshot dedup: no duplicate retained rows after a sharing-reduction snapshot | **pass** (closure finalizer path not run) | [07-latest-fixes/archive-snapshot-dedup](07-latest-fixes/archive-snapshot-dedup/receipt.txt) |
| 7c | Dormant board grants: escalation_only keeps the grant but hides it; board_scope re-admits | **pass** | [07-latest-fixes/dormant-board-grants](07-latest-fixes/dormant-board-grants/receipt.txt) |

Two items are blocked by external resources: hosted purchase needs a real Stripe price, and self-host capacity needs a signed licence and installation. The customer-integration rows also still need an approved Entra application, SCIM, an inbound mailbox and a destination paid entitlement. None of these were available to this run.

## Findings

- **Billing (native, pre-existing, outside this branch).** Approved hourly time dated inside an already-billed service period is silently excluded from billing. It produces no row, warning or adjustment, and reversing the existing invoice is the only remedy. The cause is `loadTimeBasedObligation`, which bounds time by the service period (`packages/billing/src/lib/billing/billingEngine.ts:5360-5362`). This branch does not change that selection logic.
- **Billing UI.** Automatic Invoices defaults its date filter to "to today". As a result, arrears periods and cycles that end after today are hidden until the filter is widened.
- **Co-managed time.** The ticket Quick Invoice path accepts only `work_item_type = 'ticket'`, so it cannot bill `co_managed` entries.
- **Stale revision message.** A stale access-policy save is refused correctly, but the message is the generic "Could not confirm the save… reload current access". It does not name the conflict.

## Data changes and their reversal

These changes were reverted:
- Ticket 000016 assignment, both customer and MSP sides.
- White Rabbit `escalation_only`, set back to `board_scope`. The relationship revision counter moved from 82 to 86 and cannot be rewound.
- Seat allocation, back to 1.
- Client contract, set inactive again, and the billing email, cleared again.
- Draft INV-000004, reversed.
- Timesheet approval, reversed. The sheet is now `CHANGES_REQUESTED`, because `DRAFT` can't be reached through the UI after a submission.
- The 30-minute MSP test entry, deleted.
- The disposable approval team, deleted.
- The onboarding test setup, cancelled with its seat released.
- The test delegated approval, revoked.

These remain:
- Seven `DEPLOY-4E5F-*` comments on ticket 000016 in the customer store.
- Two MSP-private notes in the Oz store.
- One requester-control email, plus native assignment emails, in the local sink.
- Alice's 10-minute zero-billable operational entry `d54ee563`. The UI can only delete it together with an older guide entry, so it was kept.
- One cancelled setup on "CM-REVIEW-20261026-01 Cancel".

The final state is in [final-state.txt](final-state.txt). White Rabbit is active with `board_scope` and 1 seat. Kansas is terminated. The workflow paused state was not touched.

## Requirement census

Attribution is in [requirement-attribution.json](requirement-attribution.json).
- Only `clientIntegration:F010` qualifies for promotion: every clause was exercised on this build.
- The other rows touched here remain `implemented-unverified`, with the remaining clauses named.
- The historical 1001ffe86b manifest is unchanged.
