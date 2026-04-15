# PRD — Designer UX Improvements & Quote Collection Bindings

- Slug: `designer-ux-and-quote-bindings`
- Date: `2026-04-01`
- Status: Draft

## Summary

Make the invoice/quote template designer intuitive enough for non-technical users to create complex layouts (multi-column headers, side-by-side notes+totals, separate recurring/one-time tables) without knowing CSS syntax. Then extend the quote binding system so templates can separate line items by recurring vs one-time and services vs products.

## Problem

The designer has powerful layout capabilities (full CSS flex/grid). Visual icon toggle buttons already exist for flex direction, justify content, and align items (in `DesignerShell.tsx` `renderContainerLayoutControls`). However:
- **Grid mode is a dead end** — switching to Grid layout shows no controls (flex controls are hidden, no grid-specific controls appear)
- **Grid columns** require typing `"1fr 2fr"` or `"repeat(3, 1fr)"` in the inspector text input — no visual picker
- **Spacing** (gap, padding, margin) requires typing CSS strings like `"0 0 12px 0"` in the inspector
- **No grid presets** — only flex-based layout presets exist in the palette
- **Layout controls only appear for `container` type** — not for `section` nodes

For quotes specifically:
- Only 2 collection bindings exist (`lineItems`, `phases`) — no way to bind a table to just recurring items or just one-time items
- No per-group aggregates (recurring subtotal/tax/total vs one-time subtotal/tax/total)
- The data model already has `is_recurring`, `billing_frequency`, and `service_item_kind` on line items but the template system doesn't expose filtered views

## Goals

1. Add grid-specific controls (column layout picker) so grid mode isn't a dead end
2. Add visual spacing controls with stepper + unit selector for gap/padding/margin
3. Add grid-based layout presets to the palette
4. Extend quote template bindings with filtered collections and per-group aggregates
5. Surface new bindings in the designer palette so users can discover them

## Non-goals

- Conditional rendering / show-hide based on data (future work)
- Drag-to-resize columns within a grid (stays manual via properties)
- Quote workflow changes (acceptance, approval) — out of scope
- New quote template design (separate follow-up after bindings ship)
- Responsive/mobile layouts — templates target fixed-size PDF output

## Users and Primary Flows

**Primary user:** MSP admin designing invoice/quote templates in the billing settings area.

**Flow 1 — Create a multi-column layout:**
1. User selects a container/section in the canvas
2. In the inspector Layout panel, they see a visual column picker (1-col, 2-col equal, 2-col sidebar+main, 3-col)
3. Click a column preset → container switches to grid with appropriate `gridTemplateColumns`
4. Drag child elements into the grid cells

**Flow 2 — Adjust flex layout visually:**
1. User selects a flex container
2. Direction shown as icon toggle (↕ vertical / ↔ horizontal) instead of dropdown
3. Justify/align shown as icon button groups (visual representations of start/center/end/space-between)
4. Gap/padding shown as stepper with unit dropdown (px/%)

**Flow 3 — Build a quote with separate recurring/one-time tables:**
1. User drags two dynamic-table elements onto the canvas
2. First table: set collection binding to "Recurring Items" from dropdown
3. Second table: set collection binding to "One-time Items"
4. Add field elements for `recurringTotal` and `onetimeTotal` from the Fields palette tab

## UX / UI Notes

### Visual Layout Controls (replacing dropdowns)

> **Already implemented:** Flex direction, justify content, and align items are already icon toggle buttons in `DesignerShell.tsx` `renderContainerLayoutControls()`. See screenshot in planning context.

### Column Layout Picker (New — fills the grid mode gap)

Visual grid of clickable preset cards in the Layout panel (when display is grid or when first choosing):
- `[  1  ]` — Single column (full width)
- `[ 1 | 1 ]` — Two equal columns
- `[ 1 |  2  ]` — Sidebar + main (1fr 2fr)
- `[  2  | 1 ]` — Main + sidebar (2fr 1fr)
- `[ 1 | 1 | 1 ]` — Three equal columns

