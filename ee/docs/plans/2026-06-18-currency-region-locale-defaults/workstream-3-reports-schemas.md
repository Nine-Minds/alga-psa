# Workstream 3 — Report & schema USD hardcodes

**Owner:** agent-reports
**Goal:** Two distinct problems: (a) report metric *definitions* hardcode `currency: 'USD'` so every report
renders USD regardless of tenant; (b) Zod schemas bake `.default('USD')` so API/worker-created records get
USD before settings are ever consulted. Fix (a). For (b), recommend the right call (DD-2) and apply the
safe version.

**Owned files (edit only these):**
- `packages/reporting/src/lib/reports/definitions/contracts/revenue.ts`
- `packages/reporting/src/lib/reports/definitions/contracts/expiration.ts`
- `packages/reporting/src/lib/reports/definitions/contracts/profitability.ts`
- `packages/reporting/src/lib/reports/definitions/billing/overview.ts`
- `server/src/lib/api/schemas/quoteSchemas.ts`
- `server/src/lib/api/schemas/productSchemas.ts`
- `packages/billing/src/schemas/quoteSchemas.ts`
- `packages/billing/src/models/service.ts`

**Reference (read, don't edit):**
- `packages/billing/src/actions/billingCurrencyActions.ts` → `resolveClientBillingCurrency` (the resolver).
- How report definitions receive context (look for where `formatting`/`currency` is supplied to a metric;
  the engine — owned by WS1 — reads `formatting.currency`). The fix is to make definitions pull currency
  from the tenant default / report context rather than a literal.

## Tasks — Reports (fix)

- [x] **revenue.ts** (2 sites: `total_monthly_revenue`, `ytd_total_billed`) — removed `currency: 'USD'`
      from both currency `formatting` blocks. `currency?` is optional in `FormattingOptions`; with the
      literal gone the ReportEngine's `formatting.currency || 'USD'` fallback (WS1-owned) takes over and is
      the single point where the tenant default should be sourced. No new plumbing invented (definitions are
      static objects with no context object — DD route via `formatting.currency` per the doc).
- [x] **expiration.ts** (1 site: `expiring_contracts_revenue`) — same fix.
- [x] **profitability.ts** (3 sites: `ytd_total_revenue`, `ytd_total_labor_cost`, `ytd_gross_profit`) —
      same fix. (The other 2 metrics are `percentage`, not currency.)
- [x] **overview.ts** (3 sites: `monthly_revenue`, `outstanding_amount`, `total_credit_balance`) — same fix.
- [x] Per-report currency without a context object is not reachable from a static definition. Removing the
      literal routes all currency resolution to the engine's `formatting.currency` fallback (WS1), which is
      the agreed last-resort/tenant-default point. Mixed-currency tenants remain out of scope. NOTE: a
      parallel legacy copy of these definitions exists under `server/src/lib/reports/definitions/` (also
      hardcoding `'USD'`) — NOT in this workstream's owned files, left untouched; flag for follow-up if it is
      still wired anywhere.

## Tasks — Schemas (DD-2: recommend, then apply safe version)

- [x] **server/src/lib/api/schemas/quoteSchemas.ts** (line 89) — **KEPT default, flagged.** Recommended fix
      (drop + `.optional()`) was NOT applied because no downstream action resolves currency. Call site:
      `ApiQuoteController` → `QuoteService.create` (server/src/lib/api/services/QuoteService.ts:152) → spreads
      `quoteData` straight into `Quote.create` with NO `resolveClientBillingCurrency()` call. Dropping the
      default would persist NULL `currency_code` on API-created quotes. Added an inline DD-2 comment.
- [x] **server/src/lib/api/schemas/productSchemas.ts** (lines 29 `currencyCodeSchema`, 51 `cost_currency`) —
      **KEPT both defaults, flagged.** Call site: `ApiProductController` → `ProductCatalogService.create`
      (server/src/lib/api/services/ProductCatalogService.ts:187) inserts the validated data directly, no
      resolver. Products are tenant-scoped (no `client_id`) so `resolveClientBillingCurrency()` doesn't even
      apply — correct source is the tenant default, which a static schema can't read. Dropping → NULL
      currency on API-created products. Added inline DD-2 comments.
- [x] **packages/billing/src/schemas/quoteSchemas.ts** (line 38) — **KEPT default, flagged.** Call site:
      `quoteActions.ts` `createQuote` (packages/billing/src/actions/quoteActions.ts:445) parses with this
      schema then passes the result straight to `Quote.create` with no resolver. Dropping → NULL currency on
      created quotes. Added inline DD-2 comment.
- [x] **packages/billing/src/models/service.ts** (line 65) — **KEPT default, flagged.** This schema does
      double duty (validates DB read rows AND create input). The create path already falls back independently
      (`Service.create` line 341: `cost_currency: validatedData.cost_currency ?? 'USD'`) and the DB column
      itself `defaultTo('USD')`, so the default isn't load-bearing for create. Removing it would change the
      READ path (NULL `cost_currency` rows would surface as null instead of coerced 'USD') with no benefit and
      no resolver to source a tenant default — so kept as documented last-resort. Added inline comment.

  **DD-2 recommendation (summary):** The doc's preferred fix (drop `.default('USD')`, make `.optional()`,
  let the action layer resolve via `resolveClientBillingCurrency`) is the RIGHT end state, but it is **not
  safe to apply yet**: `resolveClientBillingCurrency` is currently only *defined* (in
  `packages/billing/src/actions/billingCurrencyActions.ts`) and **never called** anywhere in the quote or
  product create chains. WS4 owns wiring it into creation. Until WS4 lands, every call site above would
  receive `undefined`/NULL currency if the default were dropped. **Therefore all four files keep the default
  and are flagged ⚠.** Re-run this drop-and-optional change as a fast follow once WS4 confirms creation
  populates currency.

