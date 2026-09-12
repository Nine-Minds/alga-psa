# PRD — Rich text in quote Terms & Conditions

- Slug: `2026-09-12-quote-terms-rich-text`
- Date: `2026-09-12`
- Status: Draft

## Summary

`quotes.terms_and_conditions` is a `text` column rendered as plain text on three
surfaces. An MSP that keeps its terms on a web page has no way to point at them;
the only option is pasting the whole document into every quote. This plan gives
the field structured rich text — links, bold, paragraphs — stored as BlockNote
JSON, rendered through one HTML pipeline so the MSP view, the client portal and
the PDF cannot disagree.

Two things must be true before that content reaches a client-visible document,
and neither is true today:

1. The BlockNote-to-HTML converter does not validate URL schemes, so a
   `javascript:` href survives into the emitted HTML.
2. Two of the converter's escape sites are silently broken —
   `.replace(/</g, '<')` is a no-op — so code-block text is emitted into HTML
   essentially unescaped.

The second is a live stored-XSS defect on the ticket and document surfaces that
already use this converter. It is fixed first, and it is the reason this plan
leads with the converter rather than the quote schema.

## Problem

### The feature gap

`terms_and_conditions` is plain `text`
(`server/migrations/20260320100000_create_quotes_tables.cjs:27`) authored through
a bare `<TextArea>` (`QuoteForm.tsx:1494`) and rendered as `whitespace-pre-wrap`
on the MSP detail (`QuoteDetail.tsx:1260`) and the client portal
(`QuoteDetailPage.tsx:653`). In the PDF, the AST `text` node emits
`{String(content ?? '')}` as a React child
(`react-renderer.tsx:570-577`), which React escapes — so HTML typed into the
field appears literally as `<a href=...>`. Safe, but there is no way to produce a
link on any surface.

### The security defect this uncovers

`convertBlockContentToHTML` (`packages/formatting/src/blocknoteUtils.ts:1203`) is
the repo's trusted BlockNote/ProseMirror-to-HTML converter, already used by
ticket rendering (`server/src/lib/api/services/ticketRichRender.ts:36`), document
handling (`packages/documents/src/handlers/BlockNoteDocumentHandler.ts:76,122`)
and PDF generation (`pdfGenerationService.ts:1036`). Auditing it before putting
quote content through it found that it does not escape everything it appears to:

| Site | Line | Defect |
|---|---|---|
| `codeBlock` text | `754` | `.replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>')` — every replacement is a no-op. Text is emitted unescaped. |
| Unknown-block string content | `786` | Same no-op pattern. |
| `class="language-${language}"` | `755` | Raw block prop interpolated into an attribute; attribute breakout. |
| `href` (BlockNote → HTML) | `526` | Escapes `&` and `"` only. No scheme check. |
| `href` (ProseMirror → HTML) | `840` | Full `escapeHtml`, but no scheme check. |
| `href` (both Markdown paths) | `262`, `1014` | Entirely raw. |
| `style="…${textColor}"` etc. | `303`, `308`, `337`, `347`, `500`, `572-580`, `638-653` | Colour and alignment props interpolated into `style` unescaped. |

Compare the correct escaping at `531`, `550`, `563` in the same file — the no-op
lines are a copy-paste defect, not a deliberate choice.

The blast radius today is tickets and documents, not quotes. It becomes a quote
problem the moment quote T&Cs render as HTML on a client-visible page.

### Where the plain-text assumption is load-bearing

`terms_and_conditions` is read or written in more places than the three display
surfaces. Each is a consumer that must keep receiving plain text:

- REST API create/update schemas —
  `server/src/lib/api/schemas/quoteSchemas.ts:87`
- Workflow business operations —
  `shared/workflow/runtime/actions/businessOperations/crm.ts:278,1380,1611` and
  `crmWorkerDal.ts:60`
- Five copy sites that clone the field between quotes:
  `quoteActions.ts:1117` (create from template), `:1179` (duplicate), `:1251`
  (save as template), `models/quote.ts:407` (create revision), and
  `crm.ts:1611` (workflow duplicate)
