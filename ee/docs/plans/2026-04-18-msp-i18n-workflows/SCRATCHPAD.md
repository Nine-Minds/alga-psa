# Scratchpad — MSP Workflows i18n (Batch 2b-9)

> Rolling notes. Append freely. Never silently change PRD scope — if scope shifts, update PRD first, then note the change here.

## 2026-04-18 — Initial scope discovery

### File counts (non-test `.tsx`)
- `ee/server/src/components/workflow-designer/`: **34** (+ ~20 `.ts` helpers, +40 `__tests__/*.test.{ts,tsx}`)
- `ee/server/src/components/workflow-graph/`: **1** (`WorkflowGraph.tsx`)
- `ee/server/src/components/workflow-run-studio/`: **1** (`RunStudioShell.tsx`)
- `ee/packages/workflows/src/components/workflow/`: **12**

**Real total: 48 user-visible components.** The plan's "~104" figure in `MSP_i18n_plan.md` was inflated by test files and pure-TS helpers. Updated accordingly.

### Zero existing wiring confirmed
- `useTranslation`/`useFormatters` grep across all four directories returned **zero matches**.
- `^export const [A-Z_]+(_DISPLAY|_LABELS|_OPTIONS|_MAP)\s*[:=]` pattern: zero matches → no constant-based label maps to delete. The anti-pattern here is **inline option arrays inside components**, not exported constants.

### Inline option arrays found (13 distinct enums)
All identified at `ee/server/src/components/workflow-designer/...`:
- `WorkflowRunList.tsx:86-98` — workflowRunStatus + workflowRunSort
- `WorkflowRunDetails.tsx:175-188, 550` — workflowStepStatus + workflowLogLevel + filter sentinels
- `WorkflowEventList.tsx:73-76` — workflowEventStatus
- `WorkflowAiSchemaSection.tsx:51-64` — workflowAiSchemaType (duplicated array for object-property and array-item selects)
- `WorkflowActionInputSourceMode.tsx:27-28` — workflowInputSourceMode
- `workflowReferenceSelector.tsx:399-403` — workflowReferenceSection (rendered conditionally on model.*.length>0)
- `WorkflowDesigner.tsx:3713-3714, 4724-4725, 6249-6250, 6550-6551, 6614-6615` — workflowTriggerMode + workflowCanvasView + workflowOnError + workflowWaitMode + workflowWaitTiming

### Decision — single namespace
- Use `msp/workflows` (one namespace) instead of splitting into `msp/workflow-designer` + `msp/workflow-runs` + `msp/workflow-tasks`.
- **Why:** one MSP feature area; no current client-portal consumer; a single namespace keeps `ROUTE_NAMESPACES` simple; key count estimate (~1,000-1,500) is well within precedent (msp/clients has 953 keys in one file).
- **How to apply:** every component in the four directories calls `useTranslation('msp/workflows')`. If a task component is ever reused in client portal, consider extracting `features/workflow-tasks` at that time.

### Decision — enum hooks live in `ee/packages/workflows`
- Colocate with the rest of the workflows package:
  - `ee/packages/workflows/src/constants/workflowEnums.ts` — VALUES + LABEL_DEFAULTS for all 13 enums.
  - `ee/packages/workflows/src/hooks/useWorkflowEnumOptions.ts` — `useXOptions()` / `useFormatX()` for each.
- Style follows `packages/billing/src/hooks/useBillingEnumOptions.ts` (LocalizedOption<V> shape, defaultValue fallback).
- **Why:** matches the precedent set by Batch 2b-4 (billing) and Batch 6 (KB); keeps hook and source-of-truth values in the same package.

### Decision — filter sentinels stay in components
- "All statuses" / "All levels" / "All types" rows in filter dropdowns are *not* enum values. They stay as `t('filters.allStatuses')` etc. in the consuming component, prepended to the hook output:
  ```tsx
  const statusOptions = useWorkflowRunStatusOptions();
  const options = [{ value: 'all', label: t('filters.allStatuses') }, ...statusOptions];
  ```
- **Why:** the sentinel is a UI convention, not part of the enum domain; bundling it into the hook would make the hook's return type misleading.

