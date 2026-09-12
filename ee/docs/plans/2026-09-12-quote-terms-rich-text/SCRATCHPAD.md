# Scratchpad — Rich text in quote Terms & Conditions

Card `090bd1c3-a24b-4d26-a1e6-ea643919b82a`. Worktree
`/home/robert/alga-copies/feature-rich-text-in-quote-terms-conditions-hyperlink-to`,
branch `feature/rich-text-in-quote-terms-conditions-hyperlink-to`, dev port 3412,
compose project `alga-psa-local-test`.

## Corrections to the commissioning brief

Four claims in the card turned out to be wrong or incomplete. They change the
shape of the work, so they are recorded before anything else.

### 1. `quotes` is not a Citus-distributed table

The card called for a Citus-safe migration and pointed at the
`citus-migration-gotchas` skill. Not needed here.

- No migration in `server/migrations/` calls `create_distributed_table` on
  `quotes`, `quote_items` or `quote_activities` (checked against all 97
  migrations that call it).
- `server/migrations/20260702140000_add_sales_order_quote_link.cjs:18-27`
  confirms it from the other direction — it skips adding an FK from the
  distributed `sales_orders` to `quotes` *because* `quotes` is not distributed,
  with a comment saying so.

A plain `ALTER TABLE quotes ADD COLUMN` is correct. No
`truncate_local_data_after_distributing_table` guard, no distribution-column
constraint on any index. House style still applies: `hasColumn` guard, one
subcommand per `alterTable` call — see
`20260819120000_add_board_pinning_and_list_view_settings.cjs:31-54`, whose
comment explains the one-subcommand rule ("Citus rejects an ALTER carrying two
utility subcommands").

### 2. `convertBlockContentToHTML` does **not** escape all text

The card said the helper "escapes all text (`escapeHtml` at :3, applied at :854,
:861, :916)" and concluded there is "no injection surface and no sanitizer
dependency is needed". The first half is false, which makes the second half
unsafe as reasoning even though its conclusion (no sanitizer) still holds for a
different reason.

Two escape sites are **no-ops**:

```
754:  .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');   // codeBlock text
786:  anyBlock.content.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
```

Every replacement maps a character to itself. Verified byte-exactly with
`cat -v`; compare the correct versions in the same file at `531`, `550`, `563`
(`'&amp;'`, `'&lt;'`, `'&gt;'`). This is a copy-paste defect.

Consequence: a BlockNote **code block** containing `<script>…</script>` is
emitted unescaped by `convertBlockNoteToHTML`. That output is already consumed by
`packages/documents/src/handlers/BlockNoteDocumentHandler.ts:76,122` and
`server/src/lib/api/services/ticketRichRender.ts:36`. **This is a live stored-XSS
defect on tickets and documents today, independent of quotes.** It is why the
converter work leads the plan rather than following it.

The href finding in the card is real and confirmed — no scheme validation
anywhere in the file (`grep` for `javascript:`, `new URL(`, `protocol`,
`startsWith('http')` returns nothing) — but it is one of several:

| Line | Emitted | Escaping |
|---|---|---|
| 262 | `href` → Markdown | none |
| 526 | `href` → HTML | `&` and `"` only, no scheme check |
| 840 | `href` → HTML | full `escapeHtml`, no scheme check |
| 1014 | `href` → Markdown | none |
| 755 | `class="language-${language}"` | none |
| 774 | `<img src>` | escaped, no scheme check |
| 303, 308, 337, 347, 500, 572-580, 638-653 | `style="…"` colours/alignment | none |

The card's underlying argument still stands — the stored value is structured
JSON, the app serializes it, raw HTML is never accepted — so the fix is correct
escaping plus a scheme allowlist at the emission sites, not a scrubber. But the
premise "it already escapes everything" cannot be relied on.

### 3. Adding an AST node type is not a two-file change, and getting it wrong deletes data

The card scoped this as schema + renderer. The node type actually lives in two
unsynchronized unions, and the visual designer is a third, separate type system:

