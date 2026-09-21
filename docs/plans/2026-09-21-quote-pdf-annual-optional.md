# Quote PDF: cadence-aware grouping + Optional items (alga-2026-0002383)

**Card:** `0bddd1cf-57e7-4810-875e-b0677ba5d868`
**Branch:** `feature/quote-pdf-annual-cadence-grouped-as-monthly-and`
**Date:** 2026-09-21
**Desk:** Design Session (conn), delegated by XO. This document is the implementation
spec. It is written from a fresh read of the code in this worktree; the "Draft
Implementation" step builds to this plan.

**Ticket:** Ryan Hoffmann (FTS Technology). A quote with one-time, monthly-recurring,
one annual-recurring, and several Optional lines renders wrong on the **Standard Quote
Grouped** PDF: the $159/yr annual line is listed under "Monthly Items" and folded into
"Monthly Total", and Optional lines are indistinguishable from required lines and are
counted in the Monthly/One-Time totals, overstating the base price. Customer is blocked
sending a real quote.

---

## Problem (confirmed by code read)

### Defect 1 — annual cadence rendered as monthly
The view-model builder partitions line items into `recurring_items` vs `onetime_items`
**solely on the `is_recurring` boolean and never inspects `billing_frequency`**:
`buildCadenceCollections` (`packages/billing/src/lib/adapters/quoteAdapters.ts:310-349`,
partition at `:341-345`), consumed at `mapLoadedQuoteToViewModel:547-549` and emitted as
`recurring_items` / `recurring_subtotal` / `recurring_total`
(`quoteAdapters.ts:593-602`). The grouped template then renders `recurring_items` under a
hard-coded **"Monthly Items"** header
(`packages/billing/src/lib/quote-template-ast/standardTemplates.ts:540-560`) and labels
`recurringTotal` **"Monthly Total"** (`standardTemplates.ts:604-607`). So any annual (or
quarterly / semi-annual) recurring item lands in the monthly table and monthly total.
`billing_frequency` is already carried end-to-end on the item
(`packages/types/src/interfaces/quote.interfaces.ts:229`; mapped at
`quoteAdapters.ts:105`) — only the grouping ignores it. (The editor sidebar's
per-month figure already filters to `billing_frequency === 'monthly'` —
`quoteLineItemDraft.ts:326-332` — proving the field is populated and reliable.)

### Defect 2 — Optional items not distinguished, and counted in base totals
The single inclusion rule `isQuoteItemIncluded` (`quoteAdapters.ts:54-57`; mirrored as
`isItemIncluded` in `quoteCalculationService.ts:57-60` and `included` in
`quoteLineItemDraft.ts:202-204`) treats an optional line as **included whenever
`is_selected === true`**. Optional-and-selected lines therefore contribute to the group
subtotals (`buildQuoteGroupSummary:356-367`) and to the overall derived totals
(`quoteAdapters.ts:561-565`) exactly like required lines, and the grouped template has no
"Optional" marker or section at all — the `is_optional` column exists only on the
**Detailed** template (`standardTemplates.ts:364`). Result: optional lines look identical
to required lines and inflate Monthly / One-Time totals, matching Ryan's report.

### How the grouped template is reached (scope note)
Grouped is **not** in the auto-fallback (`templateSelection.ts:166-180` picks only
`standard-quote-by-location` or `standard-quote-default`). A quote renders grouped only
when a tenant/quote explicitly assigns `standard-quote-grouped`
(`resolveQuoteTemplateAst:99-159`). Ryan's tenant has done so.

---

## Architecture as-is (the pipeline, for the implementer)

- **View model** `QuoteViewModel` / `QuoteViewModelLineItem`
  (`packages/types/src/interfaces/quote.interfaces.ts:208-315`) — built by
  `mapLoadedQuoteToViewModel` (`quoteAdapters.ts:500-615`) from DB rows. This is the single
  data object every quote render binds against (PDF, designer preview, template preview).
