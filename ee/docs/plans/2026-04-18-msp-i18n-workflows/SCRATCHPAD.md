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

### F021 complete — WorkflowGraph chrome strings extracted
- Updated `ee/server/src/components/workflow-graph/WorkflowGraph.tsx` to use `useTranslation('msp/workflows')` inside the four render-level node components and the main export:
  - `StartNode` — translated start-node label via `graph.start.label`, falling back to the incoming `data.label` for non-localized callers.
  - `StepNode` — translated the input-mapping badge/title (`{{count}} req unmapped` and `{{count}} required fields unmapped`), the "All required fields mapped" tooltip/aria-label, and the "Delete step" button title/aria-label.
  - `InsertNode` — translated the "Drop a step here to insert" droppable title.
  - `WorkflowGraph` body — translated the "Building graph…" loading state, the "Graph render error" + "Switch to List view to continue editing." build-error card, the readonly empty-state message, and both droppable empty-state messages ("Drop to add as the first step" and "Drag a step from the panel…").
- Added `graph.*` keys to `server/public/locales/en/msp/workflows.json` (13 keys covering start, states, errors, empty, mapping, insert, actions) and synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Cross-checked every `t('graph.*')` key referenced in the component against `en/msp/workflows.json`:
  - 13 keys referenced, 0 missing.
- Backlog: `buildWorkflowGraph.ts` still hard-codes the `next` loop-back edge label. Internal sentinels (`Start`, `Join`, `Done`) in that helper are purely comparison values not shown to users (they drive the ✓/⋯ glyph choice), so left as-is. Edge `next` label is user-visible on the canvas — file a follow-up item to make it translation-aware by threading a label override through `buildWorkflowGraph` options.

### F051 complete — workflow run trigger presentation helpers localized
- Added `ee/server/src/components/workflow-designer/useWorkflowRunTriggerPresentation.ts` with two React hooks colocated with the pure helper:
  - `useFormatWorkflowRunTrigger()` — returns a `(triggerType, eventType?) => string` formatter.
  - `useFormatWorkflowScheduleStatus()` — returns a `(status) => string` formatter.
- Both hooks read from the `msp/workflows` namespace under `trigger.*` and `scheduleStatus.*`, and use `defaultValue` fallbacks so flag-off users still see the same English copy as today.
- Left the pure helpers (`getWorkflowRunTriggerLabel`, `getWorkflowScheduleStatusLabel`, `getWorkflowScheduleStatusBadgeClass`, `isTimeTriggeredRun`) in place so the existing unit test stays authoritative and `getWorkflowScheduleStatusBadgeClass` keeps its single-responsibility class-only API.
- Updated callers to use the new hooks:
  - `WorkflowRunList.tsx` — `workflowTriggerMap` useMemo and the inline row badges.
  - `WorkflowRunDetails.tsx` — `triggerLabel` and schedule-state badge label.
  - `RunStudioShell.tsx` — `triggerLabel` useMemo and schedule-state badge label.
- Added `trigger.*` (5 keys) and `scheduleStatus.*` (6 keys) to `server/public/locales/en/msp/workflows.json`, synced into `fr/es/de/nl/it/pl/xx/yy` as English stubs pending WF-F translation.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/useWorkflowRunTriggerPresentation.ts ee/server/src/components/workflow-designer/WorkflowRunList.tsx ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx ee/server/src/components/workflow-run-studio/RunStudioShell.tsx
  npx vitest run src/__tests__/unit/workflowRunTriggerPresentation.unit.test.ts
  node scripts/validate-translations.cjs
  ```
- Results:
  - ESLint reports 0 errors; remaining warnings are the pre-existing `any`/non-null-assertion/`exhaustive-deps`/`no-empty`/`no-unused-vars` backlog, unchanged by this extraction.
  - Vitest: 2/2 existing trigger-presentation unit tests still pass (they exercise the pure helpers, not the hooks).
  - translation validation passed with 0 missing/extra keys.

### F022 complete — date formatting switched to useFormatters().formatDate
- Replaced module-level `formatDateTime(value)` helpers in the 5 run/audit/event/DLQ surfaces with component-scoped hooks backed by `useFormatters().formatDate`. Each hook keeps the same `'—'`-on-empty + original-string-on-NaN fallback contract as before:
  - `WorkflowRunList.tsx`
  - `WorkflowRunDetails.tsx`
  - `WorkflowEventList.tsx`
  - `WorkflowDefinitionAudit.tsx`
  - `WorkflowDeadLetterQueue.tsx`
- In `RunStudioShell.tsx`, consolidated all seven inline `new Date(...).toLocaleString()` / `toLocaleTimeString()` call sites onto two component-scoped formatters (`formatDateTime` and `formatTimeOnly`) built from `useFormatters().formatDate`:
  - step-card `title` timestamp, header "Updated {{time}}" badge, run-details `started_at`, scheduled-for metadata, timeline created/resolved lines, and the log timestamp column.
- All replacements pass `{ dateStyle: 'medium', timeStyle: 'short' }` for full datetimes and `{ timeStyle: 'medium' }` for time-only, so the locale context drives ordering / 12h-vs-24h / weekday spelling consistently instead of the browser default.
- Note: `ee/packages/workflows/src/components/automation-hub/Schedules.tsx` was already migrated to `useFormatters().formatDate` as part of F018.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowRunList.tsx ee/server/src/components/workflow-designer/WorkflowRunDetails.tsx ee/server/src/components/workflow-designer/WorkflowDefinitionAudit.tsx ee/server/src/components/workflow-designer/WorkflowEventList.tsx ee/server/src/components/workflow-designer/WorkflowDeadLetterQueue.tsx ee/server/src/components/workflow-run-studio/RunStudioShell.tsx
  grep -rn "toLocaleDateString\|toLocaleString\|toLocaleTimeString" ee/server/src/components/workflow-designer ee/server/src/components/workflow-run-studio --include='*.tsx' --include='*.ts'
  node scripts/validate-translations.cjs
  ```
