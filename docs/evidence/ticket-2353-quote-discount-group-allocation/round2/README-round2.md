# Round 2 — standard Grouped Quote catalog template now renders (repair round)

Scope: ticket-2353 smoke-fix loop, round 2/3. The round-1 smoke failed because the
shared standard "Grouped Quote Template (Standard)" catalog row
(`08a528dd-6cc5-4c4d-b6c9-cf8bea390a2a`) carries `lines` keys in its two
Description columns that this branch's invoice-template AST runtime rejected:

    TemplateEvaluationError: Invoice template AST schema validation failed:
      layout.children.5.columns.0: Unrecognized key(s) in object: 'lines';
      layout.children.7.columns.0: Unrecognized key(s) in object: 'lines'

## What changed

`packages/billing/src/lib/invoice-template-ast/schema.ts`, `react-renderer.tsx`,
`packages/types/src/lib/invoice-template-ast.ts`, plus unit coverage
(`schema.test.ts`, `react-renderer.test.tsx`) and a DB-backed regression
(`quoteInfrastructure.test.ts` T220):

- Table/dynamic-table columns may now carry an optional `lines` array of
  `{ id, value, format?, style? }` stacked cell lines (the ticket-2354 authoring
  shape). Additive: columns without `lines` validate and render exactly as before.
- The renderer resolves each line against the current row; empty lines (a line
  whose path is missing, e.g. `service_name` on a discount/custom row) are
  dropped. When a column has `lines` and at least one resolves, the lines render
  (each with its own inline style). When all lines resolve empty, the column
  falls back to its flat `value` — so discount and custom rows never lose their
  description. A `\n` in a resolved cell value drops blank edge lines and uses
  `white-space: pre-line`, mirroring ticket 2354's renderer convention.
- No catalog row was reseeded or edited. QUO-0003's template assignment was
  temporarily pointed at the standard row for generation and restored to its
  custom template (`2353c000-0000-4000-8000-00000000b001`) immediately after.

## Runtime regression

`quoteInfrastructure.test.ts` T220 loads the actual `standard_quote_document_templates`
row for `standard-quote-grouped`, reproduces the shared-dev `lines` Description
column shape on it, and drives the real quote preview + PDF generation services
for a $25/$35 two-service quote with two legacy service-targeted $5 discounts
and four one-time charges. It asserts the stacked name lines, the description
fallback on discount rows, and $50.00 / $2,987.97 / -$5.00 figures, and that
`generatePDF` returns a buffer through the real `getQuoteHtml` path.

## Evidence produced this round (real shared catalog row, local dev data)

Harness: `createPDFGenerationService(tenant dd8cb218…)` → `renderQuotePreview`
and `generatePDF` (Puppeteer) against the real catalog row and real QUO-0003
(`9f4886a0-a332-430e-9056-973aa35e43a1`) on the shared dev Postgres. Same code
path the product uses (`downloadQuotePdf` → `pdfService.generatePDF` →
`evaluateTemplateAst` → `renderTemplateAstHtmlDocument` → Puppeteer).

- `QUO-0003-standard-grouped-real-catalog.pdf` — 2-page letter PDF; the first
  standard-grouped PDF produced by this branch from the actual shared catalog
  row (contains `lines` columns).
- `QUO-0003-standard-grouped-real-catalog.txt` — `pdftotext -layout` transcript.
- `standard-grouped-preview.html` — the product's quote-preview HTML.
- `2353-real-catalog-1.png` / `2353-real-catalog-2.png` — PDF pages rasterized.
- `standard-grouped-preview-top.png` / `...-bottom.png` — preview HTML rendered
  headless (this host has no Alga Dev browser pane; screenshots of the real
  editor are retained from the round-1 smoke, files 28–32 in
  `/tmp/alga-smoke-evidence/task-2353-20260908-234007`).

### Expected vs actual (PDF transcript, zero tax)

| Figure | Expected | Actual |
|---|---:|---:|
| Monthly service A price/amount | $25.00 | USD 25.00 |
| Monthly service B price/amount | $35.00 | USD 35.00 |
| Two discounts in Monthly Items | −$5.00 each | −USD 5.00 ×2, description "Discount" |
| Monthly Total | $50.00 | USD 50.00 |
| One-time Total | $2,987.97 | USD 2,987.97 |
| Taxes | $0.00 | USD 0.00 ×2 |

The shared standard template's notes/totals block shows group net figures
(Monthly 50.00, Tax 0.00, Monthly Total 50.00; One-time 2,987.97, Tax 0.00,
One-time Total 2,987.97). The two −USD 5.00 discount rows in Monthly Items add
up to the $10 total discount. Overall discount ($10) and overall total
($3,037.97 = $50.00 + $2,987.97) are shown by the editor sidebar / view model
(round-1 screenshots and adapter view-model evidence) rather than by this
template's totals layout.

### Command / environment notes

- Worktree: `feature/correct-recurring-quote-discount-allocation-and`;
  repair commits `f824277fca` (runtime lines support) plus the review-round
  fixes (workspace lines roundtrip + renderer line classes). Not pushed.
- Node v22.18.0; Vitest 3.2.7 (server/) and 4.1.10 (root); shared dev Postgres
  on 127.0.0.1:5472 (app via PgBouncer 6472).
- `quoteInfrastructure.test.ts` T220 and the harness ran with
  `TEST_DB_NAME=test_database_2353db_full` (fresh, migrated) and
  `TEST_DB_NAME=test_database_2353lines_harness` (connects to the shared DB).

## Review-round fixes (after round-2 review)

Two independently reproduced compatibility gaps were fixed on top of the
round-2 commit:

1. **`invoice-designer/ast/workspaceAst.ts`** dropped `column.lines` during
   workspace import/export, so duplicating/saving a custom template flattened
   the stacked Description cell. Import now preserves `lines` verbatim and
   export re-emits line ids, expressions, formats and styles (incl. `tokenIds`)
   via `mapWorkspaceColumnLines`. Regressions: `workspaceAst.roundtrip.templates.test.ts`
   covers `dynamic-table` and `table` inputs, determinism across cycles, and
   rendered output after roundtrip.
2. **`react-renderer.tsx`** discarded the `className` from
   `resolveStyleRef(line.style)`, so supported `style.tokenIds` on stacked lines
   were silently ignored. Lines now carry `class="ast-…"` next to their inline
   styles. Regressions assert class + inline rendering for both table node kinds.

Re-validation after these fixes: 183 unit/focused tests, 115 DB-backed infra
tests (incl. T220), and 34 workspace roundtrip/regression tests pass; billing
typecheck + build clean; ESLint 0 errors on touched files.
- Pre-fix reproduction confirmed with the exact failure text (see README in the
  parent evidence dir); post-fix the same catalog AST evaluates and renders.

## Compatibility notes for ticket 2354 / 2355

- This branch's runtime now accepts and renders the `lines` column shape the
  shared catalog already contains, so no catalog reseed/restore is needed on
  this branch. The catalog row's `updated_at` and `templateAst` were not
  changed (verified by the restore step).
- Ticket 2354's own runtime additionally renders the `{{name}}\n{{description}}`
  single-expression Description cell; this branch's renderer now honours that
  `\n` convention too, so the two branches render the eventual catalog content
  consistently. The `service_name`/`catalog_description` row fields referenced
  by the shared `lines` expression resolve from the quote view model where they
  exist; empty ones are dropped with the description fallback, never shown blank.
- No designer/workspace write-back of the catalog was exercised in this round
  (that surface belongs to ticket 2354/2355); the `lines` key survives the
  i18n localization walk and roundtrips through the render path.
