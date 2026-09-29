# Scratchpad — Editable Totals-Row Branding

## Evidence

- `componentSchema.ts`: the `totals` component uses only `COMMON_INSPECTOR`; standalone subtotal/tax/discount rows use `TOTALS_ROW_INSPECTOR`, but that schema addresses root node properties rather than nested `metadata.totalsRows` entries.
- `workspaceAst.ts`: totals import stores each row's stable id, localized label reference, value expression/path, format, emphasis, `style`, and `labelStyle`; export maps them back already.
- `react-renderer.tsx`: totals rendering merges emphasis before `row.style`, applies row style to the wrapper, and applies `row.labelStyle` only to the label. Therefore row text color is inherited by label and amount unless labelStyle overrides it.
- `standardTemplates.ts`: grouped quote/invoice monthly and one-time rows carry explicit purple/white inline styles.
- `DesignerSchemaInspector.tsx`: nested variable-length row editing needs a widget, parallel to `TableEditorWidget`; generic dot paths cannot describe an arbitrary row id/index safely.
- Root `package-lock.json` was already modified before design work and is excluded from this plan commit.

## Decisions

- Build a focused nested-row widget instead of flattening rows into pseudo-nodes or changing the AST.
- Edit only `style.inline.backgroundColor` and `style.inline.color` in this ticket.
- Preserve explicit label color and document its higher specificity rather than silently normalizing it.
- No migration, standard-template recolor, or renderer rewrite.

## Implementation sequence

1. Extend inspector widget typing/dispatch and mount it on totals.
2. Add immutable row-style helpers and the widget using existing color controls.
3. Add localization strings and focused inspector tests.
4. Strengthen quote/invoice round-trip and renderer tests.
5. Run save/reopen preview/PDF smoke with distinct row colors.

## Completion

- Implemented `totals-rows-editor` widget (`inspector/widgets/TotalsRowsEditorWidget.tsx`)
  mounted on the `totals` component; edits only `metadata.totalsRows[*].style.inline`
  background/text colors, replaces the whole rows array immutably through
  `setNodeProp`, preserves `labelStyle`, and prunes only emptied inline/style wrappers.
- Canvas totals preview now renders the saved rows with their styles so color edits
  are reflected live on the design surface (fallback summary retained for empty rows).
- New locales: `invoiceDesigner.totalsRowsEditor.*` + `designer.schema.panels.totals-rows.title`
  in all 10 locale packs (pseudo regenerated).
- Tests: `TotalsRowsEditorWidget.integration.test.tsx` (T001/T002/T003/T008),
  `workspaceAst.totalsRowsRoundtrip.test.ts` (T004/T005/T007),
  `lib/invoice-template-ast/totalsRowBranding.render.test.tsx` (T006). Evidence under
  `evidence/` covers the quote/invoice preview + PDF render paths (T009/T010) with the
  same evaluator/renderer code the app runs.
- Full invoice-designer + schema + react-renderer suite (105 files / 531 tests) green.

