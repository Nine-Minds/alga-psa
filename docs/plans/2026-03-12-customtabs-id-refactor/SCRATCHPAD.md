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
