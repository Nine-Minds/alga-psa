# Show product price and cost where contracts are built; stop the wizard losing catalog prices

Card `1f4dfd8e` · PSA `alga-2026-0002714` (`84feb4ad-04f1-4040-8565-1ee8703220c4`)

## Two defects, one cause

**The bug.** `ProductsStep.tsx` keeps the catalog price in two local maps keyed by **row index**:
`currencyRates` (line 24) and `legacyDefaultRates` (line 26), filled only inside `handleProductChange`.
They are never seeded from `data.product_services`, which already carries `currency_rate` and
`default_rate`. `ContractWizard` renders steps through a `switch` on the current step, so `ProductsStep`
**unmounts on every step change** — coming back shows every product as "No AUD price in the catalog" and
the red "This product has no default price and no override…" alert even when the catalog has the price.
Removing a row shifts the index-keyed values onto the wrong rows.

**The ask.** Lynda cannot see the saved price (and cost) while building the contract, nor the unit price
on the Contract Lines tab, so she cannot tell whether the pricing is right or worth overriding. On
Contract Lines a catalog-priced member renders `formatRate(null)` → "Unit Rate N/A".

The common cause is the same: **the screens derive price from parallel local state instead of from the
draft and the shared resolver.** Fix that once and both symptoms go.

## Direction

### 1. The draft is the only price state

Delete `currencyRates` / `legacyDefaultRates`. Render each row's price from `data.product_services[i]`
(`currency_rate`, `default_rate`) — the draft already holds what will be written. Key rows by
`service_id`, not array index, so removal cannot shuffle prices.

For rows whose draft has no `currency_rate` (a resumed draft, or a product added before this change),
resolve with **the same lookup the Review step uses** — one shared hook, e.g.
`useProductCatalogRates(contractCurrency, productIds)` wrapping `getServiceCatalogRatesForCurrency` —
so Products and Review can never disagree. The hook caches per currency and returns
`{ currency_rate, default_rate, cost, cost_currency }` per service.

### 2. Show price *and cost* on the Products step

Beside each product's price/override field: the catalog price in the **contract currency**, the **cost**
(`service_catalog.cost` / `cost_currency`, already returned by the picker query), and the override field.
Show margin only if it falls straight out of those two numbers in the contract currency; do not invent a
pricing model, and do not convert between currencies.

**Cost is internal.** Before rendering it, find the existing permission/setting that already governs
cost visibility in the service catalog and follow it (implementation task: grep the catalog cost column
and its permission). Never render cost on a client-facing surface. If no permission gating exists yet,
gate on the same permission the service catalog uses for editing cost, and note it in the PR.

### 3. Contract Lines tab shows the effective unit price

In `ContractLines.tsx`, a catalog-priced unit member currently calls `formatRate(null)`. Resolve the
**effective unit price through the shared resolver**
(`resolveRecurringMemberRate` / `resolveEffectiveLineRate` in
`shared/billingClients/recurringMemberRate.ts`) — the same chain the invoice engine uses — and render:

- the effective unit price in the contract currency;
- a **source label**: "catalog" vs "override" (so overriding is a visible decision, not a mystery);
- the cost alongside, under the same visibility rule as §2.

Where the line is a fixed fee, keep showing the period total as it does today; this changes the unit
member display only.

### 4. Currency

Contract currency everywhere. If `cost_currency` differs from it, **label** the cost currency rather than
converting. Reuse `formatMinorCurrency` / the existing currency controls; never hardcode `"USD"` or a
symbol.

### 5. i18n

New keys under `wizardReview.products.*` / `contractLines.pricing.*` for "catalog price", "cost",
"override", "catalog", "margin". Add every one to **every** locale pack in the same commit — the locale
and `artifact-drift` checks fail a half-translated set.

## Coordination

`ContractLines.tsx` is also touched by the stacked cards `c319eda8` (base_rate_basis constraint) and
`085ecc17` (transactional save). This card changes **display only**: no write path, no `handleSaveContractLine`
changes. Rebase on those branches as they land; if a conflict is in the save path, this card takes theirs.

## Deliberately not doing

- No new pricing model, no margin percentage column, no client-facing price/cost exposure.
- Not changing how a price is stored or which rate wins on write — display follows the resolver.
- Not converting cost between currencies.
- Not replacing the Products step's picker; only its price derivation.

## Tests

- `ProductsStep`: pick products → go to another step → come back; the catalog price still shows and no
  missing-price warning appears. Remove the first of three products; the remaining rows keep their own
  prices (regression for the index-keyed bug).
- A resumed draft without `currency_rate` is priced through the shared lookup (same value the Review step
  shows).
- Contract Lines: a catalog-priced product member shows its catalog unit price (not N/A), is labelled
  "catalog", and shows cost; an overridden member shows the override and is labelled "override".
- Cost is absent for a user without the cost-visibility permission.
