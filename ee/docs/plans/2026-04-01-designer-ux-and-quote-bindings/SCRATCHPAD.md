# Scratchpad — Designer UX & Quote Bindings

## Key File Paths

### Designer Inspector System
- **Schema definitions:** `packages/billing/src/components/invoice-designer/schema/componentSchema.ts`
  - COMMON_INSPECTOR (line 58) — layout, sizing, appearance, flex-item panels
  - Layout enum fields: flexDirection (91), alignItems (101), justifyContent (114)
  - Grid string fields: gridTemplateColumns (143), gridTemplateRows (150)
  - Spacing css-length fields: gap (76), padding (83), margin (242)
- **Inspector renderer:** `packages/billing/src/components/invoice-designer/inspector/DesignerSchemaInspector.tsx`
  - Field kind rendering: renderField (line 117)
  - enum → CustomSelect dropdown (190-206)
  - css-length → text Input (209-225)
  - widget → TableEditorWidget (289-293)
  - Normalizers import (line 14-20)
- **Inspector schema types:** `packages/billing/src/components/invoice-designer/schema/inspectorSchema.ts`
- **Normalizers:** `packages/billing/src/components/invoice-designer/inspector/normalizers.ts`

### Designer Palette
- **Palette component:** `packages/billing/src/components/invoice-designer/palette/ComponentPalette.tsx`
  - 4 tabs: BLOCKS, PRESETS, FIELDS, OUTLINE (lines ~272-299)
  - Fields tab builds from expression context adapter (lines 230-233)
  - Field grouping by category: invoice, customer, tenant, item (lines 41-46)
- **Layout presets:** `packages/billing/src/components/invoice-designer/constants/presets.ts`
  - LayoutPresetDefinition interface (line 35)
  - LAYOUT_PRESETS array (line 44): 5-6 existing presets

### Quote Bindings
- **Binding definitions:** `packages/billing/src/lib/quote-template-ast/bindings.ts`
  - 35 value bindings (lines 7-35)
  - 2 collection bindings: lineItems, phases (lines 37-40)
- **Quote adapters:** `packages/billing/src/lib/adapters/quoteAdapters.ts`
  - mapQuoteItemToViewModel (line 37) — maps single item
  - buildPhaseViewModels (line 64) — groups by phase
  - mapLoadedQuoteToViewModel (line 207) — builds full view model
- **Quote types:** `packages/types/src/interfaces/quote.interfaces.ts`
  - QuoteViewModel (line ~185)
  - QuoteViewModelLineItem — has is_recurring, service_item_kind, billing_frequency

### Table Editor Widget
- **Widget:** `packages/billing/src/components/invoice-designer/inspector/widgets/TableEditorWidget.tsx`
  - Collection binding dropdown (lines 391-403)
  - Options built from AST bindings (lines 142-205)

## Panel Scroll Problem (FR-0)

The 3-panel layout (palette | canvas | inspector) is inside `flex flex-1 min-h-[560px]` (line 1830).
- **Palette** (left): Has floating behavior via `isPaletteFloating` + `fixed top-0` (line 1843). **Bug:** triggers when `rect.top <= 0` (line 703), pinning to browser viewport top, overlapping the app header/navbar. Causes jarring jump on scroll.
- **Canvas** (center): `flex-1 flex` (line 2091)
- **Inspector** (right): Plain `<aside class="w-72 ... p-4 space-y-4">` (line 1885) — NO overflow-y, NO fixed height

Both problems stem from the same root cause: the 3-panel row doesn't constrain its height, so overflow goes to the page.

**Fix:** Make the 3-panel row fill available height with `overflow-hidden`, then each panel gets `overflow-y-auto`. Remove the palette floating hack entirely — it was compensating for the missing overflow constraint.

Key lines to change:
- Line 1830: `<div className="flex flex-1 min-h-[560px]">` — add overflow-hidden, make it fill height
- Line 1831-1858: Palette wrapper — remove floating logic, add overflow-y-auto
- Line 1885: Inspector aside — add overflow-y-auto
- Lines 597-603, 673-733: Remove isPaletteFloating state + syncPaletteFloatingState effect

## Already Implemented (removed from scope)

