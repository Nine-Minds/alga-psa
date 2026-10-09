# PRD — Invoice Designer Usability

- Slug: `2026-09-30-invoice-designer-usability`
- Date: `2026-09-30`
- Status: Implemented (retroactive plan; Draft Implementation + Implement complete on the branch)
- Card: `bdaeb651` "Improve designer functionality" · Branch: `feature/improve-designer-functionality` · Base: `main @ 228d983a4a`

## Summary

Make the invoice / quote layout designer usable by someone who has never seen it: every
common authoring task (place a block, nest it, move it, style it, bind it to data, make
its labels translate, save) works through obvious UI operations, with the canvas showing
what the document will actually render. The work was driven by an iterative usability
loop: a fresh evaluator rebuilt an existing, non-trivial invoice layout from scratch
using UI operations only (no drag-and-drop available) and rated the experience 1–10.
Scores went 4 → 6 → 6 → 7 → 7 → 7 → 8 → 8 → 8; every rebuild was verified to be a
faithful copy of the source layout's AST.

## Problem

Building a layout in the designer produced behavior users could not predict:

- Text could not be styled (no size / weight / line-height / alignment), so designs
  made in code could not be reproduced.
- Layer names were silently replaced by UUIDs on save; inserts landed in unrelated
  containers; there was no way to move or re-parent a block without dragging.
- Three overlapping sizing systems (X/Y/W/H numbers, a Sizing Mode panel, raw CSS
  width/height) disagreed with each other; an "Apply" button did nothing visible.
- The canvas did not show authored typography, backgrounds or borders, added spacing
  the rendered document does not have, and showed table columns that were not saved.
- Saving a new layout twice created duplicate layouts; table column widths, the
  company-logo binding and recipient-translated labels could not be authored at all.

## Goals

1. Every structural edit (insert, reorder, re-parent, copy, paste, duplicate, delete)
   is possible from buttons and the keyboard, with a visible indication of where the
   next block lands.
2. The inspector exposes every style the renderer honours (typography, per-side
   spacing, borders, backgrounds, size limits) in one predictable location per concern.
3. The canvas is WYSIWYG with the rendered document for layout, spacing, typography
   and authored surfaces.
4. Authoring choices survive save / reopen exactly (names, widths, bindings,
   translations), and a new layout saves as one record.
5. Labels can be standard, recipient-translated labels — by default for table headers
   and totals rows, automatically when the typed text is a standard label.

## Non-goals

- Free-form (absolute) positioning; the designer stays a flow layout.
- Changing the template AST renderer semantics beyond honouring authored table corners.
- Rich-text authoring for the Rich Text block.
- Cross-layout clipboard (copy in one layout, paste in another).
- Real-time collaboration, design tokens / theme libraries.

## Users and Primary Flows

- **MSP billing admin** building or adjusting an invoice / quote layout.
  1. Create New Layout → add blocks with "+" (inside the selected container, after the
     selected block, or at the end of the page) → style in the inspector → bind data
     fields → Preview → Save (stays in the editor).
  2. Open an existing layout → read what each block sets ("Set on this block") →
     adjust → save.
  3. Duplicate a styled card → rename it (inner layers follow) → rebind its fields.

## UX / UI Notes

- **Left panel:** Blocks / Presets / Fields tabs above a permanently visible Outline.
  The Blocks tab shows where the next block goes ("New blocks go inside X") with an
  Inside it / After it switch; Shift+click on "+" inserts after the selection.
- **Canvas:** authored typography, backgrounds and borders render (light theme); a
  marker shows the next insertion point; empty containers show a drop zone; the block
  name badge shows on hover only; selection fades the rest of the page lightly.
- **Inspector (top to bottom):** Arrange toolbar (Up, Down, Out, In, Copy, Paste,
  Duplicate, Copy style, Paste style, Delete) · Layer name with type chip · "Set on this
  block (N)" summary chips · tabs **Content / Style / Layout & size** (Content hidden for
  blocks with nothing to fill in). Panels show an "N set" count and dots on set fields;
  placeholders read "e.g. …" in italics.