Clicking a preset:
1. Sets `layout.display` to `grid`
2. Sets `layout.gridTemplateColumns` to the corresponding value
3. Raw CSS input stays visible below for power users who want to customize

### Spacing Controls

Replace raw CSS text inputs for gap, padding, margin with:
- Numeric stepper (up/down arrows, or type a number)
- Unit dropdown beside it: `px` (default), `%`, `rem`
- Value stored as combined string (e.g., `"16px"`)
- For margin: four individual steppers (top, right, bottom, left) with a "link" toggle to set all at once

### New Layout Presets in Palette

Add to the existing preset system:
- **"Notes + Totals Row"** (Body) — 2-col grid: wide notes left, narrow totals right
- **"Two Equal Columns"** (Body) — 2-col grid section
- **"Three Info Columns"** (Body) — 3-col grid for info cards
- **"Recurring + One-time Tables"** (Body, quote-specific) — Two stacked dynamic tables pre-bound to `recurringItems` and `onetimeItems`

## Requirements

### Functional Requirements

#### Phase 1: Visual Layout Controls

> **Already done:** Flex direction, justify content, and align items icon toggle buttons exist in `DesignerShell.tsx` `renderContainerLayoutControls()` (lines 1019-1098). These render for container nodes when display is flex.

**FR-0 Independent Panel Scrolling (palette + inspector + canvas)**
- **Problem:** The 3-panel row (palette | canvas | inspector) is inside `flex flex-1 min-h-[560px]` (line 1830). Neither the inspector nor the canvas area constrains its height, so when content overflows, the **whole page scrolls**, pushing the canvas out of view.
- **Palette bug:** The palette has a `fixed top-0` floating mode that triggers when `rect.top <= 0` (line 703), but it pins to the **browser viewport top**, overlapping the app header/navbar. This causes a jarring jump visible in the screenshot.
- **Fix approach:** Replace the palette's floating/fixed hack with proper CSS layout:
  - Make the 3-panel flex row fill available viewport height (`h-full` / `flex-1` with `overflow-hidden` on parent)
  - Each panel (palette, canvas, inspector) gets `overflow-y-auto` independently
  - Remove the `isPaletteFloating` / `fixed top-0` logic entirely — no longer needed when panels scroll within their own bounds
  - Canvas area scrolls independently (it already has its own scroll context via DesignCanvas)
- **Result:** User can scroll the inspector to reach column settings while the canvas stays visible. User can scroll the palette without it jumping over the header.

**FR-1 Grid Column Layout Picker**
- Add a visual column picker widget to the Layout panel
- 5 preset options: 1-col, 2-equal, sidebar+main, main+sidebar, 3-equal
- Clicking a preset sets `layout.display: 'grid'` and `layout.gridTemplateColumns` accordingly
- Show below the Mode selector, visible when node is a container
- Raw grid CSS inputs remain available below the picker for customization
- Active preset highlighted based on current `gridTemplateColumns` value

**FR-2 Spacing Stepper Controls**
- Replace css-length text inputs for `gap`, `padding` with numeric stepper + unit selector
- Stepper: number input with up/down increment buttons (step: 1 for px, 0.25 for rem, 1 for %)
- Unit dropdown: px (default), %, rem
- Parse existing CSS values on load (e.g., "16px" → value: 16, unit: "px")
- Write back as combined string (e.g., `"16px"`)

**FR-3 Margin Controls**
- Replace single margin css-length input with four individual stepper fields (top, right, bottom, left)
- "Link all" toggle button — when linked, changing one value changes all four
- Parse existing shorthand on load (e.g., "8px 16px" → top:8, right:16, bottom:8, left:16)
- Write back as shorthand

**FR-4 New Layout Presets**
- Add 3-4 new grid-based presets to `LAYOUT_PRESETS` array
- Each uses CSS grid layout (not legacy flex mode)
- Presets appear in the Presets tab of the palette alongside existing ones

