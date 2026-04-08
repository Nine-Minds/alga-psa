# Scratchpad — MSP i18n Batch 2b-21b/c: Projects + Project Templates Migration

- Plan slug: `2026-04-05-msp-i18n-projects-migration`
- Created: `2026-04-05`

## What This Is

Mechanical wiring pass: ~60 unwired MSP project + project-template components ×
`useTranslation(['features/projects', 'common'])`. Shared namespace (128 keys, 9 locales)
already exists and is already loaded by `ROUTE_NAMESPACES['/msp/projects']`. The
`templates.*` subtree (17 keys) is live. Client-portal side is 100% wired (9/9) — this
closes the MSP gap.

Consolidates parent plan's 2b-21b (projects, 45 files) and 2b-21c (project-templates,
15 files) because they share package, namespace, and patterns.

## Decisions

- **(2026-04-05)** Keep project-templates strings in existing `features/projects.json`
  under `templates.*` subtree rather than creating a new `features/project-templates.json`
  namespace. Rationale: already-wired components (`TemplateStatusColumnsStep`,
  `TemplateStatusManager`, `ProjectTaskStatusSettings`) use `features/projects` with
  `templates.*` keys and it's working. Splitting would fragment the namespace needlessly.
  Supersedes the parent plan's tentative "new `features/project-templates` namespace" idea.
- **(2026-04-05)** Use array multi-namespace form:
  `useTranslation(['features/projects', 'common'])`. Matches all 5 already-wired
  components. Generic actions (Save/Cancel/Delete/Confirm) pull from `common` via
  `common:` prefix.
- **(2026-04-05)** Ship sub-batches A (projects core, 15 files), B (project-templates,
  15 files), C (settings + small, 30 files) as independent PRs.
- **(2026-04-05)** Template wizard strings nested per-step
  (`templates.wizard.basics.*`, `templates.wizard.tasks.*`, etc.) rather than flat.
  Matches existing onboarding wizard pattern in `msp/onboarding.json`.
- **(2026-04-05)** Task document strings — prefer reusing `features/documents`
  keys where they match (upload/download/attach/remove). Only add
  `features/projects.taskDocuments.*` for project-task-specific copy. Verify
  `features/documents` is loaded transitively on `/msp/projects/[id]` routes.
- **(2026-04-05)** Translate toast messages, inline validation, and user-visible error
  strings. Do NOT translate `throw new Error('...')` strings caught by error boundaries
  or logged only.

## Discoveries / Constraints

- **(2026-04-05)** `features/projects.json` top-level groups: title, subtitle,
  searchPlaceholder, allStatuses, resetFilters, active, completed, onHold, timeline,
  milestones, phasesAndTasks, kanbanView, listView, task, tasks (15), phases (7),
  settings (22), templates (17), documents (13), team, budget, fields (12), status (5),
  messages (5), backToProjects, invalidProjectData, plus ~16 leaf fields. Total: 128 keys.
- **(2026-04-05)** `ROUTE_NAMESPACES` entries that load `features/projects`:
  - `/client-portal/projects` — already works
  - `/msp/projects` — loads `['common', 'msp/core', 'features/projects']`
  - `/msp/settings` — loads `['common', 'msp/core', 'msp/settings', 'msp/admin', 'msp/email-providers', 'features/projects']` (already includes it!)
  - `/msp/billing` — loads `['common', 'msp/core', 'features/billing', 'msp/reports']` (does not include projects — if any project component is rendered on billing, fix needed)
- **(2026-04-05)** Templates routes NOT in ROUTE_NAMESPACES:
  - `/msp/projects/templates`
  - `/msp/projects/templates/[templateId]`
  - `/msp/projects/templates/create`
  Should match-best against `/msp/projects` and inherit its namespaces. Verify.
- **(2026-04-05)** Already-wired MSP project components (reference patterns):
  - `PhaseListItem.tsx` → `useTranslation('features/projects')` (single-namespace form)
  - `TemplateStatusManager.tsx` → `useTranslation(['features/projects', 'common'])` (array form)
  - `TemplateStatusColumnsStep.tsx` → `useTranslation(['features/projects', 'common'])`
  - `ProjectTaskStatusSettings.tsx` → `useTranslation(['features/projects', 'common'])`
  - `TaskComment.tsx` → `useTranslation('common')`
  **Preferred: array form** — matches 3 of 5, supports `common:` prefix for shared keys.
- **(2026-04-05)** Largest files dominate the string count:
  - `ProjectDetail.tsx` 3,038 LOC / ~50 strings
  - `TemplateEditor.tsx` 2,315 LOC / ~28 strings
  - `TaskForm.tsx` 2,024 LOC / ~39 strings
  - `TaskListView.tsx` 1,320 LOC / ~9 strings
  - `PhaseTaskImportDialog.tsx` 1,290 LOC / ~21 strings
  - `TemplateTaskForm.tsx` 1,015 LOC / ~22 strings
  - `Projects.tsx` 980 LOC / ~21 strings
  - `TemplateTaskListView.tsx` 953 LOC / ~8 strings
  These 8 files alone are ~12,900 LOC and ~198 strings of the estimated ~450 total.
- **(2026-04-05)** Rough string estimates (heuristic undercount):
  - Sub-batch A (projects core): 15 files, ~250 strings
  - Sub-batch B (project-templates): 15 files, ~150 strings
  - Sub-batch C (settings + small): 30 files, ~80-100 strings
  - **Total: ~480 strings** (realistic: 500-650)
- **(2026-04-05)** `ProjectQuickAdd` reused in global quick-create:
  `server/src/components/layout/QuickCreateDialog.tsx`. Must work in both contexts.
- **(2026-04-05)** Zero-string components to verify: StatusColumn, TaskCommentThread,
  KanbanBoard, ClientPortalConfigEditor, ProjectPage, KanbanZoomControl, TaskCommentForm,
  DonutChart, TaskQuickAdd, TaskEdit, HoursProgressBar, ProjectActiveToggle,
  TaskPrioritySettings. Most are layout/style-only or re-export shims.