- **Size control:** width Auto / Fill / Fit / Fixed + one value input; height Auto /
  Fixed + value; min/max width and height inline.
- **Editor chrome:** one header row (title, template name, "Saved <time>", Close,
  Save Template); the editor fits the viewport so the page never scrolls while editing.

## Requirements

### Functional Requirements

- **Structure:** insertion target rules (container → inside, leaf → after, nothing/page
  → end of page; climb to the nearest accepting ancestor); the page accepts every block
  type except legacy columns; reorder / move-out / move-into; subtree copy, cut, paste,
  duplicate with fresh ids and unique layer names; delete selects the next sibling,
  then the previous, then the container.
- **Inspector:** typography for text-bearing blocks; per-side padding and margin with an
  explicit "Same on all sides" toggle; unified Size control; size limits; copy / paste
  style; container layout controls; per-block override summary.
- **Data:** layer names persist; Logo / Image can bind to the company logo; table column
  widths and alignment are column CSS; new tables and totals come with real default
  columns / rows; Data Field binding sets format and (if not author-typed) label;
  "+ Insert data field…" for text blocks; FIELDS tab click rebinds a selected Data Field.
- **Translation:** catalog of standard document labels; StandardLabelControl on text,
  field labels, column headers and totals rows; auto-link exact standard text; "Use
  fixed text" opt-out that sticks.
- **Save:** first save of a new layout adopts the saved id (no duplicate on re-save),
  stays in the editor, shows "Saved <time>" and a toast.

### Non-functional Requirements

- All new UI strings use `msp/invoicing` (and `msp/keyboard-shortcuts`) keys, translated
  in de / es / fr / it / nl / pl / pt with regenerated xx / yy pseudo-locales.
- Light and dark theme support (authored colors apply on the light page; dark mode keeps
  the designer's own surface).
- Shipped standard templates round-trip byte-identically through import / export
  (no `name` field emitted for unrenamed layers, no injected default labels).

## Data / API / Integrations

- `TemplateNodeBase.name?: string` (types + zod schema, max 200 chars): author-facing
  layer name, presentation-only; `id` remains the stable identity.
- Export registers bindings under the document kind's canonical ids (`lineItems`,
  `invoiceNumber`, …) and their fallbacks; Logo binds to the kind's logo path
  (`tenantClient.logoUrl` / `tenant.logo_url` / `tenantClient.logo_url`).
- Renderer: a table with an authored `border-radius` renders with
  `border-collapse: separate; border-spacing: 0; overflow: hidden`.
- No database schema changes; layouts remain `invoice_templates.templateAst` JSON.

## Security / Permissions

No changes. Saving continues through `saveInvoiceTemplate` (billing update permission).

## Observability

None added (out of scope).

## Rollout / Migration

- No migration. Existing layouts open unchanged; layer names default to node ids.
- Visible output change: the shipped Detailed template's line-items table now renders
  its authored rounded corners in preview / PDF.
- Designer defaults changed for new blocks only (content-sized blocks, Box Container
  padding 0 / gap 8, Totals 300px right-aligned, Logo bound to the company logo).

## Open Questions

- Should the cross-layout clipboard (copy blocks between layouts) be added next?
- Should the canvas show authored surfaces in dark mode on a white "paper" instead of
  the designer surface?

## Acceptance Criteria (Definition of Done)

- A first-time user can rebuild the shipped Detailed invoice header, party cards, line
  items table and totals from a blank layout without drag-and-drop, and the saved AST
  matches the source (structure, bindings, styles, translated labels).
- Three consecutive independent usability evaluations rate the experience ≥ 8/10.
- Saving a new layout twice yields one record; reopening preserves layer names, column
  widths, logo binding and translation links.
- Designer, AST, renderer, billing-dashboard and keyboard-shortcut test suites pass;
  translation validation passes for all locales.