- `packages/types/src/lib/invoice-template-ast.ts:47-57` — `TemplateNodeType`
  (10 types) and the `TemplateNode` union. This is what the renderer imports.
- `packages/billing/src/lib/invoice-template-ast/schema.ts:396-493` — the zod
  `nodeSchema` discriminated union, plus a hand-written `NodeInput` mirror at
  `:303-394`. Not generated from the types package; kept in sync by hand.
- `packages/billing/src/lib/invoice-template-ast/i18nLabels.ts:63-91` — a
  `resolveNode` switch with an explicit `case 'text'`.
- The designer's own `DesignerComponentType` (22 values,
  `invoice-designer/state/designerStore.ts:27-50`) compiles down to the 10 AST
  types via `componentSchema.ts`, `componentCatalog.ts:15-36`,
  `DesignCanvas.tsx:936`, and both directions of `workspaceAst.ts`
  (export switch `:1043`, import switch `:1803-1955`).

**The sharp edge**, `workspaceAst.ts:1892-1893`:

```ts
const designerType = typeMap[inputNode.type];
if (!designerType) return;
```

An AST node whose type is not in `typeMap` is **silently dropped on import**. So
if `richText` ships without designer support, a tenant who opens their quote
layout in the designer, changes a margin and saves, loses the Terms & Conditions
node with no error and no warning. That is the argument for FR18 (full designer
support) and FR19 (make the drop loud). Open Question 2 is whether both must land
in this card.

### 4. Tenant layouts will not pick up a standard-template change

`templateSelection.ts` resolves a tenant's layout from
`quote_document_templates` (per-tenant, PK `(tenant, template_id)`, whole AST in
a `templateAst` jsonb column), falling back to
`standard_quote_document_templates` (global), falling back to the in-code
`standardTemplates.ts`. So **three** places carry the stock AST and all three
need the `terms-copy` change, including the in-code fallback the card did not
mention.

The precedent migration
`20260908100001_update_standard_quote_templates_catalog_description.cjs`
deliberately touches only the global standard rows, with a comment: *"Tenant-owned
custom quote templates … are left byte-for-byte unchanged."* Following that
precedent here would mean any tenant who has ever cloned a stock layout never
gets a working link, with nothing to tell them why. FR17 departs from it under a
stock-shape guard. **Needs sign-off** — Open Question 1.

## Decisions

**D1 — Dual column, block wins, one flattening helper.** Add
`terms_and_conditions_block jsonb`; keep `terms_and_conditions` text as the
plain-text projection. Chosen over a single column because the text column is
load-bearing for the REST API (`quoteSchemas.ts:87`), the workflow business
operations (`crm.ts:278,1380,1611`, `crmWorkerDal.ts:60`) and the existing
`termsAndConditions` binding — all of which want a string. The risk of dual
columns is drift across the five copy sites, so the flattening goes through one
shared helper (F019) rather than being open-coded per site.

Copy sites that must carry both, found by grepping `terms_and_conditions`:
`quoteActions.ts:1117`, `:1179`, `:1251`, `models/quote.ts:407`,
`crm.ts:1611`. All five use the same `input ?? source ?? null` idiom.

**D2 — A column, not a sibling table.** `document_block_content` is the repo's
other jsonb-content pattern, but it is a table keyed by `(tenant, document_id)`
because a document *has* content. Terms are a scalar field on a quote. Column,
following `20260819120000`.

**D3 — One HTML pipeline for all three surfaces.** The card suggested
`RichTextViewer` for the two UI surfaces and `convertBlockContentToHTML` for the
PDF. Those are two different renderers — `RichTextViewer` mounts a read-only
BlockNote editor (`packages/ui/src/editor/RichTextViewer.tsx:652-657`,
`dynamic(..., {ssr:false})`), the other emits an HTML string — so that split
guarantees the three surfaces *can* disagree, which is exactly what the card says
must not happen. All three go through `convertBlockContentToHTML` behind one
shared component (F047).