### Decision — `getActivityStatusOptions` out of scope
- Lives in `ee/packages/workflows/src/actions/activity-actions/activityStatusActions.ts`; returns `{ value, label }` tuples from DB rows (activity status labels are tenant data, not UI chrome).
- No migration needed for this batch. Listed as deferred in the enum-labels backlog (F050).

### Decision — Single namespace for tasks vs. splitting
- `ee/packages/workflows/src/components/workflow/Task*.tsx` and `DynamicForm.tsx` are only mounted today under MSP routes. They render inside `/msp/workflow-editor/<id>` (task assignment step rendering) and prospectively in a dedicated inbox page under MSP.
- Keep these in `msp/workflows` for now. Open question #1 in PRD stays "answered no" unless a client-portal consumer appears.

### Backlog / deferred
- `FormExample.tsx`, `TaskInboxExample.tsx`, `ConditionalFormExample.tsx` — demo components. Not mounted in production. Defer unless extraction is trivial.
- Workflow action registry labels — separate initiative (registry API returns labels as data).
- Expression editor (Monaco) vendor UI — out of scope.
- React Flow node body text driven by workflow-definition data — out of scope.
- Dead-letter engine log messages — out of scope (server-side).

### Validation commands
```bash
# Validate translation coverage
node scripts/validate-translations.cjs

# Regenerate pseudo-locales after adding/changing English keys
node scripts/generate-pseudo-locales.cjs

# Enum anti-pattern audit (must return zero after WF-A merges)
rg -n "\{\s*value:\s*['\"][^'\"]+['\"]\s*,\s*label:\s*['\"][A-Z][^'\"]*['\"]" \
  ee/server/src/components/workflow-designer \
  ee/server/src/components/workflow-graph \
  ee/server/src/components/workflow-run-studio \
  ee/packages/workflows/src/components/workflow

# Hardcoded locale formatting (must return zero after WF-B)
rg -n "toLocaleDateString\(['\"]en|toLocaleString\(['\"]en" \
  ee/server/src/components/workflow-designer \
  ee/server/src/components/workflow-run-studio

# Italian accent audit (run after WF-F translations)
grep -n ' e [a-z]\| puo \| gia \| verra \| funzionalita\| necessario' \
  server/public/locales/it/msp/workflows.json
```

### Gotchas
- **Backend status codes.** `RUNNING / SUCCEEDED / FAILED` etc. are persisted verbatim in DB/Temporal. Use the raw value as the translation-key segment (`enums.workflowRunStatus.RUNNING`, not `.running`). Do NOT normalize casing.
- **Feature flag fallback.** When `msp-i18n-enabled` is off, `I18nWrapper` still renders but forces locale='en'. Every `t()` must pass `defaultValue` so flag-off users see the same English copy as today. Missing `defaultValue` = flag-off regression where users see the raw key.
- **Vitest assertions.** ~40 test files in `workflow-designer/__tests__/`. Several assert on English text (`getByText('Running')`). Migrating the status from inline array to hook means those assertions need to change to `getByRole` or to assert on option values rather than labels. Budget extra time in WF-B/WF-C/WF-D.
- **WorkflowDesigner.tsx is ~7k lines.** Plan WF-C carefully — consider splitting extraction by section (toolbar, palette sidebar, properties sidebar, canvas overlay) if the PR gets too big to review in one pass.
- **Namespace mismatch.** If a `t()` call in a workflow component accidentally uses `msp/core` or `msp/settings` instead of `msp/workflows`, the key will resolve if the target namespace happens to have that key, otherwise it renders the raw key. Lint-style regression test (T040) catches these.

### PR breakdown estimate
| PR | Sub-batch | Files touched | Risk |
|----|-----------|---------------|------|
| 1 | WF-A foundation | `config.ts`, `workflowEnums.ts`, `useWorkflowEnumOptions.ts`, 9 new `msp/workflows.json` files, pseudo-locale gen | Low |
| 2 | WF-B run studio + run list | 12 component files, `msp/workflows.json` (en) additions | Medium (Vitest updates) |
| 3 | WF-E task + form | 9 component files | Low |
| 4 | WF-C designer shell | 3 files but WorkflowDesigner is 7k lines | High (review burden) |
| 5 | WF-D designer editors + mapping | 22 component files | Medium |
| 6 | WF-F translations + QA | locale files only | Low (mechanical) |

Target order: WF-A → WF-B+WF-E in parallel → WF-C → WF-D → WF-F.

