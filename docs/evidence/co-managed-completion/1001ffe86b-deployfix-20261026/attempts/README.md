# Superseded attempts in this round

- `build-1792995121422/` (source 238627579d): ticket delete and the empty Scheduled work link gaps.
- `build-1792998882649/` (source 415019b46c): direct checklist / external-link / optimized-comment writes
  succeeded from the ended workspace; other writers found unguarded by review.
- Source 9f87789071: the board build failed in webpack (an error mapper imported the server lifecycle
  module into a client bundle), so nothing was served; fixed in 1001ffe86b.

The ledger (`manifest.json`, `attribution-decisions.json`) attributes only runs on the final build.
- `build-1793002032501/09-billing-attempt-1-no-billing-email/` (final build): the first guide 09 run removed the
  workaround price, reversed INV-000002 and restored the contract, then the preview refused because White Rabbit
  had no billing email (cleared by guide 09's earlier restore). Its `db-before.json` is the original state. The
  attributed `guides/09-billing/` run sets and later clears the billing email and completes the flow.