Cost of this decision: it diverges from the ticket pattern, where
`RichTextViewer` is the standard for display
(`packages/tickets/src/components/ticket/TicketInfo.tsx:1991`,
`packages/client-portal/src/components/tickets/TicketDetails.tsx:845-848`). Taken
knowingly — a quote is a document whose PDF is the artifact that matters, so the
PDF's renderer is the one the screens should match.

**D4 — Editor is `TextEditor`, following the ticket pattern.** The ticket path is
the one with real persistence: `parseTicketRichTextContent` /
`serializeTicketRichTextContent` (`packages/tickets/src/lib/ticketRichText.ts:588-605`),
state as `PartialBlock[]`, `JSON.stringify` on save. `DocumentCard.tsx` looks
like a simpler example but its `handleSave` is a stub — do not copy it.

Note `TextEditor` emits `PartialBlock[]` via `onContentChange`, not a string, so
`QuoteForm`'s generic `handleChange(field, value: string)` (`:377-379`) cannot
carry it (F049).

## Verified file map

| What | Where |
|---|---|
| `quotes` table | `server/migrations/20260320100000_create_quotes_tables.cjs:27` (`terms_and_conditions`), `:28` (`is_template`) |
| Business templates | rows in `quotes` with `is_template = true` — not a separate table. `quote_document_templates` is PDF *layouts*, unrelated. |
| Types | `packages/types/src/interfaces/quote.interfaces.ts:102,267` |
| Internal zod | `packages/billing/src/schemas/quoteSchemas.ts:32` |
| REST zod | `server/src/lib/api/schemas/quoteSchemas.ts:87` |
| Workflow zod | `shared/workflow/runtime/actions/businessOperations/crm.ts:278`, `crmWorkerDal.ts:60` |
| Copy sites | `quoteActions.ts:1117,1179,1251`; `models/quote.ts:407`; `crm.ts:1611` |
| View model | `packages/billing/src/lib/adapters/quoteAdapters.ts:583` |
| Binding | `packages/billing/src/lib/quote-template-ast/bindings.ts:19-24` |
| Stock AST (code) | `packages/billing/src/lib/quote-template-ast/standardTemplates.ts:198,200,396,398,619,621,853,855` |
| Stock AST (seed) | `server/migrations/20260320103000_create_standard_quote_document_templates.cjs:100-101,193-194` |
| Layout resolution | `packages/billing/src/lib/quote-template-ast/templateSelection.ts` |
| PDF entry | `pdfGenerationService.ts:925-966` (`getQuoteHtml`) |
| Editor form | `QuoteForm.tsx:1494` (TextArea), `:55-81` (state), `:393-402` (template prefill), `:449` (payload) |
| MSP display | `QuoteDetail.tsx:1259-1260` |
| Portal display | `packages/client-portal/src/components/billing/QuoteDetailPage.tsx:650-656` |

`convertBlockContentToHTML` at `pdfGenerationService.ts:1036` is real but sits in
`getDocumentHtml`, the generic uploaded-document path — it has nothing to do with
quotes or the AST renderer. The card cited it as precedent for trusting the
helper; the precedent holds, the code path does not overlap.

## Coordination

Sibling card "Quote template fields never reach the new quote" has committed its
plan at `ee/docs/plans/2026-09-12-quote-template-instantiation/` (commit
`fcd6d7b867` on its own branch). Two of its changes land in files this card
edits:

- It renames `QuoteForm`'s `template_id` state field to `source_template_id`.
- It adds `whiteSpace: 'pre-line'` to the AST `text` node at
  `react-renderer.tsx:570-576`, as `{ whiteSpace: 'pre-line', ...style }` so a
  layout author can override it.

Sequence this card after it. F032 keeps the `pre-line` treatment in the
`richText` node's plain-text fallback. As of this writing that change has not
landed on this branch — `react-renderer.tsx:570-577` still renders a bare
`<p>{String(content ?? '')}</p>`.

