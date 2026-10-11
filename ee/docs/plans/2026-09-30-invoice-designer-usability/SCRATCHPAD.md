# Scratchpad — Invoice Designer Usability

- Plan slug: `2026-09-30-invoice-designer-usability`
- Created: `2026-09-30` (retroactive: written after the implementation loop finished)

## What This Is

Working notes from the usability loop that drove this card: what each round found,
what was decided, and the gotchas a future engineer on the designer will hit.

## Method (usability loop)

- Source: a copy of the shipped Detailed invoice template (header with logo + meta card,
  divider, From / Bill To cards, dynamic line-items table, right-aligned totals).
- Each round, a fresh evaluator agent rebuilt it from "Create New Layout" using UI
  operations only (click / type / keys / hover / scroll / screenshots; no JS, no URL
  navigation, no drag primitive available), saved it as `Replica iteration N`, and rated
  the experience 1–10 (1 unusable, 3 frustrating, 5 tolerable, 7 pleasant, 8+ professional).
- After each round the saved AST was diffed against the source AST (structure, bindings,
  styles, i18n refs) to confirm faithfulness; then the friction list drove the next fixes.
- Scores: 4, 6, 6, 7, 7, 7, 8, 8, 8. Every replica matched the source (remaining diffs were
  equivalent spellings such as `left` vs `left center`, explicit `format: text`).

## Decisions

- (2026-09-30) Layer names are an optional `name` on AST nodes, not a rewrite of `id`:
  the canvas resolves repeat-region scope by AST id (`resolveCanvasRowScope`), so ids must
  stay stable. Names equal to the id are not exported, keeping shipped templates
  byte-identical on round-trip.
- (2026-09-30) The page accepts all block types (not just sections / tables): the AST
  allows any node under the document, imported templates already put stacks there, and
  forcing a Section wrapper was the first dead end for every evaluator.
- (2026-09-30) Arrow keys reorder blocks (auto-layout semantics) instead of nudging X/Y;
  coordinates are ignored by the flow layout.
- (2026-09-30) "Set" in the inspector means "differs from a new block's default", so
  explicitly written defaults (`auto`, Box Container gap 8) do not read as authored.
- (2026-09-30) Typed text that exactly equals a standard document label auto-links to the
  translated label (visible banner); "Use fixed text" sets `__translationOptOut` so it
  never re-links.
- (2026-09-30) Saving a new layout updates the URL with `history.replaceState`, not
  `router.replace`: the router navigation re-ran the server render and was dropped or
  stalled; the editor also tracks the created id itself so a second save always updates.
- (2026-09-30) Rounded tables render with separate borders (collapsed borders cannot be
  rounded). This visibly changes the shipped Detailed template's line-items table to the
  corners its AST always specified.
- (2026-09-30) Box Container default gap stays 8px (padding 0); evaluators noted the drift
  from "unset" but it is a sensible authoring default and no longer counts as "set".

## Discoveries / Constraints

- (2026-09-30) The canvas used to strip authored `backgroundColor`, `color` and `border`
  for dark mode; authored surfaces now apply via CSS custom properties only under
  `html:not(.dark)` (`AUTHORED_SURFACE_CSS` in `DesignCanvas.tsx`).
- (2026-09-30) Inner text elements carried a fixed `text-[11px]`, overriding authored font
  sizes even for imported templates.
- (2026-09-30) The canvas page layout had `gap: 32px` that the renderer never applies; now
  `createPageLayout()` (gap 0) is the single source for page layout.
- (2026-09-30) Table column `width` (px numbers) was canvas-only and never exported; column
  `style.inline.width` / `textAlign` is what renders.
- (2026-09-30) `patchOps.setNodeProp` rejects non-JSON values including nested `undefined`;
  strip undefined keys before patching arrays of objects.
- (2026-09-30) `formatCssLengthBox` returns `undefined` when any side is null — the old box
  editor unset the whole padding when one side was cleared.
- (2026-09-30) Import seeds metadata from schema defaults; any new default metadata (e.g.
  Data Field label) must be cleared on import or it leaks into existing layouts (two
  round-trip tests caught this).
- (2026-09-30) Next dev Fast Refresh of designer modules can empty the designer store in an
  open editor; reload before verifying in the browser. Never edit designer code while an
  evaluator is mid-run.
- (2026-09-30) `react-hot-toast` toasts disappear in ~2s; the persistent "Saved <time>"
  status is what users actually notice.

## Commands / Runbooks

- Types: `cd packages/billing && NODE_OPTIONS=--max-old-space-size=16384 npx tsc --noEmit -p tsconfig.json`
- Tests (designer + AST + renderer + editor + shortcuts), run from `server/`:
  `npx vitest run ../packages/billing/src/components/invoice-designer ../packages/billing/src/lib ../packages/billing/src/components/billing-dashboard ../packages/billing/src/actions ../packages/ui/src/keyboard-shortcuts`
- Translations: add English to `server/public/locales/en/msp/invoicing.json`, translate the
  other locales, then `node scripts/generate-pseudo-locales.cjs` and
  `node scripts/validate-translations.cjs`.
- AST diff during evaluation: export `invoice_templates."templateAst"` for source and
  replica and compare node trees (type, name/id, binding paths, i18n refs, inline styles).

## Links / References

- Designer: `packages/billing/src/components/invoice-designer/` — `DesignerShell.tsx`,
  `canvas/DesignCanvas.tsx`, `inspector/DesignerSchemaInspector.tsx`,
  `inspector/fieldState.ts`, `inspector/NodeOverridesSummary.tsx`,
  `inspector/widgets/{TableEditorWidget,TotalsRowsEditorWidget,StandardLabelControl}.tsx`,
  `palette/{ComponentPalette,OutlineView}.tsx`, `schema/componentSchema.ts`,
  `state/designerStore.ts`, `utils/structureEditing.ts`, `hooks/useStructureCommands.ts`,
  `ast/workspaceAst.ts`.
- AST: `packages/types/src/lib/invoice-template-ast.ts`,
  `packages/billing/src/lib/invoice-template-ast/{schema.ts,react-renderer.tsx,standardDocumentLabels.ts}`.
- Editor: `packages/billing/src/components/billing-dashboard/InvoiceTemplateEditor.tsx`.

## Open Questions

- Cross-layout clipboard (copy a card from one layout into another).
- Dark mode: render the canvas as a white "paper" with authored surfaces, or keep the
  designer surface as now?
