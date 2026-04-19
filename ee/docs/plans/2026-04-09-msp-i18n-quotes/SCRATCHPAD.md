# Scratchpad -- MSP i18n: Quotes Sub-batch

- Plan slug: `2026-04-09-msp-i18n-quotes`
- Created: `2026-04-09`
- Last synced to codebase: `2026-04-17`

## Status Recheck (2026-04-17)

**Still 0% implemented.** Verified against the current codebase:

- `server/public/locales/en/msp/quotes.json` — **does not exist**.
- All 12 files under `packages/billing/src/components/billing-dashboard/quotes/` still have `useTranslation=0` (confirmed by grep).
- `features.json` / `tests.json`: 0/22 features, 0/27 tests marked implemented.
- `nav.billing.sections.quotes`, `nav.billing.quotes`, `nav.billing.quoteBusinessTemplates`, `nav.billing.quoteLayouts` **still missing** from `server/public/locales/en/msp/core.json` (verified via grep). The `F022`/`T027` backfill remains outstanding.

### Upstream changes since the 2026-04-10 addendum (affect this plan)

| Commit | What changed | Impact on this plan |
|---|---|---|
| `7da29f66c add footer for most of them` (touches `QuoteForm.tsx`, `QuoteDetail.tsx`, `QuoteLineItemsEditor.tsx`) | Footer UI added to quote components. | Include footer labels in the existing `quoteForm.*` / `quoteDetail.*` / `quoteLineItems.*` groups. No new namespace needed. |
| `ead79deec Fix quote recipients field build errors` | Build fix on `QuoteSendRecipientsField.tsx`. | `QuoteSendRecipientsField.tsx` is now 396 LOC (PRD estimated 403). Strings enumerated in 2026-04-10 addendum remain the same; `F021`/`quoteRecipients.*` group still correct. |
| `8528a0816 enums translated` (merged via `i18n/more_enum_hooks` / PR #2344) — finishes the shared **enum-labels pattern** for billing enums. `useBillingFrequencyOptions` / `useFormatBillingFrequency` / `useContractLineTypeOptions` / `useFormatContractLineType` published from `@alga-psa/billing/hooks/useBillingEnumOptions`; keys in `features/billing.json#enums.*`. | `QuoteLineItemsEditor.tsx` renders a frequency select (Weekly / Monthly / Quarterly / Annually — see "Decisions" below). `QuoteStatusBadge.tsx` still blocked on status-metadata translation. | **New guidance:** replace the local `frequency` option list in `QuoteLineItemsEditor.tsx` with `useBillingFrequencyOptions()`. Do NOT duplicate those labels into `msp/quotes`. Verify `/msp/billing`, `/msp/quote-approvals`, and `/msp/quote-document-templates` entries in `ROUTE_NAMESPACES` load `features/billing` (the PRD already adds `msp/quotes` to `/msp/billing`, which already has `features/billing`). |
| `QuoteLineItemsEditor.tsx` now 666 LOC (PRD estimate: 676). No behavioral drift beyond markup badge already captured in the 2026-04-10 addendum. | — | No change to `F006` / `F020`. |

### PRD correction — `QuoteStatusBadge` follow-up is now unblocked

The 2026-04-09 decision excluded `QuoteStatusBadge.tsx` because `QUOTE_STATUS_METADATA` labels were baked in at the types layer. The enum-labels pattern shipped 2026-04-14 is the pattern that solves this (see `.ai/translation/enum-labels-pattern.md`). Options:

1. **Preferred:** publish a `useQuoteStatusLabel()` / `useQuoteStatusOptions()` hook from `@alga-psa/types` or `@alga-psa/billing/hooks/`, with keys under `features/billing.json#enums.quoteStatus.*`. Then `QuoteStatusBadge.tsx` becomes a thin consumer of the hook. Zero changes needed in `msp/quotes`.
2. Leave out-of-scope per original plan, and track a dedicated "quote status labels via enum-hook" plan.

Recommend (1) — it removes the only remaining untranslated quote surface and matches the pattern now adopted project-wide. Add as a **new feature F023** (wire `QuoteStatusBadge` via shared hook) and a corresponding **T028** (pseudo-locale visibility test on status badges).

### No structural changes otherwise

Existing F001-F022 / T001-T027 remain valid. Proceed with the corrected frequency-options source and, if accepted, add F023/T028 for `QuoteStatusBadge`.

---

## Decisions

- (2026-04-09) **QuoteStatusBadge.tsx excluded from wiring**: This component reads labels from `QUOTE_STATUS_METADATA` in `@alga-psa/types`. Translating those labels requires a types-level change (making the metadata accept a `t()` function or switching to key-based lookup). Out of scope for this batch; track as follow-up.
- (2026-04-09) **quoteLineItemDraft.ts excluded from wiring**: Pure logic/data utility with no rendered JSX. The only user-visible output is `formatDraftQuoteMoney()` which uses `Intl.NumberFormat` -- already locale-capable via the formatter replacement (F012).
- (2026-04-09) **Single namespace for all 12 files**: All quote components live in the same directory and share significant vocabulary (Cancel, Back, Save, Send, Delete, etc.). A single `msp/quotes` namespace avoids cross-namespace imports and keeps the bundle small.
- (2026-04-09) **Execution order**: F001 (scaffold namespace) -> F002-F011 (wire components, largest first) -> F012-F013 (formatters) -> F014-F017 (translations + validation) -> F018 (routes) -> F019 (build check).
- (2026-04-09) **Currency formatting replacement**: Five components define local `formatCurrency()` helpers using `new Intl.NumberFormat('en-US', ...)`. These should be replaced with `useFormatters().formatCurrency()` or a shared locale-aware helper. The `quoteLineItemDraft.ts` utility also has `formatDraftQuoteMoney()` with `en-US` -- this should be made locale-aware as part of F012.
- (2026-04-09) **Date formatting replacement**: Four components define local `formatDate()` helpers using `.toLocaleDateString()` with no locale argument (defaults to browser locale, which is correct). However, `QuoteDocumentTemplateEditor.tsx` uses `.toLocaleString()` for timestamps. These should use `useFormatters()` for consistency.

## Post-planning additions (2026-04-10)

- **(2026-04-10)** **MSP sidebar Quotes section renders raw English even in xx/de.** While doing the billing-dashboard xx smoke test, the left-hand MSP navigation consistently showed `Quotes / Quote Templates / Quote Layouts` in English under a `QUOTES` section header, while every other entry pseudo-translated cleanly. Root cause: `server/src/config/menuConfig.ts:308-317` added a Quotes section that references four translation keys that were never backfilled into `msp/core.json`:
  - `nav.billing.sections.quotes` (section header)
  - `nav.billing.quotes` (Quotes item)
  - `nav.billing.quoteBusinessTemplates` (Quote Templates item; note: href=`/msp/billing?tab=quote-business-templates`)
  - `nav.billing.quoteLayouts` (Quote Layouts item; note: href=`/msp/billing?tab=quote-templates`)

  Every other `nav.billing.*` key is present in all 9 locale files under `msp/core.json` (contractTemplates, clientContracts, invoicing, accountingExports, usageTracking, etc.). Only the Quotes block is missing — so the sidebar falls back to the hardcoded English `name` field in `menuConfig.ts`.

  **Decision:** keep these keys in `msp/core` (where the rest of `nav.billing.*` lives) rather than introducing cross-namespace navigation. The fix is a pure locale-file backfill — no code change in `menuConfig.ts`, and no dependency on the `msp/quotes` namespace load order. Tracked as `F022` / `T027` below.



- **(2026-04-10)** **Product markup on quote line items** landed after the planning commit (commits `6a40d09fa` "Show product markup on quote line items" and `3afa5763f` "Add recipient picker and discount-aware markup"). `QuoteLineItemsEditor.tsx` now renders, for product-kind items only:
  - A live markup badge in the Unit Price cell: `` `${sign}${markup.toFixed(1)}% markup` `` -- needs a translation key with `{{value}}` interpolation (and probably a separate key for the sign, or format the whole string via t with `{{signedValue}}`).
  - A "Markup unavailable" label + tooltip when `cost_currency` differs from the quote currency. Tooltip text: `` `Markup can't be calculated because cost is tracked in ${item.cost_currency} and this quote is in ${currencyCode}.` `` -- needs `{{costCurrency}}` and `{{quoteCurrency}}` interpolation.
  - These all live under a new `quoteLineItems.markup.*` key group. F006 already covers QuoteLineItemsEditor wiring but predates the markup UI, so the wiring pass must explicitly hit these new strings (tracked as `F020`).
- **(2026-04-10)** **New component `QuoteSendRecipientsField.tsx`** (403 LOC) was added in commits `3afa5763f` and `ead79deec` and is consumed by `QuoteDetail.tsx` and `QuoteForm.tsx` in their send dialogs. It is a searchable combobox with its own user-visible strings, none of which are covered by F002/F003:
  - Trigger label (three-way ternary): `'Select a client first'`, `'No users or contacts available'`, `'Add internal user or client contact…'`.
  - Search input `placeholder="Search by name or email…"`.
  - Empty states: `'No recipients available'` and `'No matches'`.
  - Kind badge values: `'Internal'` / `'Contact'`.
  - Remove button `aria-label={`Remove ${r.email}`}` -- needs `{{email}}` interpolation.
  - Tracked as `F021` / `T025` / `T026` below. New key group `quoteRecipients.*`.

## Discoveries / Constraints

### QuoteForm.tsx (1,072 LOC)
- Largest component by string density. Contains: form field labels (Title, Description/Scope, Client, Contact, Currency, Quote Date, Valid Until, PO Number, Notes to Client, Terms & Conditions, Quote Layout), heading variants (New Quote, Edit Quote, New Quote Template, Edit Quote Template, Quote QQQ vN), workflow action buttons for every status, three embedded dialogs (send, approval, conversion preview), totals section (Subtotal, Discounts, Tax, Total), status banners (Accepted, Rejected, Converted), read-only notice.
- The heading logic is complex with conditional template/edit/read-only/quote-number branching -- use a computed key or switch statement with t().
- Conversion dialog preview is duplicated between QuoteForm and QuoteDetail. Could share keys under `quoteConversion.*`.
- `formatCurrency` is a local closure using `form.currency_code` -- will need to use the formatter's currency parameter.

### QuoteDetail.tsx (1,106 LOC)
- Similar to QuoteForm but read-only. Additional sections: Version History, Scope of Work, Activity Log, Quote Layout (with template selector), Client Notes, Internal Notes, Terms & Conditions.
- Has `formatQuoteNumber()` helper -- "Template quote" fallback string needs translation.
- Accepted/rejected status sections have inline status text with bold labels ("Accepted by:", "Accepted on:", "Rejected on:", "Reason:").
- Line item table differs from QuoteLineItemsEditor (read-only, simpler columns). Has client selection badges for optional items ("Client selected this optional item" / "Client declined this optional item").
- Activity log renders `activity.activity_type.replace(/_/g, ' ')` -- these are server-side enum values, likely should stay untranslated or get a separate mapping. Leave as-is for now.

### QuotesTab.tsx (656 LOC)
- Contains `BASE_QUOTE_COLUMNS` defined at module level as a constant array. Column titles ('Quote #', 'Client', 'Title', 'Total', 'Status', 'Date') need t() but the array is outside the component. Will need to move column definitions inside the component or use a factory function.
- Sub-tab labels use template literals with counts: `` `Active (${count})` ``. Use t() with `{{count}}` interpolation.
- Two dialogs: delete confirmation and send quote. Send dialog has additional recipients and message fields.
- `QuoteSubTabContent` is an inner component -- needs to share the same t() or get its own hook call.

### QuoteDocumentTemplateEditor.tsx (596 LOC)
- Has design/code/preview tabs with pipeline status labels (Shape, Render).
- Template name/version form fields.
- "Code view is generated from the Visual workspace and is read-only." info alert.
- Preview section has "Sample Scenario" label, scenario descriptions (from imported data -- may not be translatable here), and pipeline error messages.
- Created/Updated timestamps.
- "Template name is required." validation message.

### QuoteLineItemsEditor.tsx (585 LOC)
- Table headers at module level inside `renderItemRows`: Move, Item, Billing, Flags, Qty, Unit Price, Total, Actions.
- Checkbox labels: "Optional", "Recurring".
- Frequency select options: Weekly, Monthly, Quarterly, Annually.
- Discount panel: "Percentage discount", "Fixed discount", "Whole quote", "Specific item", "Specific service", "Applies to the full quote subtotal".
- Phase/section label: "Phase / Section", placeholder "e.g. Discovery, Rollout, Ongoing".
- Dynamic text: "Custom item", section item count "{n} item(s)", "Set price", "No price in {currency}".
- Collapse/Expand toggle labels.
- "Ungrouped Items" as a phase fallback label.

### QuoteDocumentTemplatesPage.tsx (299 LOC)
- Page heading "Quote Layouts", description, "New Layout" button.
- Table columns: Name, Source, Default, Actions.
- Action menu: Edit, Edit as Copy, Clone, Set as Default, Delete.
- Uses `confirm()` for delete -- should be replaced with a proper translated confirmation, but that is a UX change beyond i18n scope. At minimum translate the confirm message string.
- "(Standard)" suffix on template names.

### QuoteConversionDialog.tsx (293 LOC)
- Standalone dialog used from multiple places (though QuoteForm and QuoteDetail have their own inline conversion dialogs too).
- Mode labels: "Contract Only", "Invoice Only", "Contract + Invoice".
- Mode descriptions are full sentences explaining what each mode does.
- Item mapping preview with category headings and counts.
- Summary section: "Quote Total", "Status After Conversion" -> "Converted".
- Partial conversion alert with dynamic text.

### QuoteApprovalDashboard.tsx (245 LOC)
- Heading "Quote Approvals", description paragraph.
- Approval required toggle with two conditional description strings.
- Status filter: "Pending Approval", "Approved".
- Table columns: Quote #, Client, Title, Amount, Status, Quote Date, Valid Until.
- Empty state with dynamic status text.
- "Back to Quotes" button.

### QuoteTemplatesList.tsx (215 LOC)
- Description paragraph about what templates do.
- Table columns: Title, Items, Currency, Created, Actions.
- Action menu: Edit Template, Create Quote from Template, Delete.
- Empty state with "Save as Template" reference.
- Delete confirmation dialog.
- "New Template" button.

### QuotePreviewPanel.tsx (215 LOC)
- Panel heading "Quote Preview".
- Template selector with "(Standard)" suffix.
- "Open Quote" and "Download PDF" buttons.
- Empty state: "Select a quote to preview" with icon.
- Loading state: "Loading Preview..."
- Error fallback: "Could not display preview. Data might be missing."

## Key Gotchas

1. **Column definitions at module scope**: `BASE_QUOTE_COLUMNS` in QuotesTab.tsx and column arrays in QuoteApprovalDashboard.tsx / QuoteTemplatesList.tsx are defined as constants outside the component. They need `t()` for titles but `t()` is only available inside the component. Options: (a) move inside component with useMemo, (b) use factory function that takes `t` as parameter. Option (a) is simplest and consistent with other translated components.
2. **Shared conversion dialog content**: QuoteForm.tsx, QuoteDetail.tsx, and QuoteConversionDialog.tsx all have conversion preview UI. Share keys under `quoteConversion.*` to avoid triple-maintaining the same strings.
3. **Template string in headings**: QuoteForm heading uses complex conditional logic. Keep the branching but wrap each branch in t().
4. **Interpolation-heavy strings**: Sub-tab labels like `Active (${count})`, section counts like `${count} item(s)`, and notice messages like `Created draft contract ${name}` need careful interpolation variable placement. Use `{{count}}`, `{{name}}` patterns.
5. **formatCurrency/formatDate helper replacement**: These are defined as standalone functions, not as component methods. Replacing them with `useFormatters()` requires either moving the formatting call inside the component or passing the formatter down. Since these functions are used in column definitions (which will move inside the component per gotcha #1), this should align naturally.
6. **Keep stable values untranslated**: Tab IDs (`active`, `sent`, `closed`, `approval`), query param values (`quotes`, `edit`, `detail`), status enum values (`draft`, `sent`, `accepted`, etc.), CSS class names, element IDs, route paths, `aria-label` values that are already descriptive English.
7. **QuoteStatusBadge is a pass-through**: It renders `metadata.label` from a types constant. The label translation belongs in the types layer or a shared status-label mapping, not in this namespace. Leave it untranslated for now.

## Progress Log

- (2026-04-19) Completed `F001`: created [server/public/locales/en/msp/quotes.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/en/msp/quotes.json) with the planned component-scoped roots (`common`, `quotesTab`, `quoteForm`, `quoteDetail`, `quoteLineItems`, `quoteRecipients`, `quoteConversion`, `quoteApproval`, `quoteTemplates`, `quotePreview`, `templateEditor`, `templatesPage`) and seeded the first shared/base English keys from the PRD + component inventory. Expect follow-on wiring passes (`F002`-`F021`) to expand individual leaf keys as each component is converted.
- (2026-04-19) Completed `T001`: added [packages/billing/tests/billing-dashboard/QuotesSubbatch.i18n.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/tests/billing-dashboard/QuotesSubbatch.i18n.test.ts) with a node-side contract test that parses `en/msp/quotes.json` and asserts the namespace exposes the planned top-level groups in order. Validation command: `cd packages/billing && npx vitest run tests/billing-dashboard/QuotesSubbatch.i18n.test.ts`.
- (2026-04-19) Completed `F002`: wired [packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx) to `useTranslation('msp/quotes')` for the form chrome, workflow actions, notices/errors, send/approval/conversion dialogs, status banners, and totals footer. Expanded [server/public/locales/en/msp/quotes.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/en/msp/quotes.json) with the `quoteForm.*` leaf keys now consumed by the component. Validation:
  - `rg -n "text=\\\"|title=\\\"|placeholder=\\\"|>[^<{]*[A-Za-z][^<{]*<" packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx` -> only non-UI match left was the `runWorkflowAction` helper signature; all rendered copy now flows through `t(...)`.
  - `cd packages/billing && npm run typecheck` -> blocked by a pre-existing upstream issue outside this batch: `packages/ui/src/lib/dateFnsLocale.ts` is missing the `pt` locale mapping required by the now-expanded locale union. Track this for the later build/typecheck gate (`F019`/`T024`) unless another batch lands the fix first.
- (2026-04-19) Completed `T003`: extended [packages/billing/tests/billing-dashboard/QuotesSubbatch.i18n.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/tests/billing-dashboard/QuotesSubbatch.i18n.test.ts) with a `QuoteForm` contract test that asserts the `useTranslation('msp/quotes')` hook is present and that representative form/workflow/dialog keys resolve from `en/msp/quotes.json`. Validation command: `cd packages/billing && npx vitest run tests/billing-dashboard/QuotesSubbatch.i18n.test.ts`.
- (2026-04-19) Completed `T004`: added a negative-source regression check to [packages/billing/tests/billing-dashboard/QuotesSubbatch.i18n.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/tests/billing-dashboard/QuotesSubbatch.i18n.test.ts) covering the major raw-English literals that used to be rendered directly by `QuoteForm.tsx` (buttons, labels, placeholders, dialog titles, conversion preview headings, and loading text). Validation command: `cd packages/billing && npx vitest run tests/billing-dashboard/QuotesSubbatch.i18n.test.ts`.
- (2026-04-19) Completed `F003`: wired [packages/billing/src/components/billing-dashboard/quotes/QuoteDetail.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/billing-dashboard/quotes/QuoteDetail.tsx) to `useTranslation('msp/quotes')` across the page shell, field summaries, totals, version history, status banners, line-item table, converted-record links, and the conversion/preview/send/approval dialogs. Reused the shared `quoteForm.*`, `quoteConversion.*`, `quoteLineItems.*`, and `common.*` keys where the UI copy matches, and expanded [server/public/locales/en/msp/quotes.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/en/msp/quotes.json) with the remaining `quoteDetail.*` leaves (actions, alerts, notices, errors, preview/loading, and table labels). Validation:
  - `rg -n "text=\\\"|title=\\\"|placeholder=\\\"|>[^<{]*[A-Za-z][^<{]*<" packages/billing/src/components/billing-dashboard/quotes/QuoteDetail.tsx` -> no matches; the detail component no longer renders raw English JSX literals directly.
  - `node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('server/public/locales/en/msp/quotes.json','utf8')); console.log('quotes.json ok');"` -> parsed successfully after the `quoteDetail.*` additions.
- (2026-04-19) Completed `T005`: extended [packages/billing/tests/billing-dashboard/QuotesSubbatch.i18n.test.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/tests/billing-dashboard/QuotesSubbatch.i18n.test.ts) with a `QuoteDetail` contract test that asserts the translation hook is present and that representative detail, dialog, badge, and conversion-preview keys resolve from `en/msp/quotes.json`. Validation command: `cd packages/billing && npx vitest run tests/billing-dashboard/QuotesSubbatch.i18n.test.ts`.

## Commands / Runbook

- `git status --short`
- `rg -n '>[[:space:]]*[A-Z][^<{]*<' packages/billing/src/components/billing-dashboard/quotes/*.tsx`
- `rg -n "'[^']*[A-Za-z][^']*'|\"[^\"]*[A-Za-z][^\"]*\"" packages/billing/src/components/billing-dashboard/quotes/*.tsx`