### Open TODOs
- [ ] Confirm with design that German "Workflow-Abläufe" / "Arbeitsabläufe" pick in core.json before WF-F translates the workflows namespace.
- [ ] Determine whether `ExpressionEditor` hover/completion messages are user-facing or dev-only (blocks part of F028).
- [ ] Decide whether to write the audit test (T040) as a unit test or extend the existing `ContractLinesSubbatch.i18n.test.ts` pattern.
- [ ] Confirm no active workflow-run-studio redesign is in flight that would conflict with this batch's shell changes.

### Links
- Main plan: `.ai/translation/MSP_i18n_plan.md`
- Translation guide: `.ai/translation/translation-guide.md`
- Enum pattern (with backlog this batch should update): `.ai/translation/enum-labels-pattern.md`
- File-structure reference (update after WF-F): `.ai/translation/translation_files_structure.md`
- Example hook style: `packages/billing/src/hooks/useBillingEnumOptions.ts`
- Example batch SCRATCHPAD style: `ee/docs/plans/2026-04-09-msp-i18n-credits/SCRATCHPAD.md`

## 2026-04-19 — Progress log

### F001 complete — namespace scaffold created
- Added `server/public/locales/{en,fr,es,de,nl,it,pl,xx,yy}/msp/workflows.json`.
- Initial scaffold currently includes `page`, `nav`, `sections`, `empty`, and `actions` roots so downstream component work can add keys incrementally without first creating the namespace.
- Non-English production locales currently copy English as temporary stubs, matching the PRD. `xx` and `yy` were also created as temporary structural stubs so `validate-translations.cjs` passes from the first commit; F041 will regenerate them from English later.
- Validation run: `node scripts/validate-translations.cjs` — passed with 0 missing/extra keys across production locales and structural match for pseudo-locales.

### F002 complete — route namespace loading wired
- Added `msp/workflows` namespace loading to `packages/core/src/lib/i18n/config.ts` for:
  - `/msp/workflows`
  - `/msp/workflows/runs`
  - `/msp/workflow-editor`
  - `/msp/workflow-control`
- Verified longest-prefix behavior with:
  ```bash
  node --import tsx/esm -e "import { ROUTE_NAMESPACES, getNamespacesForRoute } from './packages/core/src/lib/i18n/config.ts'; ..."
  ```
- Confirmed dynamic workflow routes now resolve to `['common', 'msp/core', 'msp/workflows']`, including:
  - `/msp/workflows/runs/run-123`
  - `/msp/workflow-editor/abc`
  - `/msp/workflow-editor/new`

### F003 complete — workflow enum source of truth added
- Added `ee/packages/workflows/src/constants/workflowEnums.ts`.
- The file now exports 13 `*_VALUES` arrays plus 13 `*_LABEL_DEFAULTS` records for:
  - run status
  - run sort
  - event status
  - step status
  - log level
  - AI schema type
  - input source mode
  - reference section
  - trigger mode
  - canvas view
  - on-error
  - wait mode
  - wait timing
- Preserved raw backend values exactly as they appear today (`RUNNING`, `RETRY_SCHEDULED`, `started_at:desc`, etc.) so translation keys can be built directly from persisted values without normalization.
- Validation command:
  ```bash
  npx tsx -e "import * as enums from './ee/packages/workflows/src/constants/workflowEnums.ts'; ..."
  ```
  Verified every label-default map contains an entry for every enum value.

### F004 complete — localized enum hooks added
- Added `ee/packages/workflows/src/hooks/useWorkflowEnumOptions.ts`.
- Exported `useXOptions()` and `useFormatX()` hooks for all 13 workflow enums, all bound to `useTranslation('msp/workflows')`.
- Each hook uses `defaultValue` from the corresponding `*_LABEL_DEFAULTS` record so:
  - the workflow UI stays readable before the namespace finishes loading
  - flag-off MSP users still see English instead of raw translation keys
  - unknown server values fall back to the raw value string in formatter hooks
- Updated `ee/packages/workflows/package.json` to expose:
  - `@alga-psa/workflows/hooks/*`
  - `@alga-psa/workflows/constants/*`