- The view-model adapter feeding the PDF —
  `packages/billing/src/lib/adapters/quoteAdapters.ts:583`

## Goals

1. Quote Terms & Conditions can carry links, emphasis and multiple paragraphs.
2. A link authored once renders identically — same href, same text — on the MSP
   quote detail, the client portal quote view and the PDF, and is clickable in
   the PDF.
3. A `javascript:`, `data:` or otherwise non-web URL is neutralized on all three
   surfaces.
4. Code-block and unknown-block content is HTML-escaped wherever the converter
   emits it, closing the existing defect on tickets and documents.
5. Every existing quote and business template — all of which hold plain text —
   renders exactly as it does today, including in already-issued PDF layouts.
6. Business templates (`quotes.is_template = true`) carry rich T&Cs, so terms
   authored once flow into every quote created from that template.

## Non-goals

- Rich text for `client_notes`, `internal_notes` or `description`. The same
  machinery will fit them; this plan does not spend the scope.
- Rich text anywhere in the invoice or sales-order document paths, beyond the
  shared converter hardening they inherit.
- A general-purpose sanitizer dependency. The source of truth stays structured
  JSON and raw HTML is never accepted from a user, so the fix is correct
  escaping and a scheme allowlist at the emission sites, not a scrubber on the
  way out.
- Retiring the duplicate BlockNote display implementations noted under Risks.
- Rewriting tenant-customized quote layouts that have diverged from stock.

## Users and Primary Flows

**MSP billing operator.** Opens a quote or a business template, writes terms
into the Terms & Conditions editor, selects text and applies a link to the
company's published terms page. Saves. The link is live on the quote detail, in
the PDF they download, and on the portal page the client sees.

**Client portal user.** Opens the quote, reads the terms, follows the link to
the full document in a new tab.

**Existing tenant who never opens the editor.** Sees no change anywhere. Their
plain-text terms continue to render with line breaks preserved.

## UX / UI Notes

The Terms & Conditions control in `QuoteForm.tsx`'s "Client-facing text" card
becomes the standard BlockNote editor. That card already renders for business
templates as well as quotes — it is not gated on `!isTemplate` — so the template
authoring path comes for free and must stay that way.

The sibling field `client_notes` stays a `TextArea`. The two controls sitting
side by side with different affordances is intentional: notes are a sentence,
terms are a document.

Both read-only surfaces render the converted HTML inside a container carrying the
existing prose styling, so a link is visibly a link. The MSP detail keeps its
em-dash placeholder when the field is empty; the portal keeps hiding the section
entirely.

## Requirements

### Functional Requirements

**Converter hardening** (`packages/formatting/src/blocknoteUtils.ts`)

- FR1. A single shared helper validates URL schemes and is applied at every
  `href` emission site — `262`, `526`, `840`, `1014`. `http`, `https` and
  `mailto` pass. Everything else — `javascript:`, `data:`, `vbscript:`, `file:`,
  unknown schemes — is dropped, and the link renders as its text content with no
  anchor.
- FR2. Protocol-relative (`//evil.example`) and scheme-bearing values disguised
  by leading whitespace, embedded control characters or mixed case
  (`JaVaScRiPt:`) are evaluated after normalization, not before.
- FR3. Relative and fragment hrefs (`/terms`, `#section`) are preserved — they
  are not a scheme and not a threat.
- FR4. The no-op escapes at `754` and `786` are replaced with the correct
  `escapeHtml`, and the `language` interpolation at `755` is escaped.
- FR5. Colour and alignment props interpolated into `style` attributes are
  escaped or validated at every site listed in the Problem table.
- FR6. All of the above route through the existing `escapeHtml` helper rather
  than new inline replacements, removing the divergent inline escapers in the
  file.

**Storage**

- FR7. `quotes` gains `terms_and_conditions_block jsonb` (nullable). The
  existing `terms_and_conditions` text column is retained as the plain-text
  projection.
- FR8. On every write that sets terms, the block column holds the structured
  value and the text column holds a flattened plain-text copy of it, produced by
  one shared helper so the two columns cannot drift.
