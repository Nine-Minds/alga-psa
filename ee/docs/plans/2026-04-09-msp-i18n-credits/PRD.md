# PRD — MSP i18n: Credits Sub-batch

- Slug: `2026-04-09-msp-i18n-credits`
- Date: `2026-04-09`
- Status: Draft
- Parent plan: `/.ai/translation/MSP_i18n_plan.md`

## Summary

Create a new `msp/credits` i18n namespace and wire `useTranslation('msp/credits')` into 10
credit management components across `packages/billing/src/components/credits/` and
`packages/billing/src/components/billing-dashboard/Credit*.tsx`. None of these components
currently use `useTranslation`. This is a greenfield namespace (no existing JSON to extend)
covering ~150 user-visible strings across credit management, reconciliation, application,
and expiration flows.

## Problem

MSP users navigating to billing > credits see fully English UI while the surrounding
navigation, sidebar, and dashboard chrome are already translated. The credits module spans
10 components with ~150 hardcoded English strings across credit listing, management dashboards,
reconciliation reports, credit application, and expiration modification dialogs. No
`msp/credits.json` namespace exists, and no `ROUTE_NAMESPACES` entry loads credit-specific
translations for `/msp/billing/credits`.

## Goals

1. Create `server/public/locales/en/msp/credits.json` with all keys needed by the 10 components
2. Wire `useTranslation('msp/credits')` into all 8 client components (2 files are server-side
   or have zero visible strings)
3. Generate translations for 7 non-English locales (fr, es, de, nl, it, pl) + 2 pseudo-locales
   (xx, yy)
4. Add `/msp/billing/credits` route to `ROUTE_NAMESPACES` in
   `packages/core/src/lib/i18n/config.ts` loading `msp/credits`