- **Flex direction icon toggles** — `DesignerShell.tsx` lines 308-311, `CONTAINER_FLEX_DIRECTION_OPTIONS`
- **Align items icon toggles** — lines 313-318, `CONTAINER_ALIGN_ITEMS_OPTIONS`  
- **Justify content icon toggles** — lines 320-327, `CONTAINER_JUSTIFY_CONTENT_OPTIONS`
- **Layout mode toggle** (flex/grid) — lines 303-306, `CONTAINER_LAYOUT_MODE_OPTIONS`
- All rendered via `renderButtonGroup()` helper (lines 1029-1065) inside `renderContainerLayoutControls()` (1019-1098)
- **Gap:** Grid mode shows NO controls after toggling to grid (line 1076 only renders flex sub-controls). This is the key UX gap to fill.

## Architecture Decisions

### New field kind: `icon-button-group`
Rather than replacing enum fields inline, introduce a new inspector field kind `icon-button-group` that renders a row of icon toggle buttons. The schema entry would look like:
```typescript
{
  kind: 'icon-button-group',
  id: 'flexDirection',
  label: 'Direction',
  path: 'layout.flexDirection',
  options: [
    { value: 'column', label: 'Vertical', icon: 'arrow-down' },
    { value: 'row', label: 'Horizontal', icon: 'arrow-right' },
  ],
}
```
This keeps the schema declarative and the renderer generic.

### New field kind: `css-length-stepper`
For gap/padding, a new field kind that renders number input + unit dropdown:
```typescript
{
  kind: 'css-length-stepper',
  id: 'gap',
  label: 'Gap',
  path: 'layout.gap',
  allowedUnits: ['px', '%', 'rem'],
  defaultUnit: 'px',
}
```

### New widget: `column-layout-picker`
For the grid column presets, a new widget (like table-editor) that shows clickable visual cards.

### Filtered collections: computed at view model level
Rather than adding filtering logic to the template renderer, compute filtered arrays and aggregates in `mapLoadedQuoteToViewModel()`. The binding paths then point directly to new top-level fields on the view model. This keeps rendering simple and the data shape flat.

## Gotchas

1. **Inspector field kind extensibility** — Currently hardcoded if/else chain in renderField. Adding new kinds means adding new branches. No plugin system.
2. **Expression context adapter is separate from AST bindings** — The Fields palette uses `buildInvoiceExpressionPathOptions()` which has a separate schema from the quote bindings. New quote bindings need to be added to BOTH systems.
3. **Legacy preset layout format** — Some presets use `{ mode, direction, gap }` instead of CSS `{ display, flexDirection, gap }`. New presets should use the CSS format.
4. **Dark theme** — Inspector uses `dark:` Tailwind prefixes. New components need dark variants.
5. **setNodeProp commit parameter** — Interactive controls (sliders, steppers) should pass `commit: false` during drag/type and `commit: true` on release/blur for clean undo history.

## Progress Log