`~/alga-psa` (main checkout) has uncommitted WIP touching `quoteActions.ts`,
`QuoteForm.tsx`, `QuoteDetail.tsx`, `QuotesTab.tsx` and `pdfGenerationService.ts`
for PDF filenames and titles. Unrelated to T&Cs, overlapping files.

## Leverage notes

- There are now at least three implementations of "render BlockNote JSON for
  display": `convertBlockContentToHTML` (string HTML),
  `packages/ui/src/editor/RichTextViewer.tsx` (read-only BlockNote), and a
  hand-rolled walker in
  `packages/client-portal/src/components/kb/ClientKBArticleView.tsx:129`
  ("Simple TipTap/BlockNote JSON renderer"). D3 picks one for this card and does
  not consolidate. Candidate for a `// LEVERAGE: pattern blocknote-render`
  marker at the three sites.
- `blocknoteUtils.ts` has one correct `escapeHtml` at `:3` and at least four
  divergent inline re-implementations (`531`, `550`, `563`, plus the two broken
  ones). F015 collapses them. The broken pair is the direct cost of that
  duplication — a fix applied to the helper never reached the copies.
- `workspaceAst.ts:1892`'s silent drop makes *every* future AST node type a
  data-loss risk, not just this one. F042 makes it loud; preserving unknown nodes
  through a designer round-trip would be the real fix and is out of scope here.

## Commands

```bash
# Dev stack for this worktree
cd /home/robert/alga-copies/feature-rich-text-in-quote-terms-conditions-hyperlink-to

# Converter tests (vitest)
npx vitest run packages/formatting/src/blocknoteUtils.prosemirror.test.ts
npx vitest run packages/formatting/src/blocknoteUtils.image.test.ts

# Existing quote coverage
npx vitest run packages/billing/tests/quote/

# Confirm quotes is not distributed (in any env with citus)
# SELECT citus_table_type, distribution_column FROM citus_tables WHERE table_name::text = 'quotes';
```

Existing converter tests: `packages/formatting/src/blocknoteUtils.prosemirror.test.ts`
(287 lines — covers link marks with an `https` href, but no malicious-scheme
case) and `blocknoteUtils.image.test.ts`. Neither covers the broken escapes, the
style/class injection, or any scheme rejection.

## Implementation status (Draft Implementation)

All 55 features are implemented. Landing notes and the one migration trap
discovered while wiring the PDF:

- **Converter (F001–F015).** `sanitizeHref` / `sanitizeImageSrc` export from
  `blocknoteUtils.ts`; applied at every BlockNote and ProseMirror href site,
  the image `src`, the code-block/unknown-content escapes, the `language`
  class and the colour/alignment style sites. 39 formatting tests pass,
  including the new `blocknoteUtils.security.test.ts`.
- **Storage/projection (F016–F028).** `quotes.terms_and_conditions_block`
  jsonb migration plus `quoteTermsContent.ts` (`normalizeQuoteTermsFields`),
  used by `Quote.create`/`Quote.update` and all five copy sites. A plain-string
  write clears the block column; a structured write projects to text.
- **AST/PDF (F029–F041).** `richText` node in the types union, zod schema,
  `i18nLabels`, `react-renderer` and the four stock layouts. `react-renderer`
  emits converter HTML for structured values and `white-space: pre-line` for
  the plain-string fallback. Migration
  `20260912121000_rewrite_quote_terms_copy_to_rich_text.cjs` rewrites the
  stock `terms-copy` node in the global and tenant-owned layouts under the
  stock-shape guard.

  **Trap:** rewriting the node alone is not sufficient. The AST's
  `bindings.values` must also declare `termsAndConditionsRich`
  (`path: terms_and_conditions_rich`) or the evaluator resolves nothing and the
  PDF terms section renders empty (the MSP/portal UI reads the view model
  directly, so it looked correct). The migration now syncs the binding
  alongside the node; the contract test asserts it.
- **Designer (F042–F046).** `richText` is a first-class `DesignerComponentType`
  with schema, palette, canvas preview and both `workspaceAst` directions.
  `workspaceAst` now throws on an unrecognized node type instead of dropping
  it.