- Sanity check:
  ```bash
  npx tsx -e "import { useWorkflowRunStatusOptions, useFormatWorkflowRunStatus } from './ee/packages/workflows/src/hooks/useWorkflowEnumOptions.ts'; ..."
  ```
  Confirmed the new hook module resolves and exports functions.

### F005 complete — enum translation keys seeded
- Added `enums.*` trees for all 13 workflow enums under `server/public/locales/en/msp/workflows.json`.
- To keep `validate-translations.cjs` green while the feature batch is still in progress, mirrored the same key structure into `fr/es/de/nl/it/pl/xx/yy` as temporary English stubs. F042/F041 will replace those with real translations and regenerated pseudo-locales later.
- Validation rerun after the enum-key expansion:
  ```bash
  node scripts/validate-translations.cjs
  ```
  Passed with 0 missing/extra keys.

### F006 complete — WorkflowRunList uses enum hooks
- Updated `ee/server/src/components/workflow-designer/WorkflowRunList.tsx` to consume:
  - `useWorkflowRunStatusOptions()`
  - `useWorkflowRunSortOptions()`
- Removed the local `STATUS_OPTIONS` and `SORT_OPTIONS` inline English arrays.
- Kept the filter sentinel local to the component per PRD guidance:
  - `t('filters.allStatuses', { defaultValue: 'All statuses' })`
- Added `filters.allStatuses` to `msp/workflows.json` across all locales as a temporary English stub.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowRunList.tsx
  node scripts/validate-translations.cjs
  ```
- ESLint result: no errors; existing warnings remain in `WorkflowRunList.tsx` for pre-existing `any`/unused-variable sites unrelated to this enum migration.

### F007 complete — WorkflowRunDetails uses enum hooks
- Updated `ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx` to consume:
  - `useWorkflowStepStatusOptions()`
  - `useWorkflowLogLevelOptions()`
- Removed the local inline arrays for step-status and log-level filters.
- Localized the remaining filter sentinels with `t()`:
  - `filters.allStatuses`
  - `filters.allLevels`
  - `filters.allTypes`
- `nodeTypeOptions` still builds dynamic type values from the loaded workflow definition, but the sentinel row is now translated.
- Added `filters.allLevels` and `filters.allTypes` to every locale file as temporary English stubs.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx
  node scripts/validate-translations.cjs
  ```
- ESLint result: no errors; current warnings in `WorkflowRunDetails.tsx` are pre-existing `any`/unused/non-null-assertion warnings outside this enum-hook change.

### F008 complete — WorkflowEventList uses enum hooks
- Updated `ee/server/src/components/workflow-designer/WorkflowEventList.tsx` to consume `useWorkflowEventStatusOptions()`.
- Removed the local inline event-status options array.
- Reused `filters.allStatuses` for the sentinel row.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowEventList.tsx
  node scripts/validate-translations.cjs
  ```
- ESLint result: no errors; existing warnings are unrelated pre-existing `any`/unused-variable warnings in `WorkflowEventList.tsx`.

### F009 complete — WorkflowAiSchemaSection uses schema-type hook
- Updated `ee/server/src/components/workflow-designer/WorkflowAiSchemaSection.tsx` to consume `useWorkflowAiSchemaTypeOptions()`.
- Removed the duplicated hardcoded primitive-type arrays.
- Preserved current UX by filtering out the `array` option only for the array-item picker, while the main field-type selector still exposes all 6 enum values from the shared hook.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowAiSchemaSection.tsx
  node scripts/validate-translations.cjs
  ```
- Result: no ESLint errors or warnings from this file; translation validation remained green.

### F010 complete — WorkflowActionInputSourceMode uses enum hook
- Updated `ee/server/src/components/workflow-designer/WorkflowActionInputSourceMode.tsx` to consume `useWorkflowInputSourceModeOptions()`.
- Removed the local `SOURCE_MODE_OPTIONS` inline English array.
- Kept all source-mode derivation / transition logic unchanged; only the select-label source changed.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowActionInputSourceMode.tsx
  node scripts/validate-translations.cjs
  ```
- Result: no ESLint errors or warnings from this file; translation validation remained green.

### F011 complete — workflowReferenceSelector uses enum hook
- Updated `ee/server/src/components/workflow-designer/workflowReferenceSelector.tsx` to consume `useWorkflowReferenceSectionOptions()`.
- Preserved the existing visibility rule by filtering the hook output based on whether `payload`, `vars`, `meta`, `error`, or `forEach` actually has entries in the current model.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/workflowReferenceSelector.tsx
  node scripts/validate-translations.cjs
  ```
