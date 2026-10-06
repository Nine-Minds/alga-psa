# Scratchpad — Quote currency default propagation and source visibility

- Plan slug: `2026-09-21-quote-currency-default-source`
- Created: 2026-09-21
- Card: `alga-2026-0002520`

## Decisions

- (2026-09-21) Do not add a client-currency provenance column in this card.
  Historical rows cannot be backfilled exactly. On a tenant currency change,
  treat clients whose stored value equals the old tenant default as followers;
  preserve all distinct values and disclose this matching rule in the UI.
- (2026-09-21) Keep propagation atomic with the tenant settings write inside
  `updateDefaultBillingSettings`; do not launch a background job or make a
  second client-side mutation.
- (2026-09-21) Keep existing quotes and business templates immutable when
  defaults change. Their persisted `currency_code` remains authoritative.
- (2026-09-21) Currency source on `QuoteForm` is transient presentation state,
  modeled as an explicit union. It is not a new quote column.
- (2026-09-21) Client changes re-default currency only for a new quote. Editing
  an existing quote retains the saved currency to avoid relabeling existing
  line-item amounts.
- (2026-09-21) Template currency continues to win when a business template is
  applied; the source label makes that precedence discoverable.
- (2026-09-21) Limit the magnitude fix to the identified Quote Detail summary
  fields. Audit of other money-formatting paths is separate work.

## Discoveries / Constraints

- (2026-09-21) `server/migrations/20251118134500_add_multi_currency_support.cjs`
  made `clients.default_currency_code` non-null with a USD default.
- (2026-09-21) `packages/clients/src/actions/clientActions.ts` copies the tenant
  default (then USD) during normal client creation and CSV creation, so null
  cannot currently represent inheritance.
- (2026-09-21) `packages/billing/src/actions/billingSettingsActions.ts` already
  uses partial-key writes so independent settings sections do not clobber each
  other. Client propagation must be gated by
  `has('defaultCurrencyCode')` to preserve that guarantee.
- (2026-09-21) `packages/billing/src/actions/quoteActions.ts` resolves an omitted
  quote currency as client default, tenant default, then USD. It writes the
  result explicitly because the quote column itself defaults to USD.
- (2026-09-21) `packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx`
  currently loads the tenant default in a separate effect, initializes new
  forms from it, and always submits a concrete currency. Client selection does
  not currently re-default the currency.
- (2026-09-21) The same form intentionally makes business-template currency
  authoritative in `handleTemplateChange`, and
  `createQuoteFromTemplate` falls back to `template.currency_code`.
- (2026-09-21) Quote renderers and adapters consume the persisted quote
  currency; no hard-coded renderer change is needed.
- (2026-09-21) `QuoteDetail.tsx` passes minor-unit summary values directly to
  the major-unit `useFormatters().formatCurrency` API at the identified summary
  block. Form-side total formatting already divides by 100.
- (2026-09-21) The worktree had a pre-existing `package-lock.json` modification
  before planning. It is unrelated and must not be staged with this plan or
  implementation commits.

## Likely Implementation Touchpoints

- `packages/billing/src/actions/billingSettingsActions.ts`
  - old/new effective currency resolution
  - tenant-scoped compare-and-propagate update
  - action result counts and transaction locking
- `packages/billing/src/components/settings/billing/DefaultCurrencySettings.tsx`
  - explanatory copy and count-aware success feedback
- `packages/billing/src/components/settings/billing/BillingSettings.tsx`
  - surrounding description if the explanation belongs at card level
- `packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx`
  - deterministic default resolution, source state, source helper, client and
    template transitions
- `packages/billing/src/components/billing-dashboard/quotes/QuoteDetail.tsx`
  - minor-to-major conversion for summary values
- `packages/billing/tests/billingSettingsActions.defaultCurrency.test.ts`
  - action behavior and partial-save regression
- a DB-backed billing-settings action integration test
  - real tenant-scoped update and rollback behavior
- `packages/billing/tests/quote/QuoteForm.test.tsx`
  - source/preference transitions
- `packages/billing/tests/quote/quoteActions.test.ts`
  - create fallback precedence
- `packages/billing/tests/quote/quoteDetail.test.tsx`
  - factor-of-100 regression

## Commands / Runbooks

- Validate plan shape:
  `python /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-09-21-quote-currency-default-source`
- Focused tests during implementation:
  `npx vitest run packages/billing/tests/billingSettingsActions.defaultCurrency.test.ts packages/billing/tests/quote/QuoteForm.test.tsx packages/billing/tests/quote/quoteActions.test.ts packages/billing/tests/quote/quoteDetail.test.tsx`
- Inspect only planned changes before committing:
  `git diff -- ee/docs/plans/2026-09-21-quote-currency-default-source`

## Links / References

- Internal card: `alga-2026-0002520`
- Base inspected: `2dc8454a4c`
- Existing currency design notes:
  `ee/docs/plans/2026-06-18-currency-region-locale-defaults/`
- Related business-template behavior plan:
  `ee/docs/plans/2026-09-12-quote-template-instantiation/`

## Open Questions

- No implementation blocker. If exact inheritance provenance is required later,
  design a client-level “use tenant default” mode and migrate provenance as a
  separate feature rather than inferring it silently here.