- **Editor/display (F047–F055).** `QuoteTermsContent` in
  `packages/ui/src/editor` is the one display pipeline for MSP detail and the
  client portal; `QuoteForm` uses `TextEditor` with structured
  `PartialBlock[]` state seeded from the block column (split per legacy line)
  or the plain-text column, and renders `QuoteTermsContent` read-only.

### Verification

- `packages/formatting`: 39 passed. `packages/ui` QuoteTermsContent: 4 passed.
- Targeted `packages/billing` + server: 67 passed (renderer, schema,
  projection, designer round-trip, migration contract).
- Full `packages/billing` suite: 1311 passed; all `workspaceAst.*`: 126 passed.
- Dev stack (port 3412, compose `alga-psa-local-test`), Playwright on Chrome:
  - MSP (`/msp/quote-approvals?quoteId=…`) rich terms → `<strong>` + anchor
    `https://example.com/terms` + two `<p>`; `javascript:` link → no anchor,
    text kept; plain-text quote → `<p>` with `white-space: pre-wrap`.
  - Client portal (`/client-portal/billing/quotes/…`) — same three outcomes.
  - Downloaded PDF (`pdf-lib`) contains a `/Link` annotation whose URI is
    `https://example.com/terms`, and the terms text is present.
- The dev DB migration runner (`migrate:ee`) aborts because the shared DB
  carries migrations from other worktrees; the two feature migrations were
  applied by invoking their `up()` directly. They stay idempotent and are safe
  to re-run once the DB's migration list is reconciled.
- Not covered by an automated test: the full `QuoteForm` component
  (T019/T020) and DB-integration copies (T008/T010/T011). The behaviors were
  exercised by the projection unit tests and the live smoke, but the plan's
  DB-integration suites were not added here.

## Review repairs (second pass)

Five defects from the first review, all fixed and covered by real tests.

1. **jsonb array serialization.** `normalizeQuoteTermsFields` kept the block as
   a JS array, and node-postgres serializes an array parameter as a PostgreSQL
   array literal (`{...}`), not JSON. Added
   `serializeQuoteTermsBlockForDb` / `prepareQuoteTermsForDb` in
   `quoteTermsContent.ts` and applied it at every Knex write of a `quotes` row:
   the billing `Quote.create`/`Quote.update`/`createRevision`, and the separate
   workflow `Quote` in `crmWorkerDal.ts` (which `crm.ts` uses and which
   previously bypassed normalization). Arrays stay arrays in application state
   and in records returned from the DB.
2. **QuoteForm editor never consumed external content.** The mounted
   `TextEditor` builds its document once; template selection updated
   `termsBlock` but not the editor. QuoteForm now bumps a `termsEditorKey` only
   on quote load / template selection and passes it as `TextEditor key`, so the
   document is replaced on external replacement while ordinary typing keeps the
   same instance (cursor/undo preserved).
3. **Dual-field inheritance.** `createQuoteFromTemplate` applied `?? `
   independently to the two terms fields, so clearing restored the template's
   terms and a plain-text override inherited the template block. The two fields
   are now resolved together: supplied (`undefined` vs `null` distinguished)
   wins, inherit only when neither is supplied.
