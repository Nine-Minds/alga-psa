# Editable Totals-Row Branding

## Problem

Invoice and quote templates can persist and render a distinct `style` and `labelStyle` for every totals row, but the visual designer exposes only the parent totals block's common appearance controls. Templates copied from the grouped quote preset therefore retain fixed purple/white row styles that users cannot edit visually.

## Goal

Let a template author edit each existing totals row's background and text colors independently, see the change immediately, persist it through save/reopen, and receive the same result in preview and PDF output.

## Users and flow

An MSP administrator opens an invoice or quote layout, selects a Totals component, expands a row identified by its localized display label, chooses row background and text colors, saves, reopens, previews, and exports. Each row is edited independently; unrelated row properties and table/header branding remain unchanged.

## Design

- Add a schema-driven `totals-rows-editor` inspector widget to the shared invoice designer and mount it only on the `totals` component.
- Implement `TotalsRowsEditorWidget` beside `TableEditorWidget`. It reads `node.metadata.totalsRows`, renders one stable section per row, and replaces the array immutably through `setNodeProp(node.id, 'metadata.totalsRows', nextRows, commit)`.
- Identify rows by stable `row.id`; display the imported/localized `row.label`. Do not add, remove, reorder, or rewrite bindings from this ticket's control.
- Edit `row.style.inline.backgroundColor` and `row.style.inline.color`. Row `style.inline.color` governs both label and amount by inheritance.
- Preserve an explicit `row.labelStyle.inline.color` as the label-specific override. Show a concise note when it differs so the user understands why the label may not match the row text color; do not silently delete it.
- Reuse the existing `ColorPicker` interaction and CSS-color normalization conventions. Empty/reset removes only the selected color property and prunes newly empty inline/style wrappers without disturbing other row style fields.
- Keep the existing import/export contract in `workspaceAst.ts`; it already round-trips `row.style` and `row.labelStyle`. Keep the renderer contract; it already merges emphasis with row style and applies label style only to the label.
- Add translation keys for the widget title, row background, row text, reset affordance, and label-override explanation in the shared invoicing locale set.

## Data and compatibility

No migration or API change is required. Existing AST rows already accept `style` and `labelStyle`; imported templates already copy both into `metadata.totalsRows`, and export restores them. Existing templates become editable when opened. Rows with no explicit colors remain valid and continue to use inherited/default styling.

## Non-goals

- Changing grouped-template default colors.
- Editing totals labels, values, bindings, formats, emphasis, order, spacing, borders, or radius.
- Adding or removing totals rows.
- Changing discount calculations or quote item descriptions.
- Reworking renderer or PDF architecture.

## Risks

- Mutating a nested row in place could bypass store history or overwrite sibling metadata; replace the complete rows array immutably.
- Clearing a color could accidentally remove padding/border fields; prune only empty color wrappers.
- A row-level text color can appear ineffective when an explicit label color exists; preserve and explain the documented precedence.
- The control is shared by invoice and quote designers, so tests must cover both document kinds.

## Definition of done

- Every imported totals row is listed by stable id/display label and has independent background/text color controls.
- Changes update the canvas immediately and participate in undo/history using existing live/commit semantics.
- Save/reopen and AST import/export preserve ids, labels/i18n references, values, formats, emphasis, ordering, non-color styles, and untouched rows.
- Preview and PDF rendering show each chosen background and the chosen row text color; explicit label color continues to override only the label.
- Clearing a color restores inheritance without damaging other styles.
- Existing unstyled and custom templates remain valid with no migration.

