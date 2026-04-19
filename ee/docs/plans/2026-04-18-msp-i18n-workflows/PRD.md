# PRD — MSP Workflows i18n (Batch 2b-9)

> **Status:** Draft
> **Owner:** i18n working group
> **Started:** 2026-04-18
> **Plan reference:** `.ai/translation/MSP_i18n_plan.md` → Batch 2b-9
> **Predecessors:** Batches 2b-1 through 2b-8, 2b-10 through 2b-21 already shipped. Workflows is the last large MSP surface with zero `useTranslation` wiring.

---

## Problem statement

The MSP Workflows UI (workflow definitions list, run studio, designer, task inbox) has **zero i18n wiring**. All user-visible strings are hardcoded English in components under:

- `ee/server/src/components/workflow-designer/` (34 non-test `.tsx` files + helpers)
- `ee/server/src/components/workflow-graph/` (1 `.tsx`)
- `ee/server/src/components/workflow-run-studio/` (1 `.tsx`)
- `ee/packages/workflows/src/components/workflow/` (12 `.tsx`, task + form UI)

No `msp/workflows.json` namespace exists in `server/public/locales/*/`. The MSP feature flag `msp-i18n-enabled` is shipped to all non-English users; on any workflow route they see mixed English/translated UI because the shell is translated but the workflow surface is not.

Beyond string extraction, the designer and run list contain **~13 distinct inline option arrays with English labels** (workflow run status, step status, log level, AI schema type, reference mode, wait mode, etc.). These are the `enum-labels-pattern.md` anti-pattern: they never reach `t()`, so validation passes with 0 missing keys while the UI renders English in every locale.

## User value

- Non-English MSP operators can build, run, and debug workflows in their preferred language (fr, es, de, nl, it, pl).
- Pseudo-locale QA can actually catch regressions in the workflow surface (currently every string shows as English, masking real gaps).
- Removes the single largest remaining hole in MSP coverage, unlocking Phase 7 rollout / flag removal.

## Goals

1. Create `msp/workflows` namespace with translations in en/fr/es/de/nl/it/pl + pseudo-locales xx/yy.
2. Extract every user-visible string in the 48 in-scope components to `t()` calls.
3. Migrate every inline `{ value, label }` option array and any `*_DISPLAY` / `*_OPTIONS` constants to the [enum-labels option-hook pattern](../../../../.ai/translation/enum-labels-pattern.md): `VALUES` + `LABEL_DEFAULTS` in a constants file, `useXOptions()` / `useFormatX()` hooks colocated in `ee/packages/workflows/src/hooks/`.
4. Register `/msp/workflows`, `/msp/workflows/runs`, `/msp/workflows/runs/[runId]`, `/msp/workflow-editor`, `/msp/workflow-editor/[workflowId]`, `/msp/workflow-editor/new`, and `/msp/workflow-control` in `ROUTE_NAMESPACES`.
5. Migrate hardcoded date/number/duration formatting to `useFormatters()` (the designer renders timestamps in the run list, event list, and step history; all are `toLocaleString`-flavored today).
6. Pass `node scripts/validate-translations.cjs` with zero missing/extra keys across 9 locales.
7. Visual QA on `xx`: every user-visible string in the workflow surface shows `11111`. No English bleed-through.
8. CI workflow validation passes on PR.

## Non-goals

- **Registry metadata translation.** Action display names, descriptions, and schema field labels come from `/api/workflow/registry/*` endpoints, which return whatever the action definition module declared. Those labels are *data*, not UI chrome, and belong in a separate "workflow action catalog i18n" initiative (not scoped here).
- **User-authored workflow content.** Workflow names, step names, comments, etc. are tenant data and never translated.
- **Temporal / worker / engine logs.** Server-side log lines, audit payloads, and engine error messages below the UI layer are out of scope. Only strings rendered to the operator in the run studio / dead-letter view are in scope.
- **Workflow API error responses.** Server actions keep returning English `{ success, error }` payloads; components map them to translation keys via the standard error-map pattern (see `translation-guide.md#error-and-validation-translation-pattern`).
- **`FormExample.tsx`, `TaskInboxExample.tsx`, `ConditionalFormExample.tsx`.** These are demo/example components not mounted in production routes. Extract only if trivially colocated; otherwise defer with a comment.
- **Monaco editor chrome (JSONata expression editor).** The Monaco toolbar/status messages are vendor UI; only the surrounding wrapper (hints, validation badges, placeholder text) is in scope.
- **Workflow graph React Flow node internals.** Node headers/badges that come from registry metadata are data; only static chrome (empty state, toolbar buttons) is in scope.

## Target users and primary flows

