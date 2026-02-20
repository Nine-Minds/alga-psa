# MSP Full Translation Plan

- Slug: `msp-i18n-full-translation`
- Date: `2026-02-18`
- Status: Approved
- Supersedes: `.ai/translation/MSP_i18n_plan.md` (phases 2-7)
- Builds on: `docs/plans/2026-02-12-msp-i18n-phase1/` (completed)

## Summary

Translate the entire MSP portal into all 7 supported languages (en, fr, es, de, nl, it, pl) through a repeatable batch process. Each batch extracts one feature area's hardcoded strings, migrates date/number formatting to locale-aware utilities, adds error/validation translation keys, and ships behind the existing `msp-i18n-enabled` feature flag.

## Current State (Post-Phase 1)

Phase 1 is 100% complete (all 33 features merged). The foundation is in place:

| What | Status |
|------|--------|
| `msp-i18n-enabled` feature flag | Done |
| `I18nWrapper` in MSP layout (standard + EE) | Done |
| Namespace restructuring (`clientPortal.json` split into `client-portal.json` + `features/*.json`) | Done |
| Client portal components migrated to new namespaces | Done |
| `msp.json` with nav/sidebar/header/settings labels | Done (73 lines, ~60 keys) |
| MSP org language settings (Settings > General) | Done |
| Personal language preference in Profile | Done |
| Locale hierarchy (user > org default > system default) | Done |
| 7 languages configured | Done |
| MSP page content translated | **0%** — no MSP components call `useTranslation()` yet |
| Date/number formatting locale-aware | **~5%** — `useFormatters()` hook exists but rarely used |

### Current translation file inventory

```
server/public/locales/en/
  common.json              878 lines (~400 keys)
  client-portal.json       457 lines (~300 keys)
  msp.json                  73 lines  (~60 keys)
  features/
    appointments.json      138 lines
    billing.json            98 lines
    documents.json         189 lines
    projects.json           99 lines
    tickets.json           175 lines
```

All 7 languages have matching files.

## Strategy

```
Infrastructure sprint
        |
        v
  +---> Batch N ----+
  |     1. Inventory |
  |     2. Create EN namespace JSON
  |     3. Extract strings (t('key') calls)
  |     4. Migrate formatting (useFormatters)
  |     5. Add error/validation keys
  |     6. Generate pseudo-locale files
  |     7. Visual QA with pseudo-locales
  |     8. Generate real translations (AI)
  |     9. Validate (keys, JSON, variables)
  |    10. Ship (PR, merge)
  +-----+
        |
        v (repeat for all batches)
  Rollout & cleanup
```

Three pillars per batch:
1. **UI string extraction** — replace hardcoded English with `t('key')` calls
2. **Date/time/number formatting** — replace hardcoded `'en-US'` formatting with `useFormatters()` hook
3. **Error/validation messages** — follow client portal pattern (server returns English, component maps to translation keys)

---

## Phase 0: Infrastructure Sprint

A focused sprint that creates the foundation for all subsequent batches. Everything here happens before any MSP page content gets translated.

### 0a. Lazy Namespace Loading

**Problem:** `I18N_CONFIG.ns` lists all namespaces. i18next fetches them all on init. Adding 12+ MSP namespaces means 20+ HTTP requests on every page load.

**Solution:**

1. Change `I18N_CONFIG.ns` to only `['common']`
2. Add `ROUTE_NAMESPACES` mapping (route prefix to namespaces):

