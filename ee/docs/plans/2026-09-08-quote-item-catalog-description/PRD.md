# Quote Item Catalog Description

## Problem

Quote line items currently retain a product/service name and an editable line description, but they do not retain the catalog description that existed when an item was selected. The default quote table consequently renders the name where users expect a customer-facing catalog description, and the layout designer cannot place the item name above that description in one table cell.

## User value

MSP staff can produce quotes whose line items show a concise item name followed by the detailed catalog description, while preserving a separately editable line description and stable historical output.

## Goals

- Snapshot the catalog description when a catalog-backed line is created or its selected catalog item changes.
- Expose `Item Name`, `Catalog Description`, and `Line Description` as distinct quote layout fields.
- Let a dynamic-table cell render name above catalog description with independent line styling.
- Update standard quote layouts to use the stacked presentation consistently across ordinary, recurring, one-time, grouped, and location-grouped tables.
- Preserve snapshot values through quote duplication, revision, quote-template save/use, preview, PDF, and supported server/API item creation.
- Keep monetary calculations and existing saved layouts unchanged.

## Non-goals

- Total-row branding, discount-allocation changes, or unrelated quote work.
- Reconstructing historical catalog descriptions from current catalog data.
- Live catalog lookups during rendering.
- Replacing or reinterpreting the existing editable `description` field.

## Product and data decisions

1. Add nullable `quote_items.catalog_description` and corresponding nullable fields to persisted, draft, and quote view-model types.
2. `description` remains the user-editable line description and keeps its current defaults for compatibility. `service_name` remains the item-name snapshot.
3. For a new catalog-backed item, the server resolves the tenant-scoped catalog row and writes its current description into `catalog_description`. Client picker data may improve immediate draft preview, but is not trusted as the persistence source of truth.
4. `null` means no catalog description was captured. Empty catalog text normalizes to `null`. Custom and discount lines use `null`.
5. Existing rows remain `null`; there is no backfill because current catalog text cannot be represented as an historical snapshot. Existing layouts continue rendering their current `description` binding.
6. Duplication, revision, save-as-template, and create-from-template copy the stored snapshot exactly, including `null`; they do not refresh it from the catalog.
7. If a line's catalog selection changes, recapture name, SKU, kind, and catalog description together. Ordinary edits to quantity, price, or line description do not refresh the snapshot.
8. Extend table columns backward-compatibly with optional stacked cell lines. Legacy columns retain their single `value`; a stacked column contains ordered line expressions and per-line styles. The editor exposes a preset rather than forcing existing custom layouts to migrate.

## Primary flow

1. A user selects a product or service with a distinct name and catalog description.
2. The draft immediately shows the captured values and persists them through the server-side catalog lookup.
3. In the quote layout designer, the user can bind Item Name, Catalog Description, or Line Description independently, or add the `Item name + catalog description` stacked column preset.
4. Preview and PDF render the item name first and catalog description beneath it. Missing descriptions collapse cleanly without `undefined`, duplicate fallback text, or an empty visual gap.
5. Reopening, duplicating, revising, or templating the quote preserves the captured value even if the catalog later changes or is deleted.

## Implementation sequence

1. Add the nullable database column and shared TypeScript/Zod contracts.
2. Thread catalog description through catalog picker search and fallback retrieval for immediate draft state.
3. Centralize authoritative snapshot capture in `QuoteItem.create`; add explicit selection-change handling rather than refreshing snapshots during unrelated updates.
4. Thread the field through `DraftQuoteItem`, `QuoteForm` persistence, adapters, samples, duplication, revision, and template flows.
5. Register the three clearly labelled quote line-item bindings in `documentBindingCatalog.ts`.
6. Extend `TemplateTableColumn`, AST validation, workspace import/export, designer table editor, canvas, React/server rendering, and tests with optional stacked lines while preserving legacy `value` columns.
7. Add the stacked preset to standard and designer quote templates, including grouped and location-grouped variants; update seeded standard templates through an additive migration without rewriting customer-owned custom ASTs.
8. Add focused behavioral tests and complete live designer preview/PDF smoke evidence.

## Impacted modules

- `server/migrations/*quote_item_catalog_description*.cjs`
- `packages/types/src/interfaces/quote.interfaces.ts`
- `packages/types/src/lib/invoice-template-ast.ts`
- `packages/billing/src/schemas/quoteSchemas.ts`
- `packages/billing/src/actions/serviceActions.ts`
- `packages/billing/src/actions/quoteActions.ts`
- `packages/billing/src/models/quoteItem.ts`
- `packages/billing/src/models/quote.ts`
- `packages/billing/src/components/billing-dashboard/contracts/ServiceCatalogPicker.tsx`
- `packages/billing/src/components/billing-dashboard/quotes/quoteLineItemDraft.ts`
- `packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx`
- `packages/billing/src/lib/adapters/quoteAdapters.ts`
- `packages/billing/src/components/invoice-designer/fields/documentBindingCatalog.ts`
- `packages/billing/src/components/invoice-designer/inspector/widgets/TableEditorWidget.tsx`
- `packages/billing/src/components/invoice-designer/ast/workspaceAst.ts`
- `packages/billing/src/components/invoice-designer/canvas/DesignCanvas.tsx`
- `packages/billing/src/lib/invoice-template-ast/schema.ts`
- `packages/billing/src/lib/invoice-template-ast/react-renderer.tsx`
- `packages/billing/src/lib/quote-template-ast/standardTemplates.ts`
- `packages/billing/src/components/invoice-designer/constants/presets.ts`
- Quote preview/PDF sample and behavioral test modules adjacent to the files above.

## Risks and mitigations

- **Historical misrepresentation:** do not backfill old rows; render graceful fallbacks.
- **Snapshot refresh during copies:** distinguish new catalog selection from copy flows and pass stored values explicitly.
- **AST compatibility:** make stacked lines optional and continue accepting/rendering legacy `value` columns unchanged.
- **Long content and pagination:** use wrapping and block-safe row behavior already shared by preview and server/PDF rendering; exercise multiline and long text in real output.
- **Unrelated local changes:** preserve the pre-existing root `package-lock.json` modification and exclude it from implementation commits.

## Acceptance criteria

- Product and service selections with distinct names/descriptions retain both values and render name above catalog description in preview and exported PDF.
- Line description remains separately editable and is never overwritten by catalog-description capture.
- Cached picker, fallback picker, and server/API create paths produce consistent snapshots with tenant validation.
- Missing descriptions, custom items, discounts, deleted catalog entries, and long/multiline text render without duplicate fallback text or broken layout.
- Catalog edits do not alter existing quote output; duplicate/revision/template flows preserve the stored snapshot.
- Existing saved layouts and old quote rows continue to render; all supported grouping views expose the same fields.
- Focused DB-backed, adapter, AST round-trip, renderer, and real preview/PDF checks pass without changing quote totals.

