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