#### Phase 2: Quote Collection Bindings

**FR-5 Filtered Collection Bindings**
- Add to `QUOTE_TEMPLATE_COLLECTION_BINDINGS`:
  - `recurringItems` → filters `line_items` where `is_recurring === true`
  - `onetimeItems` → filters `line_items` where `is_recurring !== true`
  - `serviceItems` → filters `line_items` where `service_item_kind === 'service'`
  - `productItems` → filters `line_items` where `service_item_kind === 'product'`
- These are virtual collections computed at render time from the full `line_items` array

**FR-6 Per-Group Aggregate Value Bindings**
- Add to `QUOTE_TEMPLATE_VALUE_BINDINGS`:
  - `recurringSubtotal`, `recurringTax`, `recurringTotal`
  - `onetimeSubtotal`, `onetimeTax`, `onetimeTotal`
  - `serviceSubtotal`, `serviceTax`, `serviceTotal`
  - `productSubtotal`, `productTax`, `productTotal`
- Computed from filtered line item groups

**FR-7 Quote View Model Computation**
- Extend `QuoteViewModel` type with:
  - `recurring_items`, `onetime_items`, `service_items`, `product_items` (filtered arrays)
  - `recurring_subtotal`, `recurring_tax`, `recurring_total` (aggregates)
  - `onetime_subtotal`, `onetime_tax`, `onetime_total`
  - `service_subtotal`, `service_tax`, `service_total`
  - `product_subtotal`, `product_tax`, `product_total`
- Computed in `mapLoadedQuoteToViewModel()` from the line items

**FR-8 Collection Dropdown Discovery**
- Table editor widget collection selector should list new filtered collections
- These come automatically from the AST bindings (already works via `baseAst.bindings.collections` enumeration)

**FR-9 Fields Palette Discovery**
- New value bindings appear in the Fields tab of the component palette
- Grouped under a "Quote Totals" or similar category
- Existing invoice expression context adapter may need quote-specific extension

### Non-functional Requirements

- All new controls must work in both light and dark theme
- Inspector panel vertical space should not increase significantly (use compact controls)
- Existing templates must render identically (no regression)
- New field kinds must follow the existing normalizer pattern

## Data / API / Integrations

**No database changes.** The filtered collections and aggregates are computed at render time from existing `line_items` data in the `QuoteViewModel`.

**Type changes:**
- `QuoteViewModel` interface in `packages/types/src/interfaces/quote.interfaces.ts` — add optional filtered arrays and aggregate fields
- `QuoteViewModelLineItem` — no changes (already has `is_recurring`, `service_item_kind`)

## Security / Permissions

No changes — template editing already gated by billing admin permissions.

## Rollout / Migration

- Existing templates unaffected — new controls write the same CSS property values
- New quote bindings are additive — old templates that don't reference them work fine
- No migration needed — the filtered collections are computed on-the-fly

## Open Questions

1. **Should margin controls always show 4 fields or start collapsed?** Propose: start as single field, expand to 4 when user clicks "expand" or when shorthand has different values per side.
2. **Should the column picker also add child containers?** Propose: no, just set the grid template. Users drag content into cells.
3. **Quote fields palette grouping** — should filtered collection totals show under "Quote" category or a new "Quote Totals" sub-category?

## Acceptance Criteria (Definition of Done)

1. A non-technical user can create a 2-column layout by clicking a visual preset (no CSS typing)
2. Flex direction, justify, and align are all icon-based controls
3. Gap/padding use numeric steppers with unit selectors
4. Quote templates can bind tables to `recurringItems` or `onetimeItems` collections
5. Per-group totals (recurringTotal, onetimeTotal) are available as field bindings
6. All existing templates render identically (no visual regression)
7. New controls work in both light and dark theme
8. Fields palette shows new quote-specific bindings for discovery
