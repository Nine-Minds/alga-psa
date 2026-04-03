# PRD: CustomTabs `id` Refactor

> **Status:** Draft
> **Date:** 2026-03-12
> **Branch:** TBD
> **Related:** `.ai/translation/MSP_i18n_plan.md` (Phase 0.8)

---

## Problem Statement

The `CustomTabs` component uses `tab.label` as both the **display text** and the **Radix UI value identifier**. This coupling means:

1. **Tab labels cannot be translated** — changing the label breaks tab matching, URL sync, state management, and `onTabChange` callbacks.
2. **Every consumer builds redundant bidirectional slug maps** (`slugToLabel` / `labelToSlug`) because there is no stable identifier to use directly.
3. **TicketConversation already translates labels** via `t()`, but this creates a fragile dependency where the parent's `activeTab` state must match the translated string exactly.

This is the single biggest blocker for MSP portal i18n — currently ~12 translation guide entries warn contributors not to translate tab labels.

## Goals

1. Add a required `id: string` field to `TabContent` that serves as the stable identifier.
2. `CustomTabs` uses `id` for all internal matching (Radix `value`, `defaultTab`, `value`, `onTabChange`, `beforeTabChange`).
3. `label` becomes purely display text — freely translatable via `t()`.
4. Eliminate all bidirectional slug maps from consumers — `tab.id` IS the URL slug.
5. Update all 35 consumer files in a single PR.
6. Update `TabGroup` to work with `id`-based matching.

## Non-Goals