4. **Legacy PDF compatibility (sibling prerequisite).** The AST `text` node now
   renders with `whiteSpace: 'pre-line'` (the sibling card's change), and the
   `richText` plain-value fallback mirrors the text node exactly — including an
   empty paragraph for empty/null — so a migrated stock layout reproduces the
   legacy output instead of omitting the paragraph. `F033`/`T014` wording was
   corrected to match; a before/after regression compares the two node types for
   multiline and empty legacy terms.
5. **Coverage.** Added real-Postgres tests
   (`server/src/test/infrastructure/billing/quotes/quoteTermsRichText.test.ts`):
   create/update/reload, plain-write-clears-block, clear-both, `createRevision`
   copy, and REST `QuoteService` create/update. Extended the mocked
   `quoteActions.test.ts` for inherit / rich override / plain override /
   explicit clear through `createQuoteFromTemplate`. Extended the workflow
   `businessOperations.crm.db.test.ts` for template duplication with rich
   terms. Added `QuoteForm.terms.test.tsx` for select-template-after-mount,
   edit, save and reopen. T008/T010/T011/T019/T020 now marked implemented.

### Smoke (dev :3412, dedicated disposable fixtures)

Authored two paragraphs in the MSP BlockNote editor, saved, reopened (editor and
DB both show the structured block), then rendered the same quote on the MSP
detail, in the client portal, and in the downloaded PDF — all show both
paragraphs. Separately opened a tenant quote layout containing a `richText`
terms node in the visual designer, renamed the layout (unrelated change), saved,
and confirmed the persisted AST still carries the `richText` node and
`termsAndConditionsRich` binding. The disposable client/contact/user/quote and
layout were deleted afterwards.

### Known residue

The earlier smoke changed the client of quote `dc68315e` ("Smoke EUR Template
20260912-0511"). Its original `client_id` could not be recovered from reliable
evidence — no audit/activity record, no document association, and the sibling
template has `client_id: null` — so recovery is reported blocked rather than
guessed. The other smoke quotes were restored.

## Review repair — runtime import chain (third pass)

The second pass moved the worker import to `@alga-psa/billing/lib/quoteTermsContent`,
but `packages/billing/package.json` does not export `./lib/*`, and
`shared/tsup.config.ts` externalizes `@alga-psa/*`. The built shared
`workflow/runtime/index.js` therefore kept an eager import of a non-exported
subpath, and native Node failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

Fix — one implementation, runtime-safe home:

- The canonical `isEmptyTermsBlock` / `serializeQuoteTermsBlockForDb` /
  `normalizeQuoteTermsFields` / `prepareQuoteTermsForDb` now live in
  `shared/lib/quoteTerms.ts` (`@alga-psa/shared`), which imports
  `flattenBlockContentToPlainText` from `@alga-psa/formatting/blocknoteUtils`.
- `shared/package.json` gains `"./lib/quoteTerms"` → `./dist/lib/quoteTerms.js`
  (plus the `.js` alias), and declares `@alga-psa/formatting` as a dependency.
  `shared/tsup.config.ts` gains the `lib/quoteTerms` entry, and
  `shared/project.json` now builds `@alga-psa/formatting` first.
- `packages/billing/src/lib/quoteTermsContent.ts` re-exports from
  `@alga-psa/shared/lib/quoteTerms`, so billing keeps its internal import path
  and there is no shared→billing edge.
- `crmWorkerDal.ts` imports the shared module relatively
  (`../../../../lib/quoteTerms`), which the shared build bundles.
- `packages/formatting/package.json` exports now point `import`/`require` at the
  built `dist/*.js` (types still from `src`), and its tsup config emits `.js`
  extensions (`addJsExtensions`) so native Node can load the built package. The
  shared module's transitive formatting dependency therefore resolves in
  deployed artifacts instead of relying on Node TS stripping.

Verification:

- `shared/__tests__/quoteTermsRuntimeExports.test.ts` (native Node, built
  artifacts): the built workflow runtime loads with no package-path errors,
  `@alga-psa/shared/lib/quoteTerms`, `@alga-psa/formatting/blocknoteUtils` and
  `@alga-psa/formatting` all import under native Node, no built shared file
  references `@alga-psa/billing/lib/quoteTermsContent`, and the worker source
  imports the shared module.
- Rebuilt `@alga-psa/formatting`, `@alga-psa/event-bus` and `@alga-psa/shared`;
  `npm run build` in `ee/temporal-workflows` succeeds and its dist has no
  billing-subpath import.
- Rerun: billing 1322, formatting 39, ui 4, targeted server 49, workflow crm db
  13; typechecks clean for billing, shared, formatting, ui. Dev server on 3412
  still renders quote terms after the refactor.