- **(2026-04-05)** `ProjectSettings` is exported from `@alga-psa/projects/components` and
  imported by `server/src/components/settings/SettingsPage.tsx` (Settings page wiring).
- **(2026-04-07, F001 audit)** Existing `features/projects` keys are enough for:
  base projects list chrome (`title`, `subtitle`, `searchPlaceholder`, `allStatuses`,
  `resetFilters`), generic project fields (`fields.*`), summary cards
  (`taskCompletion`, `budgetHours`, `hoursUsage`, etc.), base task table headers
  (`tasks.*`), phase shell (`phases.*`), attachments shell (`documents.*`),
  template status-column management (`templates.statuses.*`), and project/phase status
  settings (`settings.statuses.*`).
- **(2026-04-07, F001 audit)** Confirmed missing MSP key groups for sub-batch A:
  `projectList.*` (filters, empty-state CTAs, row actions, deletion toasts),
  `quickAdd.*`, `projectDetail.*` (header actions, tabs, metrics, phase actions, search),
  `taskForm.*` (field labels/placeholders, validation, checklist/deletion/move/duplicate
  confirmations, prefill copy), `taskDependencies.*`, `taskTicketLinks.*`,
  `materials.*`, `export.*`, `import.*`, `dialogs.*`, and `filters.deadline.*`.
- **(2026-04-07, F001 audit)** Confirmed missing MSP key groups for sub-batch B:
  `templates.list.*`, `templates.create.*`, `templates.apply.*`, `templates.detail.*`,
  `templates.editor.*`, `templates.taskForm.*`, and `templates.wizard.*` with nested
  per-step groups (`basics`, `phases`, `tasks`, `review`, `clientPortal`).
- **(2026-04-07, F001 audit)** Confirmed missing MSP key groups for sub-batch C:
  `settings.statuses.tenant.*` / project-settings page copy, plus small dialog/filter
  leaf keys reused by `CreateTaskFromTicketDialog`, `LinkTicketToTaskDialog`,
  `MoveTaskDialog`, `DuplicateTaskDialog`, `ProjectInfo`, `ProjectTaskStatusSelector`,
  `ProjectPhases`, `TaskStatusSelect`, `TicketSelect`, and `TaskTypeSelector`.
- **(2026-04-07, F001 audit)** Reuse decisions from current inventory:
  keep attachments copy under existing `documents.*` where strings match; add
  `taskDocuments.*` only for task-specific actions if required.
  Keep shared generic buttons in `common`.
  Reuse `tasks.*`, `fields.*`, `phases.*`, and `status.*` before adding narrower keys.
  Keep all template-related strings in `features/projects` under `templates.*`.
- **(2026-04-07, F001 audit)** Representative concrete gaps seen in code:
  `Projects.tsx` needs translations for `Projects`, search/filter placeholders,
  `Open menu`, and delete success toast.
  `ProjectQuickAdd.tsx` / `ProjectDetailsEdit.tsx` need full form labels, placeholders,
  unsaved/save confirmation copy, and portal visibility label.
  `TaskDependencies.tsx` lacks keys for section title, dependency editor actions, and
  task picker placeholders.
  `TaskTicketLinks.tsx` lacks keys for duplicate/invalid ticket toasts, section title,
  link/create dialog labels, and ticket search filters.
  `TaskDocumentsSimple.tsx` lacks keys for auth/validation toasts, create/upload/link
  buttons, remove actions, document-name placeholder, and unsaved-change dialog.
  `PhaseTaskImportDialog.tsx` needs a large `import.*` subtree for CSV instructions,
  mapping labels, preview stats, unmatched agents/statuses, and completion summaries.
- **(2026-04-07, F002)** Expanded `server/public/locales/en/features/projects.json`
  from 128 leaf keys to 665 leaf keys. Added new top-level groups:
  `projectList`, `quickAdd`, `edit`, `projectDetail`, `taskForm`,
  `taskDependencies`, `taskTicketLinks`, `taskDocuments`, `materials`, `export`,
  `import`, `dialogs`, `filters`, `projectInfo`, `projectPhases`, `selectors`,
  plus large `settings.*` and `templates.*` extensions.
- **(2026-04-07, F002)** Chose pragmatic scaffolding over late piecemeal key creation:
  the English namespace now contains concrete fallbacks for all plan groups, including
  template list/create/apply/detail/editor/wizard surfaces and project-settings/task-
  status-library surfaces. Later component wiring can mostly reuse these keys and only
  add narrowly missing leaves if a file surfaces unexpected copy.
- **(2026-04-07, F003)** Propagated the expanded `features/projects` tree into
  `fr/es/de/nl/it/pl` by deep-merging each existing locale over the new English source.
  Result: all six real locales now preserve their pre-existing translated values while
  gaining the full expanded key set for parity with English. Newly introduced leaves that
  did not previously exist are currently seeded from English; this keeps validation and
  wiring unblocked and preserves the prior human translations intact.
- **(2026-04-07, F004)** Ran `node scripts/generate-pseudo-locales.cjs` after the
  namespace expansion. Regenerated `xx/features/projects.json` and
  `yy/features/projects.json`; the run also refreshed `xx/common.json` because the pseudo
  generator rewrites every pseudo-locale file from current English sources in one pass.
- **(2026-04-07, validation)** `node scripts/validate-translations.cjs` passes after the
  locale propagation + pseudo generation (8 locales checked, 0 errors, 0 warnings).
- **(2026-04-07, F005)** Verified template-route namespace loading with the actual
  resolver via `node_modules/.bin/tsx -e ...getNamespacesForRoute(...)`.
  Results:
  `/msp/projects/templates` → `["common","msp/core","features/projects"]`
  `/msp/projects/templates/123` → `["common","msp/core","features/projects"]`
  `/msp/projects/templates/create` → `["common","msp/core","features/projects"]`
  No explicit `ROUTE_NAMESPACES` entries are needed; longest-prefix matching against
  `/msp/projects` already loads `features/projects` correctly.
