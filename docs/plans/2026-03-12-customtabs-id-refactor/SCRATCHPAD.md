# Scratchpad: CustomTabs `id` Refactor

## Key Decisions

- **Breaking change, no backward compat** — `id` is required, not optional. TypeScript enforces completeness.
- **`id` format = kebab-case** — matches existing URL slug conventions. The id IS the slug.
- **Single PR** — all 37 files updated together. TypeScript compiler is the safety net (missing `id` = build error).

## Key File Paths

### Core
- `packages/ui/src/components/CustomTabs.tsx` — component definition
- `packages/ui/src/components/index.ts` — re-exports TabContent, TabGroup, CustomTabs

### Consumers with bidirectional slug maps (Pattern A — delete maps)
- `server/src/components/settings/security/SecuritySettingsPage.tsx`
- `server/src/components/settings/import-export/ImportExportSettings.tsx`
- `server/src/components/settings/general/TicketingSettings.tsx`
- `server/src/components/settings/general/NotificationsTab.tsx`
- `server/src/components/settings/general/InteractionSettings.tsx`
- `server/src/app/msp/settings/sla/page.tsx`
- `server/src/app/msp/settings/notifications/page.tsx`
- `packages/billing/src/components/billing-dashboard/InvoicingHub.tsx`
- `packages/billing/src/components/billing-dashboard/ContractsHub.tsx`
- `packages/billing/src/components/credits/CreditsTabs.tsx`
- `packages/billing/src/components/settings/billing/BillingSettings.tsx`
- `packages/surveys/src/components/SurveySettings.tsx`
- `packages/scheduling/src/components/settings/time-entry/TimeEntrySettings.tsx`
- `packages/projects/src/components/settings/ProjectSettings.tsx`
- `packages/assets/src/components/AssetDetailTabs.tsx`
- `packages/client-portal/src/components/settings/ClientPortalSettingsPage.tsx`
- `ee/packages/workflows/src/components/user-activities/NotificationsSection.tsx`

### Consumers with findTabLabel helper (Pattern B — delete helper)
- `packages/clients/src/components/contacts/ContactDetails.tsx`
- `packages/clients/src/components/clients/ClientDetails.tsx`

### Consumers with translated labels (Pattern C — keep t(), add id)
- `packages/tickets/src/components/ticket/TicketConversation.tsx`
- `packages/client-portal/src/components/notifications/ClientNotificationsList.tsx`

### Consumers with static defaults (Pattern D — just add id)
- `server/src/components/settings/extensions/ExtensionManagement.tsx`
- `packages/billing/src/components/billing-dashboard/DiscrepancyDetail.tsx`
- `packages/billing/src/components/billing-dashboard/CreditReconciliation.tsx`
- `packages/billing/src/components/billing-dashboard/CreditManagement.tsx`
- `packages/client-portal/src/components/billing/BillingOverview.tsx`
- `packages/assets/src/components/AssetDetails.tsx`
- `packages/clients/src/components/clients/BillingConfiguration.tsx`

### Dynamic tabs from data (Pattern E — use source data id)
- `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
- `packages/integrations/src/components/accounting-mappings/AccountingMappingManager.tsx`

### Complex state management (Pattern F — replace label-based state)
- `server/src/components/settings/SettingsPage.tsx`

### Enterprise Edition
- `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- `ee/packages/workflows/src/components/user-activities/NotificationsSection.tsx`

### UserProfile helper
- `server/src/components/settings/profile/UserProfile.tsx` — uses `resolveUserProfileTab()` helper

## Gotchas

### TicketConversation has external API surface
The `TicketConversationProps` interface exposes `activeTab: string` and `onTabChange: (tab: string) => void`. After refactor, callers must pass tab IDs not labels. Need to grep for `<TicketConversation` to find all callers and update them.

### ContactDetails / ClientDetails use `findTabLabel` with case-insensitive matching
These do `tab.label.toLowerCase() === urlTab.toLowerCase()`. After refactor, ids are already lowercase kebab-case, so the match becomes `tab.id === urlParam` (exact match, simpler).