- Result: no ESLint errors or warnings from this file; translation validation remained green.

### F012 complete — WorkflowDesigner inline enum arrays removed
- Updated `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx` to consume:
  - `useWorkflowTriggerModeOptions()`
  - `useWorkflowCanvasViewOptions()`
  - `useWorkflowOnErrorOptions()`
  - `useWorkflowWaitModeOptions()`
  - `useWorkflowWaitTimingOptions()`
- Replaced the five inline option arrays called out in the PRD:
  - trigger mode
  - canvas view
  - foreach/on-item-error
  - wait mode
  - wait timing
- Kept the hook calls local to the two component boundaries already present in the file:
  - main `WorkflowDesigner`
  - `StepConfigPanel`
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowDesigner.tsx
  node scripts/validate-translations.cjs
  ```
- ESLint result: no errors; the file still has a large pre-existing warning backlog (`unused`, `any`, `react-hooks/exhaustive-deps`, etc.) unrelated to this enum-hook conversion.

### F013 complete — WorkflowRunList strings extracted
- Updated `ee/server/src/components/workflow-designer/WorkflowRunList.tsx` to route all component-owned copy through `useTranslation('msp/workflows')`, including:
  - quick range chips
  - summary strip labels
  - filter labels/placeholders
  - table headers / empty states
  - row action labels
  - bulk-action dialog copy
  - toast fallbacks for load/export/bulk-action flows
- Switched run-status badges and summary counts from raw persisted values (`RUNNING`, `FAILED`, etc.) to `useFormatWorkflowRunStatus()` so localized labels render while action payloads still send raw enum values.
- Added `runList.*` keys to `server/public/locales/{en,fr,es,de,nl,it,pl,xx,yy}/msp/workflows.json` as temporary English stubs; real translations remain WF-F work.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowRunList.tsx
  node scripts/validate-translations.cjs
  ```
- ESLint result: no errors; the remaining warnings in `WorkflowRunList.tsx` are pre-existing `any`/unused-variable sites, plus the same existing helper-input typing.

### Added backlog item — workflowRunTriggerPresentation helper still returns English
- While extracting `WorkflowRunList.tsx`, confirmed `ee/server/src/components/workflow-designer/workflowRunTriggerPresentation.ts` still returns hardcoded English labels for:
  - `Manual`
  - `Event`
  - `One-time schedule`
  - `Recurring schedule`
  - schedule statuses such as `Scheduled` / `Paused`
- This helper is explicitly named in the PRD WF-B surface list but was missing from `features.json`.
- Added:
  - `F051` — translate the helper via workflow-aware formatters
  - `T046` — formatter coverage test for trigger + schedule-status labels
- Rationale: without a dedicated item, run-list and dialog surfaces would still leak English even after component extraction work is complete.

### F014 complete — WorkflowRunDetails strings extracted
- Updated `ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx` to localize component-owned copy across:
  - run header + action bar
  - summary metadata grid
  - step timeline filters / table / empty state
  - step detail panels, wait history, envelope tabs
  - action invocation cards
  - log viewer and audit trail
  - all five confirmation dialogs
  - toast fallbacks for load/export/retry/resume/cancel/replay/requeue flows
- Switched workflow run / step / log level badges from raw enum values to:
  - `useFormatWorkflowRunStatus()`
  - `useFormatWorkflowStepStatus()`
  - `useFormatWorkflowLogLevel()`
- Added `runDetails.*` keys to `server/public/locales/en/msp/workflows.json`, then synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy` to preserve validation parity until WF-F translations.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx
  node scripts/validate-translations.cjs
  ```
- ESLint result: no errors; remaining warnings are the file's pre-existing `any`/unused-type/non-null-assertion backlog unrelated to the i18n extraction.

### F015 complete — WorkflowRunDialog strings extracted
- Updated `ee/server/src/components/workflow-designer/WorkflowRunDialog.tsx` to use `useTranslation('msp/workflows')` for component-owned copy across:
  - dialog title / description / footer actions
  - workflow/event/schema selectors
  - draft/system/concurrency warnings
  - payload builder controls and validation summary
  - preset management and clipboard/latest-run toasts
  - form-builder object/array helper controls (`Show/Hide`, `Add field`, `Remove`, etc.)