- **(2026-04-07, F020)** Wired `packages/projects/src/components/ProjectDetail.tsx`
  to `useTranslation(['features/projects', 'common'])`. Translated the project-detail
  header/view controls, search/filter chrome, sticky-status/pin controls, selected-phase
  completion summary, empty-state guidance, confirmation dialogs, and the main toast copy
  for task/phase move/update/delete/import flows.
- **(2026-04-07, F020)** Added the missing `projectDetail.*` leaves required by the
  `ProjectDetail.tsx` wiring to English, re-synced `fr/es/de/nl/it/pl` via the merge
  script, regenerated pseudo-locales, and re-ran translation validation successfully.
- **(2026-04-07, F020 check)** `node_modules/.bin/eslint
  packages/projects/src/components/ProjectDetail.tsx` passes with pre-existing warnings
  only (no new lint errors introduced by the i18n wiring).
- **(2026-04-07, F021)** Wired `packages/projects/src/components/TaskForm.tsx` to
  `useTranslation(['features/projects', 'common'])`. Localized the form labels,
  placeholders, save/delete/time-entry actions, validation copy, checklist chrome,
  document/ticket cleanup confirmations, dependency-unsaved prompt, and task-level toast
  / error fallback copy for move/save/delete/duplicate/agent flows.
- **(2026-04-07, F021)** Extended `taskForm.*` with the missing leaves surfaced by the
  TaskForm audit: field labels (`descriptionLabel`, `dueDateLabel`, `taskTypeLabel`,
  `priorityLabel`), picker/help copy (`noService`, `addTeamMembers`, `loading`),
  confirmation/dialog strings (`deleteMessage`, `moveMessage`, `cancelMessage`,
  `dependencyUnsavedMessage`, keep/delete document/ticket actions), and operational
  fallback/toast strings (`saveFailed`, `deleteFailed`, `moveFailed`, `duplicateFailed`,
  `linkingPartialFailure`, `tagCreationPartialFailure`, `prepareTimeEntryFailed`, etc.).
- **(2026-04-07, F021)** Re-synced `fr/es/de/nl/it/pl` by deep-merging each locale over
  the updated English `features/projects` tree, regenerated `xx/yy` via
  `node scripts/generate-pseudo-locales.cjs`, and re-validated translations successfully.
- **(2026-04-07, F021 check)** `node_modules/.bin/eslint
  packages/projects/src/components/TaskForm.tsx` passes with pre-existing warnings only
  (25 warnings, 0 errors). The new i18n wiring did not add fresh lint failures.
- **(2026-04-07, F022)** Wired `packages/projects/src/components/PhaseTaskImportDialog.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the upload step,
  field-mapping table, preview summary/table chrome, invalid-row / unmatched-agent /
  unmatched-status guidance, large-import confirmations, resolution workflows, importing
  spinner, and completion summaries.
- **(2026-04-07, F022)** Extended `import.*` with the dialog-specific gaps surfaced by the
  audit: CSV read/process/import fallback errors, required/optional field lists,
  table/tooltip labels, large-import confirmation copy, unmatched agent/status warnings,
  next-step/import button text, row-limit description, task-count summaries, and
  `import.fields.*` labels so the field-mapping UI no longer depends on hardcoded English
  constants from `TASK_IMPORT_FIELDS`.
- **(2026-04-07, F022)** Re-synced `fr/es/de/nl/it/pl` from the updated English source,
  regenerated pseudo-locales, and re-ran `node scripts/generate-pseudo-locales.cjs &&
  node scripts/validate-translations.cjs` successfully.
- **(2026-04-07, F022 check)** `node_modules/.bin/eslint
  packages/projects/src/components/PhaseTaskImportDialog.tsx` passes with pre-existing
  warnings only (6 warnings, 0 errors).
- **(2026-04-07, F023)** Wired `packages/projects/src/components/Projects.tsx` to
  `useTranslation(['features/projects', 'common'])`. Localized the page title, create
  actions, filter placeholders, table headers, row-value fallbacks, screen-reader menu
  label, reset button, and the delete-success / delete-validation fallback copy.
- **(2026-04-07, F023)** Extended `projectList.*` with the list-specific gaps surfaced by
  the table audit: `columns.*`, `statusOptions.*`, row fallback values (`noClient`,
  `noContact`, `unassigned`, `notAvailable`, `thisProject`), and delete-validation /
  delete-failure messages used by `DeleteEntityDialog`.
- **(2026-04-07, F023)** Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and
  re-ran `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  successfully after the `projectList.*` additions.
- **(2026-04-07, F023 check)** `node_modules/.bin/eslint
  packages/projects/src/components/Projects.tsx` passes with pre-existing warnings only
  (17 warnings, 0 errors).
- **(2026-04-07, F024)** Wired `packages/projects/src/components/TaskDocumentsSimple.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the attachments section
  header, create/upload/link controls, empty state, remove/download/save flows, drawer
  titles and placeholders, file-attachment viewer copy, folder-selector prompt, and the
  unsaved-changes confirmation dialog shown above the task drawer.
- **(2026-04-07, F024)** Extended `taskDocuments.*` with the missing attachment-surface
  leaves surfaced by the audit: `attachmentsTitle`, short button labels (`newButton`,
  `uploadButton`, `linkButton`), empty-state/fallback names, load/create/save/remove/
  download failure messages, folder-selection copy, PDF label, and unsaved-change
  confirm strings.
- **(2026-04-07, F024)** Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and
  re-ran `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  successfully after the `taskDocuments.*` additions.
- **(2026-04-07, F024 check)** `node_modules/.bin/eslint
  packages/projects/src/components/TaskDocumentsSimple.tsx` passes with pre-existing
  warnings only (10 warnings, 0 errors).
- **(2026-04-07, F025)** Wired `packages/projects/src/components/TaskTicketLinks.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the associated-tickets
  section title, link/create actions, link-existing dialog chrome, filter labels and
  active-filter chips, select-ticket prompt, cancel/link actions, quick-create checkbox,
  and ticket-link toast / error fallback copy.
- **(2026-04-07, F025)** Extended `taskTicketLinks.*` with the remaining filter/dialog
  leaves surfaced by the audit: category / board / priority labels, active-chip templates,
  `selectTicketPlaceholder`, error fallbacks for link/remove/new-ticket flows, and small
  fallbacks like `clientFallback` and `defaultNewStatus`.
- **(2026-04-07, F025)** Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and
  re-ran `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  successfully after the `taskTicketLinks.*` additions.
