# Feature Flags Documentation

## Overview

Alga PSA uses PostHog for feature flag management, allowing tenant-based feature control. Features can be enabled/disabled for specific tenants while showing an "Under Construction" placeholder for restricted users.

## Current Feature Flags

### 1. `billing-enabled`
Controls access to billing-related features across the application.

**Affected Areas:**
- **MSP Portal:**
  - Billing menu section in sidebar (shows construction icon when disabled)
  - Billing page at `/msp/billing`
  - Company Details - Billing, Billing Dashboard, and Tax Settings tabs
  - Settings - Tax tab
  - Settings - Invoice Settings tab (within Billing tab)
  
- **Client Portal:**
  - Billing menu item and page at `/client-portal/billing`

**Behavior:**
- When disabled: Shows construction placeholder image
- Navigation items remain visible but display placeholder content when accessed

### 2. `advanced-features-enabled`
Controls access to advanced/experimental features.

**Affected Areas:**
- **Automation Hub** - Menu section and all sub-items
  - Template Library
  - Workflows
  - Events Catalog
  - Logs & History
  
- **System Monitoring** - Menu section (redirects to `/msp/jobs`)
  - Job Monitoring
  
- **Settings - Integrations tab**

- **User Activities Dashboard - Workflow Tasks section** (hidden, no placeholder)

**Behavior:**
- Menu items show construction icon when disabled
- Pages/tabs show construction placeholder when accessed
- Workflow Tasks in User Activities are completely hidden

### 3. `email-configuration`
Controls access to email configuration settings.

**Affected Areas:**
- **Settings - General - Email tab**
  - Email provider configuration
  - Domain settings
  - Email settings management

**Behavior:**
- When disabled: Shows construction placeholder image
- Tab remains visible but displays placeholder content when accessed

### 4. `delegated-time-entry`
Controls access to the delegated time-entry UI (editing/viewing time sheets for other users) in the MSP portal.

**Affected Areas:**
- **MSP Portal:**
  - Time Entry page at `/msp/time-entry` (subject user selector)
  - Time Sheet pages at `/msp/time-entry/timesheet/:id` (delegation UI + ability to edit delegated sheets)

**Behavior:**
- When disabled: The UI only allows working with the current user’s own time periods/time sheets (delegated sheets are shown as read-only if accessed directly).
- When enabled: Authorized users can select a subject user and edit/view that user’s time sheets via the UI.

### 5. `invoice-template-gui-designer`
Controls access to the new (experimental) invoice template visual designer.

**Affected Areas:**
- **MSP Portal:**
  - Billing page at `/msp/billing` → **Invoice Templates** tab → Template editor view

**Behavior:**
- When disabled (default): Uses the existing AssemblyScript source editor only.
- When enabled: Shows a **Visual** tab alongside the existing **Code** editor tab.
  - The visual designer persists its workspace state alongside the template source (and uses local storage as a best-effort fallback).
  - Invoice output remains driven by the AssemblyScript template (until the compilation pipeline is finalized).

### 6. `email-logs`
Controls access to email log UI surfaces for outbound email auditing/debugging.

**Affected Areas:**
- **MSP Portal:**
  - System Monitor → Email Logs menu link
  - Email Logs page at `/msp/email-logs`
  - Ticket Details → Email Notifications section (per-ticket)

**Behavior:**
- When disabled: Email Logs page shows construction placeholder; navigation link and ticket section are hidden.

## Implementation Details

### User Identification
Users are identified in PostHog with tenant information via `PostHogUserIdentifier` component:
```typescript
posthog.identify(anonymousId, {
  tenant: user.tenant,
  user_type: user.user_type
});
```

### Key Components

1. **FeaturePlaceholder** (`/src/components/FeaturePlaceholder.tsx`)
   - Displays the "Under Construction" image
   - Responsive sizing with max height of 90vh

2. **SidebarWithFeatureFlags** (`/src/components/layout/SidebarWithFeatureFlags.tsx`)
   - Wraps the main sidebar to handle feature flags
   - Adds `underConstruction` property to disabled menu items

3. **FeatureFlagWrapper** (`/src/components/FeatureFlagWrapper.tsx`)
   - Generic wrapper component for feature flag conditional rendering

4. **FeatureFlagPageWrapper** (`/src/components/FeatureFlagPageWrapper.tsx`)
   - Page-level wrapper for showing placeholder on entire pages

## PostHog Configuration

To configure these feature flags in PostHog:

1. **Create Feature Flag:**
   - Key: `billing-enabled`, `advanced-features-enabled`, or `email-configuration`
   - Type: Boolean

2. **Set Rollout Conditions:**
   - Add condition: User property `tenant` equals `[your-tenant-id]`
   - Set to 100% for matching users
   - Default to 0% for all others

3. **Test:**
   - Enable for specific tenant
   - Verify placeholder appears for other tenants

## Usage Examples

### Checking Feature Flag in Component:
```typescript
const featureFlag = useFeatureFlag('billing-enabled');
const isEnabled = typeof featureFlag === 'boolean' ? featureFlag : featureFlag?.enabled;
```

### Conditional Rendering:
```typescript
{isEnabled ? (
  <ActualContent />
) : (
  <FeaturePlaceholder />
)}
```

### Hiding Content Completely:
```typescript
{isAdvancedFeaturesEnabled && (
  <WorkflowTasksSection />
)}
```

## Notes

- Feature flags are checked on the client side
- The construction image is located at `/images/under-construction.png`
- All text is included in the image itself (no additional text rendering)
- Service Types and Service Catalog remain accessible regardless of billing feature flag