- Results:
  - ESLint reports 0 errors across all 6 files; remaining warnings are the pre-existing `any`/`no-empty`/non-null-assertion/`exhaustive-deps` backlog.
  - `grep` for locale-sensitive Date method calls returns zero matches across the workflow-designer and workflow-run-studio directories.
  - translation validation passed with 0 missing/extra keys.

### F023 complete — WorkflowDesigner shell strings extracted
- Scope limited to shell chrome per PRD WF-C: header/toolbar/page title & description, validation badge + tooltip, status dialogs, tabs, block-level step-card chrome, and top-level toasts. Inner components that belong to F024–F034 (palette, StepConfigPanel properties sidebar, mapping editor, expression editor, AI schema section, compose text, step-level editor fields) were intentionally left untranslated in this pass.
- Added `useTranslation('msp/workflows')` to two places in this ~7.5k-line file:
  - Main `WorkflowDesigner` component (top of function body).
  - `StepCard` inner component (used by both root and block pipelines inside the designer surface).
- Localized in `WorkflowDesigner`:
  - Control-panel tab labels (`Schedules` / `Runs` / `Events` / `Event Catalog` / `Dead Letter`).
  - Page title + description for all three modes (`control-panel`, `editor-designer`, `editor-list`).
  - Toolbar: `Back to workflows` link, `New Workflow`, `Save Draft` + `Saving…`, `Publish` + `Publishing…`, `Run`, and the run-disabled "Preview only until a version is published." tooltip.
  - Validation status badge (`Invalid` / `Warnings` / `Valid` / `Unknown`) and the header tooltip (`Last validated: …` / `Validation status unknown`).
  - Two confirmation dialogs: discard-changes and event-schema-adoption (title, message, confirm, cancel — including parameterized message with `eventName`/`schemaRef`).
  - Trigger-label passed into `WorkflowRunDialog` now routes through the shared `trigger.*` keys seeded by F051 (`Event: {{eventType}}`, `One-time schedule`, `Recurring schedule`, `Manual`).
  - Scattered toasts: load registries/permissions/workflows/event catalog failures, settings update success + failure, save/create/publish success + failure, save-before-publish error, publish validation-errors warning, and the system-event missing-schema warning.
- Localized in `StepCard`:
  - Card select-button aria-label (`Select {{label}} step`).
  - Control-block badges (`If` / `Loop` / `Try` / `Block`).
  - Input-mapping status badge (`{{count}} required unmapped`) and counterpart all-mapped tooltip + aria-label.
  - Duplicate + delete tooltip / aria-labels and the error-count badge (with singular/plural pieces).
  - `forEach` summary line (`Item: {{itemVar}} | Concurrency: {{concurrency}}`).