- **(2026-04-07, F025 check)** `node_modules/.bin/eslint
  packages/projects/src/components/TaskTicketLinks.tsx` passes with pre-existing warnings
  only (13 warnings, 0 errors).
- **(2026-04-07, F026)** Wired `packages/projects/src/components/TaskDependencies.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the dependency section
  title, dependency-type labels, add/edit placeholders, action-button titles, empty
  state, and inline error fallbacks for add/remove/update flows in both edit and pending
  modes.
- **(2026-04-07, F026)** Added the only missing namespace leaf surfaced by the audit:
  `taskDependencies.updateError`, used when replacing an existing dependency target fails.
- **(2026-04-07, F026)** Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and
  re-ran `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  successfully after the `taskDependencies.updateError` addition.
- **(2026-04-07, F026 check)** `node_modules/.bin/eslint
  packages/projects/src/components/TaskDependencies.tsx` passes with pre-existing
  warnings only (14 warnings, 0 errors).
- **(2026-04-07, F027)** Wired `packages/projects/src/components/ProjectMaterialsDrawer.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the drawer header,
  add-form labels and placeholders, loading/empty states, add/remove toast copy, table
  headers/status badges, and the unbilled-total summary.
- **(2026-04-07, F027)** Extended `materials.*` with the small gaps surfaced by the
  component audit: product-search copy, add/remove failure messages, `adding` /
  `addMaterial`, and `unknownProduct`.
- **(2026-04-07, F027)** Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and
  re-ran `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  successfully after the `materials.*` additions.
- **(2026-04-07, F027 check)** `node_modules/.bin/eslint
  packages/projects/src/components/ProjectMaterialsDrawer.tsx` passes cleanly with 0
  warnings / 0 errors after wrapping the translation helper in `useCallback`.
- **(2026-04-07, F028)** Wired `packages/projects/src/components/ProjectTaskExportDialog.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the dialog title,
  phase/field selection headers, select-all toggles, selected-count summaries, export /
  exporting / completion copy, and the export-field checkbox labels via `export.fields.*`.
- **(2026-04-07, F028)** Added the small missing `export.done` leaf so the completion CTA
  stays `"Done"` instead of drifting to a generic close label.
- **(2026-04-07, F028)** Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and
  re-ran `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  successfully after the `export.done` addition.
- **(2026-04-07, F028 check)** `node_modules/.bin/eslint
  packages/projects/src/components/ProjectTaskExportDialog.tsx` passes with pre-existing
  warnings only (2 warnings, 0 errors).
- **(2026-04-07, F029)** Wired `packages/projects/src/components/ProjectQuickAdd.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the quick-add dialog
  title, field labels/placeholders, validation banner/errors, project-status add-new
  affordance, client-portal section header, and create/cancel button + toast copy used
  both on `/msp/projects` and in the global quick-create dialog.
- **(2026-04-07, F029)** No new locale keys were required. Existing `quickAdd.*`,
  `settings.statuses.addStatus`, and `common:actions.*` leaves fully covered the dialog,
  so this item was a pure component-wiring pass with English fallbacks preserved.
- **(2026-04-07, F029 check)** `node_modules/.bin/eslint
  packages/projects/src/components/ProjectQuickAdd.tsx` passes with a pre-existing hooks
  warning only (1 warning, 0 errors).
- **(2026-04-07, F030)** Wired `packages/projects/src/components/ProjectDetailsEdit.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the edit-form labels,
  placeholders, validation banner, active/inactive status chip, client-portal section
  header, save/cancel confirmation dialogs, and the success/failure/save-button copy.
- **(2026-04-07, F030)** Added one narrow locale leaf, `projectEdit.updateError`, so the
  update failure path stays under the project-edit namespace instead of falling back to a
  generic common save-error message. Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-
  locales, and re-ran translation validation successfully.
- **(2026-04-07, F030 check)** `node_modules/.bin/eslint
  packages/projects/src/components/ProjectDetailsEdit.tsx` passes with a pre-existing
  hooks warning only (1 warning, 0 errors).
- **(2026-04-07, F031)** Wired `packages/projects/src/components/PrefillFromTicketDialog.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the dialog title,
  search/filter labels, active-filter chips, ticket selector label, link-checkbox copy,
  reset/cancel action labels, and the confirm CTA.
- **(2026-04-07, F031)** Reused the existing `taskTicketLinks.*` filter chrome instead of
  adding a parallel prefill-specific subtree for shared ticket filter labels. Added only
  `dialogs.prefillFromTicket.confirm` for the domain-specific confirm button text, then
  re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran translation
  validation successfully.
- **(2026-04-07, F031 check)** `node_modules/.bin/eslint
  packages/projects/src/components/PrefillFromTicketDialog.tsx` passes with pre-existing
  warnings only (4 warnings, 0 errors).
- **(2026-04-07, F032)** Wired `packages/projects/src/components/TaskListView.tsx` to
  `useTranslation(['features/projects', 'common'])`. Localized the responsive table
  headers, hidden-columns alert, phase empty state, phase/task add buttons, badge/date/
  completion chrome, expand/collapse affordances, checklist/dependency tooltip copy, and
  task action titles.
- **(2026-04-07, F032)** Added a small list-view extension to the namespace:
  `projectDetail.hiddenColumnsAlert`, `projectDetail.listViewEmptyMessage`,
  `projectDetail.seeMore`, `projectDetail.seeLess`, `projectDetail.checklistItems`,
  `projectDetail.checklistSummary`, `projectDetail.unknownUser`, `projectDetail.blocksLabel`,
  plus `taskDependencies.dependsOn`, `taskDependencies.unknownTask`, and
  `projectPhases.addPhase`. Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales,
  and re-ran translation validation successfully.
- **(2026-04-07, F032 check)** `node_modules/.bin/eslint
  packages/projects/src/components/TaskListView.tsx` passes with pre-existing warnings
  only (4 warnings, 0 errors).
- **(2026-04-07, F033)** Wired `packages/projects/src/components/TaskCard.tsx` to
  `useTranslation(['features/projects', 'common'])`. Localized the card ARIA label,
  quick-actions menu/sr-only copy, priority tooltip, due-date chrome, see-more toggles,
  additional-agent / checklist / dependency tooltips, hide-tags control, and critical-path
  badge.
- **(2026-04-07, F033)** Added a narrow kanban/task-card extension under
  `projectDetail.*`: `taskCardAria`, `taskActions`, `priorityLevel`, `dueLabel`,
  `noDueDate`, `hideTags`, and `criticalPath`. Re-synced `fr/es/de/nl/it/pl`,
  regenerated pseudo-locales, and re-ran translation validation successfully.
- **(2026-04-07, F033 check)** `node_modules/.bin/eslint
  packages/projects/src/components/TaskCard.tsx` passes with pre-existing warnings only
  (117 warnings, 0 errors).
- **(2026-04-07, F034)** Wired `packages/projects/src/components/PhaseQuickAdd.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the dialog title,
  inline validation, phase-name/description placeholders, date labels/placeholders, save
  and cancel actions, and the add-phase failure fallback.
