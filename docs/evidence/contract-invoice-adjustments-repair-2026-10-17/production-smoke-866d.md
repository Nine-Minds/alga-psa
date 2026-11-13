# Contract invoice repair smoke, 2026-10-17

**Result: PASS** for the repair smoke on build `866d98ffeac18cbf612580f59654621b01478d79`. Production health reports the expected build identity, and Open Review reaches its authenticated Billing pane. One Open Review attempt timed out; retry succeeded.

The real QA UI verified expanded charge save, same-invoice reselection, a 10% discount, immediate recalculation after a later charge, and stable ledger postings on repeat save. A controlled session expiry preserved pending edits; signing in again and explicitly retrying saved them. Invoice preview, the actual PDF, and database totals agree. Finalized invoice controls, portal dates, and true-up explanations passed.

The smoke used a database-cloned fixture and real application UI, with no mocks. Owned fixtures were cleaned up, and shared invoice history was unchanged.

The smoke did not rerun fresh invoice generation, accounting exports, companion scheduling, or the full tax and currency matrix.

Evidence directory: `/tmp/alga-smoke-evidence/contract-review-866d-20261017-2203`.
