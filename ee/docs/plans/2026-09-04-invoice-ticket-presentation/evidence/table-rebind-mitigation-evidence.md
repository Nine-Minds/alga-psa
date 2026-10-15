# Mitigation: designer table source rebinding lost on save

Smoke-test failure follow-up (XO card d011685d-a15a-47b8-b67d-903de15760ee). Scope: two defects only, applied on top of `4707ed82bc`.

## Defect 1 — stale `__astTableSourceBindingId` survived a source-binding change

Root cause confirmed as reported: the widget cleared the preserved AST binding id with `setNodeProp(..., undefined, ...)`, which `patchOps.setNodeProp` rejects (`non-json-value`), so export kept preferring the stale id and discarded the user's selection.

Fixes (all in `TableEditorWidget.tsx`):

1. The source-binding change handler now removes the preserved key through the store's `unsetNodeProp` (the key-removal path `patchOps` actually supports) before writing `metadata.collectionBindingKey`.
2. The catalog options in the source-binding select now carry the collection's **data path** as their value instead of the catalog binding id. `collectionBindingKey` is a path everywhere else (AST import writes denormalized paths; presets write paths), and export registers collections by path — selecting the raw id `lineItems` would have exported a bogus `collection.lineItems` binding with path `lineItems`, which the evaluator cannot resolve against the view model (it exposes `items`). With the path as the option value, export reuses the registered catalog binding (`lineItems`, path `items`), and preview/PDF resolve the intended rows. Ids that equal their path (`timeEntries`, `ticketGroups`, `ticketPresentationRows`, `recurringItems`, …) are unaffected; transforms source/output options keep their binding ids verbatim.

### `setNodeProp(..., undefined)` audit

Swept the designer (`packages/billing/src/components/invoice-designer`) for other clearing sites hitting the same rejection: **the widget's handler was the only one**. `DesignerSchemaInspector.applyNormalized` and `DesignerShell` (`applyFlexBasis`, `applyFlexNumber`, aspect-ratio) already route undefined through `unsetNodeProp`; every other `setNodeProp` call site passes concrete values.

### Behavioral test

`packages/billing/src/components/invoice-designer/inspector/widgets/TableEditorWidget.sourceRebinding.test.tsx` — imports an AST containing a dynamic table bound to `timeEntries` (via `importTemplateAstToWorkspace` + the real designer store), renders the real `TableEditorWidget`, fires the source-binding select change (the widget's own `onValueChange` path), exports through `exportWorkspace()` → `exportWorkspaceToTemplateAst`, and asserts the persisted `repeat.sourceBinding.bindingId`:

- rebind to All Line Items → `lineItems` (registered catalog binding, path `items`), stable across re-import;
- with authored transforms, rebind to the transforms output → `timeEntries.transformed`;
- the preserved `metadata.__astTableSourceBindingId` key is asserted present on the imported node and gone after the change (guards the export assertion against passing vacuously).

### Live repro (dev stack, port 3967, layout `d1f349bb-64f1-4fee-a54b-c7a821c63ea9`)

Baseline saved AST table bindings: `["ticketPresentationRows", "timeEntries"]` (jsonpath double-match artifact aside, one table each; the billed-time table is node `d30906f3-c2b5-4026-84bf-ec59022be7d4`).

1. Selected the billed-time table, changed Source Binding to **timeEntries.transformed (Transforms output)**, Save Template. DB: `repeat.sourceBinding.bindingId = "timeEntries.transformed"`. Reopen shows the transforms output selected; drafts preview renders the table with 4 transformed rows, no render error.
2. Changed the same table to **All Line Items**, Save Template. DB: `repeat.sourceBinding.bindingId = "lineItems"` with `bindings.collections.lineItems.path = "items"`; drafts preview renders 5 invoice line-item rows.
3. Restored **timeEntries.transformed** and saved (final persisted state).

Screenshots: `/home/robert/alga-artifacts/invoice-ticket-rebind-mitigation-2026-09-06/screenshots/` (`wo-rebind-selected.png`, `wo-rebind-reopened.png`, `wo-rebind-preview.png`, `wo-rebind-lineitems-preview.png`).

## Defect 2 — generic "Failed to render template using Wasm." for invalid bindings

`renderTemplateOnServer` now classifies `TemplateEvaluationError` (missing/invalid bindings, from both evaluation and render) as an expected action error carrying the evaluator's diagnostic, on the standard `actionError` + `messageKey` localization seam (`msp/invoicing:errors.template.evaluationFailed`, added to all ten locales). `TemplateRenderer` now recognizes the action-error result shape — previously it destructured `{html, css}` off it blindly — and displays the localized diagnostic instead of the generic Wasm failure.

### Live repro (dev stack, port 3967, layout `d1f349bb-64f1-4fee-a54b-c7a821c63ea9`)

Deliberately broke the billed-time table's binding in the saved AST (DB update: `repeat.sourceBinding.bindingId` → `nonexistent.binding`, transforms output left intact so nothing resolves it), then opened the drafts preview (`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=2bfcea7e-8bd8-42b0-b198-bb90880f2c4c&templateId=d1f349bb-…`):

- Preview shows the evaluator's diagnostic, not the generic Wasm error: `Error: Template data binding failed: Collection "nonexistent.binding" (path "nonexistent.binding") is missing or is not an array.` — screenshot `wo-fix2-invalid-binding-diagnostic.png`.
- Restored the original AST from backup (`fix2/templateAst-backup.json`); preview renders again with no error — screenshot `wo-fix2-restored-preview.png`.

## Verification

- New test: 2/2 pass. `TableEditorWidget.integration.test.tsx`: 9/9 pass.
- Designer + invoice-template-ast + adapters suites: 587/588 (114 files). The one failure, `workspaceAst.standardTemplates.regression.test.ts` (`standard-invoice-by-ticket` expects node ids `line-items` / `billed-time-heading` that the reworked by-ticket template no longer contains), **fails identically on clean HEAD with this round's changes stashed** — pre-existing stale expectation, out of this round's scope, left untouched.
- billing-dashboard + actions suites: 275/277. The two failures (`prepaidBalanceAlertSettingsActions.db.test.ts`, DB-backed feature-flag cases) also fail identically on clean HEAD — pre-existing/environmental, unrelated.
- `packages/billing` `tsc --noEmit`: clean. `server` `tsc --noEmit` (16 GB heap): clean.
- Full isolated server webpack build: **skipped** — changes are client components, one server-action error branch, and locale JSON; no build-graph impact beyond what the passing typechecks cover.