- FR9. When both columns are populated, the block column is authoritative for
  display. When the block column is null, the text column renders as it does
  today.
- FR10. All five copy sites carry both columns together. A quote created from a
  template, duplicated, saved as a template, or revised, keeps its rich terms.
- FR11. The REST API and the workflow business operations continue to accept and
  return `terms_and_conditions` as a plain string. Writing through those paths
  sets the text column and clears the block column, so the value a caller wrote
  is the value that displays.

**PDF rendering**

- FR12. The template AST gains a `richText` node type, declared in both
  `packages/types/src/lib/invoice-template-ast.ts` and the zod schema at
  `packages/billing/src/lib/invoice-template-ast/schema.ts`.
- FR13. `react-renderer.tsx` renders a `richText` node by resolving its content
  binding and emitting the hardened converter's HTML via
  `dangerouslySetInnerHTML`. When the resolved value is not structured content,
  the node renders the plain-text fallback with the same `whiteSpace: 'pre-line'`
  treatment the `text` node uses.
- FR14. The `text` node is unchanged. Every existing layout keeps rendering
  through it.
- FR15. The quote view model exposes the block column alongside the text column
  so the `termsAndConditions` binding can resolve either.
- FR16. The stock layouts' `terms-copy` node becomes a `richText` node, in both
  the seeded rows and the in-code fallback
  (`packages/billing/src/lib/quote-template-ast/standardTemplates.ts`), which
  `templateSelection.ts` falls back to when no DB row exists.
- FR17. A migration rewrites `terms-copy` in the seeded
  `standard_quote_document_templates` rows and in tenant-owned
  `quote_document_templates` rows, but only where the node still matches the
  stock shape — `type: 'text'` bound to `termsAndConditions`. A node a tenant has
  edited is left alone and keeps working as plain text.

**Designer**

- FR18. `richText` is a first-class designer component type, present in
  `DesignerComponentType`, `componentSchema`, the palette catalog, the canvas
  preview switch, and both directions of `workspaceAst` conversion.
- FR19. `workspaceAst.ts`'s AST import no longer discards a node whose type it
  does not recognize. Today `if (!designerType) return;` (`:1892`) drops it
  silently, so opening and saving a layout in the designer would delete the
  terms block. It fails loudly instead, consistent with the repo's fail-fast
  standard.

**Editor and display**

- FR20. The Terms & Conditions control in `QuoteForm.tsx` is the standard
  BlockNote editor, loading from the block column and falling back to the text
  column for a quote that has never been edited richly.
- FR21. The editor renders for business templates on the same terms as quotes.
- FR22. `QuoteDetail.tsx` and the client portal's `QuoteDetailPage.tsx` render
  the converted HTML through one shared component, so neither surface carries its
  own conversion.

### Non-functional Requirements

- NFR1. `quotes` is **not** a Citus-distributed table. Verified against every
  `create_distributed_table` call in `server/migrations/`, and corroborated by
  `20260702140000_add_sales_order_quote_link.cjs:18-27`, which skips an FK
  precisely because `quotes` is not distributed. A plain `ALTER TABLE` is
  correct; no `truncate_local_data_after_distributing_table` guard is needed.
  The migration still follows house style — `hasColumn` guard, one subcommand per
  `alterTable` call — so it stays safe if `quotes` is distributed later.
- NFR2. The converter is shared by tickets, documents and PDFs. Its existing
  behaviour for every currently-emitted construct is preserved except where this
  plan states otherwise.

## Data / API / Integrations

New column:

```
quotes.terms_and_conditions_block  jsonb  NULL
```

Mirrors the `document_block_content.block_data` shape (BlockNote block array), as
a column rather than a sibling table because terms are a scalar per-quote field,
not a collection. This follows the add-jsonb-column precedent at
`server/migrations/20260819120000_add_board_pinning_and_list_view_settings.cjs:31-54`.