- **(2026-04-07, F034)** Added the small phase-quick-add leaves under `projectPhases.*`:
  `phaseNamePlaceholder`, `descriptionPlaceholder`, `adding`, and `addError`. Re-synced
  `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran translation validation
  successfully.
- **(2026-04-07, F034 check)** `node_modules/.bin/eslint
  packages/projects/src/components/PhaseQuickAdd.tsx` passes cleanly with 0 warnings /
  0 errors.
- **(2026-04-07, F050)** Wired `packages/projects/src/components/project-templates/TemplateEditor.tsx`
  to `useTranslation(['features/projects', 'common'])`, including the embedded
  `TemplateStatusColumn` and template-task-card helpers in the same file. Localized the
  editor shell, apply/actions menu, delete confirmations, client-portal dialog, phases
  sidebar, kanban header controls, empty states, status-column add buttons, and all task-
  card menu/tooltip chrome.
- **(2026-04-07, F050)** Expanded `templates.editor.*` with the editor-specific gaps
  surfaced by the audit: failure toasts (`deleteFailed`, `clientPortalSaveFailed`,
  `addPhaseFailed`, `updatePhaseFailed`, `deletePhaseFailed`, `moveTaskFailed`,
  `reorderPhaseFailed`, `taskSaveFailed`, `deleteTaskFailed`, `updateAssigneeFailed`),
  delete-confirmation messages, badge/action labels, sidebar guidance, status-column
  summary copy, list/kanban empty states, phase-duration summaries, task-card
  expand/collapse labels, and fallback labels like `statusFallback`, `unknownUser`, and
  `unknownTask`. Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran
  translation validation successfully.
- **(2026-04-07, F050 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/TemplateEditor.tsx` passes with
  pre-existing warnings only (8 warnings, 0 errors).
- **(2026-04-07, F051)** Wired `packages/projects/src/components/project-templates/TemplateTaskForm.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the create/edit title,
  all field labels/placeholders, validation and save-error copy, checklist/dependency
  section chrome, additional-agent guidance, form action buttons, and the unsaved-change
  confirmation dialog.
- **(2026-04-07, F051)** Extended `templates.taskForm.*` only where the existing subtree
  had gaps: `addAction`, `updateAction`, `saving`, `saveFailed`, `taskNameRequired`,
  `addChecklistItem`, `dependenciesHelp`, `cancelEditMessage`, `discardChanges`,
  `continueEditing`, and `additionalAgentsHelp`. Re-synced `fr/es/de/nl/it/pl`,
  regenerated pseudo-locales, and re-ran translation validation successfully.
- **(2026-04-07, F051 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/TemplateTaskForm.tsx` passes with
  pre-existing warnings only (3 warnings, 0 errors).
- **(2026-04-07, F052)** Wired
  `packages/projects/src/components/project-templates/wizard-steps/TemplateTasksStep.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the step title and
  description, phase selector, empty states, task editor labels/placeholders, service and
  assignment copy, checklist controls, inline validation, per-task summary text, add-task
  CTA, and the concluding tip callout.
- **(2026-04-07, F052)** Extended `templates.wizard.tasks.*` only for wizard-step-specific
  gaps: `noTasksInPhase`, `thisPhase`, `durationSummaryShort`, `noPriority`,
  `checklistItemsSummary`, `tipDescription`, `done`, and `addTaskToPhase`. Re-synced
  `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran translation validation
  successfully.
