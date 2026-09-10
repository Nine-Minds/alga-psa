# Scratchpad — Quote Item Catalog Description

## Durable decisions

- Keep `quote_items.description` as the editable line description; do not silently change its meaning.
- Add nullable `catalog_description` as a quote-time snapshot. No historical backfill.
- Server-side tenant-scoped catalog lookup is authoritative for new selections; picker propagation is for immediate UX.
- Copy/revision/template flows preserve the stored snapshot exactly rather than refreshing from the catalog.
- Add optional stacked table-cell lines; retain legacy single-expression columns unchanged.
- Update managed standard templates, not tenant-owned custom template ASTs.

## Code findings

- `serviceActions.ts` picker searches `sc.description` but omits it from `CatalogPickerItem` and the SELECT.
- `ServiceCatalogPicker.tsx` cached and `getServiceById` fallback paths both need the field.
- `quoteLineItemDraft.ts` currently sets line `description` to `service_name`.
- `QuoteItem.create` resolves tenant-scoped catalog identity but omits catalog description; this is the authoritative capture point.
- `QuoteForm.tsx` persists a shared payload through `addQuoteItem`/`updateQuoteItem` and must thread the snapshot deliberately.
- `quoteActions.ts` and `quote.ts` contain template, duplication, and revision item-copy loops that must preserve the snapshot.
- `quoteAdapters.ts` maps persisted items to the preview/PDF view model; `pdfGenerationService.ts` uses that adapter for both output paths.
- `documentBindingCatalog.ts` currently exposes only quote line `description`, while sales-order fields already demonstrate separate `service_name` registration.
- `TemplateTableColumn` and its Zod schema currently allow one `value` plus one column style; renderer cells format only that value. Independent stacked styling therefore needs an additive AST shape and matching editor/renderer support.
- Standard quote tables and grouped designer presets bind their Description column to `description`.

## Gotchas

- The worktree already contains an unrelated modified root `package-lock.json`; preserve it and exclude it from commits.
- A catalog item deletion after capture must not invalidate rendering.
- Empty and null catalog descriptions should not fall back to a duplicated item name in stacked output.
- Long/multiline catalog text needs real preview/PDF evidence, not source-string tests.

## Scope pointer

- Alga ticket: alga-2026-0002354.
