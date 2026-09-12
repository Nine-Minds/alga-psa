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
