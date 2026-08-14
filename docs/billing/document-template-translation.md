# Translating Customer Documents

**Related Documentation:**
- [invoice_templates.md](./invoice_templates.md) — the AST engine these documents are built on
- [quoting-system.md](./quoting-system.md) — quote document templates
- [../../tools/i18n/README.md](../../tools/i18n/README.md) — translation QA tooling and per-locale glossaries

## 1. What this covers

Every document a client receives — invoice, quote, sales order confirmation,
packing slip, pick list — is rendered from a `TemplateAst`. Its chrome
(`Subtotal`, `Qty`, `Rate`, `Bill To`, `Terms & Conditions`, …) is template
content, not UI copy, so changing the app's language never reached it. Standard
templates now carry translatable labels and render in the **recipient's**
language.

Translated:

- Labels authored into the standard templates: section titles, field labels,
  table column headers, empty-state text, totals row labels, and standalone
  headings such as `Bill To`.
- Numbers, dates and currency in the same document.

Not translated, deliberately:

- **Customized templates.** A tenant who edited a template keeps exactly what
  they authored, in the language they authored it. See §5.
- **Entered data.** Service names, line-item descriptions, notes and any other
  client-entered text stay as typed. A German frame around English line items
  is the intended outcome.
- **Compliance content.** A translated label is not a jurisdiction-compliant
  invoice; tenants own that through the designer.
- **Documents already issued.** Generated PDFs are stored artifacts. Nothing
  re-renders what a client already received.

## 2. Labels are key-or-literal

A label in the AST is either a literal string, used exactly as written, or a
key reference:

```jsonc
// literal — rendered as-is, in every locale
{ "id": "subtotal", "label": "Subtotal" }

// key reference — resolved against the recipient's locale
{ "id": "subtotal", "label": { "i18nKey": "labels.subtotal", "defaultValue": "Subtotal" } }
```

`TemplateI18nText = string | { i18nKey, defaultValue }`
(`packages/types/src/lib/invoice-template-ast.ts`, mirrored in
`packages/billing/src/lib/invoice-template-ast/schema.ts`). Text nodes take the
same idea as a value expression: `{ type: 'i18n', i18nKey, defaultValue }`.

The change is additive — every AST written before it is still valid, and
literal-only templates render byte-identically. That is what makes the
no-surprises rule structural rather than a convention someone has to remember.

`defaultValue` is the authored English and is what renders if the key is
missing, the locale pack fails to load, or an unresolved reference somehow
reaches the renderer. A key never leaks into a customer's document.

**Only display fields are keys.** Node ids, binding ids, transform ids, column
ids and paths are machine identifiers. Translating one corrupts a rendered
document while passing every gate, so `resolveTemplateAstI18n` walks the
display fields and nothing else, and
`packages/billing/src/lib/document-templates/standardTemplateI18n.test.ts`
pins every id and path against a manifest.

## 3. One locale per document

The recipient's locale wins for both labels and formatting. A document with
German labels and American dates is worse than a consistently English one, so
the two can never diverge:

1. `PDFGenerationService.resolveRenderLocale()` resolves the recipient —
   billing contact → client → tenant, through the same `resolveEmailLocale`
   hierarchy the outbound email uses.
2. `localizeTemplateAstForLocale(ast, locale)`
   (`packages/billing/src/lib/invoice-template-ast/i18nLabels.ts`) loads the
   `documents` namespace for that locale, resolves the key references, and
   returns both the localized AST and the locale that actually applied.