- **Bindings** map bindingId → view-model path
  (`packages/billing/src/lib/quote-template-ast/bindings.ts`): value bindings `:7-57`
  (incl. `recurringSubtotal→recurring_subtotal` …), collection bindings `:59-70`
  (`recurringItems→recurring_items`, `onetimeItems→onetime_items`,
  `groupsByLocation→groups_by_location`).
- **Templates** (code source of truth) `standardTemplates.ts` —
  `buildStandardQuoteGroupedAst:444-661`; the by-location band pattern we will mirror is
  `buildStandardQuoteByLocationAst:674-895` (repeating `location-bands` stack over
  `groupsByLocation`, each band = header + `dynamic-table` bound to `group.items` + a
  per-group subtotal row, `:777-818`).
- **Discount allocation (PR #3359)** `quoteDiscountAllocation.ts` — pure
  `allocateQuoteDiscounts(bases, discounts)` (`:110-200`). Each base carries a binary
  `isRecurring` (`:45`); the result reports per-base `allocations[]` (`:71`,
  `baseItemId`+`amount`+`isRecurring`) plus convenience `recurringAmount`/`onetimeAmount`
  aggregates (`:73-76`). Shared by the adapter (`resolveQuoteItemDiscounts:265-299`), the
  persisted recalc (`quoteCalculationService.ts:62-91`) and the editor draft
  (`quoteLineItemDraft.ts:228,274,314`).
- **Rendering** `pdfGenerationService.getQuoteHtml` (`:984-1027`) resolves the AST live per
  render (`resolveQuoteTemplateAst`), localizes label nodes via
  `localizeTemplateAstForLocale` (`i18nLabels.ts`, applied around `:778/814/1013`), then
  `evaluateTemplateAst` binds the view model. **Locale labels come from the AST i18nKey
  nodes, not from view-model data.**
- **Persistence of standard templates** — the grouped AST that actually renders is a
  **snapshot row in a shared catalog table** `standard_quote_document_templates`, seeded by
  migration `server/migrations/20260402100000_add_grouped_standard_templates.cjs:159-311`.
  `getStandardTemplateAst` reads the DB row first and only falls back to the code constant
  when the row is null (never, the column is NOT NULL) —
  `templateSelection.ts:45-59`. **Editing `buildStandardQuoteGroupedAst` in code is inert
  for existing environments** until a migration rewrites the catalog row (precedents:
  `20260723180000`, `20260908100001`, `20260912121000`).

---

## Design decisions (the crux)

### D1. Cadence grouping = renderer-computed `groups_by_cadence`, rendered as bands
Add a new collection `groups_by_cadence` to the view model, mirroring `groups_by_location`.
Each group is `{ cadence_key, name, is_recurring, items, subtotal, tax, total,
optional_items, optional_subtotal, optional_tax, optional_total }`. The grouped template
renders **one repeating `cadence-bands` stack** over it (exactly the by-location band
shape), so:
- "any other cadence present" and "empty cadence sections omitted" fall out for free — the
  renderer only emits non-empty groups, in a fixed cadence order.
- **Per-cadence subtotals/tax/totals come from the renderer** (row-scoped `group.*`
  fields), satisfying the card's "bindings … come from the renderer, not the template."

Rejected alternative: static per-cadence tables (`monthly_items`/`annual_items`/…) with
value bindings. It cannot express "any other cadence" and needs bespoke empty-omit logic
per section. The band repeat is strictly higher-leverage and reuses proven code.

**Cadence key + order.** Derive a canonical key per item:
`!is_recurring → 'onetime'`; recurring → normalize `billing_frequency` (default `'monthly'`
when null/empty) to one of `monthly | quarterly | semi-annually | annually`, else the
lower-cased raw value (unknown cadence still gets its own band). Reuse the existing
normalizer family used by contracts — `normalizeContractCadenceBillingCycle`
(`contractCadenceServicePeriodMaterialization.ts:486`; canonical value list at `:749`) —
extracted/shared rather than re-implemented (LEVERAGE: one cadence vocabulary). Display
order: monthly → quarterly → semi-annually → annually → other recurring (alpha) →
one-time last.

**Cadence label localization.** Band headers are data-driven (`content: path 'name'`),
but must localize. The renderer emits a stable `cadence_key` + English `name` fallback;
`pdfGenerationService.getQuoteHtml` localizes `groups_by_cadence[].name` for the resolved
locale using the same documents i18n source `localizeTemplateAstForLocale` consumes (new
keys `labels.cadence.monthly|quarterly|semiAnnually|annually|oneTime`, generic fallback for
unknown). This keeps localized labels without the static-i18nKey limitation. (Alternative:
thread a translator into `mapLoadedQuoteToViewModel`; rejected as a broader signature change
to a shared adapter.)

### D2. Optional semantics = a separate add-on bucket, excluded from base totals everywhere
Reframe "Optional" from "included when selected" to **"a proposed add-on that is never in
the base/required price, shown separately with an if-selected amount."**
- Base/required totals (group `subtotal/tax/total`, overall `subtotal/tax/total_amount`,
  and every editor-summary base figure) are computed from **required (non-optional) items
  only**, regardless of `is_selected`.
- Optional items render per cadence in an **"Optional (if selected)"** sub-section, each row
  showing its amount, plus an **optional subtotal** per cadence and an overall
  "Optional if selected" line on the totals card. Optional discount rows (targeting optional
  bases) allocate within the optional bucket.
- `is_selected` is retained only as the customer's acceptance signal for
  **conversion** (which optional add-ons become contract/one-time lines); it no longer moves
  the presented base total.

This is the central product decision (see Open Questions). It directly fixes "totals
overstate the base price," and is the interpretation Ryan's report demands. It changes the
meaning of the three inclusion helpers, so they must move in lockstep (D4) or the PDF and
editor will disagree — which the card forbids.

### D3. Per-cadence discount attribution without changing the pure allocator
`allocateQuoteDiscounts` already returns per-base `allocations[]` keyed by `baseItemId`.
The adapter will attribute each discount's reduction to a cadence band by looking up each
allocation's base item cadence key (build a `baseItemId → cadence_key` map), instead of the
binary `recurringAmount/onetimeAmount` split used today
(`quoteAdapters.ts:288-296, 328-338`). The pure module stays unchanged (its `isRecurring`
and aggregate fields remain for the legacy bindings and the editor's monthly-net figure).
This keeps mixed-cadence discount math exact across monthly + annual + one-time and keeps
`quoteDiscountAllocation.ts` as the single source of truth.

### D4. Three inclusion sites move together; editor summary mirrors the PDF
`isQuoteItemIncluded` (`quoteAdapters.ts:54`), `isItemIncluded`
(`quoteCalculationService.ts:57`) and `included` (`quoteLineItemDraft.ts:202`) encode the
same rule three times (LEVERAGE: extract one `quoteItemInclusion` helper). The base-total
rule becomes **"required (non-optional) items only."** The editor summary
(`calculateDraftQuoteTotals`, `calculateDraftMonthlyRecurringNet`,
`quoteLineItemDraft.ts:206-334`; surfaced in `QuoteForm.tsx` ~`:419-436, :1693-1695`) must
present the same required base + per-cadence + "optional if selected" figures so editor and
PDF agree and both agree with `quoteDiscountAllocation`.

### D5. Backward compatibility — no quote recreation; ship a companion migration
Two frozen-snapshot facts (verified) drive this:
1. Existing tenants render the grouped AST from the **catalog row**, not code
   (`templateSelection.ts:54-58`). Custom clones embed their own frozen AST
   (`quoteDocumentTemplates.ts:56-84`; comment `templateSelection.ts:161-165`).
2. Quotes store **no** template snapshot — the AST resolves live and grouped bindings
   recompute from `quote_items` each render (`pdfGenerationService.ts:984-1027`).

Therefore, to avoid the #3358 "recreate every quote" outcome:
- **Keep the legacy bindings populated.** The renderer continues to emit `recurring_items`,
  `onetime_items`, `recurring_subtotal/tax/total`, `onetime_subtotal/tax/total` with their
  current meaning (all-recurring vs one-time). Old catalog rows and custom clones keep
  rendering unchanged (still mislabeled "Monthly" for annual, but not broken). No binding
  path the old AST references is removed.
- **Ship a migration** that rewrites the shared `standard-quote-grouped` catalog row with
  the new cadence-band AST (mirroring `20260402100000` seed + `20260908100001` update
  pattern), so all non-customized tenants get the fix. Tenants who cloned grouped keep their
  frozen copy (documented; they re-clone to adopt).
- No `quote_items` schema change is needed — `is_optional/is_selected/is_recurring/
  billing_frequency` already exist (`20260320100000_create_quotes_tables.cjs:104-107`).

---

## What changes, in order

1. **Cadence vocabulary (shared helper)** — extract/normalize once.
   - Reuse `normalizeContractCadenceBillingCycle`
     (`packages/billing/src/actions/contractCadenceServicePeriodMaterialization.ts:486`) or
     lift its canonical mapping into a small shared `quoteItemCadence.ts`
     (`resolveCadenceKey(item) → 'onetime' | 'monthly' | 'quarterly' | 'semi-annually' |
     'annually' | <raw>`, plus a cadence display-order comparator). One vocabulary for the
     adapter, the draft, and the editor.

2. **Inclusion helper (shared)** — `packages/billing/.../quoteItemInclusion.ts`.
   - `isRequired(item) = !is_optional`; `isOptional(item) = !!is_optional`. Replace the three
     copies (`quoteAdapters.ts:54`, `quoteCalculationService.ts:57`,
     `quoteLineItemDraft.ts:202`) with imports. Base totals key off `isRequired`.

3. **Types** — `packages/types/src/interfaces/quote.interfaces.ts`.
   - Add `QuoteViewModelCadenceGroup { cadence_key: string; name?: string|null;
     is_recurring: boolean; items; subtotal; tax; total; optional_items;
     optional_subtotal; optional_tax; optional_total }`.
   - Add to `QuoteViewModel`: `groups_by_cadence?: QuoteViewModelCadenceGroup[]` and overall
     `optional_subtotal?/optional_tax?/optional_total?`. Keep all existing fields.
   - Update `packages/types/src/interfaces/quoteViewModel.typecheck.test.ts`.

4. **View-model builder** — `packages/billing/src/lib/adapters/quoteAdapters.ts`.
   - New `buildCadenceGroups(lineItems, discountAllocations, baseCadenceMap)`: group required
     bases by cadence key; split optional bases into each group's `optional_items`; attribute
     discount `allocations[]` to bands via `baseItemId → cadence_key` (D3); compute
     `subtotal/tax/total` (required only) and `optional_*` per group; emit non-empty groups in
     canonical order.
   - Change base totals to required-only (`:561-565`) and add overall `optional_*`.
   - **Keep** `buildCadenceCollections` + `recurring_*`/`onetime_*` outputs for legacy
     bindings (D5). Wire `groups_by_cadence` into the returned view model (`:567-614`).

5. **Bindings** — `packages/billing/src/lib/quote-template-ast/bindings.ts`.
   - Add collection binding `groupsByCadence → groups_by_cadence`. Add any value bindings the
     new totals card uses (`optionalSubtotal → optional_subtotal`, etc.). Do not remove
     existing bindings.

6. **Grouped template** — `packages/billing/src/lib/quote-template-ast/standardTemplates.ts`.
   - Rewrite `buildStandardQuoteGroupedAst` body's item region: replace the two fixed tables
     (`:540-581`) with a repeating `cadence-bands` stack over `groupsByCadence` (mirror
     `location-bands` `:777-818`): per band → header (`path 'name'`) + required `dynamic-table`
     (`group.items`) + per-band subtotal/tax/total rows + an **Optional (if selected)**
     sub-table (`group.optional_items`) shown only when present, with an optional subtotal.
   - Rework the totals card (`:599-612`) to an overall summary: required subtotal, discounts,
     tax, grand total, and an "Optional if selected" line. Keep `standard-quote-default`,
     `-detailed`, `-by-location` untouched.

7. **PDF locale labels** — `packages/billing/src/services/pdfGenerationService.ts`.
   - After building the quote view model and resolving the locale, localize
     `groups_by_cadence[].name` (and any optional-section label carried as data) from the
     documents i18n source (D1).

8. **Editor summary parity** — `quoteLineItemDraft.ts` + `QuoteForm.tsx`
   (`packages/billing/src/components/billing-dashboard/quotes/`).
   - Base draft totals = required only. Add per-cadence recurring figures (generalize
     `calculateDraftMonthlyRecurringNet` to per-cadence) and an "optional if selected" total.
     Surface them in the summary sidebar so editor == PDF. Client-side i18n keys for
     cadence/optional labels.

9. **i18n** — `server/public/locales/{de,en,es,fr,it,nl,pl,pt,xx,yy}/documents.json` (10) +
   `standardTemplateI18n.manifest.json`.
   - Add `labels.cadence.*`, `labels.optionalSection` / `labels.ifSelected`,
     `labels.optionalTotal`, `labels.annualTotal` (and any new totals-row labels) to every
     locale.
   - Regenerate the `standard-quote-grouped` entry in
     `packages/billing/src/lib/document-templates/standardTemplateI18n.manifest.json` — it is
     a path-indexed snapshot of every label site and is asserted by
     `standardTemplateI18n.test.ts` (walks each standard AST; fails if a key is missing from
     `en/documents.json` or the manifest drifts). Changing the grouped layout changes the
     `$.layout.children[…]` paths, so the manifest **must** be updated in the same change.

10. **Catalog migration** — `server/migrations/2026XXXXXXXXXX_update_grouped_quote_template_cadence.cjs`.
    - Upsert the new grouped AST into `standard_quote_document_templates` for
      `standard-quote-grouped` (inline literal AST, `.onConflict(code).merge(...)`), following
      `20260402100000` + `20260908100001`. Idempotent; no-op down. This is what makes the fix
      reach existing environments (D5).

11. **Designer/preview fixtures** — `packages/billing/src/components/invoice-designer/preview/quoteSampleScenarios.ts`.
    - Add an annual line + optional lines to the grouped sample so the designer preview and
      snapshot render the new sections.

---

## What we are deliberately NOT doing

- **Mutually-exclusive option groups** (Ryan's cloud-vs-on-prem "choose one"). True radio
  semantics need a new option-group model + editor UI + conversion rules. Out of scope; the
  Optional section here is the groundwork. Today Ryan can mark both alternatives Optional and
  they render as separate "if selected" add-ons (no enforced exclusivity). **Flag as
  follow-up ticket.**
- **Changing persisted `quotes.subtotal/total_amount` or conversion math.**
  `recalculateQuoteFinancials` (`quoteCalculationService.ts:275-396`) still governs the
  stored quote total and what conversion consumes. We change the *inclusion helper it shares*
  (D4) only insofar as base totals exclude optional — but whether the **persisted** stored
  total and conversion should also exclude optional-selected is an Open Question (below); the
  default is to keep conversion behavior and only change presentation + the editor summary the
  user reads. Revisit if the answer says otherwise.
- **Invoice / sales-order templates.** Quote family only.
- **Auto-selecting grouped.** Template selection logic
  (`autoSelectStandardQuoteTemplateCode`, `templateSelection.ts`) is unchanged; grouped stays
  an explicit choice.
- **Back-migrating tenant custom clones.** They keep their frozen AST (documented upgrade
  path: re-clone).

---

## Risks

- **R1 — Optional semantics ripple.** Redefining inclusion (D2/D4) touches the three shared
  helpers; miss one and PDF/editor/persisted totals diverge. Mitigation: single extracted
  helper (step 2), and tests asserting all three agree on the same fixture.
- **R2 — i18n manifest drift.** Reordering grouped children breaks
  `standardTemplateI18n.test.ts` unless the manifest is regenerated and all 10 locales carry
  the new keys. Mitigation: step 9 in the same commit; run that suite.
- **R3 — Legacy binding removal.** Dropping/renaming `recurring_*`/`onetime_*` would break
  frozen catalog rows and custom clones (the #3358 failure). Mitigation: D5 keeps them.
- **R4 — Migration vs code AST divergence.** The catalog migration inlines a literal AST that
  must match `buildStandardQuoteGroupedAst`. Mitigation: derive the literal from the built AST
  in the migration author's checkout; add a test asserting the code AST is structurally the
  intended cadence-band shape (extend `standardTemplates.test.ts`).
- **R5 — Discount attribution edge cases.** Whole-quote discount spanning monthly + annual +
  one-time must split per band and never push a band below zero. Mitigation: reuse the pure
  allocator's per-base `allocations[]`; targeted allocation-per-band tests (T008-style).
- **R6 — Unknown/absent cadence.** Recurring item with null/blank `billing_frequency` must
  default to monthly (matches editor default `QuoteLineItemsEditor` sets `'monthly'`); an
  unrecognized value must get its own band, not silently join monthly. Covered by the
  normalizer + a fixture.

## Test & verification approach

Extend the suites #3378 touched, adding an **annual + monthly + one-time + optional** fixture
and asserting section membership and every total:
- `quoteAdapters.test.ts` — new: annual item lands in its own cadence group (not monthly);
  `groups_by_cadence` order + non-empty-only; optional items excluded from band/base
  `subtotal` and present in `optional_*`; discount attributed to the correct band across
  mixed cadence; legacy `recurring_items`/`recurring_subtotal` still equal all-recurring
  (backward-compat guard).
- `quoteDiscountAllocation.test.ts` — per-band attribution via `allocations[]` for a
  monthly+annual+one-time base set; caps hold.
- `quoteLineItemDraft.test.ts` — draft base totals exclude optional; per-cadence net +
  "optional if selected" figures match the adapter on the same fixture (editor==PDF).
- `standardTemplates.test.ts` — grouped uses a repeating `cadence-bands` stack bound to
  `groupsByCadence` with a nested `dynamic-table` on `group.items` and an optional sub-table;
  no hard-coded "Monthly Items"/"Monthly Total" literals remain.
- `bindings.test.ts` — `groupsByCadence → groups_by_cadence` present; legacy bindings intact.
- `standardTemplateI18n.test.ts` — passes with regenerated manifest + new locale keys.
- `pdfGenerationService.*.test.ts` (locale variants) — grouped render shows localized cadence
  headers and an Optional section; totals reconcile.
- `quoteViewModel.typecheck.test.ts` — new fields typecheck.
- **Migration check** — a DB/infra test (or extend
  `server/src/test/infrastructure/billing/quotes/quoteInfrastructure.test.ts`) asserting the
  catalog `standard-quote-grouped` row after migration binds `groupsByCadence`.
- **Manual smoke** — recreate Ryan's quote (one-time + monthly + one annual $159 + several
  optional) on the grouped template; confirm the annual line sits under an Annual section with
  its own Annual Total, optional lines appear in an "Optional (if selected)" section excluded
  from Monthly/One-Time/base totals, and the editor summary equals the PDF.

---

## Open questions (for XO / captain)

1. **Persisted total & conversion semantics for optional-selected.** Presentation now
   excludes all optional from the base. Should the **stored** `quotes.subtotal/total_amount`
   and conversion-to-contract also stop counting optional-selected lines (making "select"
   purely an acceptance signal resolved at conversion), or keep today's "selected optional is
   in the stored total"? Default in this plan: change presentation + editor summary only;
   leave persisted/conversion behavior intact. Confirm.
2. **Mutually-exclusive alternatives** (cloud vs on-prem) — confirm it is a separate
   follow-up card, not a blocker for this one.
3. **Custom grouped clones** — accept the documented "re-clone to adopt" upgrade path for
   tenants who customized the grouped template, or is a best-effort clone-migration wanted?