- **MSP workflow author** — opens `/msp/workflow-editor/new` or `[workflowId]`, drags actions from the palette, configures inputs, sets triggers, saves.
- **MSP workflow operator** — visits `/msp/workflows/runs`, filters by status/date, opens a run to inspect steps and logs, retries or cancels.
- **MSP admin** — inspects dead-letter queue, views audit log, manages schedules.
- **Internal task assignee** — receives a workflow-generated task, opens it from the inbox, completes the form.

Every flow must render fully localized in fr/es/de/nl/it/pl. German/Dutch layout risk is highest in the run list table (long status labels) — verify no truncation regressions.

## Enum migration — explicit scope

All the following must move from inline arrays in components to the option-hook pattern. Each lives in `ee/packages/workflows/src/constants/workflowEnums.ts` (values + label defaults) with hooks in `ee/packages/workflows/src/hooks/useWorkflowEnumOptions.ts`. Translation keys go under `enums.<enumName>.*` in `msp/workflows.json`.

| Enum | Values | Source files today | Target key root |
|------|--------|---------------------|-----------------|
| `workflowRunStatus` | RUNNING, WAITING, SUCCEEDED, FAILED, CANCELED | `WorkflowRunList.tsx:87-91` | `enums.workflowRunStatus.*` |
| `workflowRunSort` | started_at:desc/asc, updated_at:desc/asc | `WorkflowRunList.tsx:95-98` | `enums.workflowRunSort.*` |
| `workflowEventStatus` | matched, unmatched, error | `WorkflowEventList.tsx:74-76` | `enums.workflowEventStatus.*` |
| `workflowStepStatus` | STARTED, SUCCEEDED, FAILED, RETRY_SCHEDULED, CANCELED | `WorkflowRunDetails.tsx:176-180` | `enums.workflowStepStatus.*` |
| `workflowLogLevel` | DEBUG, INFO, WARN, ERROR | `WorkflowRunDetails.tsx:185-188` | `enums.workflowLogLevel.*` |
| `workflowAiSchemaType` | string, number, integer, boolean, object, array | `WorkflowAiSchemaSection.tsx:51-64` (x2 copies) | `enums.workflowAiSchemaType.*` |
| `workflowInputSourceMode` | reference, fixed | `WorkflowActionInputSourceMode.tsx:27-28` | `enums.workflowInputSourceMode.*` |
| `workflowReferenceSection` | payload, vars, meta, error, forEach | `workflowReferenceSelector.tsx:399-403` | `enums.workflowReferenceSection.*` |
| `workflowTriggerMode` | manual, event | `WorkflowDesigner.tsx:3713-3714` | `enums.workflowTriggerMode.*` |
| `workflowCanvasView` | list, graph | `WorkflowDesigner.tsx:4724-4725` | `enums.workflowCanvasView.*` |
| `workflowOnError` | continue, fail | `WorkflowDesigner.tsx:6249-6250` | `enums.workflowOnError.*` |
| `workflowWaitMode` | duration, until | `WorkflowDesigner.tsx:6550-6551` | `enums.workflowWaitMode.*` |
| `workflowWaitTiming` | fixed, expression | `WorkflowDesigner.tsx:6614-6615` | `enums.workflowWaitTiming.*` |

**Filter sentinels** (e.g. `{ value: 'all', label: 'All statuses' }`) are not enum values — they stay as plain `t('filters.allStatuses')` / `t('filters.allLevels')` / `t('filters.allTypes')` calls at each call site. Hooks return the real enum options only; the "All X" row is prepended in the component.

**Activity / task status** (`getActivityStatusOptions` in `ee/packages/workflows/src/actions/activity-actions/activityStatusActions.ts`) is a server action that returns `{ value, label }` pairs from DB rows. Those labels are data, not UI chrome — flag in `enum-labels-pattern.md`'s backlog but do **not** migrate here. If any consumer in scope renders those labels, add a TODO and keep existing behavior.

**Reviewer enforcement:** No PR in this batch adds a new `*_DISPLAY` / `*_LABELS` / `*_OPTIONS` map. No PR leaves an inline `{ value, label: 'CapitalizedEnglish' }` array in a touched component. The enum-labels grep in `enum-labels-pattern.md#finding-latent-gaps` must return zero new matches in the workflow directories after each sub-batch merges.

## Namespace + route config

- **Namespace:** `msp/workflows` — single namespace for the entire workflow surface (designer, runs, dead-letter, schedules, task inbox, audit, graph, run-studio shell).
- **Rationale for single namespace:** blast radius is one MSP feature area; no shared consumers in client portal; key count estimate (~1,000–1,500 after all sub-batches) stays well under the `msp/clients` precedent of 953.
- **`ROUTE_NAMESPACES` additions** (in `packages/core/src/lib/i18n/config.ts`):
  - `/msp/workflows`: `['common', 'msp/core', 'msp/workflows']`
  - `/msp/workflows/runs`: same
  - `/msp/workflow-editor`: same
  - `/msp/workflow-control`: same