- Added `runDialog.*` keys to `server/public/locales/en/msp/workflows.json`, then synced the same stub content into `fr/es/de/nl/it/pl/xx/yy`.
- Sanity check run:
  ```bash
  node - <<'NODE'
  # compared all runDialog.* keys referenced in WorkflowRunDialog.tsx against en/msp/workflows.json
  NODE
  ```
  Result: zero missing keys.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowRunDialog.tsx
  node scripts/validate-translations.cjs
  ```
- ESLint result: no errors; remaining warnings are pre-existing `any` / unused-prop / hooks-backlog warnings in the dialog file.

### F016 complete — WorkflowEventList strings extracted
- Updated `ee/server/src/components/workflow-designer/WorkflowEventList.tsx` to localize:
  - summary badges
  - filter labels/placeholders
  - table column headers
  - empty/loading states
  - event-detail drawer labels and action copy
  - export/detail-load toast fallbacks
- Switched event-status badges to `useFormatWorkflowEventStatus()` so `matched` / `unmatched` / `error` no longer render as inline English casing logic.
- Added `eventList.*` keys to `server/public/locales/en/msp/workflows.json`, then synced the stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Sanity check run:
  ```bash
  node - <<'NODE'
  # compared all eventList.* keys referenced in WorkflowEventList.tsx against en/msp/workflows.json
  NODE
  ```
  Result: zero missing keys.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowEventList.tsx
  node scripts/validate-translations.cjs
  ```
- ESLint result: no errors; remaining warnings are limited to pre-existing `any` / unused-catch-variable sites.

### F017 complete — WorkflowDeadLetterQueue strings extracted
- Updated `ee/server/src/components/workflow-designer/WorkflowDeadLetterQueue.tsx` to localize:
  - minimum-retry filter label/placeholder
  - table column headers
  - loading/empty states
  - refresh/load-more actions
  - dead-letter load toast fallback
- Switched dead-letter run status badges to `useFormatWorkflowRunStatus()` so persisted status codes no longer render raw.
- Added `deadLetter.*` keys to `server/public/locales/en/msp/workflows.json`, then synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Sanity check run:
  ```bash
  node - <<'NODE'
  # compared all deadLetter.* keys referenced in WorkflowDeadLetterQueue.tsx against en/msp/workflows.json
  NODE
  ```
  Result: zero missing keys.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowDeadLetterQueue.tsx
  node scripts/validate-translations.cjs
  ```
- ESLint result: clean, no warnings or errors from this file after the extraction.

### F018 complete — schedules surface extracted in automation-hub package
- `ee/server/src/components/workflow-designer/WorkflowSchedules.tsx` is only a wrapper; the actual schedule list and dialog live in:
  - `ee/packages/workflows/src/components/automation-hub/Schedules.tsx`
  - `ee/packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx`
  - `ee/packages/workflows/src/components/automation-hub/WorkflowScheduleTimezonePicker.tsx`
  - `ee/packages/workflows/src/components/automation-hub/workflowScheduleRecurrence.ts`
- Localized the full schedules surface under `schedules.*` in `msp/workflows.json`, covering:
  - list heading, filters, table columns, statuses, row actions, empty/loading/error states
  - create/edit dialog title, fields, recurring builder copy, business-hours guidance, payload editor chrome, validation copy
  - timezone-picker browse/custom affordances
  - recurrence summary/validation text via localization-aware helper options instead of hardcoded English strings
- Switched schedules timestamp rendering to locale-aware client formatters where practical:
  - list timestamps now use `useFormatters().formatDate(...)`
  - relative timestamps use `useFormatters().formatRelativeTime(...)`
- Kept fr/es/de/nl/it/pl/xx/yy as English structural stubs for this step so translation validation stays green until WF-F.
- Test harness updates:
  - mocked `@alga-psa/ui/lib/i18n/client` with stable `t()` + formatter functions in `Schedules.test.tsx`
  - added the newly consumed `listWorkflowSchemaRefsAction` to the workflow-actions test mock
  - mocked `Dialog` footer and lightweight `TimePicker` / `DateTimePicker` components so the schedule dialog remains testable after the i18n wiring
- Checks run:
  ```bash
  npx vitest run src/components/automation-hub/Schedules.test.tsx src/components/automation-hub/workflowScheduleRecurrence.test.ts
  npx eslint ee/packages/workflows/src/components/automation-hub/Schedules.tsx ee/packages/workflows/src/components/automation-hub/WorkflowScheduleDialog.tsx
  npx eslint ee/packages/workflows/src/components/automation-hub/WorkflowScheduleTimezonePicker.tsx ee/packages/workflows/src/components/automation-hub/workflowScheduleRecurrence.ts ee/packages/workflows/src/components/automation-hub/Schedules.test.tsx
  node scripts/validate-translations.cjs
  ```
- Results:
  - Vitest passed: 30/30 tests across schedules + recurrence
  - translation validation passed with 0 missing/extra keys
  - ESLint reported only pre-existing warnings in `WorkflowScheduleDialog.tsx` (`no-explicit-any`) and the existing warning backlog in `Schedules.test.tsx`

### F019 complete — WorkflowDefinitionAudit strings extracted
- Updated `ee/server/src/components/workflow-designer/WorkflowDefinitionAudit.tsx` to use `useTranslation('msp/workflows')` for:
  - empty/select-workflow state
  - audit card heading
  - export/load-more actions
  - table column headers
  - system/empty-value fallbacks
  - empty table state
  - load/export toast fallbacks
- Added `audit.*` keys to `server/public/locales/{en,fr,es,de,nl,it,pl,xx,yy}/msp/workflows.json` as English stubs pending WF-F translation work.
- Deliberately left the timestamp formatter itself for `F022`, which is the plan item dedicated to locale-aware date formatting in the audit/run surfaces.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowDefinitionAudit.tsx
  node scripts/validate-translations.cjs
  ```