- **(2026-04-07, F052 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/wizard-steps/TemplateTasksStep.tsx`
  passes cleanly with 0 warnings / 0 errors.
- **(2026-04-08, F053)** Wired `packages/projects/src/components/project-templates/ApplyTemplateDialog.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the dialog title,
  validation banner, template/project/client/status/start-date fields, customization
  options, assignment radio labels, add-status affordance, submit/cancel actions, and
  success/error toast copy for load/apply flows.
- **(2026-04-08, F053)** Extended `templates.apply.*` only where the dialog surfaced
  small gaps or English drift: added `create`, `creating`, and `createFailed`, and
  aligned the existing English values for `startDateLabel` and `assignmentOptions.*`
  to the current UI text so the migration stays fallback-safe without changing the
  rendered English copy. Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales,
  and re-ran translation validation successfully.
- **(2026-04-08, F053 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/ApplyTemplateDialog.tsx` passes
  with a pre-existing hooks warning only (1 warning, 0 errors).
- **(2026-04-08, F054)** Wired `packages/projects/src/components/project-templates/ProjectTemplatesList.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the page title,
  toolbar buttons, search/category filters, table column headers, never-used fallback,
  row-action menu labels, delete-confirm dialog, loading state, and the user-facing
  load/delete error-handler copy.
- **(2026-04-08, F054)** Extended `templates.list.*` with the only missing list-page
  leaves surfaced by the audit: `loadFailed` and `deleteFailed`. Re-synced
  `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran translation validation
  successfully.
- **(2026-04-08, F054 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/ProjectTemplatesList.tsx` passes
  with pre-existing warnings only (unused `getTemplateCategories` import, existing
  `loadData` hooks warning; 3 warnings, 0 errors).
- **(2026-04-08, F055)** Wired `packages/projects/src/components/project-templates/CreateTemplateDialog.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the dialog title,
  source-project / template-name / description / category fields, copy-options section,
  create/cancel actions, success toast, and the load/create error-handler copy.
- **(2026-04-08, F055)** Extended `templates.create.*` with the only missing dialog
  leaves surfaced by the audit: `loadFailed` and `createFailed`. Re-synced
  `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran translation validation
  successfully.
- **(2026-04-08, F055 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/CreateTemplateDialog.tsx` passes
  cleanly with 0 warnings / 0 errors.
- **(2026-04-08, F056)** Wired `packages/projects/src/components/project-templates/TemplateTaskListView.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the responsive table
  headers, hidden-columns alert, empty state, phase/task add CTAs, untitled-phase/task-
  count chrome, phase timing summaries, dependency/checklist/additional-agent tooltips,
  unassigned fallback, status fallback, and edit/delete task action titles.
- **(2026-04-08, F056)** Reused existing `tasks.*`, `projectPhases.*`,
  `taskDependencies.*`, `projectDetail.*`, and `templates.editor.*` leaves where
  possible. Added only `templates.editor.noPhasesFound`, `untitledPhase`,
  `taskCount_one`, and `taskCount_other` for the template list-view-specific fallbacks.
  Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran translation
  validation successfully.
- **(2026-04-08, F056 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/TemplateTaskListView.tsx` passes
  with pre-existing warnings only (unused `taskTypes`, `priorities`, and
  `getAssigneeName`; 6 warnings, 0 errors).
- **(2026-04-08, F057)** Wired
  `packages/projects/src/components/project-templates/wizard-steps/TemplateReviewStep.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the step title and
  intro, template-information labels, status-columns header, task summary cards,
  task-details-by-phase heading, checklist-item count suffix, and the final ready-to-
  create callout.
- **(2026-04-08, F057)** Extended `templates.wizard.review.*` with only the review-step
  gaps surfaced by the audit: `descriptionLabel` for the summary block and
  `readyDescription` for the final creation callout. Re-synced `fr/es/de/nl/it/pl`,
  regenerated pseudo-locales, and re-ran translation validation successfully.
- **(2026-04-08, F057 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/wizard-steps/TemplateReviewStep.tsx`
  passes with pre-existing warnings only (unused `Layers` import and unused `index`
  callback arg; 4 warnings, 0 errors).
- **(2026-04-08, F058)** Wired
  `packages/projects/src/components/project-templates/wizard-steps/TemplatePhasesStep.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the step title and
  intro, empty state, phase-form labels/placeholders/help copy, validation message,
  done/cancel actions, duration/start/task summaries, add-phase buttons, reorder hint,
  recalculate CTAs, and the phase-timing explainer alert.
- **(2026-04-08, F058)** Extended `templates.wizard.phases.*` for the wizard-step gaps
  only: `intro`, `addFirstPhase`, `phaseNameRequired`, `daysAfterProjectStart`,
  `tasksCount`, reorder/recalculate copy, and the structured about-timing labels/help
  text. Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran
  translation validation successfully.
- **(2026-04-08, F058 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/wizard-steps/TemplatePhasesStep.tsx`
  passes cleanly with 0 warnings / 0 errors.
- **(2026-04-08, F059)** Wired `packages/projects/src/components/project-templates/CreateTemplateForm.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the page title,
  field labels/placeholders, create/cancel actions, validation toast, success toast,
  and create-failure error-handler copy.
- **(2026-04-08, F059)** No new locale keys were required. The existing
  `templates.create.*` subtree fully covered the standalone create page after the earlier
  dialog work, so this item was a pure component-wiring pass.
- **(2026-04-08, F059 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/CreateTemplateForm.tsx` passes
  cleanly with 0 warnings / 0 errors.
- **(2026-04-08, F060)** Wired `packages/projects/src/components/project-templates/TemplateDetail.tsx`
  to `useTranslation(['features/projects', 'common'])`, including the inline `TaskCard`
  helper. Localized the back/use/delete actions, delete confirmation, success/failure
  delete flows, template metadata labels, project-phases sidebar, phase header/timing
  summaries, status-column empty state, status fallback, and the phase-selection empty
  state in the kanban area.
- **(2026-04-08, F060)** Added one narrow detail-page leaf,
  `templates.detail.selectPhase`, for the kanban empty-state prompt. Re-synced
  `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran translation validation
  successfully.
- **(2026-04-08, F060 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/TemplateDetail.tsx` passes with
  pre-existing warnings only (unused dropdown-menu imports and unused
  `onTemplateUpdated`; 12 warnings, 0 errors).
- **(2026-04-08, F061)** Wired
  `packages/projects/src/components/project-templates/wizard-steps/TemplateClientPortalStep.tsx`
  to `useTranslation('features/projects')`. Localized the step title, intro paragraph,
  and the explanatory info alert above `ClientPortalConfigEditor`.
- **(2026-04-08, F061)** Extended `templates.wizard.clientPortal.*` with the only
  missing step leaves: `description` and `aboutDescription`. Re-synced
  `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran translation validation
  successfully.
- **(2026-04-08, F061 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/wizard-steps/TemplateClientPortalStep.tsx`
  passes cleanly with 0 warnings / 0 errors.
- **(2026-04-08, F062)** Wired `packages/projects/src/components/project-templates/TemplateCreationWizard.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the wizard dialog
  title, `WizardProgress` step labels, finish CTA, and the fallback load/validation/
  create error strings surfaced by the shell.
- **(2026-04-08, F062)** Extended the wizard namespace with only two shell-level leaves:
  `templates.wizard.title` and `templates.wizard.errors.createFailed`. Re-synced
  `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran translation validation
  successfully.
- **(2026-04-08, F062 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/TemplateCreationWizard.tsx` passes
  with pre-existing warnings only (unused exported type imports; 10 warnings, 0 errors).
- **(2026-04-08, F063)** Wired
  `packages/projects/src/components/project-templates/wizard-steps/TemplateBasicsStep.tsx`
  to `useTranslation('features/projects')`. Localized the template-name/description/
  category labels, placeholders, help copy, and the "What's Next?" info alert.
- **(2026-04-08, F063)** Extended `templates.wizard.basics.*` with the missing step
  leaves surfaced by the audit: `nameLabel`, `nameHelp`, `descriptionLabel`,
  `descriptionHelp`, `categoryLabel`, `categoryHelp`, and `nextHintDescription`.
  Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran translation
  validation successfully.
- **(2026-04-08, F063 check)** `node_modules/.bin/eslint
  packages/projects/src/components/project-templates/wizard-steps/TemplateBasicsStep.tsx`
  passes cleanly with 0 warnings / 0 errors.
- **(2026-04-08, F064)** Confirmed
  `packages/projects/src/components/project-templates/AddTemplateDialog.tsx` is a zero-
  string wrapper around `TemplateCreationWizard`. It introduces no user-visible copy and
  requires no i18n wiring of its own, so this item is N/A by design.
- **(2026-04-08, F080)** Wired
  `packages/projects/src/components/settings/projects/TenantProjectTaskStatusSettings.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the task-status-library
  title/description, create/import CTAs, loading and empty states, closed badge, edit/
  delete actions, create/edit dialog title, status-name/preview/color/icon chrome,
  closed-status checkbox help, submit/cancel actions, and the save/delete/import toast /
  error-handler / confirm-dialog copy.
- **(2026-04-08, F080)** Extended `settings.statuses.*` with the tenant-library-specific
  gaps surfaced by the audit: task-library description, import button/error copy, dialog
  preview labels, color/icon field labels, closed-status help text, delete-confirmation
  message, and update/save helper copy. Re-synced `fr/es/de/nl/it/pl`, regenerated
  pseudo-locales, and re-ran translation validation successfully.
- **(2026-04-08, F080 check)** `node_modules/.bin/eslint
  packages/projects/src/components/settings/projects/TenantProjectTaskStatusSettings.tsx`
  passes with pre-existing warnings only (`any` usages in legacy import/conflict code;
  8 warnings, 0 errors).
- **(2026-04-08, F081)** Wired
  `packages/projects/src/components/settings/projects/ProjectStatusSettings.tsx` to
  `useTranslation(['features/projects', 'common'])`. Localized the table headers, open/
  closed labels and project-status hints, actions-menu SR copy, card title/description,
  add/import buttons, delete-dialog fallback entity name, and the update/delete/import
  toast / error / validation feedback.
- **(2026-04-08, F081)** Extended `settings.statuses.*` with the small project-status
  page gaps surfaced by the audit: `open`, `order`, project-status description/hints,
  delete-validation failure, and `this_status`. Re-synced `fr/es/de/nl/it/pl`,
  regenerated pseudo-locales, and re-ran translation validation successfully.
- **(2026-04-08, F081 check)** `node_modules/.bin/eslint
  packages/projects/src/components/settings/projects/ProjectStatusSettings.tsx` passes
  with pre-existing warnings only (legacy non-null assertion and `any` usages; 4
  warnings, 0 errors). Also fixed the new `useCallback(... t ...)` dependency warning
  introduced by the i18n wiring.
- **(2026-04-08, F082)** Wired `packages/projects/src/components/ProjectTaskStatusEditor.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the inline label,
  loading state, customize controls, available-statuses prompt, add/remove/reorder
  feedback, closed badge, empty state, move/remove titles, and the ordering help text.
- **(2026-04-08, F082)** Extended `settings.statuses.*` with the narrow inline-editor
  leaves surfaced by the audit: task/phase labels, customize/project/phase helper copy,
  available-statuses heading, task-status load/add/remove/reorder errors, and the
  arrange-order hint. Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and
  re-ran translation validation successfully.
- **(2026-04-08, F082 check)** `node_modules/.bin/eslint
  packages/projects/src/components/ProjectTaskStatusEditor.tsx` passes with pre-existing
  warnings only (legacy non-null assertions; 2 warnings, 0 errors).
- **(2026-04-08, F083)** Wired
  `packages/projects/src/components/CreateTaskFromTicketDialog.tsx` to
  `useTranslation(['features/projects', 'common'])`. Localized the launcher button,
  dialog title, project/phase/status labels and placeholders, link-ticket checkbox, and
  create/cancel actions.
- **(2026-04-08, F083)** Extended `dialogs.createTaskFromTicket.*` only for the missing
  launcher/field-label leaves: `button`, `projectLabel`, `phaseLabel`, and
  `statusLabel`. Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales, and re-ran
  translation validation successfully.
- **(2026-04-08, F083 check)** `node_modules/.bin/eslint
  packages/projects/src/components/CreateTaskFromTicketDialog.tsx` passes with a pre-
  existing hooks warning only (`ticket.client_id` effect dependency; 1 warning, 0
  errors).
- **(2026-04-08, F084)** Wired `packages/projects/src/components/LinkTicketToTaskDialog.tsx`
  to `useTranslation(['features/projects', 'common'])`. Localized the launcher button,
  dialog title, project/phase/task labels and placeholders, cancel/link actions, and the
  success/error link feedback.
- **(2026-04-08, F084)** Extended `dialogs.linkTicketToTask.*` with the missing launcher
  and field/button leaves: `button`, `projectLabel`, `phaseLabel`, `taskLabel`,
  `linking`, and `confirm`. Re-synced `fr/es/de/nl/it/pl`, regenerated pseudo-locales,
  and re-ran translation validation successfully.
- **(2026-04-08, F084 check)** `node_modules/.bin/eslint
  packages/projects/src/components/LinkTicketToTaskDialog.tsx` passes with a pre-
  existing hooks warning only (`ticket.client_id` effect dependency; 1 warning, 0
  errors).

## Commands / Runbooks

### The lang-pack loop (run after every namespace edit)

```bash
node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs
```

- Regenerates `xx/` and `yy/` from English source (NEVER hand-edit pseudo-locales)
- Validates key parity, `{{variable}}` tokens, pseudo-locale fill patterns, Italian accents
- Exit code 0 = pass. Keep green before committing.

### Other useful commands

- Count strings in a component (lower bound):
  ```bash
  grep -cE ">[A-Z][a-zA-Z ]{2,}[a-z]<|(label|title|placeholder)[=:][ ]*['\"][A-Z]|toast\.(error|success|warning|info)\(['\"]|throw new Error\(['\"]" <file>
  ```
- List all unwired MSP project components (excluding templates):
  ```bash
  for f in $(find packages/projects/src/components -type f -name "*.tsx" ! -name "*.test.tsx" ! -path "*/project-templates/*"); do
    grep -qE "useTranslation" "$f" || echo "$f"
  done
  ```
- List all unwired project-template components:
  ```bash
  for f in $(find packages/projects/src/components/project-templates -type f -name "*.tsx" ! -name "*.test.tsx"); do
    grep -qE "useTranslation" "$f" || echo "$f"
  done
  ```
- Reference already-wired files (copy the pattern):
  ```
  packages/projects/src/components/project-templates/TemplateStatusManager.tsx
  packages/projects/src/components/project-templates/wizard-steps/TemplateStatusColumnsStep.tsx
  packages/projects/src/components/settings/projects/ProjectTaskStatusSettings.tsx
  ```
- Verify a route's namespaces (from packages/core/src/lib/i18n/config.ts):
  ```bash
  grep -A 1 "'/msp/projects'" packages/core/src/lib/i18n/config.ts
  ```

## Links / References

- Parent plan: `.ai/translation/MSP_i18n_plan.md` (Batches 2b-21b, 2b-21c)
- Sibling plan: `ee/docs/plans/2026-04-05-msp-i18n-tickets-migration/` (2b-21a)
- Shared namespace file: `server/public/locales/en/features/projects.json`
- Route config: `packages/core/src/lib/i18n/config.ts` (ROUTE_NAMESPACES)
- Validation script: `scripts/validate-translations.cjs`
- Pseudo-locale generator: `scripts/generate-pseudo-locales.cjs`
- Pattern reference (already wired, array form):
  - `packages/projects/src/components/project-templates/TemplateStatusManager.tsx`
  - `packages/projects/src/components/project-templates/wizard-steps/TemplateStatusColumnsStep.tsx`
  - `packages/projects/src/components/settings/projects/ProjectTaskStatusSettings.tsx`
- Precedent plan (similar wiring-only work): `ee/docs/plans/2026-03-20-msp-i18n-clients-assets-onboarding/`
- MSP template pages (server-side wiring):
  - `server/src/app/msp/projects/templates/page.tsx`
  - `server/src/app/msp/projects/templates/[templateId]/page.tsx`
  - `server/src/app/msp/projects/templates/create/page.tsx`
- Global quick-create integration:
  `server/src/components/layout/QuickCreateDialog.tsx`
- Settings page integration:
  `server/src/components/settings/SettingsPage.tsx`

## Open Questions

- Does `/msp/projects/templates*` load `features/projects` via best-match to `/msp/projects`?
  **Action:** verify at start of sub-batch B via T108. If not, add explicit
  `ROUTE_NAMESPACES` entries for `/msp/projects/templates`,
  `/msp/projects/templates/create`, `/msp/projects/templates/[templateId]`.
- `features/documents` loading on `/msp/projects/[id]` — does `TaskDocumentsSimple`
  render translated document strings? **Action:** check if
  `ROUTE_NAMESPACES['/msp/projects']` needs `'features/documents'` added.
- Task dependency cycle warnings — reuse existing `features/projects` keys or need new
  `taskDependencies.cycle.*`? **Action:** check during F026 implementation.
- Kanban drag helpers (ARIA labels) — translate or leave English (accessibility-only text
  may follow different conventions)? **Tentative answer:** translate; aria-labels are
  user-facing for screen reader users and should match UI locale.

## Implementation Order (recommended)

1. **Setup (F001-F005):** Audit gaps, extend `en/features/projects.json`, translate to 6
   non-English locales (IT accent audit), regenerate pseudo-locales via script, verify
   template route namespaces. This unblocks all component wiring.
2. **Sub-batch A PR (F020-F034):** 15 largest project components. Ship first while
   context is fresh. Start with ProjectDetail + TaskForm as they dominate.
3. **Sub-batch B PR (F050-F064):** 15 project-template components. Wizard steps + editor.
4. **Sub-batch C PR (F080-F094):** 30 small/settings components. Quick cleanup pass,
   confirm zero-string components.
5. **Closeout (F100-F102):** Final lang-pack loop, update parent plan, archive scratchpad.

## Risks

- **Layout breakage from long translations.** German ~30% longer than English; French
  task/phase labels expand button widths. Mitigation: pseudo-locale (xx/yy expand strings)
  test exercises kanban column widths, task card layouts, wizard nav buttons.
- **Reused components in multiple contexts.** `ProjectQuickAdd` (global QuickCreate),
  `ProjectSettings` (settings page), `LinkTicketToTaskDialog`/`CreateTaskFromTicketDialog`
  (tickets + projects both). Mitigation: integration tests T110-T111.
- **Missing templates namespace loading.** If `/msp/projects/templates*` doesn't match
  `/msp/projects` best-match, templates pages render untranslated even with components
  wired. Mitigation: **do F005 before sub-batch B**.
- **Existing tests asserting English text.** Many components have `.test.tsx` files that
  may assert exact English strings. Mitigation: use `t('key', 'Exact English')` fallback
  so rendered text is identical until locale changes; update tests that break.
- **Template wizard shared state.** Wizard passes step data via parent context — ensure
  `useTranslation` works in all 5 step components independently without state drift.