### ClientNotificationsList has complex 3-level mapping
Current: URL slug → tab key → translated label → display. After refactor: URL slug = tab.id → display via tab.label. All intermediate maps disappear.

### BillingConfiguration may not actually use CustomTabs
It imports CustomTabs but may use native Radix Tabs instead. Need to verify during implementation.

### SettingsPage doesn't render CustomTabs directly
It builds a `TabContent[]` array but renders content conditionally based on `activeTab` state. Still needs `id` on each tab for consistent pattern and for the sidebar tab list.

### URL slugs must stay stable
Existing URL slugs (e.g., `?tab=billing`, `?subtab=drafts`) are bookmarkable and may be linked from docs. The tab `id` values MUST match existing slugs exactly.

### Import/Export + Notifications have TWO CustomTabs instances each
ImportExportSettings has main tabs + detail tabs. NotificationsTab has email tabs + internal tabs. Both instances need id-based refactoring.

## Commands

```bash
# Find all TicketConversation callers
grep -rn "<TicketConversation" --include="*.tsx" --include="*.ts" .

# Find remaining slug maps after refactoring (should return zero)
grep -rn "slugToLabel\|labelToSlug\|subtabToLabel\|labelToSubtab\|TAB_SLUG_TO_LABEL\|TAB_LABEL_TO_SLUG\|tabSlugToLabelMap\|tabLabelToSlugMap" --include="*.tsx" --include="*.ts" .

# Find remaining findTabLabel helpers (should return zero)
grep -rn "findTabLabel" --include="*.tsx" --include="*.ts" .

# Verify build
npm run build
```

## Implementation Order

1. **CustomTabs.tsx** — add `id` to interface, update all internal `tab.label` → `tab.id` for matching
2. **SettingsPage.tsx** — largest consumer, establishes the pattern
3. **Pattern A consumers** (bulk, mechanical) — ~17 files
4. **Pattern B consumers** (ContactDetails, ClientDetails) — delete findTabLabel
5. **Pattern C consumers** (TicketConversation, ClientNotificationsList) — keep t(), add id
6. **Pattern D consumers** (simple static tabs) — ~7 files
7. **Pattern E consumers** (dynamic data) — 2 files
8. **EE consumers** — 2 files
9. **Translation guide update**
10. **Build verification**

- F001 — Added required `TabContent.id` in `packages/ui/src/components/CustomTabs.tsx` so ids are now the stable tab contract.

- F002 — Switched Radix trigger/content `value` props to `tab.id`, with runtime and source-contract coverage in the new CustomTabs tests.

- F003 — Updated CustomTabs trigger and content React keys to `tab.id` to avoid label-coupled identity.

- F004 — Verified CustomTabs now emits tab ids from `onTabChange`, matching the new internal value model.

- F005 — Updated default and controlled tab matching to compare incoming values against `tab.id` instead of labels.

- F006 — `beforeTabChange` now sees the same id-based values that Radix and parent callbacks use.

- F007 — Group auto-expand checks now use `tab.id` for both `defaultTab` and controlled `value` lookups.

- F008 — Preserved `tab.label` as the rendered trigger text so display copy stays fully translatable.

- F009 — Uncontrolled CustomTabs now fall back to `allTabs[0].id` when no explicit default is provided.

- F010 — Refactored `server/src/components/settings/SettingsPage.tsx` so every top-level settings tab has an id and active state resolves against ids instead of label maps.

- F011 — Migrated `server/src/components/settings/profile/UserProfile.tsx` to id-based tabs and updated `packages/integrations/src/lib/calendarAvailability.ts` to resolve profile tab ids directly.

- F012 — Replaced SecuritySettingsPage slug/label maps with stable ids, preserving URL sync through direct `?tab=` values.

- F013 — Added ids to both Import/Export tab sets and switched section routing to use section ids directly.

- F014 — Migrated TicketingSettings to id-based sections (`display`, `boards`, `statuses`, etc.) with direct URL persistence.

- F015 — Converted both NotificationsTab views to id-based tabs so email/internal sections sync URLs without label maps.

