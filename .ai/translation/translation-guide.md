# Translation Guide for Alga PSA

> **Last Updated:** 2026-03-13
> **Current Languages:** English (en), French (fr), Spanish (es), German (de), Dutch (nl), Italian (it), Polish (pl)

## Table of Contents

1. [Overview](#overview)
2. [Translating MSP Components (Per-Batch Workflow)](#translating-msp-components-per-batch-workflow)
3. [Adding a New Language](#adding-a-new-language)
4. [Configuration Files Reference](#configuration-files-reference)
5. [Namespace Structure](#namespace-structure)
6. [Key Naming Convention](#key-naming-convention)
7. [Error and Validation Translation Pattern](#error-and-validation-translation-pattern)
8. [Date/Time/Number Formatting](#datetimeNumber-formatting)
9. [Email and Notification Templates (Database)](#email-and-notification-templates-database)
10. [Pseudo-Locale Visual QA](#pseudo-locale-visual-qa)
11. [Validation Tools](#validation-tools)
12. [Common Pitfalls](#common-pitfalls)
13. [Translation Quality Guidelines](#translation-quality-guidelines)

---

## Overview

Alga PSA uses **i18next** with **react-i18next** for internationalization. The system supports a multi-portal architecture (MSP Portal and Client Portal) with feature-based namespace splitting and lazy loading.

### Current State

- **7 Languages:** en, fr, es, de, nl, it, pl
- **Namespaces in production:** `common`, `client-portal`, `features/*` (5 files), `msp/core` + MSP feature namespaces (in progress)
- **~3,660 estimated total keys** when all MSP namespaces are complete
- **Hierarchical locale resolution:** User preference > MSP org default > System default (for MSP); User > Client > Tenant > Cookie > Browser > System (for Client Portal)
- **Feature flag:** `msp-i18n-enabled` gates MSP translation (flag OFF = English-only MSP portal)

### Architecture

```
server/public/locales/{lang}/
├── common.json              # Shared across entire app (~400 keys)
├── client-portal.json       # Client portal UI chrome (~300 keys)
├── features/                # Shared between both portals
│   ├── tickets.json
│   ├── projects.json
│   ├── billing.json
│   ├── documents.json
│   └── appointments.json
└── msp/                     # MSP portal only
    ├── core.json            # Nav, sidebar, header (loads on every MSP route)
    ├── settings.json        # Settings pages
    ├── dashboard.json       # Dashboard
    ├── time-entry.json      # Time tracking
    ├── billing.json         # MSP-specific billing
    ├── contracts.json       # Contracts
    ├── tickets-msp.json     # MSP-only ticket views
    ├── contacts.json        # Contact management
    ├── assets.json          # Asset management
    ├── dispatch.json        # Technician dispatch
    ├── reports.json         # Reporting
    ├── admin.json           # Admin panels
    └── workflows.json       # Workflow builder
```

Namespaces are **lazy-loaded by route** — only the namespaces needed for the current page are fetched.

### Key Files

| Purpose | Path |
|---------|------|
| i18n config | `packages/ui/src/lib/i18n/config.ts` |
| I18nProvider + useFormatters | `packages/ui/src/lib/i18n/client.tsx` |
| I18nWrapper | `packages/tenancy/src/components/i18n/I18nWrapper.tsx` |
| Core formatters | `packages/core/src/lib/formatters.ts` |
| Feature flags | `server/src/lib/feature-flags/featureFlags.ts` |
| Hierarchical locale | `packages/tenancy/src/actions/locale-actions/getHierarchicalLocale.ts` |
| Translation files | `server/public/locales/{lang}/` |

---

## Translating MSP Components (Per-Batch Workflow)

MSP translation is done in batches, one feature area at a time. Each batch follows the same process.

### Step 1: Inventory

List all components in the feature area. Count:
- Hardcoded English strings (headings, labels, buttons, placeholders, tooltips, empty states)
- Inline date/number formatting (`toLocaleDateString('en-US')`, `toFixed(2)`, manual currency)
- Error and toast messages
- Validation messages

### Step 2: Create English namespace JSON

Create `server/public/locales/en/msp/<feature>.json` with all keys following the [naming convention](#key-naming-convention).

### Step 3: Extract strings

Replace hardcoded strings with `t('key')` calls:

```typescript
// BEFORE
<h1>Time Entry</h1>
<button>Save Changes</button>

// AFTER
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const { t } = useTranslation('msp/time-entry');

<h1>{t('page.title')}</h1>
<button>{t('actions.save')}</button>
```

### Step 4: Migrate formatting

Replace hardcoded locale formatting with `useFormatters()`:

```typescript
// BEFORE
new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// AFTER
import { useFormatters } from '@alga-psa/ui/lib/i18n/client';

const { formatDate } = useFormatters();
formatDate(entry.date, { month: 'short', day: 'numeric' })
```

### Step 5: Add error/validation keys

Add error mapping dictionaries to components and corresponding keys to the namespace JSON. See [Error and Validation Translation Pattern](#error-and-validation-translation-pattern).

### Step 6: Generate pseudo-locales

```bash
npx ts-node scripts/generate-pseudo-locale.ts --locale xx --fill "1111"
npx ts-node scripts/generate-pseudo-locale.ts --locale yy --fill "5555"
```

### Step 7: Visual QA

1. Enable `msp-i18n-enabled` flag locally
2. Switch to `xx` locale
3. Navigate through all pages in the feature area
4. **Every user-visible string should show `1111`**
5. Strings still in English = missed extraction — fix and re-test

### Step 8: Generate real translations

Use AI (Claude/GPT-4) to translate the English JSON into all 6 non-English languages. See [Translation Quality Guidelines](#translation-quality-guidelines) for the prompt and rules.

### Step 9: Validate

```bash
# Validate all translation files
npx ts-node scripts/validate-translations.ts
```

Check: all keys present in all 7 languages, no broken `{{variables}}`, valid JSON.

### Step 10: Ship

Create PR, merge. Everything is behind the `msp-i18n-enabled` flag — zero user impact.

---

## Adding a New Language

### Prerequisites

- Language code (ISO 639-1, e.g., `pt` for Portuguese)
- Display name in target language (e.g., `Portugues`)
- Translator or AI translation + human review

### Step 1: Update configuration

Edit `packages/ui/src/lib/i18n/config.ts`:

```typescript
// Add to LOCALE_CONFIG.supportedLocales
supportedLocales: ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt'] as const,

// Add to LOCALE_CONFIG.localeNames
pt: 'Portugues',
```

Edit `packages/core/src/lib/i18n/config.ts` — update the `SupportedLocale` type and arrays to match.

Edit `server/src/components/settings/notifications/EmailTemplates.tsx` — add language to `languageNames` mapping in **3 locations** (DataTable column, ViewTemplateDialog, EditTemplateDialog):

```typescript
const languageNames: Record<string, string> = {
  'en': 'English',
  'fr': 'French',
  'es': 'Spanish',
  'de': 'German',
  'nl': 'Dutch',
  'it': 'Italian',
  'pl': 'Polish',
  'pt': 'Portuguese',  // ADD
};
```

### Step 2: Create UI translation files

Copy the entire English locale directory structure and translate all files:

```bash
# Copy structure
cp -r server/public/locales/en/ server/public/locales/pt/
```

Files to translate:
- `common.json` (~400 keys)
- `client-portal.json` (~300 keys)
- `features/*.json` (5 files, ~700 keys total)
- `msp/core.json` (~60 keys)
- `msp/*.json` (all existing MSP namespaces)

### Step 3: Create email template migration

Create `server/migrations/YYYYMMDD_add_[language]_email_templates.cjs`.

Reference existing migrations:
- English: `20251027080000_add_system_auth_email_templates.cjs`
- French: `20251027090000_add_french_notification_templates.cjs`
- Polish: (check for most recent Polish migration)

Templates to translate (~20):
- 3 authentication emails (verification, password reset, portal invitation)
- 4 appointment request emails
- 3 ticket notification emails
- 1 survey email
- 3 invoice/billing emails
- 3 project/task emails
- 3 time entry emails

### Step 4: Create internal notification template migration

Create `server/migrations/YYYYMMDD_add_[language]_internal_notification_templates.cjs`.

Templates to translate (~24):
- 12 ticket notifications (8 internal + 4 client-facing)
- 4 project notifications
- 3 invoice notifications
- 4 system notifications
- 1 message notification

### Step 5: Validate and test

```bash
# Run migrations
npm run migrate

# Validate JSON files
npx ts-node scripts/validate-translations.ts

# Test in browser
# - Switch to new language in both portals
# - Check all pages render
# - Check date/time/number formatting
# - Check email templates
```

---

## Configuration Files Reference

### packages/ui/src/lib/i18n/config.ts

Main i18n configuration. Contains:
- `LOCALE_CONFIG` — supported locales, locale names, cookie settings
- `I18N_CONFIG` — i18next init options (default namespace, fallback language)
- `ROUTE_NAMESPACES` — route-to-namespace mapping for lazy loading
- `getNamespacesForRoute()` — helper to resolve namespaces for a pathname

### packages/core/src/lib/i18n/config.ts

Core i18n types. Contains:
- `SupportedLocale` type
- `SUPPORTED_LOCALES` array
- `LOCALE_DISPLAY_NAMES` map
- `LOCALE_FLAG_EMOJIS` map

### packages/ui/src/lib/i18n/client.tsx

Client-side i18n runtime. Contains:
- `I18nProvider` — React context provider
- `useI18n()` — hook for locale/language access
- `useFormatters()` — hook for locale-aware date/number/currency formatting
- `initI18n()` — initialization with lazy namespace loading

### packages/tenancy/src/components/i18n/I18nWrapper.tsx

Portal-aware wrapper. Reads route pathname, resolves namespaces, passes locale. Used in both MSP and Client Portal layouts.

---

## Namespace Structure

See `.ai/translation/translation_files_structure.md` for the complete namespace reference including file sizes, key counts, and route-to-namespace loading table.

### Key principle: No duplication

- **Shared features** (`features/*.json`) — used by both portals (tickets, billing, projects, documents, appointments)
- **Client portal chrome** (`client-portal.json`) — nav, dashboard, auth, profile specific to client portal
- **MSP core** (`msp/core.json`) — nav, sidebar, header shared across all MSP routes
- **MSP features** (`msp/*.json`) — one namespace per feature area, loaded only on relevant routes

### When to add a key to which namespace

| String location | Namespace |
|----------------|-----------|
| Generic button/label used everywhere (Save, Cancel, Delete) | `common.json` |
| Client portal navigation, auth, dashboard | `client-portal.json` |
| Ticket/project/billing/document UI used by both portals | `features/*.json` |
| MSP nav, sidebar, header, settings tabs | `msp/core.json` |
| MSP-specific feature page (time entry, dispatch, etc.) | `msp/<feature>.json` |

---

## Key Naming Convention

```json
{
  "page": {
    "title": "Page Title",
    "description": "Page description"
  },
  "sections": {
    "sectionName": {
      "title": "Section Title",
      "empty": "No items found"
    }
  },
  "fields": {
    "fieldName": {
      "label": "Label",
      "placeholder": "Enter...",
      "help": "Help text"
    }
  },
  "actions": {
    "create": "Create",
    "edit": "Edit",
    "delete": "Delete"
  },
  "table": {
    "columns": { "name": "Name", "status": "Status" },
    "empty": "No records found"
  },
  "dialogs": {
    "confirmDelete": {
      "title": "Confirm Deletion",
      "message": "Are you sure?",
      "confirm": "Delete",
      "cancel": "Cancel"
    }
  },
  "errors": { },
  "validation": { },
  "messages": {
    "success": { },
    "error": { }
  }
}
```

---

## Error and Validation Translation Pattern

Follow the established client portal pattern. Server actions return English strings; components map them to translation keys.

### Server actions

No changes needed. Continue returning `{ success, error?, data? }`:

```typescript
return { success: false, error: 'Permission denied' };
```

### Component error mapping

```typescript
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
```

### Client-side validation

```typescript
if (!name.trim()) {
  setFieldError('name', t('validation.nameRequired'));
}
```

### Namespace structure for errors

Every namespace includes:

```json
{
  "errors": {
    "loadFailed": "Failed to load data",
    "saveFailed": "Failed to save changes",
    "permissionDenied": "You don't have permission to perform this action",
    "unknown": "An unexpected error occurred"
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

---

## Date/Time/Number Formatting

### Use `useFormatters()` in React components

The `useFormatters()` hook from `packages/ui/src/lib/i18n/client.tsx` reads the locale from i18n context automatically:

```typescript
import { useFormatters } from '@alga-psa/ui/lib/i18n/client';

function MyComponent() {
  const { formatDate, formatNumber, formatCurrency, formatRelativeTime } = useFormatters();

  return (
    <div>
      <span>{formatDate(entry.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      <span>{formatCurrency(invoice.amount, 'USD')}</span>
      <span>{formatNumber(percentage, { style: 'percent' })}</span>
      <span>{formatRelativeTime(comment.created_at)}</span>
    </div>
  );
}
```

### Migration from hardcoded patterns

| Old pattern | New pattern |
|------------|------------|
| `new Date(x).toLocaleDateString('en-US', opts)` | `formatDate(x, opts)` |
| `new Date(x).toLocaleString(undefined, opts)` | `formatDate(x, opts)` |
| `` `${currency}${amount.toLocaleString(...)}` `` | `formatCurrency(amount, currency)` |
| `amount.toFixed(2)` (for display) | `formatNumber(amount, { minimumFractionDigits: 2 })` |
| Hardcoded `"Today"`, `"Yesterday"` | `formatRelativeTime(date)` |

### Locale-specific format examples

| Locale | Date | Number | Currency |
|--------|------|--------|----------|
| en | 02/18/2026 | 1,234.56 | $1,234.56 |
| fr | 18/02/2026 | 1 234,56 | 1 234,56 $ |
| de | 18.02.2026 | 1.234,56 | 1.234,56 $ |
| pl | 18.02.2026 | 1 234,56 | 1 234,56 $ |

### Server-side formatting

Use `packages/core/src/lib/formatters.ts` functions which accept a locale parameter:

```typescript
import { formatCurrency, formatDate } from '@alga-psa/core';

formatCurrency(100.50, 'fr', 'EUR');  // "100,50 EUR"
formatDate(new Date(), 'de');          // "18.02.2026"
```

---

## Email and Notification Templates (Database)

Email and notification templates are stored in the **database**, not in JSON files. See `.ai/translation/translation-database-migrations.md` for the complete reference.

### Tables

| Table | Purpose |
|-------|---------|
| `system_email_templates` | System-wide default email templates |
| `tenant_email_templates` | Tenant-customized email templates |
| `internal_notification_templates` | In-app notification templates |

### Locale resolution for emails

1. User language preference (`user_preferences` table)
2. Client default locale (`clients` table) — for client portal users
3. MSP org default locale (`tenant_settings` → `mspPortal.defaultLocale`) — for MSP users
4. System default (English)

### Template count per language

| Category | Count |
|----------|-------|
| Email templates | ~20 |
| Internal notification templates | ~24 |
| **Total** | **~44** |

### Important rules

- Always preserve `{{variables}}` exactly as they appear
- Translate subject lines
- Translate HTML content but preserve HTML tags
- Translate plain text content
- Keep variable names in English

---

## Pseudo-Locale Visual QA

Pseudo-locales replace all translation values with placeholder strings for visual testing.

### Setup

Two pseudo-locales are active in development (directories and files already exist):
- `xx` — all values = `'11111'` — `server/public/locales/xx/`
- `yy` — all values = `'55555'` — `server/public/locales/yy/`

Both are registered in `LOCALE_CONFIG.supportedLocales` and `PSEUDO_LOCALES` in `packages/core/src/lib/i18n/config.ts`. They are filtered from user-facing locale pickers via `filterPseudoLocales()`.

### Updating pseudo-locale files

When adding a new English namespace (e.g., `msp/settings.json`), copy the new file into `xx/` and `yy/` with all leaf values replaced by the fill string. Preserve `{{variables}}` and JSON key structure.

### QA process

1. Enable `msp-i18n-enabled` flag locally
2. Switch browser locale to `xx`
3. Navigate the feature area being tested
4. **Expected:** All UI strings show `11111`
5. **Problem:** Any string showing English text was not extracted
6. **Note:** Dates, numbers, and currency values will NOT show `11111` — they come from `useFormatters()`, not translation keys

---

## Validation Tools

### JSON syntax validation

```bash
# Validate all JSON files
for file in server/public/locales/**/*.json; do
  node -e "JSON.parse(require('fs').readFileSync('$file'))" || echo "INVALID: $file"
done
```

### Key comparison across languages

```bash
# Compare English keys with another language (recursive)
npx ts-node scripts/validate-translations.ts
```

The validation script checks:
- All keys present in English exist in every other language
- No extra keys in non-English files
- No broken `{{variables}}`
- Valid JSON syntax
- No duplicate keys

### Quick key count

```bash
# Count keys per namespace per language
for lang in en fr es de nl it pl; do
  echo "=== $lang ==="
  for file in server/public/locales/$lang/**/*.json; do
    count=$(node -e "const o=JSON.parse(require('fs').readFileSync('$file'));const c=(o,p='')=>{let n=0;for(const[k,v]of Object.entries(o)){if(typeof v==='object'&&v!==null)n+=c(v,p+k+'.');else n++}return n};console.log(c(o))")
    echo "  $(basename $file): $count keys"
  done
done
```

---

## Common Pitfalls

### 1. Missing interpolation variables

```json
// WRONG — missing {{name}}
"welcome": "Bienvenue!"

// CORRECT
"welcome": "Bienvenue, {{name}}!"
```

### 2. Hardcoded locale in formatting

```typescript
// WRONG
new Date(x).toLocaleDateString('en-US')

// CORRECT
const { formatDate } = useFormatters();
formatDate(x)
```

### 3. Wrong namespace import

```typescript
// WRONG — using old namespace
const { t } = useTranslation('clientPortal');

// CORRECT — using new namespace
const { t } = useTranslation('features/tickets');
```

### 4. German/Dutch text overflow

German and Dutch translations are often 30-50% longer than English. Test UI with these languages to catch layout breaks. Use CSS `overflow`, `text-overflow: ellipsis`, or flexible layouts.

### 5. Polish plural forms

Polish has 3 plural forms. i18next handles this with suffixes:

```json
{
  "items_one": "{{count}} element",
  "items_few": "{{count}} elementy",
  "items_many": "{{count}} elementow"
}
```

Rules: 1 = `_one`, 2-4 (except 12-14) = `_few`, everything else = `_many`.

### 6. Forgetting error/toast messages

Hardcoded strings in `toast.success()`, `toast.error()`, and `setError()` calls are easy to miss during extraction. Search for these patterns in each batch.

### 7. Missing aria-labels and tooltips

Accessibility text (`aria-label`, `title`, `placeholder`) must also be translated. Search for these attributes during extraction.

### 8. Currency symbol placement

Don't manually place currency symbols. Use `formatCurrency()` which handles placement per locale:
- English: `$100.00`
- French: `100,00 $`
- German: `100,00 $`

### 9. Duplicate keys in JSON

JSON allows duplicate keys but the last one wins silently. Always validate:

```bash
# Check for duplicate keys
node -e "const s=require('fs').readFileSync('file.json','utf8');const r=/\"(\w+)\":/g;const m={};let x;while(x=r.exec(s)){if(m[x[1]])console.log('DUP:',x[1]);m[x[1]]=true}"
```

### 10. Not loading the namespace

If `t('key')` returns the key string itself, the namespace likely isn't loaded. Check:
- The namespace is listed in `ROUTE_NAMESPACES` for the current route (including all routes that render the component, not just the primary one — e.g., `/msp/profile` and `/msp/security-settings` both need `msp/settings`)
- The component's `useTranslation('namespace')` matches the filename
- The `I18nWrapper` is rendering (it must always render, even with `msp-i18n-enabled` off — it forces English locale in that case)

### 11. CustomTabs labels are display text — translate them

`CustomTabs` now uses a required `id` field for matching (`defaultTab`, `activeTab`, `onTabChange`, URL sync, Radix values). The `label` property is display-only and is safe to translate.

When translating tabs:
- Keep `tab.id` stable, ASCII, and kebab-case because it is the URL slug / internal identifier
- Translate `tab.label` normally with `t('...')`
- Pass ids, not labels, through `defaultTab`, `value`, `onTabChange`, and URL params
- If a parent component stores active tab state, that state must hold the tab id rather than the translated label

### 12. Italian accent audit after AI translation

AI-generated Italian translations consistently drop mandatory accents (`à`, `è`, `ù`). After every AI translation round, check:
```bash
grep -n ' e [a-z]\| puo \| gia \| verra \| funzionalita\| necessario' server/public/locales/it/msp/<file>.json
```

### 13. Cross-check tab/section names against core.json

Translated tab labels and section names in any namespace must match the canonical names in `msp/core.json` for that language. Always verify after translation to avoid navigation using one term and settings using another.

---

## Translation Quality Guidelines

### AI translation prompt

When using AI to translate namespace files:

```
Translate this JSON file for MSP/PSA management software UI.

Rules:
- Translate values only. Do not change keys.
- Use formal register appropriate for business software.
- Preserve all {{variables}} exactly as-is.
- Preserve HTML tags if present.
- Output valid JSON.
- For Polish: use formal "Pan/Pani" forms and correct plural suffixes (_one, _few, _many).
- Keep technical terms (SLA, API, MSP, PSA) in English.
- Translate common IT terms per local convention (Ticket, Invoice, Dashboard, etc.).

Target language: [language name]
```

### Domain-specific terms

**Keep in English:** SLA, API, URL, PSA, MSP, HTTP, JSON, CSV, PDF

**Translate per local convention:**
- Ticket, Invoice, Dashboard, Settings, Project, Contract
- Check what competing products use in the target language

### Quality checklist per language

- [ ] All `{{variables}}` preserved
- [ ] Valid JSON (no syntax errors)
- [ ] Key counts match English
- [ ] Formal register used consistently
- [ ] Technical terms handled appropriately
- [ ] Plural forms correct (especially Polish)
- [ ] No truncated or missing translations

---

## Related Documentation

| Document | Path |
|----------|------|
| Full translation plan | `docs/plans/2026-02-18-msp-i18n-full-translation-plan.md` |
| Phase 1 plan (completed) | `docs/plans/2026-02-12-msp-i18n-phase1/` |
| File structure reference | `.ai/translation/translation_files_structure.md` |
| DB migration reference | `.ai/translation/translation-database-migrations.md` |
| i18next docs | https://www.i18next.com/ |
| react-i18next docs | https://react.i18next.com/ |
