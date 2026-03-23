# Follow-on Boundary — Cross-Domain Service-Period Ledger Extension

## Boundary

Recurring v1 materializes future service periods only for recurring contract-backed obligations.

The ledger does not automatically extend to:

- time-entry billing
- usage-record billing
- materials or one-off charges
- manual invoices, credits, or prepayment artifacts

## Why This Is A Separate Follow-on

Those domains do not share the same truth source:

- recurring obligations are schedule-driven
- time and usage are event-driven
- manual and financial-only artifacts are document-driven

Forcing them onto the recurring ledger before recurring v1 stabilizes would blur those truth boundaries and make billed-through, duplicate prevention, and repair semantics harder to explain.

## Trigger To Reopen

Reopen this follow-on only after recurring v1 proves:

- future materialization is stable
- regeneration and preserved-edit conflict handling are operationally understandable
- invoice linkage and billed-history immutability are reliable

## Questions The Follow-on Must Answer

- whether time and usage receive their own materialized-period ledger or only a projection
- how event timestamps map to canonical periods without corrupting event truth
- whether manual financial artifacts stay periodless, keep financial-date semantics, or gain a separate ledger concept
- which downstream readers pivot to cross-domain period truth versus staying on financial or event dates