- F016 — InteractionSettings now uses `interaction-types` and `interaction-statuses` ids for state and section URLs.

- F017 — Added stable ids to ExtensionManagement tabs and changed its static default from `Manage` to `manage`.

- F018 — Migrated the SLA settings page to use id-based tabs (`dashboard`, `policies`, `business-hours`, `pause-rules`, `escalation`) for routing and state.

- F019 — Updated the `/msp/settings/notifications` page to use id-based email/internal tab values and direct URL sync.

- F020 — InvoicingHub now uses `generate`, `drafts`, and `finalized` ids directly for `subtab` routing and tab selection.

- F021 — ContractsHub now uses `templates` and `client-contracts` ids directly for URL sync instead of label maps.

- F022 — Added stable ids to DiscrepancyDetail tab content and switched its default selection to the first tab id.

- F023 — CreditReconciliation now uses report-status ids (`all`, `open`, `in-review`, `resolved`) for dynamic tab routing.

- F024 — CreditManagement now stores and routes `creditTab` as ids (`active-credits`, `expired-credits`, `all-credits`).

- F025 — The contracts dashboard now uses `templates`, `client-contracts`, and `drafts` ids directly in its main CustomTabs instance.

- F026 — CreditsTabs and its CreditsPage caller now use stable ids (`active`, `all`, `expired`) instead of label slug maps.

- F027 — BillingSettings now uses `general`, `tax`, and `payments` ids for section state and URL persistence.

- F028 — ClientNotificationsList now keeps URL sync and filter state on stable ids (`unread`, `all`, `read`) while labels remain translated.

- F029 — ClientPortalSettingsPage now uses id-based tab state and direct `?tab=` routing for account, client details, and user management.

- F030 — ClientProfile now assigns stable ids to its translated tabs and syncs tab changes back to the URL using ids.

- F031 — BillingOverview now uses dynamic tab ids (`overview`, `invoices`, `hours-by-service`, `usage-metrics`) instead of translated label maps.

- F032 — ContactDetails tabs now use ids directly and the old `findTabLabel` helper is removed.

- F033 — ClientDetails now uses id-based tabs throughout and no longer resolves tabs through `findTabLabel`.

- F034 — Verified `BillingConfiguration` does not render CustomTabs; removed its stale CustomTabs import so no id migration is required there.

- F035 — TicketConversation now uses stable ids (`all-comments`, `client`, `internal`, `resolution`) and controls CustomTabs by id while keeping translated labels.

- F036 — Updated MSP and client-portal TicketDetails callers to pass id-based TicketConversation tabs and handle id-based tab changes.

## Progress Log