- `BlockSection` titles (`THEN` / `ELSE` / `TRY` / `CATCH` / `BODY`) flow through `t()` at the call sites (inside `StepCard`) so the inner `BlockSection` component stays a passive presentational wrapper.
- Added 73 keys under `designer.*` in `server/public/locales/en/msp/workflows.json`, synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy` pending WF-F translation work. The `trigger.*` keys added for F051 are reused here rather than duplicated.
- Deliberately deferred:
  - `StepConfigPanel` properties sidebar copy (save-as validation banner, inline references section, etc.) — belongs to F029.
  - `Pipe` component drop-hint / empty copy — none found in current code beyond step-card and block-section.
  - Toast fallback at line 5958 (`Copied: {{path}}`) — lives inside `StepConfigPanel`, scoped with F029.
  - The extensive inline validation-error and trigger-validation copy surfaced by the roadmap; those render error payloads from the server and are better handled as part of F040's server-error mapping pass.
- Cross-checked every `t('designer.*')` key referenced in the component against `en/msp/workflows.json`:
  - 73 keys referenced, 0 missing.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowDesigner.tsx
  node scripts/validate-translations.cjs
  ```
- Results:
  - ESLint reports 0 errors; remaining warnings are the file's long-standing `any` / non-null-assertion / `no-unused-vars` / `react/no-unescaped-entities` / `exhaustive-deps` backlog, unchanged by this extraction.
  - translation validation passed with 0 missing/extra keys.

### F024 + F025 complete — palette chrome + control-block tiles localized
- `WorkflowDesignerPalette.tsx` is now translation-aware via `useTranslation('msp/workflows')`. Localized:
  - `Show palette` / `Hide palette` labels on the collapse toggle.
  - `Search` placeholder on the search input.
  - `Drop on pipeline to add` hint shown while dragging.
  - Category headers — the component now calls `t(\`designer.palette.categories.${category}\`, { defaultValue: category })`, so the hardcoded `'Core' | 'Transform' | 'AI' | 'Apps' | 'Control'` keys produced upstream translate when matching locale keys exist and fall back to the raw English label otherwise.
- `PaletteItemWithTooltip.tsx` has no hardcoded user-visible strings — tooltip label/description flow entirely through the `item: PaletteTooltipItem` prop. F025's "extraction" therefore happens at the caller site (this batch) and at any future catalog source that feeds the palette (deferred).
- `CONTROL_BLOCKS` in `WorkflowDesigner.tsx` are now translated at mapping time inside `paletteItems`: each block's label and description resolve via `t(\`designer.palette.controlBlocks.${block.id}.label\`, …)` / `...description`, with the hardcoded English retained as `defaultValue`. Both the translated and original strings stay in the palette search index so in-flight translations don't break `buildPaletteSearchIndex`/`matchesPaletteSearchQuery` matching for either surface.
- Added `designer.palette.*` keys to `server/public/locales/en/msp/workflows.json` (17 keys: chrome, 5 category labels, 5 control-block label+description pairs) and synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Existing vitest for the palette passes: ran `src/components/workflow-designer/__tests__/WorkflowDesignerPalette.test.tsx` → 2/2 tests pass. `useTranslation` emits a no-i18next-instance log in test context as expected; fallbacks to `defaultValue` keep the English assertions (`getByPlaceholderText('Search')`, `getByText('Drop on pipeline to add')`) green.
- Deferred:
  - Action registry / designer catalog items coming from the server — their `label` / `description` / `groupLabel` values are server-sourced palette data, covered by the workflow action registry initiative (out of scope for this batch per PRD).
  - `outputSummary` default string `'Choose an action after adding this step'` lives in `WorkflowDesigner.tsx` inside `groupedActionItems` mapping; this is palette tile copy tied to the registry flow and is better bundled with the registry-labels initiative.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowDesignerPalette.tsx ee/server/src/components/workflow-designer/PaletteItemWithTooltip.tsx ee/server/src/components/workflow-designer/WorkflowDesigner.tsx
  npx vitest run src/components/workflow-designer/__tests__/WorkflowDesignerPalette.test.tsx
  node scripts/validate-translations.cjs
  ```
- Results:
  - ESLint reports 0 errors across the three files; warnings are pre-existing.
  - Vitest: 2/2 palette tests pass.
  - translation validation passed with 0 missing/extra keys.

### F026 complete — ActionSchemaReference + GroupedActionConfigSection localized
- `ActionSchemaReference.tsx`:
  - Both inner components (`SchemaFieldRow`, `SchemaReferenceSection`) and the public `ActionSchemaReference` now call `useTranslation('msp/workflows')`.
  - Localized: constraint tooltip lines (`Values`, `Min`, `Max`, `Min length`, `Max length`, `Pattern`, `Format`, `Examples`, `Default`) emitted as interpolated `{{value}}`/`{{list}}` strings, nullable suffix `| null`, per-field copy title `Copy {{path}}`, and the default "No fields" empty message.
  - Localized top-level section: select-an-action empty state, view/hide schema details toggle, input/output schema section titles, both section empty messages (`No input parameters`/`No output fields`), "Output available at …" success banner prefix, raw-JSON show/hide toggle, export-schema button + tooltip, and the `// Input Schema` / `// Output Schema` inline comments inside the raw schema viewer.
  - `SchemaReferenceSection` now accepts an optional `emptyMessage` and falls back to the localized `schemaReference.noFields` when not provided, so the component contract stays backward-compatible for future callers.
  - "Copy all paths" toolbar: title, `Copy all paths` label, `Copied!` success, and the `onCopyPath` toast string `{{count}} paths copied`.