- `F000a` complete. Confirmed the shell panel row in `packages/billing/src/components/invoice-designer/DesignerShell.tsx` uses `flex flex-1 min-h-0 overflow-hidden`, then added stable panel automation IDs plus `min-h-0/min-w-0` hooks around the three-panel shell so the fixed-height layout is testable and explicit.
- Verification for `F000a`: `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/DesignerShell.panelScroll.integration.test.tsx`
- `F000b` complete. The inspector `<aside>` now exposes `data-automation-id="designer-shell-inspector-panel"` with `overflow-y-auto` and `min-h-0`, which locks inspector scrolling to its own column instead of the page.
- Verification for `F000b`: same targeted Vitest slice in `DesignerShell.panelScroll.integration.test.tsx` asserts the inspector panel classes.
- `F000c` complete. The palette wrapper now uses `overflow-y-auto` and `min-h-0` with `data-automation-id="designer-shell-palette-panel"`, so palette scrolling stays inside the left rail instead of relying on viewport pinning.
- Verification for `F000c`: same targeted Vitest slice asserts the palette panel scroll-container classes.
- `F000d` complete. `DesignerShell.tsx` no longer contains `isPaletteFloating`, `syncPaletteFloatingState`, or `fixed top-0`; the old viewport-floating branch is gone and the test file guards against regressions with a source-level assertion.
- Verification for `F000d`: `DesignerShell.panelScroll.integration.test.tsx` reads the source file and asserts those legacy strings are absent.
- `F000e` complete. The center panel now exposes `data-automation-id="designer-shell-canvas-panel"` with `flex-1 min-h-0 min-w-0`, keeping the canvas in the middle flex slot while palette/inspector scroll independently.
- Verification for `F000e`: same targeted Vitest slice asserts the canvas panel remains the flexing middle column inside the overflow-hidden shell row.
- `F001` complete. Added `GRID_COLUMN_PRESETS` plus a visual grid-preset picker to `renderContainerLayoutControls()` in `packages/billing/src/components/invoice-designer/DesignerShell.tsx`. The picker renders five preset cards with preview bars and stable automation IDs.
- Verification for `F001`: `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/DesignerShell.gridLayoutControls.integration.test.tsx`
- `F002` complete. Each preset button writes `layout.gridTemplateColumns` through `setNodeProp`, and also reaffirms `layout.display = 'grid'` so the selection always leaves the container in grid mode.
- Verification for `F002`: the same grid-layout integration test clicks each preset and asserts the exact persisted `gridTemplateColumns` value in the store.
- `F003` complete. Active-state styling now derives from a normalized `gridTemplateColumns` string comparison and is exposed with `aria-pressed`, including the no-match case for custom values.
- Verification for `F003`: the same grid-layout integration test covers both matching and custom non-matching template values.
- `F004` complete. The preset picker is rendered only in the `layoutMode === 'grid'` branch inside `renderContainerLayoutControls()`, preserving the existing flex-only control set for flex containers.
- Verification for `F004`: the same grid-layout integration test asserts presence in grid mode and absence in flex mode.
- `F005` complete. The schema-driven `Template Columns` string input remains in the Layout panel below the new visual picker, so custom `gridTemplateColumns` values are still editable.
- Verification for `F005`: the same grid-layout integration test asserts the preset container appears before the raw `Template Columns` input in the DOM.
- `F006` complete. Added parser/formatter helpers in `packages/billing/src/components/invoice-designer/inspector/cssLengthFields.ts`, new `css-length-stepper` / `css-length-box` schema kinds, and dedicated inspector field components in `DesignerSchemaInspector.tsx`. `layout.gap` now renders as a number input plus unit selector instead of a freeform text field.
- Verification for `F006`: `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/inspector/cssLengthFields.test.ts ../packages/billing/src/components/invoice-designer/inspector/DesignerSchemaInspector.spacingControls.integration.test.tsx ../packages/billing/src/components/invoice-designer/inspector/DesignerSchemaInspector.integration.test.tsx ../packages/billing/src/components/invoice-designer/schema/componentSchema.test.ts`
- `F007` complete. `layout.padding` now uses the same `css-length-stepper` renderer, so padding is edited with a numeric input plus unit selector instead of raw CSS text.
- Verification for `F007`: the same spacing-control integration test asserts the padding stepper and unit dropdown render.
- `F008` complete. The stepper field kind supports `px`, `%`, and `rem`, with `px` as the default when the authored value is unitless or empty.
- Verification for `F008`: the spacing-control integration test inspects the rendered unit dropdown options directly.
- `F009` complete. `parseCssLength()` now initializes the stepper from stored CSS values such as `16px`, `2rem`, `50%`, and unitless `0`, while preserving unsupported custom strings until the user edits them.
- Verification for `F009`: both `cssLengthFields.test.ts` and the spacing-control integration test cover parse-on-load cases.
- `F010` complete. `formatCssLength()` writes numeric + unit selections back to the store as canonical CSS strings, and the stepper renderer uses that formatter for both value and unit changes.
- Verification for `F010`: the spacing-control integration test asserts writeback on numeric changes and on unit changes.
- `F011` complete. `style.margin` now uses the `css-length-box` renderer, which exposes four side-specific steppers (`top/right/bottom/left`) plus a shared unit selector.
- Verification for `F011`: the spacing-control integration test asserts all four margin inputs render.
- `F012` complete. The margin box renderer includes a `Link all` toggle; when linked it writes the same numeric value to every side, and when toggled off each side can diverge independently.
- Verification for `F012`: the spacing-control integration test covers both linked sync and unlinked independence.
- `F013` complete. `parseCssLengthBox()` expands 1-value, 2-value, 3-value, and 4-value CSS shorthand into per-side numeric state for the margin controls.
- Verification for `F013`: `cssLengthFields.test.ts` covers shorthand parsing cases.
- `F014` complete. `formatCssLengthBox()` writes per-side margin edits back as optimized CSS shorthand strings, collapsing to the shortest valid token count.
- Verification for `F014`: `cssLengthFields.test.ts` covers optimized shorthand formatting.
- `F015` complete. Added a `Notes + Totals Row` body preset in `packages/billing/src/components/invoice-designer/constants/presets.ts` with a grid section root and `2fr 1fr` tracks.
- Verification for `F015`: `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/state/designerStore.presets.test.ts`
- `F016` complete. Added a `Two Equal Columns` body preset backed by a grid section with `1fr 1fr` tracks.
- Verification for `F016`: the preset insertion test suite asserts the inserted section layout.
- `F017` complete. Added a `Three Info Columns` body preset backed by a grid section with `1fr 1fr 1fr` tracks.
- Verification for `F017`: the preset insertion test suite asserts the inserted section layout.
- `F018` complete. All three new body presets are authored with modern CSS layout objects (`display: 'grid'`, `gridTemplateColumns`) rather than legacy `{ mode, direction }` preset layout fields.
- Verification for `F018`: the preset insertion test suite asserts the inserted section layouts do not depend on legacy preset fields.
- `F019` complete. Extended `QuoteViewModel`, `mapLoadedQuoteToViewModel()`, and `QUOTE_TEMPLATE_COLLECTION_BINDINGS` so recurring line items are exposed as `recurring_items` / `recurringItems`. The designer now also infers quote context from imported binding catalogs for field discovery.
- Verification for `F019`: `cd server && npx vitest run ../packages/billing/src/lib/quote-template-ast/bindings.test.ts ../packages/billing/src/lib/adapters/quoteAdapters.test.ts ../packages/billing/src/components/invoice-designer/palette/ComponentPalette.fields.integration.test.tsx ../packages/billing/src/components/invoice-designer/palette/ComponentPalette.quoteFields.integration.test.tsx ../packages/billing/src/components/invoice-designer/inspector/TableEditorWidget.integration.test.tsx ../packages/types/src/interfaces/quoteViewModel.typecheck.test.ts`
- `F020` complete. One-time line items are exposed from `mapLoadedQuoteToViewModel()` as `onetime_items`, and `onetimeItems` is registered in the quote collection binding catalog.
- Verification for `F020`: the quote adapter and binding tests assert the one-time filtered collection shape.
- `F021` complete. Service line items are exposed as `service_items`, and the view model now carries `service_item_kind` through to each mapped quote line item.
- Verification for `F021`: the quote adapter and binding tests assert service filtering and the mapped `service_item_kind`.
- `F022` complete. Product line items are exposed as `product_items`, and `productItems` is registered in the quote collection binding catalog for tables.
- Verification for `F022`: the quote adapter and binding tests assert product filtering.
- `F023` complete. Added `recurringSubtotal`, `recurringTax`, and `recurringTotal` bindings backed by aggregate fields computed from `recurring_items`.
- Verification for `F023`: the quote adapter and binding tests assert recurring aggregate math.
- `F024` complete. Added `onetimeSubtotal`, `onetimeTax`, and `onetimeTotal` bindings backed by aggregate fields computed from `onetime_items`.
- Verification for `F024`: the quote adapter and binding tests assert one-time aggregate math.
- `F025` complete. Added `serviceSubtotal`, `serviceTax`, and `serviceTotal` bindings backed by aggregate fields computed from `service_items`.
- Verification for `F025`: the quote adapter and binding tests assert service aggregate math.
- `F026` complete. Added `productSubtotal`, `productTax`, and `productTotal` bindings backed by aggregate fields computed from `product_items`.
- Verification for `F026`: the quote adapter and binding tests assert product aggregate math.
- `F027` complete. `packages/types/src/interfaces/quote.interfaces.ts` now includes filtered item arrays on `QuoteViewModel`, and `QuoteViewModelLineItem` carries `service_item_kind`.
- Verification for `F027`: the new `quoteViewModel.typecheck.test.ts` and quote adapter tests exercise the added fields.
- `F028` complete. `QuoteViewModel` now includes recurring/one-time/service/product subtotal, tax, and total fields for template binding consumption.
- Verification for `F028`: the typecheck test and quote adapter aggregate assertions cover the new fields.
- `F029` complete. `mapLoadedQuoteToViewModel()` now materializes `recurring_items`, `onetime_items`, `service_items`, and `product_items` directly from the mapped quote line items.
- Verification for `F029`: the quote adapter tests assert the filtered array contents.
- `F030` complete. `mapLoadedQuoteToViewModel()` also computes per-group subtotal/tax/total aggregates using the same filtered item groups, including zero-value fallbacks when groups are empty.
- Verification for `F030`: the quote adapter tests assert aggregate totals and zero-value empty-group behavior.
- `F031` complete. `TableEditorWidget` now surfaces the imported quote collection catalog, and the integration test verifies the source-binding dropdown lists the new filtered collection bindings.
- Verification for `F031`: `TableEditorWidget.integration.test.tsx` covers the quote collection dropdown contents.
- `F032` complete. The component palette now infers quote document context from imported binding catalogs and shows quote-specific field groups, including a `Quote Totals` section for the new aggregate bindings.
- Verification for `F032`: `ComponentPalette.quoteFields.integration.test.tsx` asserts discovery and insertion of `quoteTotals.recurringTotal`.
- Added plan item `F018a` / `T030a` because the PRD requires a quote-specific `Recurring + One-time Tables` preset, but the generated checklist had omitted it. Keep it separate from `F018` so the extra quote-only preset remains explicit and independently traceable.
- `F018a` complete. Added a `Recurring + One-time Tables` body preset in `packages/billing/src/components/invoice-designer/constants/presets.ts` with a single-column grid section and two `dynamic-table` children pre-bound to `recurringItems` and `onetimeItems`.
- Verification for `F018a`: `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/state/designerStore.presets.test.ts`
- `F033` complete. Added explicit dark-theme regression assertions for the new grid preset controls in `DesignerShell.gridLayoutControls.integration.test.tsx` and the spacing/margin steppers in `DesignerSchemaInspector.spacingControls.integration.test.tsx`, so the new UI surfaces keep their `dark:` styling hooks under a `.dark` wrapper.
- Verification for `F033`: `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/DesignerShell.gridLayoutControls.integration.test.tsx ../packages/billing/src/components/invoice-designer/inspector/DesignerSchemaInspector.spacingControls.integration.test.tsx`
- `F034` complete. Added `workspaceAst.standardTemplates.regression.test.ts` to protect both standard invoice and standard quote templates against designer import/export regressions by asserting deterministic round-trips, binding-catalog preservation, and critical node retention for every shipped standard template code.
- Verification for `F034`: `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/ast/workspaceAst.standardTemplates.regression.test.ts`
- Added follow-up plan items `F002a`, `F004a`, and `F004b` after re-reading the PRD against the shipped shell behavior. The extracted checklist had codified the current implementation, but the PRD still requires the grid picker to be usable as the way into grid mode and for the same layout controls to be available on section nodes.
- `F002a` complete. The grid preset buttons now stay actionable from flex layouts, and the shell test covers the flex-to-grid transition by asserting a preset click changes `layout.display` to `grid` and applies the chosen `gridTemplateColumns`.
- Verification for `F002a`: `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/DesignerShell.gridLayoutControls.integration.test.tsx`
- `F004a` complete. The grid preset picker is no longer hidden behind `layoutMode === 'grid'`; it stays visible for flex layouts so users can choose a column preset as the entry point into grid mode instead of hand-editing CSS.
- Verification for `F004a`: `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/DesignerShell.gridLayoutControls.integration.test.tsx`
- `F004b` complete. `DesignerShell.tsx` now resolves layout controls for both `container` and `section` nodes, and the shell integration test selects a section node to prove the shared layout control panel still renders the same grid-mode entry points there.
- Verification for `F004b`: `cd server && npx vitest run ../packages/billing/src/components/invoice-designer/DesignerShell.gridLayoutControls.integration.test.tsx`