```typescript
// packages/ui/src/lib/i18n/config.ts
export const ROUTE_NAMESPACES: Record<string, string[]> = {
  // Client portal routes
  '/client-portal': ['common', 'client-portal'],
  '/client-portal/tickets': ['common', 'client-portal', 'features/tickets'],
  '/client-portal/projects': ['common', 'client-portal', 'features/projects'],
  '/client-portal/billing': ['common', 'client-portal', 'features/billing'],
  '/client-portal/documents': ['common', 'client-portal', 'features/documents'],
  '/client-portal/appointments': ['common', 'client-portal', 'features/appointments'],

  // MSP portal routes
  '/msp': ['common', 'msp/core', 'msp/dashboard'],
  '/msp/tickets': ['common', 'msp/core', 'features/tickets', 'msp/tickets-msp'],
  '/msp/projects': ['common', 'msp/core', 'features/projects'],
  '/msp/billing': ['common', 'msp/core', 'features/billing', 'msp/billing'],
  '/msp/contracts': ['common', 'msp/core', 'msp/contracts'],
  '/msp/time-management': ['common', 'msp/core', 'msp/time-entry'],
  '/msp/contacts': ['common', 'msp/core', 'msp/contacts'],
  '/msp/assets': ['common', 'msp/core', 'msp/assets'],
  '/msp/dispatch': ['common', 'msp/core', 'msp/dispatch'],
  '/msp/reports': ['common', 'msp/core', 'msp/reports'],
  '/msp/settings': ['common', 'msp/core', 'msp/settings'],
};

export function getNamespacesForRoute(pathname: string): string[] {
  // Exact match first
  if (ROUTE_NAMESPACES[pathname]) return ROUTE_NAMESPACES[pathname];

  // Prefix match (e.g., /msp/tickets/123 -> /msp/tickets)
  const sorted = Object.keys(ROUTE_NAMESPACES).sort((a, b) => b.length - a.length);
  for (const route of sorted) {
    if (pathname.startsWith(route)) return ROUTE_NAMESPACES[route];
  }

  return ['common'];
}
```

3. Update `I18nWrapper` to use `usePathname()` and pass route-appropriate namespaces to `I18nProvider`
4. `I18nProvider` calls `i18next.loadNamespaces()` on-demand for the current route

### 0b. Pseudo-Locale Setup

Create two test locales for visual QA:
- `xx` — all leaf values = `'1111'`
- `yy` — all leaf values = `'5555'`

**Script:** `scripts/generate-pseudo-locale.ts`

```typescript
// Reads any English namespace JSON, outputs pseudo version
// - Preserves key structure
// - Replaces leaf string values with the fill string
// - Preserves {{variables}} within the fill: "1111 {{name}} 1111"
// - Preserves pluralization suffixes (_one, _few, _many)

// Usage:
// npx ts-node scripts/generate-pseudo-locale.ts --locale xx --fill "1111"
// npx ts-node scripts/generate-pseudo-locale.ts --locale yy --fill "5555"
```

Add pseudo-locales to config in development only:

```typescript
// packages/ui/src/lib/i18n/config.ts
const devLocales = process.env.NODE_ENV === 'development'
  ? ['xx', 'yy'] as const
  : [] as const;
```

### 0c. Formatting Migration Pattern

No new utilities needed. The `useFormatters()` hook from `packages/ui/src/lib/i18n/client.tsx` already provides:

| Method | Replaces |
|--------|----------|
| `formatDate(date, opts)` | `new Date(x).toLocaleDateString('en-US', ...)` |
| `formatNumber(value, opts)` | `amount.toFixed(2)` for display |
| `formatCurrency(value, currency, opts)` | `` `${symbol}${amount.toLocaleString(...)}` `` |
| `formatRelativeTime(date)` | Hardcoded `"Today"`, `"Yesterday"` strings |

Each batch's checklist includes replacing hardcoded formatting in the affected components.

### 0d. Error/Validation Key Convention

Each namespace includes standard sections for errors and messages:

```json
{
  "page": { "title": "..." },
  "fields": { "...": "..." },
  "actions": { "...": "..." },

  "errors": {
    "loadFailed": "Failed to load data",
    "saveFailed": "Failed to save changes"
  },
  "validation": {
    "nameRequired": "Name is required",
    "emailInvalid": "Please enter a valid email"
  },
  "messages": {
    "success": {
      "created": "Successfully created",
      "updated": "Successfully updated",
      "deleted": "Successfully deleted"
    },
    "error": {
      "createFailed": "Failed to create",
      "updateFailed": "Failed to update"
    }
  }
}
```

Components use the established client portal pattern — error mapping dictionaries:

```typescript
const errorMap: Record<string, string> = {
  'Permission denied': t('errors.permissionDenied'),
  'Failed to save': t('errors.saveFailed'),
};
const message = errorMap[error.message] || t('errors.unknown');
```