- Prefix-match in `getNamespacesForRoute()` covers `/msp/workflows/runs/[runId]`, `/msp/workflow-editor/[workflowId]`, `/msp/workflow-editor/new` without explicit entries.

## Acceptance criteria (definition of done)

- [ ] `server/public/locales/{en,fr,es,de,nl,it,pl,xx,yy}/msp/workflows.json` all exist; key counts match exactly across all 9 locales.
- [ ] `node scripts/validate-translations.cjs` passes with zero missing or extra keys.
- [ ] No `useTranslation()` call in any in-scope component targets a namespace other than `msp/workflows`, `common`, or `msp/core`.
- [ ] The following greps (run against `ee/server/src/components/workflow-designer`, `ee/server/src/components/workflow-graph`, `ee/server/src/components/workflow-run-studio`, `ee/packages/workflows/src/components/workflow`) return zero matches:
  - `\{\s*value:\s*['"][^'"]+['"]\s*,\s*label:\s*['"][A-Z][^'"]*['"]` (inline English option arrays)
  - `^export const [A-Z_]+(_DISPLAY|_LABELS|_OPTIONS|_MAP)\s*[:=]` (label-map exports)
  - `toLocaleDateString\(['"]en` / `toLocaleString\(['"]en` (hardcoded locale formatting)
- [ ] Visual QA on `xx` locale: every user-visible string in `/msp/workflows`, `/msp/workflows/runs`, `/msp/workflows/runs/<runId>`, `/msp/workflow-editor/new`, `/msp/workflow-editor/<workflowId>`, `/msp/workflow-control`, and the task inbox renders `11111` — zero English leakage.
- [ ] Italian accent audit grep clean on `locales/it/msp/workflows.json` (see `translation-guide.md#common-pitfalls` rule 12).
- [ ] Translated section / tab names in `msp/workflows.json` match canonical names in `msp/core.json` for every language (e.g. German "Workflows" or "Arbeitsabläufe" must match whichever core.json uses).
- [ ] `ContractLinesSubbatch.i18n.test.ts`-style audit test added for the workflows surface (optional but recommended — covers regressions when new strings are added).
- [ ] CI `.github/workflows/validate-translations.yml` green.
- [ ] No component regressions in existing workflow Vitest suites (34 test files in `ee/server/src/components/workflow-designer/__tests__/`) — tests may need small updates if they assert English strings directly; prefer asserting on structural semantics (buttons by role, option values not labels).

## Risks

1. **`WorkflowDesigner.tsx` is ~7,000 lines.** Extracting strings in one pass is high-risk. Mitigation: sub-batch WF-C treats this file as its own unit; rely on the enum hooks landing in WF-A so most inline arrays are already gone.
2. **Backend status codes.** Step/run/event status enum values come from the server (Temporal activity names, DB status columns). Hook translation keys use the raw enum value (e.g. `SUCCEEDED`) as the key segment — do not normalize to lowercase. A server-side status rename becomes a missing-key defect, not a mis-translation; the default-value fallback keeps the UI functional.
3. **React Flow node labels.** `WorkflowGraph.tsx` renders nodes whose labels are computed from the workflow definition. Distinguish: static node chrome (empty state, mini-map labels, zoom controls) is in scope; node body text driven by workflow data is out of scope.
4. **Vitest snapshot / text-match breakage.** Several `__tests__/*.test.tsx` suites assert on English labels (e.g. `getByText('Running')`). When migrating a status from inline array to `useFormatWorkflowRunStatus`, the test must switch to `getByRole` or a data-testid, not rely on the English label. Budget extra time in each sub-batch for test updates.
5. **Expression editor / Monaco.** Custom hover/completion messages may have embedded English. Confirm before WF-D starts whether these are user-facing or dev-only; defer if vendor-owned.
6. **Dead-letter toast copy.** Several server actions under `workflowScheduleServerActions.ts` and dead-letter reroute flows produce toasts with English text. The pattern for server-action error strings is to map them in the component (already established in `translation-guide.md#error-and-validation-translation-pattern`) — do not translate server strings.
7. **German layout.** Run list table columns may get wider; spot-check in WF-B QA.
8. **Feature flag interaction.** `msp-i18n-enabled` is currently rolled out widely. When the flag is off, `I18nWrapper` forces locale=`en` and the component renders the `defaultValue` from each `t()` call. Every `t()` must supply `defaultValue` to match the English copy today, otherwise flag-off users see the key string.

## Rollout

- No data migrations; pure UI batch.
- No feature flag changes. `msp-i18n-enabled` already gates MSP i18n broadly; this batch simply widens coverage under the existing flag.
- Ship each sub-batch as its own PR against `main` (or intermediate branch per Alga convention). After WF-F ships, close batch 2b-9 in `MSP_i18n_plan.md`.

## Sub-batch plan