Types to extend: `IQuote` and `QuoteViewModel`
(`packages/types/src/interfaces/quote.interfaces.ts:102,267`), the internal zod
schemas (`packages/billing/src/schemas/quoteSchemas.ts:32`), and the AST node
union in `packages/types/src/lib/invoice-template-ast.ts`.

The REST schema (`server/src/lib/api/schemas/quoteSchemas.ts:87`) and the
workflow schemas keep `terms_and_conditions: string`. They are not extended in
this plan.

## Security / Permissions

This plan's security work is the converter hardening in FR1–FR6, and it is a
precondition rather than a follow-up: the same helper renders tickets and
documents, so the no-op escapes at `754`/`786` are exploitable today
independently of quotes.

No permission model changes. Quote T&Cs are already client-visible through the
portal; making them rich does not widen who can read them.

The plan deliberately adds no sanitizer dependency. The stored value is
structured JSON that the application itself serializes to HTML; user-supplied
raw HTML is never accepted or stored. Correct escaping plus a scheme allowlist at
the emission sites is the complete fix, and it is the fix that also protects the
existing consumers.

## Observability

No new instrumentation. FR19's loud failure on an unrecognized AST node type
surfaces through existing error handling.

## Rollout / Migration

One schema migration (the column) and one data migration (the `terms-copy`
rewrite), both idempotent and both with working `down`.

Existing tenants are unaffected until someone opens the editor: the block column
is null everywhere, so FR9 routes every quote through the text column and the
`richText` node's plain-text fallback reproduces the current output.

The `terms-copy` rewrite touches tenant-owned layouts, which is a departure from
the precedent set by
`20260908100001_update_standard_quote_templates_catalog_description.cjs` — that
migration deliberately left `quote_document_templates` untouched. The departure
is justified because a tenant who cloned a stock layout would otherwise never see
a link, with no indication why; the shape guard in FR17 keeps it from touching
anything a tenant actually authored. This needs sign-off before the migration is
written.

Sequencing against the sibling card "Quote template fields never reach the new
quote": that card renames `QuoteForm`'s `template_id` state field to
`source_template_id` and adds `whiteSpace: 'pre-line'` to the AST `text` node.
Both land in files this plan edits. This card follows it rather than running
beside it, and FR13 preserves the `pre-line` treatment in the fallback path.

## Open Questions

1. **Tenant layout rewrite (FR17).** Confirm the departure from the
   leave-tenant-rows-alone precedent, and confirm the stock-shape guard is the
   right boundary.
2. **Designer scope (FR18).** Full designer support is what makes FR19's silent
   drop harmless. Is shipping the designer component in this card correct, or
   should the card ship FR19's loud failure plus a designer-side read-only
   treatment and defer authoring?
3. **API surface (FR11).** Clearing the block column on a plain-string API write
   is the honest behaviour, but it means an integration that round-trips a quote
   through the REST API silently flattens rich terms. Is that acceptable, or
   should the API reject a plain-text write to a quote holding rich terms?
4. **Flattening fidelity (FR8).** Should a link flatten to its text, or to
   `text (url)`? The latter keeps the URL reachable for consumers reading only
   the text column — notably the workflow paths — at the cost of noise.

## Acceptance Criteria (Definition of Done)

1. A quote T&C authored with two paragraphs, bold text and an external link
   renders with the link present and clickable on the MSP quote detail, the
   client portal quote view, and the downloaded PDF, and the three agree.
2. A link whose URL is `javascript:alert(1)` renders as inert text on all three
   surfaces, with no anchor emitted.
3. A BlockNote code block containing `<script>alert(1)</script>` is escaped in
   the converter's output, verified by a test that fails against the current
   `754`/`786` implementation.
4. A quote whose `terms_and_conditions_block` is null renders byte-identically
   to its pre-change output, in all three surfaces and in a generated PDF.
5. A business template carrying rich terms produces a quote carrying the same
   rich terms, through create-from-template, duplicate, save-as-template and
   revision.
6. A tenant layout whose `terms-copy` node was customized still renders its terms
   after the migration.
7. Opening a quote layout in the designer, making an unrelated change and saving,
   leaves the terms block intact.