### 0e. Split Existing msp.json into msp/core.json

Rename `server/public/locales/{lang}/msp.json` to `server/public/locales/{lang}/msp/core.json` for all 7 languages.

This namespace (nav, sidebar, header, settings section/tab labels) loads on every MSP route. All other `msp/*` namespaces are route-specific and lazy-loaded.

Update any existing references from `useTranslation('msp')` to `useTranslation('msp/core')`.

---

## Phase 1: Translation Batches

### Batch Checklist (Repeatable)

Every batch follows this exact process:

- [ ] **1. Inventory** — List all components in the feature area. Count hardcoded strings, inline date/number formatting, error/toast messages. Record in PR description.
- [ ] **2. Create namespace JSON** — Build `server/public/locales/en/msp/<feature>.json` with all extracted keys following the naming convention.
- [ ] **3. Extract strings** — Replace hardcoded strings with `t('key')` calls. Add `useTranslation('msp/<feature>')` import.
- [ ] **4. Migrate formatting** — Replace hardcoded `toLocaleDateString('en-US')`, manual currency formatting, etc. with `useFormatters()` hook.
- [ ] **5. Add error/validation keys** — Add error mapping dictionaries in components. Add `errors.*`, `validation.*`, `messages.*` keys to namespace JSON.
- [ ] **6. Generate pseudo-locales** — Run `scripts/generate-pseudo-locale.ts` for the new namespace.
- [ ] **7. Visual QA** — Switch to `xx` locale, navigate through all pages in the feature area. Anything not showing `1111` is a missed string. Fix and re-test.
- [ ] **8. Generate real translations** — Use AI to translate English JSON into all 6 non-English languages.
- [ ] **9. Validate** — Run JSON validation script. Check key counts match across all 7 languages. Check no `{{variables}}` are broken.
- [ ] **10. Ship** — Commit, PR, merge. Still behind `msp-i18n-enabled` flag.

### Batch Order

| Batch | Namespace | Est. Keys | Scope | Notes |
|-------|-----------|-----------|-------|-------|
| **1** | `msp/settings` | ~300 | All Settings tabs: General, Users, Teams, Ticketing, Projects, Time Entry, Billing, Notifications, Email, Integrations, Extensions, Experimental | Largest surface area. Exercises full workflow. Language settings UI lives here. |
| **2** | `msp/dashboard` | ~150 | Dashboard page, command center widgets, quick stats, recent activity | High visibility — first thing users see when flag goes live. |
| **3** | `msp/time-entry` | ~200 | Time entry form, timesheet view, approvals, time reports | Core daily workflow. Heavy date/number formatting migration. |
| **4** | `msp/billing` | ~200 | MSP-specific billing views, invoice generation, payment tracking | Only MSP-specific parts. Shared billing keys already in `features/billing.json`. Currency formatting heavy. |
| **5** | `msp/contracts` | ~200 | Contract management, service agreements, SLAs | Often accessed alongside billing. |
| **6** | `msp/tickets-msp` | ~100 | MSP-only ticket views, assignment, SLA tracking, internal notes | Small batch. Shared ticket keys already in `features/tickets.json`. |
| **7** | `msp/contacts` | ~100 | Contact and company management, contact details | |
| **8** | `msp/assets` | ~100 | Asset management, asset details, asset types | |
| **9** | `msp/dispatch` | ~150 | Technician dispatch, scheduling grid | |
| **10** | `msp/reports` | ~150 | Reporting module, report builder, export | |
| **11** | `msp/admin` | ~200 | Admin panels, tenant configuration, system settings | Lower frequency usage. |
| **12** | `msp/workflows` | ~150 | Workflow builder, automation hub, runs, events, dead letter | Lower frequency usage. |

**Total estimated new MSP keys: ~2,000**

### Cumulative key count by batch completion