- Adding new translation keys (that's a separate batch workflow).
- Changing URL parameter names (`tab`, `subtab`, `section`, `category`) — those stay as-is.
- Refactoring tab content or layout.
- Adding new features to CustomTabs (lazy loading, animations, etc.).

## Target Users

- Internal developers building UI with CustomTabs.
- i18n contributors who need to translate tab labels.

## Primary Flow

### Before (current)

```typescript
const slugToLabel = { 'general': 'General', 'billing': 'Billing' };
const labelToSlug = { 'General': 'general', 'Billing': 'billing' };

const tabs = [
  { label: 'General', content: <GeneralPanel /> },
  { label: 'Billing', content: <BillingPanel /> },
];

<CustomTabs
  tabs={tabs}
  defaultTab={slugToLabel[urlParam] || 'General'}
  onTabChange={(label) => {
    params.set('tab', labelToSlug[label]);
    router.push(`?${params}`);
  }}
/>
```

### After (target)

```typescript
const tabs = [
  { id: 'general', label: 'General', content: <GeneralPanel /> },
  { id: 'billing', label: 'Billing', content: <BillingPanel /> },
];

<CustomTabs
  tabs={tabs}
  defaultTab={urlParam || 'general'}
  onTabChange={(id) => {
    params.set('tab', id);
    router.push(`?${params}`);
  }}
/>
```

### After (with i18n)

```typescript
const { t } = useTranslation('msp/settings');

const tabs = [
  { id: 'general', label: t('tabs.general'), content: <GeneralPanel /> },
  { id: 'billing', label: t('tabs.billing'), content: <BillingPanel /> },
];

<CustomTabs
  tabs={tabs}
  defaultTab={urlParam || 'general'}
  onTabChange={(id) => {
    params.set('tab', id);
    router.push(`?${params}`);
  }}
/>
```

## Data Model / API Changes

### `TabContent` interface

```typescript
// BEFORE
export interface TabContent {
  label: string;
  content: React.ReactNode;
  icon?: LucideIcon | React.ReactNode;
}

// AFTER
export interface TabContent {
  id: string;      // Stable kebab-case identifier, used as Radix value + URL slug
  label: string;   // Display text only — freely translatable
  content: React.ReactNode;
  icon?: LucideIcon | React.ReactNode;
}
```

### `CustomTabsProps` — no interface change needed

- `defaultTab` already accepts `string` — just now expects `id` instead of `label`.
- `value` already accepts `string` — same.
- `onTabChange` already returns `string` — now returns `id` instead of `label`.
- `beforeTabChange` already takes `(string, string)` — now receives `id` values.

### `TabGroup` interface — no change needed

- `title` remains a display string (translatable).
- `tabs: TabContent[]` picks up the new `id` field.

## Internal Component Changes

In `CustomTabs.tsx`, every occurrence of `tab.label` used for matching/identity must change to `tab.id`:

| Line(s) | Current | Target |
|---------|---------|--------|
| 88-93 | `allTabs[0].label` for default | `allTabs[0].id` |
| 125 | `tab.label === defaultTab` | `tab.id === defaultTab` |
| 140 | `tab.label === value` | `tab.id === value` |
| 221, 243 | `key={tab.label}` | `key={tab.id}` |
| 224, 246 | `value={tab.label}` | `value={tab.id}` |
| 258 | `key={tab.label}` | `key={tab.id}` |
| 260 | `value={tab.label}` | `value={tab.id}` |

Display rendering stays on `tab.label` (lines 227, 249).

## Consumer Migration Patterns

### Pattern A: Bidirectional slug map (most common — ~20 files)

**Delete** `slugToLabel` / `labelToSlug` maps. Add `id` to each tab. Pass URL slug directly as `defaultTab`. In `onTabChange`, write the `id` directly to URL params.

### Pattern B: `findTabLabel` helper (ContactDetails, ClientDetails)

**Delete** `findTabLabel`. Add `id` to each tab. Pass URL param directly as `defaultTab`.

### Pattern C: Translated labels (TicketConversation, ClientNotificationsList)

Add `id` to each tab. Parent components pass/receive `id` strings instead of translated labels. Keep `label: t('...')` for display.

### Pattern D: Static defaultTab string (ExtensionManagement)

Change `defaultTab="Manage"` → `defaultTab="manage"` and add `id: 'manage'` to the tab.

### Pattern E: Dynamic tabs from data (IntegrationsSettingsPage, AccountingMappingManager)

Derive `id` from the source data's existing identifier (e.g., category ID). Remove `toSlug()` / slug map generation.

### Pattern F: SettingsPage (builds tabs but doesn't render CustomTabs directly)

Add `id` to each `TabContent` object. Update `slugToLabelMap` → just use `id` directly for matching. The `activeTab` state stores `id` instead of label.

## Affected Files (Complete Inventory)

### Core

| # | File | Tabs | URL Param | Pattern |
|---|------|------|-----------|---------|
| 1 | `packages/ui/src/components/CustomTabs.tsx` | — | — | Core |
| 2 | `packages/ui/src/components/index.ts` | — | — | Re-export |

### Settings (server/src/components/settings/)

| # | File | Tabs | URL Param | Pattern |
|---|------|------|-----------|---------|
| 3 | `SettingsPage.tsx` | 17 | `tab` | F |
| 4 | `profile/UserProfile.tsx` | 6 | `tab` | A |
| 5 | `security/SecuritySettingsPage.tsx` | 7 | `tab` | A |
| 6 | `import-export/ImportExportSettings.tsx` | 3+4 | `section` | A |
| 7 | `general/TicketingSettings.tsx` | 6 | `section` | A |
| 8 | `general/NotificationsTab.tsx` | 4+1 | `view`+`section` | A |
| 9 | `general/InteractionSettings.tsx` | 2 | `section` | A |
| 10 | `extensions/ExtensionManagement.tsx` | 2 | — | D |

### Settings pages (server/src/app/msp/settings/)

| # | File | Tabs | URL Param | Pattern |
|---|------|------|-----------|---------|
| 11 | `sla/page.tsx` | 5 | slug maps | A |
| 12 | `notifications/page.tsx` | 3+1 | `view`+`section` | A |

### Billing (packages/billing/)

| # | File | Tabs | URL Param | Pattern |
|---|------|------|-----------|---------|
| 13 | `billing-dashboard/InvoicingHub.tsx` | 3 | `subtab` | A |
| 14 | `billing-dashboard/ContractsHub.tsx` | 2 | `subtab` | A |
| 15 | `billing-dashboard/DiscrepancyDetail.tsx` | 3 | — | D |
| 16 | `billing-dashboard/CreditReconciliation.tsx` | TBD | — | D |
| 17 | `billing-dashboard/CreditManagement.tsx` | TBD | — | D |
| 18 | `billing-dashboard/Contracts.tsx` | TBD | `subtab` | A |
| 19 | `credits/CreditsTabs.tsx` | 3 | `tab` | A |
| 20 | `settings/billing/BillingSettings.tsx` | 3 | `section` | A |

### Client Portal (packages/client-portal/)

| # | File | Tabs | URL Param | Pattern |
|---|------|------|-----------|---------|
| 21 | `notifications/ClientNotificationsList.tsx` | 3 | `tab` | C |
| 22 | `settings/ClientPortalSettingsPage.tsx` | 3 | `tab` | A |
| 23 | `profile/ClientProfile.tsx` | 4+ | `tab` | A/B |
| 24 | `billing/BillingOverview.tsx` | dynamic | — | D |

### Clients (packages/clients/)

| # | File | Tabs | URL Param | Pattern |
|---|------|------|-----------|---------|
| 25 | `contacts/ContactDetails.tsx` | 6 | `tab` | B |
| 26 | `clients/ClientDetails.tsx` | multi | `tab` | B |
| 27 | `clients/BillingConfiguration.tsx` | TBD | — | D |

### Other packages

| # | File | Tabs | URL Param | Pattern |
|---|------|------|-----------|---------|
| 28 | `packages/tickets/.../TicketConversation.tsx` | 4 | — | C |
| 29 | `packages/assets/.../AssetDetailTabs.tsx` | 6 | `tab` | A |
| 30 | `packages/assets/.../AssetDetails.tsx` | TBD | — | D |
| 31 | `packages/surveys/.../SurveySettings.tsx` | 2 | `subtab` | A |
| 32 | `packages/scheduling/.../TimeEntrySettings.tsx` | 2 | `subtab` | A |
| 33 | `packages/projects/.../ProjectSettings.tsx` | 4 | `section` | A |
| 34 | `packages/integrations/.../IntegrationsSettingsPage.tsx` | dynamic | `category` | E |
| 35 | `packages/integrations/.../AccountingMappingManager.tsx` | dynamic | configurable | E |

### Enterprise Edition

| # | File | Tabs | URL Param | Pattern |
|---|------|------|-----------|---------|
| 36 | `ee/.../WorkflowDesigner.tsx` | groups | — | A (groups) |
| 37 | `ee/.../NotificationsSection.tsx` | 3 | `notificationTab` | A |

## Risks

1. **Large blast radius** — 37 files in one PR. Mitigated by: each consumer is an independent, mechanical transformation; the pattern is identical across files.
2. **Missed consumer** — a file constructs `TabContent` objects without importing the type. Mitigated by: TypeScript will error on missing `id` field since it's required.
3. **TicketConversation parent components** — the `activeTab` / `onTabChange` props in `TicketConversationProps` change semantics (now id-based). All callers must be updated. Need to grep for `<TicketConversation` to find them.

## Acceptance Criteria

- [ ] `TabContent.id` is required (`string`).
- [ ] `CustomTabs` uses `id` for Radix value, key, and all callbacks.
- [ ] `CustomTabs` renders `label` for display text only.
- [ ] All bidirectional slug maps are removed from consumers.
- [ ] All `defaultTab` / `value` props pass `id` strings.
- [ ] All `onTabChange` callbacks receive `id` strings.
- [ ] URL sync works correctly (tab selection persists across refresh).
- [ ] No TypeScript errors (`npm run build` passes).
- [ ] Translation guide updated to reflect that tab labels are now translatable.
- [ ] TicketConversation parent components updated to use id-based activeTab.
