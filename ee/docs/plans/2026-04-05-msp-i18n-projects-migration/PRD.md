# PRD — MSP i18n Batch 2b-21b/c: Projects + Project Templates Migration

- Slug: `2026-04-05-msp-i18n-projects-migration`
- Date: `2026-04-05`
- Status: Draft
- Parent plan: `.ai/translation/MSP_i18n_plan.md` (Batches 2b-21b + 2b-21c)
- Sibling plan: `ee/docs/plans/2026-04-05-msp-i18n-tickets-migration/` (2b-21a)

## Summary

Wire the existing `features/projects` namespace into ~60 unwired MSP components in
`packages/projects/src/components/` (projects proper + project-templates subdirectory).
Infrastructure is already in place: `features/projects.json` (128 keys across 9 locales)
exists, `templates.*` subtree is live, and `ROUTE_NAMESPACES['/msp/projects']` already
loads it. 5 of 65 production components are wired; ~60 remain. Consolidates what the
parent plan called 2b-21b (projects) and 2b-21c (project-templates) into one effort
because they share the same package, namespace, and patterns.

## Problem

MSP users see hardcoded English across the entire project management module — the main
projects list, project detail page, task forms, kanban board, project templates, wizard
steps, and task dialogs. Only 5 of 65 production components (8%) are wired. Because
`ROUTE_NAMESPACES['/msp/projects']` already loads `features/projects`, the translation
assets are downloaded but unused. Client-portal project views are 100% wired (9/9), so
this is the last major gap in project-related UI.

Project templates were originally considered for a separate `features/project-templates`
namespace, but analysis confirmed that the existing `features/projects.json` `templates.*`
subtree (17 keys) is already used by wired components (`TemplateStatusColumnsStep`,
`TemplateStatusManager`) and should be extended rather than split.

## Goals

1. Wire `useTranslation(['features/projects', 'common'])` into all unwired production MSP
   project components (projects proper + project-templates)
2. Extend `features/projects.json` with MSP-specific keys missing from the current
   namespace (task form, task dependencies, project detail tabs, kanban, materials,
   export, template editor, template wizards, dialogs)
3. Regenerate pseudo-locales via script; validate all 9 locales pass the validator
4. Preserve 100% test pass rate and zero user-facing regressions
5. Measurable: MSP projects coverage 8% → 100%, project-templates coverage 12% → 100%

## Non-goals

- Creating a new `features/project-templates.json` namespace — templates.* lives in
  features/projects.json per existing pattern
- Retranslating existing 128 keys — 7-language coverage already exists
- Translating project/task content (names, descriptions, comments) — those are tenant data
- Wiring test files (`.test.tsx`) or test helpers
- Translating client-portal project views — already complete (9/9)
- Extending shared `features/projects` for client-portal-specific needs not surfaced on MSP
- Translating EE-only project components beyond what `packages/projects` exports

## Users and Primary Flows

**Primary user:** MSP project managers, technicians, and dispatchers using non-English
UI language (any of fr, es, de, nl, it, pl).

**Primary flows affected:**
1. `/msp/projects` — list page, filters, quick-add
2. `/msp/projects/[id]` — project detail, phases, tasks, kanban, materials, task forms
3. `/msp/projects/templates` — template list, categories filter
4. `/msp/projects/templates/[templateId]` — template editor, task builder, phase manager
5. `/msp/projects/templates/create` — template creation wizard (4-5 steps)
6. `/msp/settings/project-settings` — ProjectSettings, ProjectStatusSettings,
   TenantProjectTaskStatusSettings, TaskPrioritySettings, AddStatusDialog
7. Quick-create dialog (global nav) — `ProjectQuickAdd` reused in `layout/QuickCreateDialog`

## UX / UI Notes

- No visual changes. Text replaced inline via `t('key', 'English fallback')`.
- Use multi-namespace form: `useTranslation(['features/projects', 'common'])` — matches
  existing wired components (`TemplateStatusColumnsStep`, `TemplateStatusManager`,
  `ProjectTaskStatusSettings`).
- Common strings (Cancel, Save, Delete, Confirm) come from `common` namespace; scoped
  domain strings from `features/projects`.
- Toast messages, inline validation, confirmations all translated.
- Task form is the largest single surface (~39 strings, 2024 LOC) — split mental model by
  tab (details, dependencies, documents, ticket links, comments, materials).

## Requirements

### Functional Requirements

**Sub-batch A: Projects — core detail, task form, list (15 files, ~250 strings)**

High-traffic daily-use components. Ship first.