| After batch | New keys | Cumulative MSP keys | Total all namespaces |
|-------------|----------|---------------------|----------------------|
| Infrastructure | 0 | ~60 (core) | ~1,660 |
| 1 (settings) | ~300 | ~360 | ~1,960 |
| 2 (dashboard) | ~150 | ~510 | ~2,110 |
| 3 (time-entry) | ~200 | ~710 | ~2,310 |
| 4 (billing) | ~200 | ~910 | ~2,510 |
| 5 (contracts) | ~200 | ~1,110 | ~2,710 |
| 6 (tickets-msp) | ~100 | ~1,210 | ~2,810 |
| 7 (contacts) | ~100 | ~1,310 | ~2,910 |
| 8 (assets) | ~100 | ~1,410 | ~3,010 |
| 9 (dispatch) | ~150 | ~1,560 | ~3,160 |
| 10 (reports) | ~150 | ~1,710 | ~3,310 |
| 11 (admin) | ~200 | ~1,910 | ~3,510 |
| 12 (workflows) | ~150 | ~2,060 | ~3,660 |

---

## Key Naming Convention

All namespaces follow a consistent structure:

```json
{
  "page": {
    "title": "Page Title",
    "description": "Page description text"
  },
  "sections": {
    "sectionName": {
      "title": "Section Title",
      "empty": "No items found"
    }
  },
  "fields": {
    "fieldName": {
      "label": "Field Label",
      "placeholder": "Enter value...",
      "help": "Help text for this field"
    }
  },
  "actions": {
    "create": "Create",
    "edit": "Edit",
    "delete": "Delete"
  },
  "table": {
    "columns": {
      "name": "Name",
      "status": "Status",
      "date": "Date"
    },
    "empty": "No records found"
  },
  "dialogs": {
    "confirmDelete": {
      "title": "Confirm Deletion",
      "message": "Are you sure you want to delete this item?",
      "confirm": "Delete",
      "cancel": "Cancel"
    }
  },
  "errors": {
    "loadFailed": "Failed to load data",
    "saveFailed": "Failed to save changes"
  },
  "validation": {
    "nameRequired": "Name is required"
  },
  "messages": {
    "success": {
      "created": "Successfully created",
      "updated": "Successfully updated"
    },
    "error": {
      "createFailed": "Failed to create"
    }
  }
}
```

---

## Date/Time/Number Formatting Strategy

### Existing infrastructure (no new code needed)

| Utility | Location | Locale source |
|---------|----------|---------------|
| `useFormatters()` hook | `packages/ui/src/lib/i18n/client.tsx` | i18n context (automatic) |
| `formatCurrency()` | `packages/core/src/lib/formatters.ts` | Parameter (manual) |
| `formatDate()` | `packages/core/src/lib/formatters.ts` | Parameter (manual) |

Prefer `useFormatters()` in React components — it reads locale from i18n context automatically.

### Migration table

| Current pattern | Replace with |
|----------------|-------------|
| `new Date(x).toLocaleDateString('en-US', opts)` | `const { formatDate } = useFormatters(); formatDate(x, opts)` |
| `new Date(x).toLocaleString(undefined, opts)` | `formatDate(x, opts)` |
| `` `${currency}${amount.toLocaleString(...)}` `` | `formatCurrency(amount, currency)` |
| `amount.toFixed(2)` (displayed to user) | `formatNumber(amount, { minimumFractionDigits: 2 })` |
| Hardcoded `"Today"`, `"Yesterday"` in relative time | `formatRelativeTime(date)` |

### Server-side formatting

Server-side utilities in `server/src/lib/utils/dateTimeUtils.ts` stay as-is. They handle timezone conversion and internal date manipulation. User-facing formatting is done client-side via `useFormatters()`.

---

## Error/Validation Translation Strategy

Follow the established client portal pattern. No new architecture.

### Server actions

Server actions continue returning English error strings in `{ success, error?, data? }` result objects. No server-side i18n required.

### Client components

Components map English error strings to translation keys:

```typescript
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

function SettingsPage() {
  const { t } = useTranslation('msp/settings');

  const handleSave = async () => {
    try {
      const result = await updateSettings(data);
      if (result.success) {
        toast.success(t('messages.success.updated'));
      } else {
        const errorMap: Record<string, string> = {
          'Permission denied': t('errors.permissionDenied'),
          'Invalid configuration': t('errors.invalidConfig'),
        };
        toast.error(errorMap[result.error!] || t('errors.saveFailed'));
      }
    } catch (err) {
      toast.error(t('errors.unknown'));
    }
  };
}
```