| Sub-batch | Scope | Est. keys added | PR surface |
|-----------|-------|-----------------|------------|
| WF-A | Namespace bootstrap + enum foundation. Create `msp/workflows.json` (English), add `workflowEnums.ts` constants, publish `useWorkflowEnumOptions.ts` hooks, add `ROUTE_NAMESPACES` entries, generate empty/structural keys, regenerate pseudo-locales, run validation. **No component wiring yet** except replacing inline enum arrays with hook calls where they already exist. | ~100 (enum keys × 13 enums, approximate) | Infra only |
| WF-B | Run studio surface. Wire `WorkflowRunList`, `WorkflowRunDetails`, `WorkflowRunDialog`, `WorkflowEventList`, `WorkflowDeadLetterQueue`, `WorkflowSchedules`, `WorkflowDefinitionAudit`, `RunStudioShell`, `WorkflowGraph`, `workflowRunDialogUtils`, `workflowRunTriggerPresentation`, `workflowActionPresentation`. Migrate hardcoded timestamps to `useFormatters`. | ~250 | 12 files |
| WF-C | Designer shell — `WorkflowDesigner.tsx` + `WorkflowDesignerPalette.tsx` + `PaletteItemWithTooltip.tsx`. This is the biggest single file in the batch. Depends on WF-A enum hooks being merged. | ~400 | 3 files (but one is 7k lines) |
| WF-D | Designer editors + mapping. Wire `ActionSchemaReference`, `GroupedActionConfigSection`, `InputMappingEditor`, `MappingPanel`, `SourceDataTree`, `ValidationBadge`, `MappingEditorSkeleton`, `MappingConnectionsOverlay`, `ExpressionEditor`, `ExpressionEditorField`, `ExpressionTextArea`, `ExpressionAutocomplete`, `PipelineComponents`, `WorkflowActionInputFieldInfo`, `WorkflowActionInputFixedPicker`, `WorkflowActionInputSection`, `WorkflowActionInputSourceMode`, `WorkflowActionInputTypeHint`, `WorkflowAiSchemaSection`, `WorkflowComposeTextDocumentEditor`, `WorkflowComposeTextSection`, `WorkflowStepNameField`, `WorkflowStepSaveOutputSection`, `WorkflowWaitEditors`, `workflowReferenceSelector`. | ~300 | ~22 files |
| WF-E | Task + form components in `ee/packages/workflows/src/components/workflow/`: `TaskInbox`, `TaskList`, `TaskDetails`, `TaskForm`, `TaskHistory`, `EmbeddedTaskInbox`, `DynamicForm`, `ActionButton`, `ActionButtonGroup`. Example/demo components deferred. | ~150 | 9 files |
| WF-F | AI-generate translations for fr/es/de/nl/it/pl. Regenerate pseudo-locales. Italian accent audit. Cross-check against `msp/core.json`. Run `validate-translations.cjs`. Visual QA on `xx` across all workflow routes. Fix missed strings. Update `MSP_i18n_plan.md` marking 2b-9 complete. Add Workflows rows to the component-coverage tables. | 0 (translates existing keys) | Locale files only |

Target execution cadence: WF-A first (blocking), then WF-B + WF-E in parallel, then WF-C, then WF-D, then WF-F.

## Open questions

1. Do we want a separate `msp/workflow-tasks` namespace for the task inbox components, so the task UI can be reused in client portal later without loading the full workflow designer namespace? **Tentative answer:** No — keep single `msp/workflows` namespace; if client portal ever needs tasks, split then. Documented in SCRATCHPAD.
2. Should `RunStudioShell` live in its own namespace (it's a distinct route surface)? **Tentative answer:** No — the run studio is a mode of the workflow surface, single namespace is fine. Loaded on the same route family.
3. Are there existing workflow-related translation keys in `common.json` we should reuse (e.g. `status.*`, `actions.save`)? **Answer:** Yes — reuse `common.json` for generic verbs/nouns (Save, Cancel, Delete, Back) and for generic statuses like `active`, `inactive`. Use `msp/workflows` for workflow-specific statuses (RUNNING, WAITING, etc.). Never duplicate.
4. Do we need a `features/workflow-tasks` cross-portal namespace if the task form package is eventually consumed by MSP + client portal? **Deferred** — re-evaluate only if/when client portal ever renders a workflow task. Today it doesn't.

## Related

- Full batch plan: `.ai/translation/MSP_i18n_plan.md`
- Translation workflow guide: `.ai/translation/translation-guide.md`
- Enum migration pattern: `.ai/translation/enum-labels-pattern.md`
- Example hook style: `packages/billing/src/hooks/useBillingEnumOptions.ts`
- Precedent enum backlog entries (Assets, Quotes, Invoices, Add-ons, KB): `enum-labels-pattern.md#non-billing-backlog`