- Results:
  - ESLint clean
  - translation validation passed with 0 missing/extra keys

### F020 complete — RunStudioShell strings extracted
- Updated `ee/server/src/components/workflow-run-studio/RunStudioShell.tsx` to use `useTranslation('msp/workflows')` for component-owned copy across:
  - header kicker/title/version/updated badges and back-to-workflows link
  - replay/cancel action buttons
  - run-status indicator row and pipeline view toggle (Graph/List)
  - execution-pipeline empty/loading/no-steps states and step-card labels (if/loop/try/block, then/else/try/catch/body sections, forEach summary)
  - step-status badges (running/succeeded/failed/retrying/pending/canceled) with attempt counter
  - run-details card fields (run id, started, duration, tenant, trigger, event type, schedule state, scheduled for, cron, waiting for, counts)
  - run errors panel and step-details empty/panels (configuration, input resolved, output, envelope snapshot)
  - execution timeline (search, empty, attempt/wait entries, status/event/key segments, created/resolved lines, jump buttons)
  - run logs (search, filters, clear, empty state) with localized log-level button labels via `useFormatWorkflowLogLevel()`
  - cancel/replay dialog (title, heading, description, reason/payload fields, close/confirm/working actions, invalid-JSON error)
  - toast fallbacks for reason-required/canceled/replay-started/action-failed flows
- Switched the run-status badge from raw persisted values to `useFormatWorkflowRunStatus()` while keeping `statusBadgeClasses` style lookups on the raw status code.
- Added `runStudio.*` keys to `server/public/locales/en/msp/workflows.json` (168 keys) and synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Cross-checked every `t('runStudio.*')` key referenced in the component against `en/msp/workflows.json`:
  - 104 keys referenced, 0 missing.
- Fixed a small indentation inconsistency in the `getStepStatusStyle` default branch introduced during extraction.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-run-studio/RunStudioShell.tsx
  node scripts/validate-translations.cjs
  ```
- Results:
  - ESLint reports 0 errors; remaining warnings are pre-existing `no-empty`, `exhaustive-deps`, non-null-assertion, and `any` sites unrelated to the i18n extraction.
  - translation validation passed with 0 missing/extra keys.
- Deliberately left `new Date(...).toLocaleString()` calls (`started`, `scheduled for`, `created`, `resolved`, timeline entry created/resolved lines) for `F022`, and `getWorkflowRunTriggerLabel`/`getWorkflowScheduleStatusLabel` helper output for `F051`.