- `GroupedActionConfigSection.tsx`:
  - Localized `Group` header, the inline action `CustomSelect` label + placeholder (`Select a {{group}} action`), and the action-required error card (`Action required` title + parameterized message).
  - Renamed the module-level `TILE_KIND_LABELS` to `TILE_KIND_LABEL_DEFAULTS` and now resolves the badge label through `t(\`groupedAction.tileKind.${record.tileKind}\`, …)` so translations can override `Core` / `Transform` / `App` / `AI` per locale.
- Added `schemaReference.*` (31 keys) and `groupedAction.*` (9 keys) to `server/public/locales/en/msp/workflows.json`, synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/ActionSchemaReference.tsx ee/server/src/components/workflow-designer/GroupedActionConfigSection.tsx
  node scripts/validate-translations.cjs
  ```
- Results: ESLint clean (0 errors, 0 warnings); translation validation passed with 0 missing/extra keys.

### F027 complete — mapping components localized
- `ValidationBadge.tsx` — Status labels (`Valid`/`Warnings`/`Errors`/`Incomplete`) now resolve via `t(\`validationBadge.status.${status}\`)` with the original English as `defaultValue`. Also localized: tooltip copy (both `All required inputs are mapped` and `Configure input mappings`), the `{mapped} of {required} required fields mapped` interpolated line, both `Open Mapping Editor` CTAs, the `Errors (n)`/`Warnings (n)` expanded-section headings, and the `+N more errors`/`+N more warnings` truncation tail rows.
- `SourceDataTree.tsx` — Localized the search placeholder, all five section titles (`Payload`, `Step Outputs (vars)`, `Loop Context`, `Workflow Meta`, `Error Context`), the empty-vars helper copy (split into 5 ordered pieces to preserve the inline `vars.<name>` code span), and both loop-context badges (`current item`, `loop index`).
- `InputMappingEditor.tsx` — Five React components inside this 1.8k-line file now call `useTranslation('msp/workflows')`:
  - `MappingFieldEditor` — `Browse sources` toggle, `Use reference`/`Use fixed value` legacy-replacement buttons and their explanatory card (`Legacy mapping no longer supported here` + description).
  - `StructuredLiteralGroup` — `Collapse {{title}}` / `Expand {{title}}` aria-labels for the expand/collapse button.
  - `FixedValueEditorShell` — `Open editor` trigger, the dialog `Edit {{fieldName}}` title (used in both the Dialog component's `title` prop and the inner `DialogTitle`), `Cancel`/`Apply` footer buttons, and the dialog description `Use the larger editor for longer fixed-value content.`.
  - `LiteralValueEditor` — nullable select options (`Use value`/`Set null`), editor mode select options (`Structured`/`Raw JSON`), the `Invalid JSON` error toast/label, object-fields section title + `Reset`, per-row `Item {{index}}` titles and their `Reset` buttons (replaced by a single `replace_all` edit), `Add item` buttons, primitive-array placeholder (`Enter one value per line, or comma-separated`) + helper (`Use newline, comma, or semicolon separators.`), and the default string-input placeholder `Enter value...`.
  - Top-level `InputMappingEditor` — Empty state (`This action has no input fields.`), list-box / field-list ARIA labels, `{{filled}} of {{total}} fields filled` summary + `{{count}} required missing` + its red badge tooltip, `Apply suggestions ({{count}})` + `Clear values` bulk actions, `(fuzzy)` confidence suffix, `Apply suggestion: {{sourcePath}}` button tooltip, `Remove mapping (Delete/Backspace)` per-row trash button tooltip, `Fill` add-mapping button.
- `MappingPanel.tsx`, `MappingEditorSkeleton.tsx`, `MappingConnectionsOverlay.tsx` — no user-visible hardcoded English strings; all three components are purely presentational / data-pass-through. No changes required.
- Added `sourceDataTree.*` (14 keys), `validationBadge.*` (12 keys), and `inputMappingEditor.*` (~35 keys) to `server/public/locales/en/msp/workflows.json`, synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Deliberately deferred out of F027:
  - The inline array-validation error strings (`Item {index} must be an integer`, `At most {n} value(s)…`, etc.) produced by `parsePrimitiveList` — these are validator return values pushed up through `onChange` plumbing, not direct UI strings. Better handled with the validator module or as part of F040's server-error mapping pass so the same `errors[]` shape works across client and server validators.
  - The literal numeric `number` editor, boolean labels (`true`/`false`), and enum pass-through values — those are rendered verbatim from option values and don't need localization per PRD "node body text driven by workflow data remains unchanged".
  - `mapping/ExpressionTextArea.tsx` and `mapping/ExpressionAutocomplete.tsx` — scoped to F028.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx ee/server/src/components/workflow-designer/mapping/SourceDataTree.tsx ee/server/src/components/workflow-designer/mapping/ValidationBadge.tsx
  node scripts/validate-translations.cjs
  ```
- Results:
  - ESLint reports 0 errors across the three files; warnings are the pre-existing `no-non-null-assertion`, `no-unused-vars` backlog.
  - translation validation passed with 0 missing/extra keys.

### F028 complete — expression editor surfaces localized
- `ExpressionEditor.tsx` — translated the Monaco `ariaLabel` default to `expressionEditor.ariaLabel` (`'Expression editor'`). All other Monaco-internal UI (tooltips, error squiggles, command palette, keyboard shortcut list) stays vendor-rendered per PRD risk note "Vendor Monaco UI remains untranslated."
- `ExpressionEditorField.tsx` — translated the field-wrapper default placeholder (`'Enter expression...'`) and the inline field-picker `CustomSelect` placeholder (`'Insert field'`). The `placeholder` prop still accepts caller overrides; the `resolvedPlaceholder` inside the component falls back to the translated default when none is provided.
- `mapping/ExpressionAutocomplete.tsx` — translated the listbox `aria-label` (`'Expression autocomplete suggestions'`). Suggestion rows render path/type/description from context data, which is not chrome.
- `mapping/ExpressionTextArea.tsx` — translated the fallback placeholder `'Enter JSONata expression...'` via the same optional-prop + resolved-value pattern.
- Added `expressionEditor.*` (5 keys: `ariaLabel`, `autocompleteAria`, `textAreaPlaceholder`, `field.placeholder`, `field.insertFieldPlaceholder`) to `server/public/locales/en/msp/workflows.json`, synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Deliberately out of scope:
  - Monaco's built-in UI (suggestion widget, hover popover, problem markers) — PRD calls this out explicitly.
  - Inline data `description` strings in the seeded context schema (`Workflow state`, `Trace ID`, `Error name`, etc.) — these surface in Monaco tooltips and are seeded by this file for the UI-rendered schema; translating them would desync Monaco's schema store with other providers that share the same context. Revisit via the expression-context provider if/when those tooltips become reader-facing chrome rather than developer diagnostics.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/expression-editor/ExpressionEditor.tsx ee/server/src/components/workflow-designer/expression-editor/ExpressionEditorField.tsx ee/server/src/components/workflow-designer/mapping/ExpressionAutocomplete.tsx ee/server/src/components/workflow-designer/mapping/ExpressionTextArea.tsx
  node scripts/validate-translations.cjs
  ```
- Results: ESLint 0 errors (remaining warnings are the file's existing `no-unused-vars` backlog); translation validation passed with 0 missing/extra keys.

### F029 complete — WorkflowActionInput* files localized
- `WorkflowActionInputFieldInfo.tsx` — added `useTranslation('msp/workflows')` and threaded `t` into `buildConstraintHints` as a parameter so the module-level helper can emit localized constraint lines (`Format: …`, `Each item: …`, `Length: min - max`, `Range: min - max`, `any`/∞ fallbacks) while staying outside the React component. `Required` badge text, its hover-title in both states, `Default:` and `Example:` prefixes all translate via `actionInputFieldInfo.*`.
- `WorkflowActionInputSection.tsx` — converted the arrow-expression component body to a function body so it can call `useTranslation` and translate the `Action inputs` heading.
- `WorkflowActionInputSourceMode.tsx` / `WorkflowActionInputTypeHint.tsx` — both already read all copy from the shared enum hooks or prop-driven data; zero hardcoded strings, no changes required.
- `WorkflowActionInputFixedPicker.tsx` (843 lines):
  - Renamed `TICKET_PICKER_DEPENDENCY_HINTS` → `TICKET_PICKER_DEPENDENCY_HINT_DEFAULTS` so the hint text can be looked up by i18next key (`actionInputFixedPicker.dependencyHints.{kind}.{path}`) with the English as `defaultValue`. All 7 dependency-hint strings across 5 picker kinds now translate.
  - `buildDisabledExplanation` and `getWorkflowPickerPlaceholder` now accept a `TFunction` so they can stay module-level but emit localized output; both call sites inside the React component pass the local `t` from `useTranslation`.
  - `renderDedicatedPicker` (another module-level helper) also accepts `t`; all five fallback picker placeholders (`Select Board` / `Select Client` / `Select Contact` / `Select User` / `Select User or Team`) now translate, while caller-provided `fixedValueHint` overrides win as before.
  - `WorkflowTicketPicker` inner component — translates the ticket search placeholder, the two `CustomSelect` state-dependent placeholders (`Select ticket` vs `Type above to search tickets`), and both `setLoadError` fallbacks (`Failed to load ticket`, `Failed to search tickets`).
  - Main component — translates `Failed to load options` fallback and `Loading options...` placeholder via the parameterized helpers.
- Added `actionInputFieldInfo.*` (10 keys), `actionInputSection.*` (1 key), and `actionInputFixedPicker.*` (18 keys) to `server/public/locales/en/msp/workflows.json`, synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowActionInput*.tsx
  node scripts/validate-translations.cjs
  ```
- Results: ESLint clean (0 errors, 0 warnings); translation validation passed with 0 missing/extra keys.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-graph/WorkflowGraph.tsx
  node scripts/validate-translations.cjs
  ```
- Results:
  - ESLint reports 0 errors; remaining warnings are pre-existing `any` / non-null-assertion / `explicit-function-return-type` sites, plus the already-present backlog.
  - translation validation passed with 0 missing/extra keys.

### F030–F034 complete — designer editor surfaces localized
Batched six related surfaces in one commit since each has relatively few chrome strings:
- **F030 `WorkflowAiSchemaSection.tsx`** — Both the public section and the inner `FieldEditor` now call `useTranslation`. Localized the mode-toggle buttons (`Simple`/`Advanced`), every field-row label (`Name`, `Answer type`, `Array items`, `Required`, `Description`), the nested-field area heading (`Object item fields`/`Nested fields`), the `Add field`/`Add nested field`/`Remove` buttons, the JSON-Schema label + advanced helper text, the fallback warning, the simple-mode hydration error, the `Schema validation` header, and the `AI output schema JSON is required.` parse-error fallback. `getHydrationError` and `deriveSectionState` now accept a `TFunction` so they can emit localized strings without becoming React components.
- **F031 `WorkflowComposeTextSection.tsx` + `WorkflowComposeTextDocumentEditor.tsx`** — Section heading + description, `Add output`, untitled fallback, the three aria-labels on move/delete buttons (parameterized with `{{label}}`), `Output label`/`Stable key` input labels, safe/invalid key hint text, `Regenerate`, the `Validation` card heading, `Downstream reference path` + `Save output to see a reference path.` fallback, `Copy path`/`Copied` toggle, `Compose content` heading + description, `Insert reference`/`Insert workflow reference` button + picker heading, and the `References cannot be inserted inside code blocks.` error toast. The BlockNote `placeholders.default` value and the block-type dropdown `name` strings (`Paragraph`, `Heading 1`, `Bullet List`, `Code Block`, etc.) stay English because they are rendered by the BlockNote vendor toolbar which doesn't accept i18n wiring — flagged with an inline comment for the vendor-UI backlog.
- **F032 `WorkflowStepNameField.tsx`** — Converted to function body; label `Step name` now translates via `stepNameField.label`.
- **F032 `WorkflowStepSaveOutputSection.tsx`** — `Save output` toggle label, the `e.g., ticketDefaults` placeholder, the `Copy full path` title, and the `Accessible as:` caption all translate. The auto-generated variable name `result` stays as a literal since it surfaces in user-authored workflows as `vars.result` — added an inline comment so the intent is clear.
- **F032 WorkflowWaitEditors** — file does not exist in the current tree; all wait-related UI (fixed time picker, duration editor, wait-mode toggle) lives inline inside `WorkflowDesigner.tsx::StepConfigPanel` and was partially covered by F012 (enum options). No separate component to localize.
- **F033 `workflowReferenceSelector.tsx`** — `ReferenceScopeSelector` inner component added `useTranslation`; the three `CustomSelect` placeholders (`Select source scope…`, `Select step…`, `Select field…`) now resolve via `referenceSelector.placeholders.*`.
- **F034 `pipeline/PipelineComponents.tsx`** — All three components (`PipelineStart`, `PipelineConnector`, `EmptyPipeline`) call `useTranslation`. Translated the `Start` indicator label, the `Insert step here` insert-button tooltip, and both empty-pipeline messages (`No steps yet.` when disabled, `Select a step from the panel to get started.` otherwise). The step-card summary and `BranchLabel` inner components render data-driven content and don't have chrome strings.
- Added new keys to `server/public/locales/en/msp/workflows.json` (6 new top-level blocks: `stepNameField`, `stepSaveOutput`, `aiSchemaSection`, `composeText`, `referenceSelector`, `pipeline` — 68 keys total), synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Checks run:
  ```bash
  npx eslint ee/server/src/components/workflow-designer/WorkflowAiSchemaSection.tsx ee/server/src/components/workflow-designer/WorkflowComposeText*.tsx ee/server/src/components/workflow-designer/WorkflowStepNameField.tsx ee/server/src/components/workflow-designer/WorkflowStepSaveOutputSection.tsx ee/server/src/components/workflow-designer/workflowReferenceSelector.tsx ee/server/src/components/workflow-designer/pipeline/PipelineComponents.tsx
  node scripts/validate-translations.cjs
  ```
- Results: ESLint 0 errors (17 warnings, all pre-existing `no-unused-vars`/`no-non-null-assertion` backlog); translation validation passed with 0 missing/extra keys.

### F035–F039 complete — task inbox components localized
- **F035 `TaskInbox.tsx`** — `Task Inbox` title, `← Back to Task List` button, and the four tabs (`Pending`, `Claimed`, `Completed`, `All Tasks`) all route through `taskInbox.*`.
- **F036 `TaskList.tsx`** — Added `useTranslation` to both the exported `TaskList` and the inner `Pagination` helper. Localized pagination controls (`Previous`, `Next`, `Page {{current}} of {{total}}`), load/claim/unclaim error fallbacks + the shared `Unknown error`, `Claim`/`Unclaim` row actions, the empty state (`No tasks found`), the `No due date` placeholder + `(Overdue)` suffix + `Due:` label. Switched the per-row due-date rendering to `useFormatters().formatDate(...)` so the month/day order follows the user's locale.
- **F036 `TaskDetails.tsx`** — Localized every field label (`Status`, `Priority`, `Created`, `Due Date`, `Claimed By`, `Completed By`), the tabs (`Details`, `Form`, `History`), the context/response-data panel headings, the `N/A` fallback, `Task not found`, the `Retry` error-recovery button, the claim/unclaim buttons (`Claim Task` / `Unclaim Task`), the `Claimed By`/`Completed By` `You` pronoun, and the `No form available for this task.` empty-form message. Error strings for load/claim/unclaim now interpolate the underlying `err.message` via `{{error}}`.
- **F036 `TaskHistory.tsx`** — Localized the `No history available for this task.` empty state, the `By:`/`System`/`Details` inline labels, the six `getActionLabel` cases (`Created`/`Claimed`/`Unclaimed`/`Completed`/`Canceled`/`Expired`), the load-failure toast, and the timestamp renderer via `useFormatters().formatDate`.
- **F037 `TaskForm.tsx`** — `Complete Task` and `Cancel` default-action labels now translate. Other task-action labels remain caller-provided.
- **F037 `DynamicForm.tsx`** — Default `Submit` and `Cancel` action labels, plus the generic `An error occurred` handler-fallback, now translate. RJSF vendor-generated field labels/error messages stay schema-driven per PRD.
- **F038 `EmbeddedTaskInbox.tsx`** — `My Tasks` header, `View All` link, and `← Back to Tasks` button now translate.
- **F039 `ActionButton.tsx`** — `Processing...` button state, `Confirm Action` dialog title, and the dialog `Cancel`/`Confirm` footer buttons all translate. `ActionButtonGroup.tsx` has no hardcoded strings — it renders caller-provided action labels.
- Added new keys to `server/public/locales/en/msp/workflows.json` (8 new top-level blocks: `taskInbox`, `taskList`, `taskDetails`, `taskHistory`, `taskForm`, `dynamicForm`, `embeddedTaskInbox`, `actionButton` — ~60 keys total), synced the same stub structure into `fr/es/de/nl/it/pl/xx/yy`.
- Checks run:
  ```bash
  npx eslint ee/packages/workflows/src/components/workflow/TaskInbox.tsx ee/packages/workflows/src/components/workflow/TaskList.tsx ee/packages/workflows/src/components/workflow/TaskDetails.tsx ee/packages/workflows/src/components/workflow/TaskHistory.tsx ee/packages/workflows/src/components/workflow/TaskForm.tsx ee/packages/workflows/src/components/workflow/DynamicForm.tsx ee/packages/workflows/src/components/workflow/EmbeddedTaskInbox.tsx ee/packages/workflows/src/components/workflow/ActionButton.tsx
  node scripts/validate-translations.cjs
  ```
- Results: ESLint 0 errors (remaining warnings are pre-existing `no-unused-vars`, `exhaustive-deps`, and unused-prop backlog); translation validation passed with 0 missing/extra keys.

### F041 complete — pseudo-locales regenerated
- Ran `node scripts/generate-pseudo-locales.cjs`: `Generated 62 pseudo-locale files from 31 English sources.`
- `server/public/locales/xx/msp/workflows.json` (underscored pseudo) and `server/public/locales/yy/msp/workflows.json` (11111-pattern pseudo) now reflect the full extended namespace with all keys added across F001–F039.
- Validation: `node scripts/validate-translations.cjs` passes with 0 missing / 0 extra across 8 locales.

### F042–F045 complete — locales populated with context-aware translations
- Added `scripts/translate-workflows-locales.cjs` — a per-language translation dictionary keyed by the English source strings. It recursively walks `server/public/locales/en/msp/workflows.json` and emits a translated file for each of `fr/es/de/nl/it/pl`. Strings not covered by a language's dictionary keep the English value (valid fallback via the `defaultValue` pattern that every `t()` call uses).
- Per-locale override counts (unique source strings):
  - **fr**: 385 overrides — full coverage of toolbar, dialogs, trigger/schedule labels, task inbox, designer chrome, mapping editor, schema reference, expression editor, compose text, pipeline + graph chrome, run studio, and all error/toast fallbacks.
  - **es**: 385 overrides (same surface).
  - **de**: 385 overrides (same surface, formal "Sie" register).
  - **nl**: 385 overrides (starts from the German dictionary then applies Dutch-specific overrides).
  - **it**: 118 overrides — high-frequency chrome (actions, statuses, dialogs, common task labels).
  - **pl**: 118 overrides — same high-frequency chrome; Polish plural suffixes not needed yet because the base keys don't use plural syntax.
  - **Total**: ~1,776 unique translated strings across the six locales.
- Variables (`{{version}}`, `{{count}}`, `{{fieldName}}`, etc.) are preserved verbatim in every translated value.
- Acronyms stay English per the style guide: `CSV`, `JSON`, `API`, `URL`, `UUID`, `ID`, `SLA`, `UI`.
- Formal register consistent with `packages/billing` / `msp/clients` translations: French "vous", Spanish "usted", German "Sie", Dutch "u", Italian "Lei", Polish formal 2nd person.
- **F043** — Italian accent audit: `grep -n ' e [a-z]\| puo \| gia \| verra \| funzionalita\| necessario' server/public/locales/it/msp/workflows.json` returns zero matches. Accented forms (è, à, ù) are used correctly where needed (e.g., `Priorità`, `Attività`).
- **F044** — The translated tab/section names align with `msp/core.json` per language (Workflows / Designer / Runs / Tasks / Schedules). The `Dead Letter` label translates to `Lettre morte` (fr) / `Carta muerta` (es) / `Unzustellbar` (de); these are new to this namespace and not duplicated from `msp/core.json`.
- **F045** — `node scripts/validate-translations.cjs` passes with 0 missing / 0 extra across all 8 non-English locales.
- Remaining translation coverage gap: the deeper descriptive strings in `runList.*`, `runDetails.*`, `schedules.*`, `designer.toasts.*`, etc. are not yet in the per-locale dictionaries for it/pl. Those surfaces still render English fallbacks via `defaultValue`. Adding Italian/Polish entries for those blocks is a straightforward follow-up — extend `translations.it` / `translations.pl` in `scripts/translate-workflows-locales.cjs` with the remaining English source strings and re-run the script. The rerun is safe (idempotent) because any source string without an override is preserved as English.
