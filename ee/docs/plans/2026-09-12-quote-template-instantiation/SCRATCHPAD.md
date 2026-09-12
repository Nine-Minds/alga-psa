# Scratchpad — quote template instantiation

Card: f15013ea-60a0-498f-9a70-547fd0de658c
Branch: `feature/quote-template-fields-never-reach-the-new-quote`
Worktree: `/home/robert/alga-copies/feature-quote-template-fields-never-reach-the-new-quote`
Dev port: 3060 · compose project: `alga-psa-local-test`

## Verification done during planning

Every claim below was re-checked against the branch, not taken from the report.

- **Producer/consumer asymmetry confirmed.** `BillingDashboard.tsx:192` emits
  `?tab=quotes&quoteId=new&templateId=${id}`. `QuotesTab.tsx:313-320` reads
  `quoteId`, `mode`, `subtab`, `isTemplate`, `opportunityId`, `clientId`,
  `contactId`, `title` — no `templateId`. A repo-wide grep for `templateId=`
  returns exactly two non-test producers: `BillingDashboard.tsx:192` (quotes
  tab, no consumer) and `QuoteDocumentTemplateEditor.tsx:514` (layout tab, which
  *is* consumed at `BillingDashboard.tsx:208`). So the layout deep link works
  and the business-template deep link does not.
- **Renderer gap confirmed.** `react-renderer.tsx:570-576` `case 'text'` emits
  `<p style={style}>{String(content ?? '')}</p>`. `whiteSpace` appears in that
  file only at `:333` (line items), `:343` (table cells) and `:610` (field
  nodes) — all three conditional on a `multiline` flag. Text nodes were missed.
- **Renderer blast radius mapped.** `renderEvaluatedTemplateAst` is imported by
  `pdfGenerationService.ts:29`, `server-render.ts:4`,
  `quoteTemplatePreview.ts:11`, `invoiceTemplates.ts:30`,
  `invoiceTemplatePreview.ts:14`. Confirms the fix reaches the quote PDF, and
  confirms it also reaches invoice templates. Flag in review.
- **Server path is clean.** Not re-investigated; the report states a temporary
  assertion was added to `quoteActions.test.ts`, passed, and was reverted. The
  copy sites are `quoteActions.ts:1117` (createQuoteFromTemplate), `:1179`
  (duplicateQuote), `:1251` (saveQuoteAsTemplate). T008 makes the reverted
  assertion permanent.

## Finding beyond the original report

`QuoteForm.tsx:298` loads the **layout** id into `form.template_id` in edit mode
(`template_id: quote.template_id || ''`), while `:294` puts the same value into
`documentTemplateId`. The duplicate is not inert:

- `:428` guards `if (!form.title && !form.template_id)` with the message "Title
  is required unless creating from template". In edit mode an assigned *layout*
  therefore satisfies a guard that is supposed to mean "a business template will
  supply the title". A layout supplies no title.
- `:464` is shielded by the `isEditMode` branch at `:462`, so the wrong value
  does not reach `createQuoteFromTemplate` today. That is luck, not design.
- `:1448` (picker value) is gated on `!isEditMode`, so no visible leak there.

**Decision:** delete `:298` rather than rename it through. A quote has no column
recording which business template produced it, so in edit mode there is no
source template and the field should be empty. This removes the collision at the
root instead of renaming around it.

## Full reference list of `form.template_id` reads (rename must hit all)

`:298` (delete), `:382`, `:395`, `:428`, `:464`, `:465`, `:480`, `:1448`.
Declaration at `:58`, initialiser at `:72`.

Do not confuse with the separate, correct `documentTemplateId` state:
`:149`, `:294`, `:369-370`, `:457`, `:1528-1529`.

Also note `QuoteForm`'s two template collections, which is the same collision at
the list level: `templates` (`:147`, `IQuoteListItem[]`, business templates,
loaded `:279`) vs `documentTemplates` (`:148`, layouts, loaded `:280`). Worth
renaming `templates` → `businessTemplates` while in there.

## Decisions

- **Rename to `sourceTemplateId` / `source_template_id`.** Create-time,
  client-side-only concept. `quotes.template_id` keeps meaning "layout" and is
  untouched — no migration in this plan.
- **Reuse `handleTemplateChange` for deep-link seeding.** The picker path at
  `QuoteForm.tsx:381` already does the correct prefill and is the interim
  customer workaround, so it is the de facto specification. Seeding must call it
  rather than reimplement the field copy, or the two paths will drift.
- **Renderer default merges under the author style** —
  `{ whiteSpace: 'pre-line', ...style }`, not the reverse — so a layout author
  setting an explicit `whiteSpace` keeps control. Unconditional rather than
  gated on a `multiline` flag, because unlike field values a text node has no
  formatter that computes one.
- **No DB-backed integration suite.** The plan adds no migration and changes no
  query; the defect is client wiring plus a renderer style. T008 asserts at the
  action layer with the existing mocks, which is the right depth here. Called
  out so a reviewer can push back rather than discover the omission.

## Gotchas

- **Seed-once.** Seeding must wait for the business template list to load *and*
  fire exactly once per mount. A seed that re-runs on dependency change will
  clobber edits the user has already typed.
- **Prefill is deliberately non-destructive.** `handleTemplateChange` uses
  `current.x || template.x` (`:393-400`). That is what lets an opportunity-seeded
  title survive. Do not "simplify" it to unconditional assignment — T006 guards
  this.
- **Double-persist trap.** `:480` computes `createdFromTemplate` to skip
  client-side line-item persistence because the server already created them. If
  the rename misses this read, every template-created quote gets duplicate line
  items. This is the highest-consequence single line in the rename.
- **Overlapping unmerged work.** A separate in-flight change (PDF filenames /
  document titles, `buildDocumentFileName` in
  `packages/core/src/lib/fileNames.ts`) touches `quoteActions.ts`,
  `QuoteDetail.tsx`, `QuoteForm.tsx`, `QuotesTab.tsx`,
  `pdfGenerationService.ts` and two quote test files. No semantic overlap with
  this work, but the same files. Rebase; do not assume a clean tree.

## Existing test surfaces to extend

- `packages/billing/tests/quote/quoteActions.test.ts` — fixture at `:175`
  already defines `terms_and_conditions: 'Template terms'` with no assertion
  consuming it. T008 goes here.
- `packages/billing/src/components/billing-dashboard/quotes/QuotesTab.test.tsx`
  — exists; T001 extends it.
- No `QuoteForm` test file yet. T002–T007 need a new one.
- `packages/billing/tests/quote/quoteTemplateSelection.test.ts` — check for
  overlap before adding picker coverage.

## Smoke test

Billing → Quote Templates → build a template with multi-paragraph T&Cs and a
couple of line items → row menu "Create Quote from Template" → confirm the new
quote arrives with T&Cs, notes, currency and line items populated → download the
PDF → confirm the paragraph breaks survive.

## Customer follow-up

A reply to the reporter is drafted on the card but **not posted**. It asks a
disambiguating question that the ratified scope decision has since answered, so
it needs editing before it goes out — the question should be dropped and the
workaround ("+ From template" dropdown in the Line items header) kept. Posting
is the captain's call, not the officer's.