## Verification

- [x] Type-check `reporting`, `billing`, and `server` schema usages where quick, or confirm by inspection.
      Ran `npx tsc --noEmit -p tsconfig.json` in `packages/reporting` → **exit 0 (clean)**. This covers the
      4 report-definition edits (the only logic change — removing an optional `currency` property). The
      schema edits in `server/` and `packages/billing/` are **comments-only** (no Zod logic changed), so they
      cannot affect type-checking; confirmed by inspection.
- [x] Grep the owned files: no remaining literal `'USD'` except documented last-resorts. Report defs: only a
      single explanatory comment line in `revenue.ts` mentions 'USD'. Schemas: the four `.default('USD')`
      sites remain, each with an inline DD-2 justification comment.

## Notes (agent fills in)

**Reports (fixed):** Removed `currency: 'USD'` from all 9 currency-`formatting` blocks across the 4 owned
report definitions (revenue ×2, expiration ×1, profitability ×3, overview ×3). `FormattingOptions.currency`
is optional, so the definitions no longer force USD; the ReportEngine's `formatting.currency || 'USD'`
fallback (WS1-owned) is now the single point that should source the tenant default. No new plumbing path was
invented — static definitions have no context object, matching the doc's guidance to route via the
`formatting.currency` path WS1 owns. ReportEngine files were NOT touched (other agent's ownership).

**Schemas (recommended, kept safe):** All four schema defaults were KEPT and flagged ⚠, not dropped. The
doc's preferred drop-and-`.optional()` fix is correct in principle but unsafe today: `resolveClientBillingCurrency`
is defined but never invoked in any quote/product create chain (verified by grep across `server/src` and
`packages/billing/src`). WS4 owns wiring the resolver into creation. Dropping the defaults now would persist
NULL currency at creation for API quotes (`QuoteService.create`), billing quotes (`createQuote` action), and
products (`ProductCatalogService.create`); for `service.ts` it would additionally change the DB-read path.
Each site has an inline DD-2 comment naming the exact caller. Recommended follow-up: re-do the
drop-and-optional change after WS4 confirms creation populates currency.

**Deferred / risk flags:**
- Parallel legacy report definitions exist under `server/src/lib/reports/definitions/` (revenue/expiration/
  profitability/overview) that ALSO hardcode `currency: 'USD'`. They are NOT in this workstream's owned-files
  list, so they were left untouched. If those are still wired anywhere, they will continue to force USD — flag
  for a follow-up workstream / ownership assignment.
- `Service.create` (packages/billing/src/models/service.ts:341) has a pre-existing hardcoded
  `cost_currency: validatedData.cost_currency ?? 'USD'`. It is code (not a Zod default) and pre-dates this
  work; left as-is. Belongs to the WS4 currency-at-creation effort.

**Commands run:** `npx tsc --noEmit -p packages/reporting/tsconfig.json` → exit 0. No git add/commit/push;
changes left uncommitted.

---

**DD-2 / F-2 resolution (follow-up agent — schema defaults now dropped + create paths wired):**

The "kept safe" recommendation above is now actioned. The currency resolver is no longer routed through the
`resolveClientBillingCurrency` withAuth action (which would double-resolve auth/tenant and throws on
multi-currency contracts); instead each create path replicates the precedence with a direct, tenant-scoped
`knex`/`trx` read of `default_billing_settings.default_currency_code` (and `clients.default_currency_code`
for quotes), mirroring the WS4 pattern in `packages/billing/src/actions/manualInvoiceActions.ts`.

- **Defaults dropped → `.optional()` (no static 'USD'):**
  - `server/src/lib/api/schemas/quoteSchemas.ts` — `currency_code`
  - `server/src/lib/api/schemas/productSchemas.ts` — `currencyCodeSchema` (product `currency_code`) and `cost_currency`
  - `packages/billing/src/schemas/quoteSchemas.ts` — `currency_code`
- **Create paths wired (resolve + set explicitly before insert):**
  - `server/src/lib/api/services/QuoteService.ts` `create()` — client-scoped precedence:
    `input.currency_code || clients.default_currency_code (for the quote's client_id) || default_billing_settings.default_currency_code || 'USD'`; sets `currency_code` on the `Quote.create` payload.
  - `packages/billing/src/actions/quoteActions.ts` `createQuote` — same client-scoped precedence using the in-scope `knex`; sets `currency_code` on the `Quote.create` payload.
  - `server/src/lib/api/services/ProductCatalogService.ts` `create()` — tenant-scoped precedence:
    `input.cost_currency || default_billing_settings.default_currency_code || 'USD'`; sets `cost_currency` on the `service_catalog` insert.
- **Kept-and-flagged:**
  - `packages/billing/src/models/service.ts` — `cost_currency` `.default('USD')` **kept**. This schema does
    double duty (validates DB-read rows *and* `Service.create` input). Its two create consumers can't be wired
    to the tenant default without touching out-of-scope files: (1) `Service.create` hard-codes
    `cost_currency: validatedData.cost_currency ?? 'USD'`, so dropping the default still yields 'USD' rather
    than the tenant default unless `serviceActions.ts createService` (out of scope) resolves upstream; and
    (2) `ProductCatalogService.create` does not use this schema at all. Dropping it would also regress the
    READ path (NULL `cost_currency` rows would surface as `null`). Comment updated in place to record this.
- **Verified non-issue (no edit needed):** `createQuoteFromTemplate` (quoteActions.ts) sources
  `currency_code: input.currency_code ?? template.currency_code`; template rows always carry a populated
  `currency_code`, so dropping the schema default does not leave currency unset there.

**DB column-default findings (verified in `server/migrations/`):**
- `quotes.currency_code` — `NOT NULL DEFAULT 'USD'` (`20260320100000_create_quotes_tables.cjs`). Confirms an
  unset value would silently persist as USD → resolution set explicitly at create.
- `service_catalog.cost_currency` — `nullable DEFAULT 'USD'` (`20260107190000_add_cost_currency_to_service_catalog.cjs`).
- `default_billing_settings.default_currency_code` — `NOT NULL DEFAULT 'USD'` (`20260401120000_add_default_currency_to_billing_settings.cjs`).
- `clients.default_currency_code` — `NOT NULL DEFAULT 'USD'` (`20251118134500_add_multi_currency_support.cjs`).
- Note: `service_catalog` has **no** `currency_code` column (only `cost_currency`); the product schema's
  `currency_code` field is not a `service_catalog`/`IService` column, so product currency resolution targets
  `cost_currency`, the only real currency column on that table.