- `T000a` complete. Covered by DesignerShell.panelScroll.integration.test.tsx asserting the shell row is overflow-hidden and the inspector panel owns its own overflow-y scroll container.
- `T000b` complete. Covered by DesignerShell.panelScroll.integration.test.tsx asserting the palette uses its own overflow-y scroll container instead of viewport pinning.
- `T000c` complete. Covered by DesignerShell.panelScroll.integration.test.tsx asserting the canvas remains in the flexing middle panel while the side rails scroll independently.
- `T000d` complete. Covered by DesignerShell.panelScroll.integration.test.tsx source assertions removing isPaletteFloating, syncPaletteFloatingState, and fixed top-0 usage.
- `T001` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx rendering all five grid preset buttons in grid mode.
- `T001a` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx selecting a section node and asserting the shared layout controls and grid picker still render.
- `T002` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx keeping the grid preset buttons visible while the selected node starts in flex mode.
- `T003` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx asserting the 2 equal columns preset writes 1fr 1fr.
- `T004` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx asserting the sidebar plus main preset writes 1fr 2fr.
- `T005` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx asserting the main plus sidebar preset writes 2fr 1fr.
- `T006` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx asserting the 3 equal columns preset writes 1fr 1fr 1fr.
- `T007` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx asserting the 1 column preset writes 1fr.
- `T007a` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx asserting a preset click from flex mode flips display to grid and applies the chosen columns.
- `T008` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx asserting the matching preset exposes aria-pressed=true based on gridTemplateColumns.
- `T009` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx asserting custom gridTemplateColumns values leave every preset inactive.
- `T010` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx asserting the raw Template Columns input remains visible beneath the visual picker.
- `T011` complete. Covered by DesignerSchemaInspector.spacingControls.integration.test.tsx rendering a numeric gap input with a unit selector instead of a raw text field.