5. Pass `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
6. Measurable: 0% -> 100% of credit components wired for i18n

## Non-goals

- Translating credit amounts, dates, or tenant data (those are formatted via `useFormatters`
  or `formatCurrency`/`formatDateOnly` utilities already in use)
- Translating server-side error strings in `actions.ts` that only appear in console logs
  (e.g., `'Unknown error occurred'` in catch blocks) -- these do not surface to the user
- Moving credit components to a different package or restructuring the billing package
- Adding new UI features to credit management
- Translating Recharts axis tick formatters or tooltip formatters (they use `formatCurrency`
  which is locale-aware separately)

## File Inventory

| # | File | LOC | Type | Est. Strings | Notes |
|---|------|-----|------|-------------|-------|
| 1 | `credits/CreditsPage.tsx` | 275 | Server component | ~30 | Column titles, statuses, tab labels, card titles, settings labels. **Server component** -- will need a client wrapper or inline `t()` via server-side i18n |
| 2 | `credits/CreditsTabs.tsx` | 53 | Client | 0 | Pure tab-switching logic; labels passed in via props from CreditsPage. No visible strings to translate. **Skip.** |
| 3 | `credits/AddCreditButton.tsx` | 53 | Client | ~6 | Button label, dialog title, placeholder text, cancel/submit buttons |
| 4 | `credits/BackButton.tsx` | 20 | Client | ~1 | "Back to Credits" button text |
| 5 | `credits/actions.ts` | 109 | Server action | ~5 | Error messages in catch blocks. Only `'Authentication required'` and `'Transfer amount must be greater than zero'` surface to callers. Others are console-only. |
| 6 | `billing-dashboard/CreditManagement.tsx` | 642 | Client | ~45 | Page title, chart labels/legends, stat card labels, column titles, tab labels, button text, dialog text |
| 7 | `billing-dashboard/CreditReconciliation.tsx` | 604 | Client | ~50 | Dashboard title, filter labels, stat cards, chart titles/legends, column titles, tab labels, status badges, button text, toast messages |
| 8 | `billing-dashboard/CreditApplicationUI.tsx` | 273 | Client | ~20 | Card title/description, column titles, labels, button text, error/empty states |
| 9 | `billing-dashboard/CreditExpirationInfo.tsx` | 129 | Client | ~10 | Card title/description, field labels, help text, empty/error states |
| 10 | `billing-dashboard/CreditExpirationModificationDialog.tsx` | 172 | Client | ~15 | Dialog title/description, field labels, switch label, button text, validation errors |

**Total estimated: ~150 unique strings across ~80 translation keys (some strings repeat across components).**

## Namespace Structure

File: `server/public/locales/en/msp/credits.json`

```
{
  "page": {
    "title": "Credit Management",
    "creditsOverview": "Credits Overview",
    "overviewDescription": "Manage your client credits...",
    ...
  },
  "columns": {
    "creditId": "Credit ID",
    "created": "Created",
    "description": "Description",
    "originalAmount": "Original Amount",
    "remaining": "Remaining",
    "expires": "Expires",
    "status": "Status",
    "actions": "Actions",
    "context": "Context",
    ...
  },
  "status": {
    "active": "Active",
    "expired": "Expired",
    "expiringSoon": "Expiring Soon ({{days}} days)",
    "never": "Never",
    "na": "N/A",
    ...
  },
  "actions": {
    "view": "View",
    "edit": "Edit",
    "expire": "Expire",
    "addCredit": "Add Credit",
    "cancel": "Cancel",
    "viewAllCredits": "View All Credits",
    "backToCredits": "Back to Credits",
    ...
  },
  "tabs": {
    "activeCredits": "Active Credits",
    "allCredits": "All Credits",
    "expiredCredits": "Expired Credits"
  },
  "settings": {
    "title": "Credit Expiration Settings",
    "creditExpiration": "Credit Expiration:",
    "enabled": "Enabled",
    "disabled": "Disabled",
    "expirationPeriod": "Expiration Period:",
    "daysUnit": "{{count}} days",
    "notificationDays": "Notification Days:",
    "none": "None"
  },
  "charts": {
    "expirationSummary": "Credit Expiration Summary",
    "expirationSummaryDescription": "Overview of credits expiring soon",
    "usageTrends": "Credit Usage Trends",
    "usageTrendsDescription": "Historical credit usage patterns",
    "creditsIssued": "Credits Issued",
    "creditsApplied": "Credits Applied",
    "creditsExpired": "Credits Expired",
    ...
  },
  "stats": {
    "totalActiveCredits": "Total Active Credits",
    "expiringIn30Days": "Expiring in 30 Days",
    "totalCreditsApplied": "Total Credits Applied",
    "totalCreditsExpired": "Total Credits Expired",
    ...
  },
  "management": {
    "title": "Credit Management",
    "recentCredits": "Recent Credits",
    "recentCreditsDescription": "View and manage your client credits...",
    "addCreditPlaceholder": "Credit amount and details form would be implemented here."
  },
  "reconciliation": {
    "title": "Credit Reconciliation Dashboard",
    "selectClient": "Select Client",
    "runReconciliation": "Run Reconciliation",
    "running": "Running...",
    "status": "Status",
    "allStatuses": "All Statuses",
    "open": "Open",
    "inReview": "In Review",
    "resolved": "Resolved",
    "fromDate": "From Date",
    "toDate": "To Date",
    "reset": "Reset",
    "totalDiscrepancies": "Total Discrepancies",
    "totalDiscrepancyAmount": "Total Discrepancy Amount",
    "openIssues": "Open Issues",
    "statusDistribution": "Status Distribution",
    "statusDistributionDescription": "Overview of reconciliation report statuses",
    "discrepancyTrends": "Discrepancy Trends",
    "discrepancyTrendsDescription": "Monthly trends in credit discrepancies",
    "numberOfDiscrepancies": "Number of Discrepancies",
    "totalAmount": "Total Amount",
    "reconciliationReports": "Reconciliation Reports",
    "reconciliationReportsDescription": "View and manage credit balance discrepancies",
    "resolve": "Resolve",
    "validationResult": "Validation completed: Found {{balanceCount}} balance discrepancies and {{trackingCount}} tracking issues.",
    ...
  },
  "application": {
    "title": "Apply Credit",
    "applyToInvoice": "Apply available credits to this invoice",
    "applyToBalance": "Apply credits to reduce customer balance",
    "totalAvailableCredit": "Total Available Credit:",
    "invoiceAmount": "Invoice Amount:",
    "selectCreditToApply": "Select Credit to Apply",
    "amountToApply": "Amount to Apply",
    "creditOrderNote": "Credits are applied in order of expiration date (oldest first)",
    "noCreditsAvailable": "No credits available for this client",
    "failedToLoadCredits": "Failed to load available credits",
    "selectCreditError": "Please select a credit and enter a valid amount",
    "failedToApply": "Failed to apply credit",
    "applying": "Applying...",
    "applyCredit": "Apply Credit",
    "selected": "Selected",
    "select": "Select",
    ...
  },
  "expiration": {
    "appliedCredits": "Applied Credits",
    "creditsAppliedToInvoice": "Credits applied to this invoice: {{amount}}",
    "creditAmount": "Credit Amount:",
    "noDetails": "No credit details available",
    "failedToLoad": "Failed to load credit details",
    ...
  },
  "expirationDialog": {
    "title": "Modify Credit Expiration",
    "description": "Update the expiration date for this credit.",
    "creditAmount": "Credit Amount:",
    "remainingAmount": "Remaining Amount:",
    "created": "Created:",
    "currentExpiration": "Current Expiration:",
    "noExpiration": "No expiration",
    "removeExpiration": "Remove expiration date",
    "newExpirationDate": "New Expiration Date",
    "pastDateError": "Expiration date cannot be in the past",
    "updateError": "An error occurred while updating the expiration date",
    "saving": "Saving...",
    "saveChanges": "Save Changes"
  },
  "context": {
    "lineageMissing": "Lineage Missing",
    "lineageMissingDescription": "Source invoice metadata could not be recovered...",
    "transferredRecurringCredit": "Transferred Recurring Credit",
    "recurringSource": "Recurring Source",
    "servicePeriod": "Service Period: {{period}}",
    "recurringLineagePreserved": "Recurring source lineage preserved",
    "financialOnly": "Financial Only",
    "noRecurringServicePeriod": "No recurring service period"
  }
}
```

## ROUTE_NAMESPACES Change

In `packages/core/src/lib/i18n/config.ts`, add a new entry:

```typescript
'/msp/billing/credits': ['common', 'msp/core', 'features/billing', 'msp/credits'],
```

This must appear **before** the existing `/msp/billing` entry since `getNamespacesForRoute`
uses longest-prefix matching.

## Server Component Consideration

`CreditsPage.tsx` is an async server component (no `'use client'` directive). Two approaches:

1. **Extract a client wrapper** that calls `useTranslation('msp/credits')` and passes
   translated strings as props to the server-rendered content. This is the recommended
   pattern for server components in Next.js with client-side i18n.
2. **Convert to client component** by adding `'use client'` and restructuring data fetching.
   This is more invasive and not recommended.

The recommended approach is (1): create a thin `CreditsPageClient.tsx` wrapper that handles
translation, and have the server component pass data to it.

## Acceptance Criteria

- [ ] `server/public/locales/en/msp/credits.json` exists with all keys used by credit components
- [ ] All 8 client components with visible strings import `useTranslation('msp/credits')`
      and wrap all user-visible strings via `t('key', { defaultValue: 'English fallback' })`
- [ ] `CreditsPage.tsx` (server component) strings are translated via a client wrapper component
- [ ] `CreditsTabs.tsx` confirmed to have zero visible strings (skip)
- [ ] `actions.ts` server-side error strings assessed: user-facing ones translated, log-only
      ones left in English
- [ ] `/msp/billing/credits` added to `ROUTE_NAMESPACES` loading `msp/credits`
- [ ] Translations generated for fr, es, de, nl, it, pl (7 locales)
- [ ] `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
      exits 0
- [ ] Italian translations preserve accents (e.g., "Crediti scaduti" not "Crediti scaduti")
- [ ] `{{variable}}` interpolation tokens preserved across all 9 locale files
- [ ] Currency values still formatted via `formatCurrency()` (not translated as strings)
- [ ] Date values still formatted via `toLocaleDateString()` or `formatDateOnly()` (not translated)
- [ ] Visual smoke test: `/msp/billing/credits` and credit management tab render correctly
      in `en` and at least one non-English locale; `xx` pseudo-locale shows pseudo-text for
      every visible string