3. That same locale is handed to the renderer, which formats currency and dates
   through `fieldFormatting.ts` (dates stay pinned to UTC so they do not follow
   the server's timezone).
4. It is recorded on the filed document as `documents.rendered_locale`, so every
   stored artifact answers "what language was this?".

`metadata.locale` on the AST is an authoring-time default only. It applies when
no recipient can be resolved, and it never overrides a resolved recipient.

Where nothing resolves — no client, no tenant default, a locale pack that will
not load — rendering falls back to English **for labels and formatting
together** rather than failing. A document that renders in the wrong language is
recoverable; one that fails to render is not.

## 4. The render paths

Every path that produces a client-facing document goes through the same seam,
so an on-screen preview is authoritative about what the client receives:

| Path | Entry point | Locale source |
|------|-------------|---------------|
| PDF generation (invoice / quote / sales order) | `pdfGenerationService.ts` → `renderTemplateAstHtmlDocument({ locale })` | `resolveRenderLocale()` |
| Invoice preview panel | `renderTemplateOnServer({ invoiceId })` (`invoiceTemplates.ts`) | `resolveRenderLocale({ invoiceId })` |
| Quote preview | `renderQuotePreview` (`quoteActions.ts` → `PDFGenerationService.renderQuotePreview`) | `resolveRenderLocale({ quoteId })` |
| Designer preview (sample data) | `runAuthoritativeTemplatePreview` / `…InvoiceTemplatePreview` / `…QuoteTemplatePreview` | the language picked in the designer |

`renderTemplateAstHtmlDocument` also emits `<html lang="…">` for the locale it
rendered in.

A designer preview with **no** invoice or quote behind it renders sample data in
the selected language; it passes no entity id, so it cannot resolve a recipient
and does not try to.

## 5. Standard vs customized templates

| | Labels | Behavior |
|---|---|---|
| Standard template | Key references | Renders in the recipient's language |
| Customized template | Literals | Renders exactly as authored, in every locale |

Editing a label in the designer inspector replaces its key reference with the
literal you typed (`exportI18nText` in
`packages/billing/src/components/invoice-designer/ast/workspaceAst.ts` keeps the
key only while the text still equals its `defaultValue`). Customizing a label
freezes that label — which is the intended trade, and worth saying out loud in
support conversations.

So the adoption path for a tenant who wants translated documents is: **start
from a standard template, which arrives in their clients' languages, and
customize from there.** A tenant who already customized keeps their English (or
hand-translated) labels until they choose to re-adopt a standard template.

Refreshed standard templates ship as an ordinary migration
(`server/migrations/20260813120000_upsert_i18n_standard_document_template_asts.cjs`),
which upserts by standard code into `standard_invoice_templates` and
`standard_quote_document_templates`. Tenant-owned tables are never touched by
it.

## 6. Previewing in another language

The invoice, quote and document template editors carry a language selector
(`PreviewLocaleSelect`), defaulting to the language the app is currently in and
offering every supported locale. It is how an author checks a template before a client
ever sees it — including at the longest locale, since German runs routinely 30%
longer than English and a totals column that fits `Subtotal` may not fit
`Zwischensumme`.

The designer always renders in the language the author picked, including when it
is pulling an existing invoice's data for realistic content — it is an authoring
surface, and the author is choosing what to look at. The Invoice Preview Panel
and the quote preview are the opposite: they render a specific document for a
specific client, so they use that client's language, without a selector,
because the question they answer is "what will this client receive?".

## 7. Adding or changing a label

1. Add the key to `server/public/locales/en/documents.json` under `labels.`
   (`labels.emptyState.` for empty-state text, `labels.note.` for the sentences
   printed on a document).
2. Reference it from the standard template with the English as `defaultValue`:
   `{ i18nKey: 'labels.yourKey', defaultValue: 'Your Label' }`.
3. Translate it in all seven locales — `de`, `es`, `fr`, `it`, `nl`, `pl`, `pt`.
   Check the locale's glossary first (`tools/i18n/<locale>/glossary.json`): it
   carries the domain terms, forbidden terms and register rules, including the
   document-specific ones (see §8).
4. Update `standardTemplateI18n.manifest.json` if the template's structure
   changed, and re-run the gates in §9.

Keep an eye on column width when translating: the standard templates were
checked at their longest locale, not just English.

## 8. Glossary rules that came out of document review

Recorded as domain terms in every locale glossary, after a native-speaker review
of the shipped labels:

- **`rate` and `unit price` must stay distinct.** German originally resolved
  both to *Einzelpreis*, which would be indistinguishable on a document showing
  both columns. Rate is *Satz* (fr *tarif*, nl *tarief*, pl *stawka*,
  es/pt *tarifa*, it *tariffa*); unit price stays *Einzelpreis* /
  *prix unitaire* / *stukprijs* / …
- **`tax` stays neutral.** Dutch *btw* and French *TVA* name value-added tax
  specifically; a tenant charging a different levy would be misdescribed. Use
  *belasting*, *taxes*, *Steuer*, *podatek*, *impuesto*, *imposta*, *imposto*,
  and name a specific tax only where that tax is actually meant.
- **`fulfillment` follows the sales-order column.** The document label uses the
  same term the locale's own sales-order table uses (de *Auslieferung*, nl
  *afhandeling*, fr *livraison*, …), not a shipping-method word.
- **`pick list`** is *Kommissionierliste* / *kommissioniert* in German and
  *picklijst* / *gepickt* in Dutch, matching the signature line printed on the
  document itself.

The same principle applies generally: when a document label names a field the
app already shows in a table, use the term that table already uses.

## 9. Tests and gates

- `npm run test:i18n` — pseudo-locale generation, translation validation, the
  per-locale audits, glossary schema/invariants and template parity. This is the
  gate that covers `server/public/locales/*/documents.json`.
- `packages/billing/src/lib/document-templates/standardTemplateI18n.test.ts` —
  every display label in all four template families is a key present in
  `en/documents.json`, and every id, binding id and path matches the pinned
  manifest.
- `packages/billing/src/lib/invoice-template-ast/server-render.locale.test.ts` —
  a literal-only (customized) template renders identically under a non-English
  locale; a degraded locale load falls back to English labels *and* English
  formatting.
- `packages/billing/src/services/pdfGenerationService.locale.test.ts`,
  `…renderedLocale.test.ts`, `…previewLocale.test.ts` — the recipient locale
  wins over `metadata.locale`, an unresolvable recipient renders English rather
  than failing, and `rendered_locale` records the locale actually rendered.
- `packages/billing/src/actions/renderTemplateOnServer.locale.test.ts` — the
  invoice preview panel renders in the client's language.
- `packages/billing/src/components/invoice-designer/ast/workspaceAst.roundtrip.i18n.test.ts`
  — key references survive a designer round trip, and an edited label becomes a
  literal.

Note that `tools/i18n/find-untranslated-ui.cjs` cannot see any of this: it scans
`server/src` and `ee/server/src`, while document chrome lives in
`packages/billing`. Document labels are covered by the tests above instead.