- `T012` complete. Covered by DesignerSchemaInspector.spacingControls.integration.test.tsx rendering a numeric padding input with a unit selector.

- `T013` complete. Covered by DesignerSchemaInspector.spacingControls.integration.test.tsx asserting the spacing unit selector exposes px, %, and rem.

- `T014` complete. Covered by cssLengthFields.test.ts and DesignerSchemaInspector.spacingControls.integration.test.tsx parsing 16px into value 16 with unit px.

- `T015` complete. Covered by cssLengthFields.test.ts and DesignerSchemaInspector.spacingControls.integration.test.tsx parsing 2rem into value 2 with unit rem.

- `T016` complete. Covered by cssLengthFields.test.ts and DesignerSchemaInspector.spacingControls.integration.test.tsx parsing 50 percent into value 50 with unit percent.

- `T017` complete. Covered by cssLengthFields.test.ts and DesignerSchemaInspector.spacingControls.integration.test.tsx parsing unitless or px zero into value 0 with px as the default unit.

- `T018` complete. Covered by DesignerSchemaInspector.spacingControls.integration.test.tsx asserting gap value edits write back a combined CSS length string.

- `T019` complete. Covered by DesignerSchemaInspector.spacingControls.integration.test.tsx asserting gap unit changes write back a combined CSS length string.