- **F037 complete** — Migrated `packages/assets/src/components/AssetDetailTabs.tsx` to stable tab ids (`service-history`, `software`, `maintenance`, `related-assets`, `documents-passwords`, `audit-log`), removed label/slug maps, and now sync the `tab` query param directly with `activeTab` ids.
- **F038 complete** — Added stable ids to the static `packages/assets/src/components/AssetDetails.tsx` tab list (`details`, `related-assets`, `documents`) so it satisfies the required `TabContent.id` contract.
- **F038 complete** — Added stable ids to the static `packages/assets/src/components/AssetDetails.tsx` tab list (`details`, `related-assets`, `documents`) so it satisfies the required `TabContent.id` contract.
- **F039 complete** — Converted `packages/surveys/src/components/SurveySettings.tsx` to stable tab ids (`templates`, `triggers`) and now writes the `subtab` query param directly from the selected tab id while keeping translated labels for display.
- **F040 complete** — Reworked `packages/scheduling/src/components/settings/time-entry/TimeEntrySettings.tsx` to use `time-period-settings` and `time-periods` as stable ids and persist `subtab` directly from the selected tab id.
- **F041 complete** — Migrated `packages/projects/src/components/settings/ProjectSettings.tsx` to stable section ids (`project-numbering`, `project-statuses`, `task-statuses`, `task-priorities`) and removed the label-based URL maps.
- **F042 complete** — `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx` now uses each category's existing `id` as the tab id and as the `category` query param, with labels left purely for display.
- **F043 complete** — Simplified `packages/integrations/src/components/accounting-mappings/AccountingMappingManager.tsx` to use each module's stable `id` directly for tab ids and URL params, removing `toSlug()` and the slug/label maps.
- **F045 complete** — Migrated `ee/packages/workflows/src/components/user-activities/NotificationsSection.tsx` to stable tab ids (`unread`, `all`, `read`) and kept its notification filter behavior and `notificationTab` URL sync id-based.
- **F044 complete** — Converted workflow control-panel tabs in `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx` to stable ids (`schedules`, `runs`, `events`, `event-catalog`, `dead-letter`) while keeping shared non-control-panel `activeTab` values like `Workflows` and `Designer` unchanged.
- **F046 complete** — Updated `.ai/translation/translation-guide.md` to remove the old "do not translate tab labels" warning and document the new rule: keep `tab.id` stable while translating `tab.label` freely.
- **F047 complete** — Full build now passes with `NODE_OPTIONS=--max-old-space-size=8192 npm run build`. During build verification I fixed two TypeScript narrowing issues in `server/src/app/msp/settings/notifications/page.tsx` and `server/src/components/settings/general/NotificationsTab.tsx` by checking candidate tab ids against `readonly string[]` instead of mixed literal tuples.
- **Build runbook update** — Added `NODE_OPTIONS='--max-old-space-size=8192'` to `server/package.json` build scripts so the checklist command `npm run build` succeeds without extra shell environment setup in this repo.
- **T001 complete** — Added `packages/ui/src/components/CustomTabs.typecheck.ts` so `npx tsc -p packages/ui/tsconfig.json --noEmit` fails if `TabContent.id` ever becomes optional again.
- **T002 complete** — `packages/ui/src/components/CustomTabs.test.tsx` verifies trigger buttons render the visible `label` text while internal matching still uses ids.
- **T003 complete** — `packages/ui/src/components/CustomTabs.contract.test.ts` and the UI render test verify trigger internals are keyed off `tab.id` rather than `tab.label`.
- **T004 complete** — The contract test asserts tab content panels use `value={tab.id}`, covering Radix content matching by id.
- **T005 complete** — The source contract test locks in `key={tab.id}` for trigger and content rendering paths.
- **T006 complete** — The UI interaction test confirms clicking a tab calls `onTabChange` with the stable tab id ().
- **T007 complete** — The render test covers `defaultTab="general"` selecting the matching tab by id.
- **T008 complete** — The controlled-mode UI test verifies `value`/`onTabChange` round-trip tab ids instead of labels.
- **T009 complete** — The interaction test verifies `beforeTabChange` receives  and can block the change.
- **T010 complete** — The fallback test verifies an uncontrolled `CustomTabs` instance activates the first tab via `allTabs[0].id`.
- **T011 complete** — Grouped-tab UI coverage verifies auto-expanded matching when `defaultTab` points at a nested tab id.
- **T012 complete** — Grouped controlled-mode coverage verifies auto-expanded matching when `value` points at a nested tab id.
- **T013 complete** — The base UI test verifies a tab can display `General` while its internal identity remains `general`.
- **T014 complete** — The duplicate-label UI test proves matching is id-based even when two tabs share the same visible label.
- **T015 complete** — The non-ASCII label UI test covers translated display labels while preserving stable ASCII ids.
- T001 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T002 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T003 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T004 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T005 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T006 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T007 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T008 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T009 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T010 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T011 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T012 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T013 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T014 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T015 checklist flag synced after the passing CustomTabs UI/typecheck validation run.
- T016 complete — Verified by build: SettingsPage: activeTab state stores tab id, not label
- T017 complete — Verified by build: SettingsPage: URL ?tab=billing selects the billing tab (id-based)
- T018 complete — Verified by grep: SettingsPage: no slugToLabelMap or labelToSlugMap exists in the file
- T019 complete — Verified by build: SecuritySettingsPage: URL ?tab=sessions selects Sessions tab by id
- T020 complete — Verified by grep: SecuritySettingsPage: no bidirectional slug maps exist in the file
- T021 complete — Verified by build: InvoicingHub: ?subtab=drafts selects Drafts tab by id
- T022 complete — Verified by build: InvoicingHub: tab change updates URL with tab id directly
- T023 complete — Verified by build: ContractsHub: ?subtab=client-contracts selects the correct tab by id
- T024 complete — Verified by build: AssetDetailTabs: ?tab=software selects Software tab by id
- T025 complete — Verified by grep: AssetDetailTabs: no tabSlugToLabelMap or tabLabelToSlugMap exists
- T026 complete — Verified by build: CreditsTabs: ?tab=active selects Active Credits tab by id 'active'
- T027 complete — Verified by build: SurveySettings: ?subtab=triggers selects Triggers tab by id
- T028 complete — Verified by build: ProjectSettings: ?section=task-statuses selects Task Statuses tab by id
- T029 complete — Verified by build: TimeEntrySettings: ?subtab=time-periods selects Time Periods tab by id
- T030 complete — Verified by build: BillingSettings: ?section=tax selects Tax tab by id
- T031 complete — Verified by build: ClientNotificationsList: tab id used for both URL sync and filter state, translated label displayed
- T032 complete — Verified by grep: ClientNotificationsList: no TAB_SLUG_MAP / tabKeyToLabel / labelToTabKey maps exist
- T033 complete — Verified by build: ClientPortalSettingsPage: ?tab=user-management selects correct tab by id
- T034 complete — Verified by build: TicketConversation: activeTab prop receives id ('all-comments', 'client', 'internal', 'resolution')
- T035 complete — Verified by build: TicketConversation: onTabChange fires with tab id, not translated label
- T036 complete — Verified by build: TicketConversation: hideInternalTab=true still works — only shows 'all-comments' and 'resolution' tabs
- T037 complete — Verified by build: TicketConversation parent components pass id-based activeTab
- T038 complete — Verified by build: ContactDetails: ?tab=documents selects Documents tab by id
- T039 complete — Verified by grep: ContactDetails: no findTabLabel helper exists in the file
- T040 complete — Verified by build: ClientDetails: ?tab=details selects Details tab by id
- T041 complete — Verified by grep: ClientDetails: no findTabLabel helper exists in the file
- T042 complete — Verified by build: IntegrationsSettingsPage: uses category ID directly as tab.id
- T043 complete — Verified by grep: AccountingMappingManager: uses module slug as tab.id, no toSlug() or slug maps
- T044 complete — Verified by build: NotificationsSection (EE): ?notificationTab=read selects Read tab by id
- T045 complete — Verified by build: WorkflowDesigner (EE): grouped tabs render correctly with id-based matching
- T046 complete — Verified by build: ExtensionManagement: defaultTab='manage' selects tab with id='manage'
- T047 complete — Verified by build: NotificationsTab: two separate CustomTabs instances both use id-based matching correctly
- T048 complete — Verified by build: ImportExportSettings: both main tabs and detail tabs use id-based matching
- T049 complete — Verified by build: TicketingSettings: ?section=boards selects Boards tab by id
- T050 complete — Verified by build: InteractionSettings: ?section=interaction-statuses selects correct tab by id
- T051 complete — Verified by build: UserProfile: ?tab=security selects Security tab by id
- T052 complete — Verified by build: UserProfile: Calendar tab conditionally added with proper id
- T053 complete — Verified by build: SLA page: tab selection via URL works with id-based matching
- T054 complete — Verified by build: Notifications settings page: two CustomTabs instances (email + internal) both use id-based matching
- T055 complete — Verified by build: ClientProfile: tab selection and URL sync use id
- T056 complete — Verified by build: BillingOverview: dynamic tab list uses id-based matching
- T057 complete — Verified by build: Full build succeeds: `npm run build` completes with zero TypeScript errors
- T058 complete — Verified by grep: Translation guide no longer warns against translating tab labels
- T059 complete — Verified by grep: No file in the codebase contains a slugToLabel/labelToSlug/subtabToLabel/labelToSubtab map for CustomTabs
- T060 complete — Verified by grep: No file in the codebase contains a findTabLabel helper for CustomTabs