### Validation

Client-side validation uses translation keys directly:

```typescript
if (!name.trim()) {
  setFieldError('name', t('validation.nameRequired'));
}
```

---

## Translation Generation Workflow

For each batch, after the English namespace JSON is finalized:

### Step 1: AI translation

Feed the English JSON to Claude or GPT-4 with this prompt context:
- "Translate this JSON for MSP/PSA management software UI"
- "Use formal register"
- "Preserve all `{{variables}}` exactly as-is"
- "Preserve JSON structure and key names (translate values only)"
- "Output valid JSON"

### Step 2: Polish-specific rules

Polish requires special attention:
- **Plural forms:** 1 (`_one`), 2-4 (`_few`), 5+ (`_many`)
- **Formal register:** Use "Pan/Pani" forms
- **Date format:** DD.MM.YYYY
- **Number format:** 1 234,56 (space as thousands, comma as decimal)

```json
{
  "items_one": "{{count}} element",
  "items_few": "{{count}} elementy",
  "items_many": "{{count}} elementow"
}
```

### Step 3: Cross-language validation

Run validation script after each batch:
- All keys present in all 7 languages
- No broken `{{variables}}`
- Valid JSON (no syntax errors, no duplicate keys)
- Key counts match across languages

### Step 4: Human review (optional per batch)

Recommended at minimum for:
- Polish (primary non-English audience)
- One Romance language (French or Spanish) as spot-check

### Translation cost estimate

| Item | Cost |
|------|------|
| AI translation per batch (~200 keys x 6 languages) | ~$40 |
| AI translation all 12 batches | ~$240 |
| Human review for Polish (all batches) | ~$500-800 |
| Human review for one additional language | ~$300-500 |
| **Total (AI + Polish review)** | **~$750-1,050** |

---

## Pseudo-Locale Visual QA Process

### Setup (once, during infrastructure sprint)

1. Create `scripts/generate-pseudo-locale.ts`
2. Generate `xx` and `yy` locale files for all existing namespaces
3. Add pseudo-locales to dev config

### Per-batch QA process

1. Run `npx ts-node scripts/generate-pseudo-locale.ts --locale xx --fill "1111"` after creating English namespace
2. Enable `msp-i18n-enabled` flag locally
3. Switch browser locale to `xx`
4. Navigate through every page in the batch's feature area
5. **Every user-visible string should show `1111`**
6. Strings still showing English = missed extraction. Fix and re-test.
7. Check date/time/number values are locale-formatted (not `1111` — these come from `useFormatters()`, not translation keys)

### What pseudo-locales catch

| Shows `1111` | Correct behavior |
|-------------|-----------------|
| All UI labels, headings, buttons | String was extracted |
| Toast messages | Error/success keys added |
| Validation messages | Validation keys added |
| Empty states, placeholders | Often-forgotten strings caught |

| Shows English | Problem |
|--------------|---------|
| Any label, heading, button | Missed string extraction |
| Toast or error message | Missing error mapping |
| Tooltip, aria-label | Accessibility text missed |

| Shows formatted value (date, number) | Correct behavior |
|--------------------------------------|-----------------|
| "2/18/2026" or "18.02.2026" | Date comes from `useFormatters()` — locale applied |
| "$1,234.56" or "1.234,56 $" | Currency from `useFormatters()` |

---

## Namespace Loading by Route (Reference)

After infrastructure sprint, each MSP route loads only the namespaces it needs:

| Route | Namespaces loaded |
|-------|-------------------|
| `/msp` | `common`, `msp/core`, `msp/dashboard` |
| `/msp/tickets` | `common`, `msp/core`, `features/tickets`, `msp/tickets-msp` |
| `/msp/projects` | `common`, `msp/core`, `features/projects` |
| `/msp/billing` | `common`, `msp/core`, `features/billing`, `msp/billing` |
| `/msp/contracts` | `common`, `msp/core`, `msp/contracts` |
| `/msp/time-management` | `common`, `msp/core`, `msp/time-entry` |
| `/msp/contacts` | `common`, `msp/core`, `msp/contacts` |
| `/msp/assets` | `common`, `msp/core`, `msp/assets` |
| `/msp/dispatch` | `common`, `msp/core`, `msp/dispatch` |
| `/msp/reports` | `common`, `msp/core`, `msp/reports` |
| `/msp/settings` | `common`, `msp/core`, `msp/settings` |
| `/msp/documents` | `common`, `msp/core`, `features/documents` |
| `/msp/appointments` | `common`, `msp/core`, `features/appointments` |
| `/client-portal` | `common`, `client-portal` |
| `/client-portal/tickets` | `common`, `client-portal`, `features/tickets` |
| `/client-portal/billing` | `common`, `client-portal`, `features/billing` |
| `/client-portal/projects` | `common`, `client-portal`, `features/projects` |
| `/client-portal/documents` | `common`, `client-portal`, `features/documents` |
| `/client-portal/appointments` | `common`, `client-portal`, `features/appointments` |

---

## Rollout Plan

### During batches (flag OFF for all users)

- All work ships behind `msp-i18n-enabled` feature flag
- MSP portal stays English-only for all users
- Zero risk: flag off = no i18n initialization, no namespace loading
- Each batch is an independent PR that can be merged without blocking others

### After all batches complete

| Step | Action | Duration |
|------|--------|----------|
| Internal testing | Enable flag for your tenant. Test all MSP features in 2-3 languages. | 1-2 days |
| Fix pass | Address layout issues (German/Dutch text overflow), missing keys, formatting bugs | 2-3 days |
| Beta | Enable flag for 5-10 opt-in tenants. Gather feedback. | 1 week |
| Gradual rollout | 10% -> 50% -> 100% of tenants | 2-3 weeks |
| Cleanup | Remove feature flag checks. Remove pseudo-locales. Simplify `useMspTranslation` if used. | 1-2 days |

### Post-rollout maintenance

- New features: developers add translation keys as part of feature development
- New strings: follow the key naming convention, add to appropriate namespace
- New languages: follow the existing translation guide (`.ai/translation/translation-guide.md`)
- Validation: CI checks for missing keys, broken JSON, variable mismatches (optional — can add after rollout)

---

## Key File Locations

| Purpose | Path |
|---------|------|
| i18n config | `packages/ui/src/lib/i18n/config.ts` |
| I18nProvider | `packages/ui/src/lib/i18n/client.tsx` |
| I18nWrapper | `packages/tenancy/src/components/i18n/I18nWrapper.tsx` |
| useFormatters hook | `packages/ui/src/lib/i18n/client.tsx` |
| Core formatters | `packages/core/src/lib/formatters.ts` |
| Feature flags | `server/src/lib/feature-flags/featureFlags.ts` |
| MSP layout (standard) | `server/src/app/msp/layout.tsx` + `MspLayoutClient.tsx` |
| MSP layout (EE) | `ee/server/src/app/msp/layout.tsx` + `MspLayoutClient.tsx` |
| Translation files | `server/public/locales/{lang}/` |
| Hierarchical locale | `packages/tenancy/src/actions/locale-actions/getHierarchicalLocale.ts` |
| Pseudo-locale generator | `scripts/generate-pseudo-locale.ts` (to be created) |
| Phase 1 plan (reference) | `docs/plans/2026-02-12-msp-i18n-phase1/` |
| Translation guide | `.ai/translation/translation-guide.md` |
| DB migration guide | `.ai/translation/translation-database-migrations.md` |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| MSP translation coverage | 100% of user-visible strings | Pseudo-locale QA (no English visible with `xx` locale) |
| Missing key errors in production | 0 | Console monitoring / Sentry |
| Namespace load per route | Max 4 files | Route-namespace mapping |
| Page load regression | < 50ms additional | Performance monitoring |
| Translation quality (Polish) | Human-reviewed | Native speaker sign-off |
| All JSON files valid | 100% | Automated validation script |