| Component | LOC | Est. strings | Key content |
|-----------|-----|--------------|-------------|
| ProjectDetail.tsx | 3,038 | ~50 | Project detail page tabs, phases, tasks, budget/hours, kanban controls |
| TaskForm.tsx | 2,024 | ~39 | Task create/edit form, fields, validation, toast messages |
| PhaseTaskImportDialog.tsx | 1,290 | ~21 | Task import dialog, CSV preview, validation errors |
| Projects.tsx | 980 | ~21 | Project list, filters (status/search/deadline), empty state |
| TaskDocumentsSimple.tsx | 856 | ~21 | Task documents panel, upload, attach, download |
| TaskTicketLinks.tsx | 816 | ~21 | Task-ticket linking UI, create/unlink, search |
| TaskDependencies.tsx | 668 | ~21 | Dependency graph, add/remove, blocking indicators |
| ProjectMaterialsDrawer.tsx | 439 | ~19 | Materials list, add/edit/remove, cost labels |
| ProjectTaskExportDialog.tsx | 283 | ~18 | Export format, column picker, toast messages |
| ProjectQuickAdd.tsx | 454 | ~15 | Quick-add project dialog (reused in QuickCreate) |
| ProjectDetailsEdit.tsx | 557 | ~13 | Project detail edit form |
| PrefillFromTicketDialog.tsx | 419 | ~10 | Prefill task from ticket, field mapping |
| TaskListView.tsx | 1,320 | ~9 | Task list table, columns, inline edit |
| TaskCard.tsx | 630 | ~7 | Kanban task card, quick-actions menu |
| PhaseQuickAdd.tsx | 141 | ~7 | Quick-add phase inline |

**Sub-batch B: Project Templates (15 files, ~150 strings)**

Template creation, editing, wizard steps, apply flow.

| Component | LOC | Est. strings | Key content |
|-----------|-----|--------------|-------------|
| TemplateEditor.tsx | 2,315 | ~28 | Template editor, phases, tasks, save/publish |
| TemplateTaskForm.tsx | 1,015 | ~22 | Template task create/edit form |
| wizard-steps/TemplateTasksStep.tsx | 576 | ~20 | Wizard step 3 — tasks |
| ApplyTemplateDialog.tsx | 396 | ~20 | Apply template to project dialog |
| ProjectTemplatesList.tsx | 308 | ~12 | Template list page, columns, filters, delete confirm |
| CreateTemplateDialog.tsx | 267 | ~11 | Create template from project dialog |
| TemplateTaskListView.tsx | 953 | ~8 | Template task list view |
| wizard-steps/TemplateReviewStep.tsx | 290 | ~7 | Wizard review step |
| wizard-steps/TemplatePhasesStep.tsx | 399 | ~6 | Wizard phases step |
| CreateTemplateForm.tsx | 140 | ~6 | Template create form body |
| TemplateDetail.tsx | 308 | ~4 | Template detail sidebar |
| wizard-steps/TemplateClientPortalStep.tsx | 45 | ~2 | Client portal exposure toggle |
| TemplateCreationWizard.tsx | 360 | ~1 | Wizard shell |
| wizard-steps/TemplateBasicsStep.tsx | 81 | ~1 | Wizard basics step |
| AddTemplateDialog.tsx | 30 | 0 | Re-export shim |

**Sub-batch C: Settings + small/utility components (30 files, ~80-100 strings)**

Low-string-count cleanup pass.

| Component | LOC | Est. strings | Notes |
|-----------|-----|--------------|-------|
| settings/projects/TenantProjectTaskStatusSettings.tsx | 642 | ~11 | Tenant-level status defaults |
| settings/projects/ProjectStatusSettings.tsx | 442 | ~10 | Project status config |
| ProjectTaskStatusEditor.tsx | 350 | ~7 | Inline status editor |
| CreateTaskFromTicketDialog.tsx | 274 | ~5 | Create task from ticket |
| LinkTicketToTaskDialog.tsx | 221 | ~5 | Link ticket to task |
| DeadlineFilter.tsx | 165 | ~5 | Deadline filter dropdown |
| settings/ProjectSettings.tsx | 86 | ~5 | Top-level project settings page |
| ProjectTaskStatusSelector.tsx | 371 | ~4 | Status select dropdown |
| MoveTaskDialog.tsx | 126 | ~4 | Move task to phase dialog |
| ProjectInfo.tsx | 254 | ~3 | Project info card |
| DuplicateTaskDialog.tsx | 216 | ~3 | Duplicate task dialog |
| TicketLinkedTasksBadge.tsx | 160 | ~3 | Badge showing linked tasks |
| settings/projects/AddStatusDialog.tsx | 111 | ~2 | Add status dialog |
| ProjectPhases.tsx | 280 | ~1 | Phases section wrapper |
| TaskStatusSelect.tsx | 156 | ~1 | Task status select |
| TicketSelect.tsx | 136 | ~1 | Ticket select |
| TaskTypeSelector.tsx | 54 | ~1 | Task type selector |
| Remaining zero-string files (~13) | varies | 0 | Confirm zero strings: StatusColumn, TaskCommentThread, KanbanBoard, ClientPortalConfigEditor, ProjectPage, KanbanZoomControl, TaskCommentForm, DonutChart, TaskQuickAdd, TaskEdit, HoursProgressBar, ProjectActiveToggle, TaskPrioritySettings |

**Namespace key gaps to fill (preliminary):**

Current `features/projects.json` covers project list and basic detail. Likely MSP gaps:

- `taskForm.*` — full task create/edit form (fields, validation, placeholders)
- `taskDependencies.*` — dependency UI, blocking indicators, cycle detection
- `taskDocuments.*` — attach/upload/download controls (may overlap with `features/documents`)
- `taskTicketLinks.*` — link/unlink task-ticket, search
- `projectDetail.*` — tabs, budget/hours display, phase management
- `kanban.*` — column headers, drag helpers, zoom control
- `materials.*` — materials drawer, add/edit, costs
- `export.*` — export dialog labels (reuse features/tickets export patterns if possible)
- `quickAdd.*` — project quick-add dialog labels
- `dialogs.*` — move/duplicate/create-from-ticket dialogs
- `import.*` — task import CSV flow
- `templates.editor.*` — template editor-specific strings
- `templates.wizard.*` — wizard step titles, nav buttons, review summary
- `templates.apply.*` — apply-template dialog
- `templates.list.*` — template list page (columns, filters, delete)
- `templates.taskForm.*` — template task form (may share with `taskForm.*`)
- `settings.statuses.*` — already partially present; extend for tenant/project levels
- `filters.deadline.*` — deadline filter dropdown options

Final gap list determined during implementation — run the lang-pack loop to surface missing keys.

### Non-functional Requirements

1. **No regressions:** all existing project-related tests pass after migration
2. **Lang-pack validation:** after every `en/features/projects.json` edit, run
   `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
   and commit only when green. Single unified check covers key parity, pseudo fill
   patterns, Italian accent preservation, and `{{variable}}` preservation. Never hand-edit
   `xx/` or `yy/` pseudo-locale files.
3. **Naming convention:** follow existing `features/projects.json` patterns (camelCase,
   nested under semantic groups); reuse existing keys where possible before adding new ones
4. **Fallback-safe:** all `t()` calls use `t('key', 'English fallback')` signature
5. **Multi-namespace:** use `useTranslation(['features/projects', 'common'])` array form to
   match existing wired components; prefer `common` for generic actions (save/cancel/delete)
6. **Shared with client portal:** before adding a key, check if existing `features/projects`
   key covers it — client-portal uses the same namespace

## Data / API / Integrations

- No database changes
- No API changes
- No new npm dependencies
- Reuses existing `useTranslation` from `react-i18next` (as used in wired components)
- Reuses existing i18next infrastructure loaded via `I18nWrapper` (already in MSP layout)

## Security / Permissions

No change. Translation is a pure presentation-layer concern.

## Observability

N/A.

## Rollout / Migration

- No feature-flag gating needed — `I18nWrapper` forces English fallback when
  `msp-i18n-enabled` is off
- Ship sub-batches A/B/C as independent PRs
- Translations are static JSON served from `server/public/locales/`; no cache invalidation
  beyond standard Next.js static-asset rebuild
- Each PR is independently revertable; components continue rendering English via
  `defaultValue` fallbacks even if keys are reverted

## Open Questions

1. `ROUTE_NAMESPACES` does not include `/msp/projects/templates` or
   `/msp/projects/templates/[templateId]` or `/msp/projects/templates/create`. The
   best-match fallback to `/msp/projects` should load `features/projects` transitively.
   **Action:** verify via integration test T108; if not loading, add explicit route entries.
2. Should export dialog (`ProjectTaskExportDialog`) reuse `features/tickets` export keys
   or have its own `features/projects.export.*`? **Tentative answer:** own section under
   `features/projects` — avoids cross-namespace coupling, patterns may diverge.
3. `TaskDocumentsSimple` — should document strings live in `features/documents` or
   `features/projects.taskDocuments.*`? **Tentative answer:** reuse `features/documents`
   where keys match (already loaded for `/msp/projects` via transitive namespace? — verify),
   add `features/projects.taskDocuments.*` only for project-task-specific copy.
4. Templates wizard has 5 steps with different content — should wizard strings be flat
   under `templates.wizard.*` or nested per-step (`templates.wizard.basics.*`,
   `templates.wizard.tasks.*`)? **Tentative answer:** nested per-step, matches existing
   onboarding wizard patterns in `msp/onboarding.json`.

## Acceptance Criteria (Definition of Done)

- [ ] All ~60 unwired production MSP project + project-template components either
      (a) import `useTranslation(['features/projects', 'common'])` and wrap all
      user-visible strings, or (b) are confirmed zero-string (re-exports, style-only files,
      kanban layout components)
- [ ] `features/projects.json` contains all keys referenced by MSP project components
- [ ] `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
      exits 0
- [ ] All existing project-related unit/integration tests pass
- [ ] Visual smoke test: `/msp/projects`, `/msp/projects/[id]`, `/msp/projects/templates`,
      `/msp/projects/templates/[templateId]`, `/msp/projects/templates/create`,
      `/msp/settings/project-settings` render correctly in `en` and at least one
      non-English locale (de or fr); `xx` pseudo-locale shows pseudo-text for every
      visible string (no bare English leakage)
- [ ] Global quick-create dialog (`ProjectQuickAdd` reused in `layout/QuickCreateDialog`)
      renders translated in non-English locale
- [ ] Parent plan `.ai/translation/MSP_i18n_plan.md` updated: sub-batches 2b-21b and 2b-21c
      marked ✅ with final string counts