- `T020` complete. Covered by DesignerSchemaInspector.spacingControls.integration.test.tsx rendering the four margin side inputs, shared unit selector, and link toggle.

- `T021` complete. Covered by DesignerSchemaInspector.spacingControls.integration.test.tsx asserting Link all keeps all four margin sides synchronized.

- `T022` complete. Covered by DesignerSchemaInspector.spacingControls.integration.test.tsx asserting margin sides diverge independently once Link all is disabled.

- `T023` complete. Covered by cssLengthFields.test.ts parsing two-value margin shorthand into per-side values.

- `T024` complete. Covered by cssLengthFields.test.ts parsing one-value margin shorthand into equal per-side values.

- `T025` complete. Covered by cssLengthFields.test.ts parsing four-value margin shorthand into explicit per-side values.

- `T026` complete. Covered by cssLengthFields.test.ts formatting per-side margin edits back into optimized CSS shorthand.

- `T027` complete. Covered by designerStore.presets.test.ts asserting the Notes plus Totals Row preset inserts a grid section with 2fr 1fr columns.

- `T028` complete. Covered by designerStore.presets.test.ts asserting the Two Equal Columns preset inserts a grid section with equal tracks.

- `T029` complete. Covered by designerStore.presets.test.ts asserting the Three Info Columns preset inserts a grid section with three equal tracks.

