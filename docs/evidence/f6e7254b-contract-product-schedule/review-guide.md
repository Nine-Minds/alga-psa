# Review PR #3492: permanent quantity changes and invoice true-ups

Start with an isolated monthly, in-advance or in-arrears contract containing
10 seats at $100 per seat and a 10% automatic contract discount. Use an unbilled
30-day service period. The review application must run the repair commit;
screenshots from September 23 show the earlier boundary-only implementation.

1. Open the contract line's **Schedule recurring change & history** panel.
   Confirm boundary-only scheduling is the default.
2. Opt in to the mid-period true-up, change quantity to 13, and choose the 16th
   of the unbilled period. Preview the impact. Expect one charge for
   `3 × $100 × 15/30 = $150`, the affected period, and before/after totals.
3. Generate or refresh the eligible draft. With no other items and no tax,
   the original $1,000 plus the $150 true-up less $115 discount totals $1,035.
   Confirm there is exactly one source-linked `contract_change` charge.
4. Refresh again. The charge, discount and total must not duplicate or change.
5. Bill the next service period. Standing quantity is 13, gross is $1,300,
   and the 10% discount leaves $1,170 before tax. The true-up does not recur.
6. Inspect history and an earlier invoice. Their quantities and amounts remain
   unchanged. Check a decrease and zero separately; zero stops the recurring
   item without deleting its history.

For credits, verify the credit reduces the invoice total but does not reduce
the positive base used by the automatic percentage discount. For a pending
revision cancellation, verify the draft adjustment disappears and its discount
is recalculated. A finalized invoice must remain unchanged.

## Settlement checks

- Two editable drafts with equal windows still have only one settlement owner.
- A different client, currency, contract assignment or absent line cannot claim
  the event. A future affected period cannot land on an earlier draft.
- A carry-forward retains its original affected dates. Adjustment provenance
  is half-open; detail/discount coverage ends on the previous day.
- Catalog currency rates, explicit boundary price overrides and delayed billing
  use the effective history, not today's configuration.

## Live evidence status

The review endpoint `http://100.109.101.64:23029/api/health` was unreachable
during this takeover. The app server was not started. Changed-artifact live UI
smoke remains incomplete; automated results are recorded separately in README.md.
Capture the deployed commit, screenshots, revision/version, invoice IDs, true-up
math, discount, tax and next-period quantity when the review app is available.
