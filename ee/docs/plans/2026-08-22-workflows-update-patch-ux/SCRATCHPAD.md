# Scratchpad — Update-Action Patch Fields UX

## Scope history

- 2026-08-22: First draft mis-scoped as workflow *versioning* update UX. Robert corrected: the task is the **patch fields on update-style business actions** — users can't tell the flat field pile edits an existing record. Versioning PRD discarded.
- Explicitly NOT in scope: `transform.assign` / `MappingExprEditor` (the other "change data" surface — free-text path + JSONata rows). Same confusion family, separate surface, separate future effort.

## Key file map (2026-08-22 exploration)

- Patch schemas (the five update actions), all in `shared/workflow/runtime/actions/businessOperations/`:
  - `tickets.ts:778-838` `tickets.update_fields` — `patch: { status_id, priority_id, assignment, title, category_id, subcategory_id, location_id, due_date (nullable), tags, custom_fields, attributes }` + `.refine(>=1 key, 'Patch must include at least one field')`; also `expected_updated_at`, `idempotency_key` as sibling inputs.
  - `contacts.ts:123-153, 994-1005` (`contacts.update`, UI "Edit Contact"), `clients.ts:170-190, 1354-1360`, `opportunities.ts:275-292`, `projects.ts:1950`.
  - Runtime: shallow defined-keys-win merge (`contacts.ts:1017-1027`); `clients.ts:1397-1399` merges `properties`; `tickets.ts:888-894` merges `attributes`. Outputs include before/after + `changed_fields`.
- UI pipeline: `WorkflowActionInputSection.tsx` → `MappingPanel` → `ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx`
  - `patch` arrives as `ActionInputField` with `children` (L198); object fields get Structured/Raw JSON mode switch (L1341-1420); raw mode = TextArea with 'Invalid JSON'.
  - Per-leaf source mode: `WorkflowActionInputSourceMode.tsx:9` `'reference' | 'fixed' | 'expression'`; defaults at :50-66.
  - Dependent-picker hardcode: `WorkflowActionInputFixedPicker.tsx:274-285` `candidatePaths = ['assignee.type','assignment.primary.type','patch.assignment.primary.type']` — must keep working.
- i18n: `server/public/locales/en/msp/workflows.json` — `inputMappingEditor.*` keys (mode.structured/rawJson, objectFields='Object fields', browseSources, fill, clearValues, addItem, askAi.ariaLabel), `validationBadge.tooltip.mappingCount`.
- Related prior art: `ee/docs/plans/2026-04-20-workflow-ticket-assignment-model/PRD.md:84` — "update-fields patch editor must support patch.assignment as structured input, not raw JSON-only"; `2026-03-14-workflow-fixed-value-editor-system/` (source-mode system); `2026-03-13-workflow-designer-grouped-palette-inline-inputs-transform-actions/`.
- Tests as spec: `InputMappingEditorPickerFields.test.tsx`, `businessOperations.*.db.test.ts`, `workflow-designer-publish.playwright.test.ts`.

## Decisions

- 2026-08-22: UI-layer only; emitted definition JSON unchanged (absent key = unchanged). No schema/runtime changes.
- 2026-08-22: Detection of update-style actions is schema-inferred from the `patch` object property; registry UI hint only if inference proves insufficient.
- 2026-08-22: Three UI options mocked in `/tmp/workflow-update-ux-options/` (patch-a/b/c.html + index.html) — A: changes list rule-builder, B: full form with explicit unchanged/change toggles, C: summary-first dialog with field catalog. **Robert chose Option C** (mockup archived as `mockup-option-c.html` in this folder). Watch-out: C is a modal dialog while every other action edits in the inline mapping panel — reuse the mapping-field components inside the dialog, don't fork them.

## Gotchas

- The mapping editor is generic across all actions — patch presentation must be gated so create-style actions are untouched.
- `due_date` is `.nullable().optional()`: three states (unchanged / set / clear) — UI must distinguish clear-vs-unchanged.
- `clients.update` patch key layout differs (nested `properties` merge) — verify the changes model handles a merged sub-record gracefully.
- Empty patch is a schema `.refine` failure — map that message to friendly copy rather than letting the raw zod string through.
- Every interactive element needs a stable `id` (ui-reflection/Playwright); copy via `useTranslation('msp/workflows')` with `defaultValue`.