- `T030` complete. Covered by designerStore.presets.test.ts asserting the new presets use display grid and gridTemplateColumns instead of legacy mode or direction fields.

- `T030a` complete. Covered by designerStore.presets.test.ts asserting the Recurring plus One-time Tables preset inserts two dynamic tables bound to recurringItems and onetimeItems.

- `T031` complete. Covered by quoteAdapters.test.ts asserting recurring_items contains only line items where is_recurring is true.

- `T032` complete. Covered by quoteAdapters.test.ts asserting onetime_items contains only line items where is_recurring is not true.

- `T033` complete. Covered by quoteAdapters.test.ts asserting service_items contains only line items with service_item_kind service.

- `T034` complete. Covered by quoteAdapters.test.ts asserting product_items contains only line items with service_item_kind product.

- `T035` complete. Expanded quoteAdapters.test.ts to cover a quote with no line items, proving every filtered collection returns an empty array instead of erroring when nothing matches.

- `T036` complete. Covered by quoteAdapters.test.ts asserting recurring_subtotal sums total_price only across recurring items.

- `T037` complete. Covered by quoteAdapters.test.ts asserting recurring_tax sums tax_amount only across recurring items.

- `T038` complete. Covered by quoteAdapters.test.ts asserting recurring_total equals recurring subtotal plus recurring tax.

- `T039` complete. Covered by quoteAdapters.test.ts asserting onetime_subtotal sums total_price only across one-time items.

- `T040` complete. Covered by quoteAdapters.test.ts asserting onetime_tax sums tax_amount only across one-time items.

- `T041` complete. Covered by quoteAdapters.test.ts asserting onetime_total equals one-time subtotal plus one-time tax.

- `T042` complete. Covered by quoteAdapters.test.ts asserting service subtotal, tax, and total are computed only from service items.

- `T043` complete. Covered by quoteAdapters.test.ts asserting product subtotal, tax, and total are computed only from product items.

- `T044` complete. Covered by quoteViewModel.typecheck.test.ts asserting QuoteViewModel exposes the filtered item arrays used by quote templates.

- `T045` complete. Covered by quoteViewModel.typecheck.test.ts asserting QuoteViewModel exposes the per-group aggregate number fields used by quote templates.

- `T046` complete. Covered by quoteAdapters.test.ts asserting mapLoadedQuoteToViewModel populates recurring, one-time, service, and product arrays with the expected item ids.

- `T047` complete. Covered by quoteAdapters.test.ts asserting group aggregates match the sums of the filtered items.

- `T048` complete. Covered by quoteAdapters.test.ts asserting every quote group aggregate falls back to zero when no items match.

- `T049` complete. Covered by TableEditorWidget.integration.test.tsx asserting the collection dropdown lists recurringItems, onetimeItems, serviceItems, and productItems.

- `T050` complete. Expanded ComponentPalette.quoteFields.integration.test.tsx to assert the Quote Totals section exposes recurring, onetime, service, and product total field buttons for discovery before inserting the recurring total alias.

- `T051` complete. Covered by DesignerShell.gridLayoutControls.integration.test.tsx and DesignerSchemaInspector.spacingControls.integration.test.tsx asserting the new controls retain their dark-theme class hooks under a dark wrapper.

- `T052` complete. Covered by workspaceAst.standardTemplates.regression.test.ts asserting both shipped standard invoice templates keep their critical node ids, binding catalogs, and deterministic round-trip output across designer import and export.

- `T053` complete. Covered by workspaceAst.standardTemplates.regression.test.ts asserting both shipped standard quote templates keep their critical node ids, binding catalogs, and deterministic round-trip output across designer import and export.
