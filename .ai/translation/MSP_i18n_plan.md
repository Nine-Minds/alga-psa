# MSP Internationalization (i18n) Implementation Plan

> **Goal**: Full MSP portal translation with restructured namespace architecture
> **Current State**: Batch 1 (Settings) complete — 769 keys across 9 locales, 32 components extracted
> **Target State**: 100% translatable MSP portal with 7 languages
> **Polish Status**: ✅ Translation available (ready for integration)
> **CustomTabs Refactoring**: ✅ Complete — `id` is required on `TabContent`, all components migrated

---

## Executive Summary

| Metric | Current | Target |
|--------|---------|--------|
| Supported languages | 7 (en, fr, es, de, nl, it, pl) | 7 ✅ |
| Namespace structure | Feature-based (shared + portal-specific) | Feature-based ✅ |
| Translation duplication | None (shared features) | None ✅ |
| MSP namespaces complete | 3/12 (core, dashboard, settings) | 12/12 |
| Estimated unique keys delivered | ~1,700+ | ~6,750-8,150 (revised up from ~3,660) |

---

## Phase 0: Foundation + Polish Integration (Week 1)

### 0.1 Add Polish Language Support

**Status**: Polish translations are available and ready for integration.

**Files to modify:**

```typescript
// server/src/lib/i18n/config.ts
export const LOCALE_CONFIG = {
  supportedLocales: ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl'] as const,
  localeNames: {
    en: 'English',
    fr: 'Français',
    es: 'Español',
    de: 'Deutsch',
    nl: 'Nederlands',
    it: 'Italiano',
    pl: 'Polski',  // ADD
  } as const,
  // ...
};
```

**Files to create/copy:**
```
server/public/locales/pl/
  common.json        # Polish translations (available)
  clientPortal.json  # Polish translations (available)
```

**Database migration for Polish email templates:**
```typescript
// ee/server/migrations/YYYYMMDD_add_polish_email_templates.ts
export async function up(knex: Knex): Promise<void> {
  // Copy English templates as base, then update with Polish translations
  await knex.raw(`
    INSERT INTO system_email_templates (template_name, language_code, subject, body)
    SELECT template_name, 'pl', subject, body
    FROM system_email_templates
    WHERE language_code = 'en'
    ON CONFLICT (template_name, language_code) DO NOTHING
  `);

  // Then update with actual Polish translations...
}
```

### 0.2 Fix Existing Issues

**Duplicate keys in common.json (all languages):**
- Line 42-43: Remove duplicate `confirmDeletion`
- Line 47-48: Remove duplicate `saving`

### 0.3 Create MSP Feature Flag

```typescript
// server/src/lib/feature-flags/featureFlags.ts
const DEFAULT_BOOLEAN_FLAGS: Record<string, boolean> = {
  // ... existing flags
  'msp-i18n-enabled': false,  // ADD - Controls MSP translation rollout
};
```

### 0.4 Create Namespace Structure

**Problem with current structure:**
- `clientPortal.json` contains `tickets`, `documents`, `projects`, `billing` (~500+ keys)
- These features are shared with MSP portal
- Creating `msp/tickets.json` etc. would duplicate translations

**Solution: Feature-based namespaces with portal overlays**

The key insight: Client portal is a **subset view** of MSP features with different UI chrome.
There's no client-portal-specific *functionality* - just portal-specific navigation/branding.

```
server/public/locales/{lang}/
├── common.json                    # Core UI (buttons, status, validation, time)
│
├── features/                      # SHARED between portals (no duplication!)
│   ├── tickets.json              # Ticket management (~150 keys)
│   ├── documents.json            # Document management (~190 keys)
│   ├── projects.json             # Project views (~100 keys)
│   ├── billing.json              # Invoices, payments (~150 keys)
│   ├── appointments.json         # Appointment system (~140 keys) - SHARED!
│   ├── notifications.json        # Notification system (~50 keys)
│   ├── contacts.json             # Contacts/companies (~80 keys)
│   ├── profile.json              # User profile (~100 keys)
│   └── assets.json               # Asset management (~100 keys)
│
├── client-portal/                 # Client portal UI chrome ONLY
│   ├── core.json                 # Nav, layouts, branding (~50 keys)
│   ├── dashboard.json            # Client dashboard widgets (~40 keys)
│   └── auth.json                 # Client auth flows (~100 keys)
│
└── msp/                           # MSP portal ONLY (features not in client portal)
    ├── core.json                 # MSP nav, layouts, sidebar (~100 keys)
    ├── dashboard.json            # MSP dashboard, command center (~150 keys)
    ├── time-entry.json           # Time tracking, approvals (~200 keys)
    ├── dispatch.json             # Technician dispatch, scheduling (~150 keys)
    ├── contracts.json            # Contract management (~200 keys)
    ├── reports.json              # Reporting module (~150 keys)
    ├── settings.json             # MSP settings, configuration (~300 keys)
    ├── admin.json                # Admin panels, tenant config (~200 keys)
    └── workflows.json            # Workflow management (~150 keys)
```

**Key benefits:**
1. **No duplication** - Tickets, documents, projects shared across portals
2. **Clear ownership** - Feature teams own their namespace
3. **Lazy loading** - Only load what's needed per route
4. **Easier translation** - Smaller, focused files
5. **Migration path** - Can extract from `clientPortal.json` incrementally

**Namespace loading by route:**

| Route | Namespaces Loaded |
|-------|-------------------|
| `/client-portal/tickets` | `common`, `features/tickets`, `client-portal/core` |
| `/msp/tickets` | `common`, `features/tickets`, `msp/core` |
| `/client-portal/dashboard` | `common`, `features/tickets`, `client-portal/core`, `client-portal/dashboard` |
| `/msp/billing` | `common`, `features/billing`, `msp/core`, `msp/contracts` |

**Estimated key distribution:**

| Category | Namespace | Est. Keys | Source |
|----------|-----------|-----------|--------|
| **Shared** | common.json | ~400 | Existing + extracted |
| | features/tickets.json | ~150 | From clientPortal.json |
| | features/documents.json | ~190 | From clientPortal.json |
| | features/projects.json | ~100 | From clientPortal.json |
| | features/billing.json | ~150 | From clientPortal.json |
| | features/notifications.json | ~50 | From clientPortal.json |
| | features/contacts.json | ~80 | New |
| **Client** | client-portal/*.json | ~610 | Remaining from clientPortal.json |
| **MSP** | msp/*.json | ~1,500 | New extractions |
| **Total** | | ~3,230 | |

**vs. duplicated approach:** ~4,100 keys (saving ~870 keys = ~20% less translation work)

### 0.5 Update i18n Configuration

```typescript
// server/src/lib/i18n/config.ts
export const I18N_CONFIG = {
  // ...existing
  defaultNS: 'common',
  ns: [
    // Core
    'common',

    // Shared features (used by both portals - no duplication)
    'features/tickets',
    'features/documents',
    'features/projects',
    'features/billing',
    'features/appointments',
    'features/notifications',
    'features/contacts',
    'features/profile',
    'features/assets',

    // Client portal UI chrome only
    'client-portal/core',
    'client-portal/dashboard',
    'client-portal/auth',

    // MSP portal only (features not in client portal)
    'msp/core',
    'msp/dashboard',
    'msp/time-entry',
    'msp/dispatch',
    'msp/contracts',
    'msp/reports',
    'msp/settings',
    'msp/admin',
    'msp/workflows',
  ],
  partialBundledLanguages: true,  // Enable lazy loading
};

// Namespace to route mapping for preloading
export const ROUTE_NAMESPACES: Record<string, string[]> = {
  // Client portal routes (shared features + client chrome)
  '/client-portal': ['common', 'client-portal/core', 'client-portal/dashboard'],
  '/client-portal/tickets': ['common', 'features/tickets', 'client-portal/core'],
  '/client-portal/projects': ['common', 'features/projects', 'client-portal/core'],
  '/client-portal/billing': ['common', 'features/billing', 'client-portal/core'],
  '/client-portal/appointments': ['common', 'features/appointments', 'client-portal/core'],
  '/client-portal/documents': ['common', 'features/documents', 'client-portal/core'],
  '/client-portal/profile': ['common', 'features/profile', 'client-portal/core'],

  // MSP portal routes (shared features + MSP-only features)
  '/msp': ['common', 'msp/core', 'msp/dashboard'],
  '/msp/tickets': ['common', 'features/tickets', 'msp/core'],
  '/msp/projects': ['common', 'features/projects', 'msp/core'],
  '/msp/billing': ['common', 'features/billing', 'msp/core', 'msp/contracts'],
  '/msp/time-management': ['common', 'msp/core', 'msp/time-entry'],
  '/msp/contacts': ['common', 'features/contacts', 'msp/core'],
  '/msp/settings': ['common', 'msp/core', 'msp/settings'],
  '/msp/assets': ['common', 'features/assets', 'msp/core'],
  '/msp/appointments': ['common', 'features/appointments', 'msp/core'],
  '/msp/dispatch': ['common', 'msp/core', 'msp/dispatch'],
  '/msp/reports': ['common', 'msp/core', 'msp/reports'],
};
```

### 0.6 Migration Strategy: Extract Shared Features

**Phase 0.6a: Extract from clientPortal.json (non-breaking)**

```typescript
// scripts/extract-shared-namespaces.ts
// Run: npx ts-node scripts/extract-shared-namespaces.ts

const EXTRACTION_MAP = {
  // Shared features (used by both portals)
  'features/tickets': ['tickets'],           // Extract tickets.* from clientPortal.json
  'features/documents': ['documents'],       // Extract documents.*
  'features/projects': ['projects'],         // Extract projects.*
  'features/billing': ['billing'],           // Extract billing.*
  'features/appointments': ['appointments'], // Shared between portals
  'features/notifications': ['notifications'],
  'features/profile': ['profile'],           // User profile

  // Client portal UI chrome only
  'client-portal/core': ['nav'],             // Client-specific navigation
  'client-portal/dashboard': ['dashboard'],  // Client dashboard widgets
  'client-portal/auth': ['auth'],            // Client auth flows
};

// This creates new files while keeping clientPortal.json working
// Components can migrate gradually to new namespaces
```

**Phase 0.6b: Backward compatibility layer**

```typescript
// server/src/lib/i18n/legacyNamespaceAdapter.ts
// During migration, support both old and new namespace patterns

export const NAMESPACE_ALIASES: Record<string, string> = {
  // Old namespace -> New namespace
  'clientPortal': 'client-portal/core',  // Fallback for unmigrated components
};

// In i18n initialization, load aliased namespaces automatically
```

**Phase 0.6c: Gradual component migration**

```typescript
// BEFORE (old pattern)
const { t } = useTranslation('clientPortal');
t('tickets.title');  // Works

// AFTER (new pattern - preferred)
const { t } = useTranslation('features/tickets');
t('title');  // Cleaner, more specific

// DURING MIGRATION (both work)
// Old components continue using 'clientPortal'
// New/migrated components use specific namespaces
```

---

## Phase 0.7: Fix Technical Gaps — ✅ COMPLETE

### Gap 1: MSP Layout Missing I18nWrapper

**Problem**: `MspLayoutClient.tsx` doesn't wrap children in `I18nWrapper`, so MSP pages can't use `useTranslation()` or `useI18n()`.

**Current state** (`server/src/app/msp/MspLayoutClient.tsx`):
```typescript
// No I18nWrapper - MSP pages can't use translations!
return (
  <AppSessionProvider session={session}>
    <PostHogUserIdentifier />
    <TagProvider>
      <ClientUIStateProvider>
        {isOnboardingPage ? children : <DefaultLayout>{children}</DefaultLayout>}
      </ClientUIStateProvider>
    </TagProvider>
  </AppSessionProvider>
);
```

**Solution**: Add `I18nWrapper` with portal='msp'
```typescript
// server/src/app/msp/MspLayoutClient.tsx
import { I18nWrapper } from '@/components/i18n/I18nWrapper';

return (
  <AppSessionProvider session={session}>
    <PostHogUserIdentifier />
    <I18nWrapper portal="msp" initialLocale={initialLocale}>
      <TagProvider>
        <ClientUIStateProvider>
          {isOnboardingPage ? children : <DefaultLayout>{children}</DefaultLayout>}
        </ClientUIStateProvider>
      </TagProvider>
    </I18nWrapper>
  </AppSessionProvider>
);
```

**Also update server layout** (`server/src/app/msp/layout.tsx`):
```typescript
// Pass locale to client component
const locale = await getHierarchicalLocaleAction();

return (
  <MspLayoutClient
    session={session}
    needsOnboarding={needsOnboarding}
    initialSidebarCollapsed={initialSidebarCollapsed}
    initialLocale={locale}  // ADD
  >
    {children}
  </MspLayoutClient>
);
```

### Gap 2: i18next Loads ALL Namespaces on Init

**Problem**: Current `initI18n()` spreads `I18N_CONFIG.ns` which loads ALL namespaces eagerly.
Adding 20+ namespaces would cause massive initial load.

**Current state** (`server/src/lib/i18n/client.tsx`):
```typescript
await i18next.init({
  ...I18N_CONFIG,  // Includes ns: ['common', 'clientPortal', ...]
  // i18next-http-backend fetches ALL namespaces listed in ns!
});
```

**Solution**: Lazy namespace loading with on-demand fetching

```typescript
// server/src/lib/i18n/client.tsx - REVISED

interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: SupportedLocale;
  initialResources?: Record<string, Record<string, object>>;  // NEW: Server-preloaded
  namespaces?: string[];  // NEW: Namespaces for this route
  portal?: 'msp' | 'client';
}

async function initI18n(
  locale: SupportedLocale,
  initialResources?: Record<string, Record<string, object>>,
  namespaces?: string[]
) {
  if (i18nInitialized) {
    // Already initialized - just load additional namespaces if needed
    if (namespaces?.length) {
      await i18next.loadNamespaces(namespaces);
    }
    return;
  }

  const config = {
    ...I18N_CONFIG,
    lng: locale,
    // CRITICAL: Only specify namespaces we actually need to load
    ns: namespaces || ['common'],
    defaultNS: 'common',
    // Don't preload all namespaces
    preload: false,
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    // Add resources if server-preloaded
    ...(initialResources && {
      resources: { [locale]: initialResources },
      partialBundledLanguages: true,
    }),
  };

  await i18next
    .use(HttpBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init(config);

  i18nInitialized = true;
}

export function I18nProvider({
  children,
  initialLocale,
  initialResources,
  namespaces = ['common'],
  portal = 'client',
}: I18nProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    initI18n(locale, initialResources, namespaces).then(() => {
      setIsInitialized(true);
    });
  }, []);

  // Load additional namespaces on-demand when route changes
  useEffect(() => {
    if (isInitialized && namespaces?.length) {
      i18next.loadNamespaces(namespaces);
    }
  }, [isInitialized, namespaces]);

  // ... rest of implementation
}
```

### Gap 3: Config.ts Namespace List Causes Eager Loading

**Problem**: `I18N_CONFIG.ns` lists ALL namespaces, causing i18next to fetch them all.

**Solution**: Separate namespace registry from init config

```typescript
// server/src/lib/i18n/config.ts - REVISED

// Registry of all available namespaces (for validation, not loading)
export const AVAILABLE_NAMESPACES = [
  'common',
  'features/tickets',
  'features/documents',
  // ... all namespaces
] as const;

// Config for i18next init - minimal namespaces only!
export const I18N_CONFIG = {
  debug: process.env.NODE_ENV === 'development',
  fallbackLng: LOCALE_CONFIG.defaultLocale,
  supportedLngs: [...LOCALE_CONFIG.supportedLocales],
  defaultNS: 'common',
  // DON'T list all namespaces here - they're loaded on-demand
  ns: ['common'],
  interpolation: { escapeValue: false },
  load: 'languageOnly' as const,
  // Enable lazy loading
  partialBundledLanguages: true,
};

// Route-to-namespace mapping for preloading
export const ROUTE_NAMESPACES: Record<string, string[]> = {
  '/msp': ['common', 'msp/core', 'msp/dashboard'],
  '/msp/tickets': ['common', 'features/tickets', 'msp/core'],
  // ... etc
};

// Helper to get namespaces for a route
export function getNamespacesForRoute(pathname: string): string[] {
  // Try exact match
  if (ROUTE_NAMESPACES[pathname]) {
    return ROUTE_NAMESPACES[pathname];
  }

  // Try prefix match (e.g., /msp/tickets/123 -> /msp/tickets)
  for (const [route, namespaces] of Object.entries(ROUTE_NAMESPACES)) {
    if (pathname.startsWith(route)) {
      return namespaces;
    }
  }

  // Default
  return ['common'];
}
```

### Gap 4: I18nWrapper Needs Route-Aware Namespaces

**Solution**: Update `I18nWrapper` to use route-based namespace loading

```typescript
// server/src/components/i18n/I18nWrapper.tsx - REVISED
'use client';

import { usePathname } from 'next/navigation';
import { I18nProvider } from '@/lib/i18n/client';
import { getNamespacesForRoute } from '@/lib/i18n/config';
import { getHierarchicalLocaleAction } from '@/lib/actions/locale-actions/getHierarchicalLocale';

interface I18nWrapperProps {
  children: ReactNode;
  initialLocale?: SupportedLocale;
  initialResources?: Record<string, object>;  // Server-preloaded
  portal?: 'msp' | 'client';
}

export function I18nWrapper({
  children,
  initialLocale,
  initialResources,
  portal = 'msp'
}: I18nWrapperProps) {
  const pathname = usePathname();
  const namespaces = getNamespacesForRoute(pathname);

  // ... locale fetching logic

  return (
    <I18nProvider
      initialLocale={locale}
      initialResources={initialResources}
      namespaces={namespaces}
      portal={portal}
    >
      {children}
    </I18nProvider>
  );
}
```

### Gap 5: Internal Notification Locale Resolution

**Current state**: `createNotificationFromTemplateInternal()` uses templates from `internal_notification_templates` table which already has `language_code` column. However, the locale selection for internal users needs to respect user preferences.

**Problem**: Need to ensure internal notification templates are selected based on user's locale preference.

**Solution**: Update notification creation to resolve locale for internal users

```typescript
// server/src/lib/actions/internal-notification-actions/internalNotificationActions.ts

import { resolveEmailLocale } from '@/lib/notifications/emailLocaleResolver';

export async function createNotificationFromTemplateInternal(
  db: Knex,
  params: CreateNotificationParams
): Promise<void> {
  const { tenant, user_id, template_name, ...rest } = params;

  // Resolve locale for user (works for both internal and client users)
  const locale = await resolveEmailLocale(tenant, {
    userId: user_id,
    userType: 'internal',  // or determine dynamically
  });

  // Get template for resolved locale
  const template = await db('internal_notification_templates')
    .where({
      template_name,
      language_code: locale,
      tenant
    })
    .first();

  // Fallback to English if locale template not found
  const finalTemplate = template || await db('internal_notification_templates')
    .where({
      template_name,
      language_code: 'en',
      tenant
    })
    .first();

  // ... rest of implementation
}
```

### Gap 6: Email Locale Resolution for MSP Users

**Current state**: `emailLocaleResolver.ts` already handles internal users but defaults to tenant settings. It should respect MSP user preferences.

**Current logic** (already good):
```typescript
// For internal users, checks:
// 1. User preference (user_preferences table)
// 2. Tenant default
// 3. System default ('en')
```

**Enhancement**: Ensure MSP i18n feature flag is respected

```typescript
// server/src/lib/notifications/emailLocaleResolver.ts - ADD
import { featureFlags } from '@/lib/feature-flags/featureFlags';

export async function resolveEmailLocale(
  tenantId: string,
  recipient: EmailRecipient
): Promise<SupportedLocale> {
  // For internal users, check if MSP i18n is enabled
  if (recipient.userType === 'internal') {
    const mspI18nEnabled = await featureFlags.isEnabled('msp-i18n-enabled', {
      tenantId,
      userId: recipient.userId
    });

    if (!mspI18nEnabled) {
      return 'en';  // Force English when flag is off
    }
  }

  // ... rest of existing logic
}
```

---

## Lessons Learned from Batch 1 (Settings)

> These findings should be applied to all future batches.

### 1. I18nWrapper must always render (even with feature flag off)

**Problem**: `MspLayoutClient.tsx` originally skipped `I18nWrapper` entirely when `msp-i18n-enabled` was `false`. This meant `useTranslation()` returned raw keys (e.g., `profile.tabs.security`) instead of English text — a regression for users with the flag disabled.

**Fix applied**: Always render `I18nWrapper`, forcing `initialLocale='en'` when the flag is off. The flag now only controls whether users can *change* their language (language picker visibility), not whether the i18n system initializes.

**File**: `server/src/app/msp/MspLayoutClient.tsx`

### 2. CustomTabs — RESOLVED ✅

**Original problem**: `CustomTabs` used `label` for both display and matching, making translation impossible.

**Resolution**: `TabContent.id` is now a **required** field. All matching (`defaultTab`, `activeTab`, `onTabChange`, URL sync, Radix values) uses `id`. The `label` property is display-only and freely translatable via `t()`.

**All 8 settings components migrated** — each tab has a stable kebab-case `id` (e.g., `'general'`, `'ticketing'`, `'users'`). Type safety enforced via `CustomTabs.typecheck.ts`.

**Rule**: When adding new tabs, always provide a stable ASCII kebab-case `id`. Translate `label` with `t()`. Store/compare active tab state using `id`, never `label`.

### 3. ROUTE_NAMESPACES must include all routes using a namespace

**Problem**: Components at `/msp/profile` and `/msp/security-settings` use `useTranslation('msp/settings')` but those routes weren't in `ROUTE_NAMESPACES`, so the namespace wasn't pre-loaded.

**Fix applied**: Added both routes to the config:
```typescript
'/msp/settings': ['common', 'msp/core', 'msp/settings'],
'/msp/profile': ['common', 'msp/core', 'msp/settings'],
'/msp/security-settings': ['common', 'msp/core', 'msp/settings'],
```

**Rule**: When extracting strings for a new batch, always verify which routes render the affected components and ensure all routes are registered in `ROUTE_NAMESPACES`.

### 4. AI translation quality requires accent/diacritical verification

Italian translations from AI consistently dropped mandatory accents: `funzionalita` → `funzionalità`, `e necessario` → `è necessario`, `puo` → `può`, `verra` → `verrà`, `gia` → `già`. This happened across multiple generation rounds.

**Rule for all future batches**: After AI generates Italian translations, run an accent audit:
```bash
# Check for common missing Italian accents
grep -n ' e [a-z]\| puo \| gia \| verra \| funzionalita\| necessario' server/public/locales/it/msp/<namespace>.json
```

### 5. Cross-locale consistency with core.json

Tab labels and section names in settings namespace must match the canonical names in `msp/core.json` for each language. Mismatches found in batch 1:
- Spanish: "Portal del cliente" vs "Portal de clientes" (core.json is canonical)
- Dutch: "Facturering" vs "Facturatie" (core.json is canonical)
- Spanish: "Tickets" vs "Ticketing" (loanword kept in core.json)

**Rule**: Before finalizing any batch, cross-check translated section/tab names against `msp/core.json` in each language.

### 6. Polish plurals: use `_plural` suffix (not `_few`/`_many`)

The current i18next setup uses simple English-style pluralization (`key` + `key_plural`). Polish has 3 grammatical plural forms (`_one`, `_few`, `_many`), but since components only request `key` and `key_plural`, the `_few`/`_many` keys are dead code.

**Rule**: For Polish, only add `_plural` keys alongside the base key. Do NOT add `_few`/`_many` unless the frontend is explicitly configured for Polish plural categories.

---

## Phase 0.8: CustomTabs Refactoring — ✅ COMPLETE

> **Status**: DONE
> **Result**: `TabContent.id` is now a **required** field (not optional). All 8 settings components migrated.

### What was done

1. `TabContent` interface updated — `id: string` is required, `label` is display-only
2. All CustomTabs internals use `tab.id` for Radix `value`, React keys, `defaultTab` matching, and `onTabChange` callbacks
3. All 8 settings components migrated with stable kebab-case IDs:
   - `SettingsPage.tsx` — 18 tabs (`'general'`, `'client-portal'`, `'users'`, etc.)
   - `SecuritySettingsPage.tsx` — 7 tabs (`'roles'`, `'sessions'`, `'single-sign-on'`, etc.)
   - `TicketingSettings.tsx` — 6 tabs (`'display'`, `'ticket-numbering'`, `'boards'`, etc.)
   - `InteractionSettings.tsx` — 2 tabs (`'interaction-types'`, `'interaction-statuses'`)
   - `NotificationsTab.tsx` — 5 tabs (`'settings'`, `'email-templates'`, `'categories'`, etc.)
   - `ImportExportSettings.tsx` — 3 tabs (`'asset-import'`, `'asset-export'`, `'templates-automation'`)
   - `ExtensionManagement.tsx` — 2 tabs (`'manage'`, `'install'`)
   - `UserProfile.tsx` — 6 tabs (`'profile'`, `'security'`, `'single-sign-on'`, etc.)
4. Type safety enforced via `CustomTabs.typecheck.ts`
5. Tab labels are now freely translatable — no prerequisite blocking

---

## Phase 1: Performance Optimizations (Week 1-2)

### 1.1 Server-Side Namespace Preloading

```typescript
// server/src/lib/i18n/server.ts - ENHANCED
import { cache } from 'react';
import { ROUTE_NAMESPACES } from './config';

export const getServerTranslation = cache(async (
  namespace: string | string[],
  locale: SupportedLocale
) => {
  const namespaces = Array.isArray(namespace) ? namespace : [namespace];

  // Parallel load all requested namespaces
  const resources = await Promise.all(
    namespaces.map(ns => loadNamespace(ns, locale))
  );

  // ... rest of implementation
});

// Preload namespaces based on route
export async function preloadRouteNamespaces(
  pathname: string,
  locale: SupportedLocale
): Promise<Record<string, object>> {
  const namespaces = ROUTE_NAMESPACES[pathname] || ['msp/core'];
  const resources: Record<string, object> = {};

  await Promise.all(
    namespaces.map(async (ns) => {
      resources[ns] = await loadNamespace(ns, locale);
    })
  );

  return resources;
}
```

### 1.2 Client-Side Lazy Loading

```typescript
// server/src/lib/i18n/client.tsx - ENHANCED
interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: SupportedLocale;
  initialResources?: Record<string, object>;  // ADD - Server preloaded
  portal?: 'msp' | 'client';
  namespaces?: string[];  // ADD - Namespaces to load
}

export function I18nProvider({
  children,
  initialLocale,
  initialResources,
  portal = 'client',
  namespaces = ['common'],
}: I18nProviderProps) {
  useEffect(() => {
    // Only fetch namespaces not already provided
    const missingNamespaces = namespaces.filter(
      ns => !initialResources?.[ns]
    );

    if (missingNamespaces.length > 0) {
      // Lazy load missing namespaces
      missingNamespaces.forEach(ns => {
        i18next.loadNamespaces(ns);
      });
    }
  }, [namespaces, initialResources]);

  // ...
}
```

### 1.3 MSP Layout Integration

```typescript
// server/src/app/(msp)/layout.tsx
import { preloadRouteNamespaces } from '@/lib/i18n/server';
import { headers } from 'next/headers';

export default async function MSPLayout({ children }: { children: ReactNode }) {
  const headersList = headers();
  const pathname = headersList.get('x-pathname') || '/msp';
  const locale = headersList.get('x-locale') || 'en';

  // Preload namespaces for this route
  const initialResources = await preloadRouteNamespaces(pathname, locale);

  return (
    <I18nProvider
      portal="msp"
      initialLocale={locale}
      initialResources={initialResources}
      namespaces={['msp/core']}
    >
      {children}
    </I18nProvider>
  );
}
```

### 1.4 Translation Caching Strategy

```typescript
// server/src/lib/i18n/cache.ts - NEW
import { unstable_cache } from 'next/cache';

export const getCachedTranslations = unstable_cache(
  async (namespace: string, locale: string) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_URL}/locales/${locale}/${namespace}.json`
    );
    return response.json();
  },
  ['translations'],
  {
    revalidate: 3600,  // 1 hour cache
    tags: ['translations'],
  }
);

// Invalidate on translation update
export async function invalidateTranslationCache() {
  revalidateTag('translations');
}
```

---

## Phase 2: String Extraction (Weeks 2-4)

### 2.1 Extraction Pattern

Since `I18nWrapper` always renders (forcing English when `msp-i18n-enabled` is off), `t()` calls always return proper English text. **No feature flag conditionals needed in components.**

```typescript
// BEFORE - Hardcoded
<h1>Welcome to Your MSP Command Center</h1>
<button>Save Changes</button>

// AFTER - Direct t() usage (no feature flag wrapper needed)
const { t } = useTranslation('msp/dashboard');

<h1>{t('welcome.title')}</h1>
<button>{t('actions.save')}</button>
```

> **Note**: Tab labels in `CustomTabs` are now fully translatable — Phase 0.8 is complete. Use `t()` for `label` and stable kebab-case strings for `id`.

### 2.2 Batch Priority Order

**Phase 2a: Extract shared features from clientPortal.json (existing translations)**

These already have translations in all 7 languages - just need to restructure.

| Batch | Namespace | Keys | Source | Priority |
|-------|-----------|------|--------|----------|
| 2a-1 | features/tickets | ~150 | clientPortal.json | CRITICAL |
| 2a-2 | features/documents | ~190 | clientPortal.json | CRITICAL |
| 2a-3 | features/billing | ~150 | clientPortal.json | HIGH |
| 2a-4 | features/projects | ~100 | clientPortal.json | HIGH |
| 2a-5 | features/appointments | ~140 | clientPortal.json | HIGH |
| 2a-6 | features/profile | ~100 | clientPortal.json | MEDIUM |
| 2a-7 | features/notifications | ~50 | clientPortal.json | MEDIUM |

**Phase 2b: Create MSP-only namespaces (new extractions from hardcoded strings)**

> **Revised estimates (2026-03-20):** Component-level scan revealed contracts/billing and workflows
> are far larger than originally estimated. Contracts/billing needs sub-batching; workflows is EE-heavy.

| Batch | Namespace | Est. Keys | Files | Components | Priority | Status |
|-------|-----------|-----------|-------|------------|----------|--------|
| 2b-1 | msp/core | 150 | 10 | Nav, sidebar, header, banners, quick-create, dialogs | CRITICAL | ✅ DONE |
| 2b-2 | msp/dashboard | 89 | 5 | Dashboard, widgets, onboarding checklist, step definitions | HIGH | ✅ DONE |
| 2b-3 | msp/time-entry | ~275-300 | 34 | Time entry, timesheet, approvals, intervals | HIGH | |
| 2b-4 | msp/contracts + billing (6 sub-batches) | ~2,495 | 113 | Contracts, lines, quotes, invoicing, service catalog, credits | HIGH | |
| 2b-5 | msp/dispatch | ~120-150 | 13 | Technician dispatch, scheduling grid, work items | MEDIUM | |
| 2b-6 | msp/settings | 769 | 32 | Settings components | MEDIUM | ✅ DONE |
| 2b-7 | msp/reports | ~180-220 | 4 | Contract reports, revenue, performance, usage | MEDIUM | |
| 2b-8 | msp/admin | ~140-180 | 4 | Telemetry settings, email admin, diagnostics | LOW | |
| 2b-9 | msp/workflows (5 sub-batches) | ~3,980 | 105 | Workflow designer, automation hub, tasks, user-activities (EE) | LOW | |
| 2b-10 | msp/clients | ~900 | 36 | Client list, client form, billing config, contract management | HIGH | |
| 2b-11 | msp/contacts | ~450 | 15 | Contact list, details, editor, phone numbers | HIGH | |
| 2b-12 | msp/assets | ~1,200 | 40 | Asset form, details, dashboard, documents, patch status, RMM | HIGH | |
| 2b-13 | msp/surveys | ~780 | 26 | Survey dashboard, triggers, templates, response analytics | MEDIUM | |
| 2b-14 | msp/schedule | ~400 | 11 | Schedule calendar, grid, availability editor | MEDIUM | |
| 2b-15 | msp/knowledge-base | ~380 | 12 | KB article editor, categories, search, review queue | MEDIUM | |
| 2b-16 | msp/onboarding | ~600 | 14 | Onboarding wizard steps, team setup, billing setup | HIGH | |
| 2b-17 | msp/jobs | ~220 | 7 | Job metrics, recent jobs table, job details | LOW | |
| 2b-18 | msp/email-logs | ~140 | 1 | Email log data table, status badges | LOW | |
| 2b-19 | msp/profile | ~160 | 5 | User profile, account settings | MEDIUM | |
| 2b-20 | msp/extensions + misc | ~200 | 10 | Extensions, licenses, platform updates, security settings | LOW | |

#### Batch 2b-4 sub-batch breakdown (contracts/billing)

> **Revised 2026-03-20** after reading actual component files. Original estimate (~5,500-6,500) was ~2.5x too high.
> Real total: **~2,495 strings across 113 files**. Detailed plan: `docs/plans/2026-03-20-msp-i18n-contracts-billing/`

| Sub-batch | Namespace | Est. Keys | Files | Key components |
|-----------|-----------|-----------|-------|----------------|
| 2b-4a | msp/contracts | ~610 | 26 | ContractDetail, ContractDialog, ContractTemplateDetail, ContractWizard, wizard steps |
| 2b-4b | msp/contract-lines | ~1,000 | 24 | ContractLineDialog (180), CreateCustomContractLineDialog (177), Hourly/Fixed/Usage configs |
| 2b-4c | msp/quotes | ~145 | 10 | QuoteDetail, QuoteForm, QuoteLineItemsEditor |
| 2b-4d | msp/invoicing | ~240 | 16 | DraftsTab, FinalizedTab, InvoiceTemplateEditor, tax import/reconciliation |
| 2b-4e | msp/service-catalog | ~350 | 25 | ServiceCatalogManager, ServiceTypeSettings, TaxRates, ProductsManager |
| 2b-4f | msp/billing-misc | ~150 | 12 | CreditManagement, CreditReconciliation, UsageTracking, AccountingExportsTab |

#### Recommended execution order (all remaining batches)

| Order | Batch | Keys | Files | Plan |
|-------|-------|------|-------|------|
| 1-4 | 2b-5, 2b-7, 2b-8, 2b-3 | ~503 | 54 | `docs/plans/2026-03-20-msp-i18n-dispatch-reports-admin-time/` |
| 5-7 | 2b-10, 2b-11, 2b-12 | ~2,550 | 91 | `docs/plans/2026-03-20-msp-i18n-clients-assets-onboarding/` |
| 8 | 2b-16 (onboarding) | ~600 | 14 | (same plan) |
| 9-10 | 2b-4c, 2b-4f (quotes, billing-misc) | ~295 | 22 | `docs/plans/2026-03-20-msp-i18n-contracts-billing/` |
| 11-12 | 2b-4d, 2b-4e (invoicing, service-catalog) | ~590 | 41 | (same plan) |
| 13-14 | 2b-4a, 2b-4b (contracts, contract-lines) | ~1,610 | 50 | (same plan) |
| 15-16 | 2b-13, 2b-14 (surveys, schedule) | ~428 | 37 | `docs/plans/2026-03-20-msp-i18n-remaining/` |
| 17 | 2b-15 (knowledge-base) | ~189 | 10 | (same plan) |
| 18 | 2b-19 (profile) | ~64 | 8 | (same plan) |
| 19 | 2b-17, 2b-18 (jobs, email-providers) | ~165 | 17 | (same plan) |
| 20 | 2b-20 (extensions, licensing) | 0 | 0 | Closed — no user-visible strings |
| 21 | 2b-9 (workflows, 5 sub-batches) | ~3,980 | 105 | `docs/plans/2026-03-20-msp-i18n-workflows/` |

**Phase 2c: Extract client-portal UI chrome (minimal)**

| Batch | Namespace | Keys | Source | Priority |
|-------|-----------|------|--------|----------|
| 2c-1 | client-portal/core | ~50 | clientPortal.json (nav) | HIGH |
| 2c-2 | client-portal/dashboard | ~40 | clientPortal.json | MEDIUM |
| 2c-3 | client-portal/auth | ~100 | clientPortal.json | MEDIUM |

### 2.3 Key Naming Convention

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
  "messages": {
    "success": {
      "created": "Successfully created",
      "updated": "Successfully updated"
    },
    "error": {
      "createFailed": "Failed to create"
    }
  },
  "dialogs": {
    "confirmDelete": {
      "title": "Confirm Deletion",
      "message": "Are you sure you want to delete this item?",
      "confirm": "Delete",
      "cancel": "Cancel"
    }
  }
}
```

### 2.4 Extraction Script

```typescript
// scripts/extract-strings.ts
// Run: npx ts-node scripts/extract-strings.ts server/src/components/billing

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

interface ExtractedString {
  file: string;
  line: number;
  text: string;
  context: string;
  suggestedKey: string;
}

function extractStringsFromFile(filePath: string): ExtractedString[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true
  );

  const strings: ExtractedString[] = [];

  function visit(node: ts.Node) {
    // Extract JSX text content
    if (ts.isJsxText(node) && node.text.trim()) {
      strings.push({
        file: filePath,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: node.text.trim(),
        context: getParentContext(node),
        suggestedKey: generateKey(node.text.trim()),
      });
    }

    // Extract string literals in JSX attributes
    if (ts.isStringLiteral(node)) {
      const parent = node.parent;
      if (ts.isJsxAttribute(parent)) {
        const attrName = parent.name.getText();
        if (['title', 'placeholder', 'aria-label', 'alt'].includes(attrName)) {
          strings.push({
            file: filePath,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            text: node.text,
            context: `${attrName} attribute`,
            suggestedKey: generateKey(node.text),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return strings;
}

// Usage: Generate JSON from extracted strings
function generateNamespaceJson(strings: ExtractedString[]): object {
  const result: Record<string, any> = {};

  for (const str of strings) {
    const keys = str.suggestedKey.split('.');
    let current = result;

    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = current[keys[i]] || {};
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = str.text;
  }

  return result;
}
```

---

## Phase 3: Component Migration (Weeks 4-8)

### 3.1 Migration Helper Hook

```typescript
// server/src/hooks/useMspTranslation.ts - NEW
import { useTranslation } from '@/lib/i18n/client';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';

interface MspTranslationOptions {
  namespace: string;
  fallbacks?: Record<string, string>;  // Key -> hardcoded fallback
}

export function useMspTranslation({ namespace, fallbacks = {} }: MspTranslationOptions) {
  const { enabled: i18nEnabled } = useFeatureFlag('msp-i18n-enabled');
  const { t: translate, ...rest } = useTranslation(namespace);

  // Smart translation function with fallback
  const t = (key: string, fallback?: string): string => {
    if (!i18nEnabled) {
      return fallback || fallbacks[key] || key;
    }
    return translate(key, { defaultValue: fallback || fallbacks[key] });
  };

  return { t, i18nEnabled, ...rest };
}

// Usage in component:
const { t } = useMspTranslation({
  namespace: 'msp/billing',
  fallbacks: {
    'page.title': 'Billing Dashboard',
    'tabs.invoices': 'Invoices',
  }
});
```

### 3.2 Component Migration Template

```typescript
// Example: BillingDashboard.tsx migration

// STEP 1: Import translation hook
import { useMspTranslation } from '@/hooks/useMspTranslation';

// STEP 2: Define fallbacks (copy from existing hardcoded strings)
const FALLBACKS = {
  'page.title': 'Billing',
  'tabs.contracts': 'Contracts',
  'tabs.invoices': 'Invoices',
  'tabs.credits': 'Credit Management',
  'actions.generate': 'Generate Invoice',
  'messages.error.loadFailed': 'Failed to load billing data',
} as const;

// STEP 3: Use in component
export function BillingDashboard() {
  const { t } = useMspTranslation({
    namespace: 'msp/billing',
    fallbacks: FALLBACKS,
  });

  return (
    <div>
      <h1>{t('page.title')}</h1>
      <Tabs>
        <Tab label={t('tabs.contracts')} />
        <Tab label={t('tabs.invoices')} />
        <Tab label={t('tabs.credits')} />
      </Tabs>
    </div>
  );
}
```

### 3.3 Migration Checklist Per Component

- [ ] Import `useMspTranslation` hook
- [ ] Define FALLBACKS object with all hardcoded strings
- [ ] Replace hardcoded strings with `t('key')` calls
- [ ] Update toast messages to use translations
- [ ] Update error messages to use translations
- [ ] Update aria-labels and accessibility text
- [ ] Add translations to namespace JSON file
- [ ] Test with flag OFF (should show English fallbacks)
- [ ] Test with flag ON (should show translations)

---

## Phase 4: Internal User Settings (Week 8-9)

### 4.1 Enable Language Preference for MSP Users

```typescript
// server/src/lib/actions/auth/getHierarchicalLocale.ts - MODIFY
export async function getHierarchicalLocaleAction(): Promise<SupportedLocale> {
  const session = await getServerSession(options);

  if (!session?.user) {
    return getLocaleFromCookie() || 'en';
  }

  const user = session.user;

  // For internal users, check feature flag
  if (user.user_type === 'internal') {
    const mspI18nEnabled = await featureFlags.isEnabled('msp-i18n-enabled', {
      userId: user.id,
      tenantId: user.tenant,
    });

    if (!mspI18nEnabled) {
      return 'en';  // Force English when flag is off
    }
  }

  // Continue with normal hierarchical resolution
  // 1. User preference
  // 2. Tenant default
  // 3. Cookie
  // 4. System default
}
```

### 4.2 Add Language Setting to User Profile

```typescript
// server/src/components/settings/UserProfile.tsx - ADD
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { LanguagePreference } from '@/components/i18n/LanguagePreference';

export function UserProfile() {
  const { enabled: mspI18nEnabled } = useFeatureFlag('msp-i18n-enabled');

  return (
    <div>
      {/* Existing profile fields */}

      {mspI18nEnabled && (
        <section>
          <h3>Language Preference</h3>
          <LanguagePreference
            portal="msp"
            showDescription
          />
        </section>
      )}
    </div>
  );
}
```

---

## Phase 5: Notifications & Emails (Week 9-10)

### 5.1 Localized Internal Notifications

```typescript
// server/src/lib/notifications/internalNotificationActions.ts - MODIFY
async function getNotificationLocale(userId: string): Promise<SupportedLocale> {
  const mspI18nEnabled = await featureFlags.isEnabled('msp-i18n-enabled');

  if (!mspI18nEnabled) {
    return 'en';
  }

  // Get user's language preference
  const { knex, tenant } = await createTenantKnex();
  const user = await knex('users')
    .where({ user_id: userId, tenant })
    .first();

  return user?.preferences?.locale || 'en';
}
```

### 5.2 Database Migration for Polish Templates

```typescript
// ee/server/migrations/YYYYMMDD_add_polish_notification_templates.ts
export async function up(knex: Knex): Promise<void> {
  // Copy English templates to Polish
  const englishTemplates = await knex('internal_notification_templates')
    .where('language_code', 'en');

  const polishTemplates = englishTemplates.map(t => ({
    ...t,
    template_id: undefined,  // Generate new ID
    language_code: 'pl',
    // TODO: Replace with actual Polish translations
  }));

  await knex('internal_notification_templates').insert(polishTemplates);
}
```

---

## Phase 6: Translation Workflow (Ongoing)

### 6.1 Translation File Validation

```typescript
// scripts/validate-translations.ts
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = 'server/public/locales';
const REFERENCE_LOCALE = 'en';

function validateTranslations(): void {
  const locales = fs.readdirSync(LOCALES_DIR);
  const referenceLocale = REFERENCE_LOCALE;

  for (const locale of locales) {
    if (locale === referenceLocale) continue;

    const namespaces = fs.readdirSync(path.join(LOCALES_DIR, referenceLocale));

    for (const namespace of namespaces) {
      const refPath = path.join(LOCALES_DIR, referenceLocale, namespace);
      const targetPath = path.join(LOCALES_DIR, locale, namespace);

      if (!fs.existsSync(targetPath)) {
        console.error(`Missing: ${targetPath}`);
        continue;
      }

      const refKeys = getAllKeys(JSON.parse(fs.readFileSync(refPath, 'utf-8')));
      const targetKeys = getAllKeys(JSON.parse(fs.readFileSync(targetPath, 'utf-8')));

      const missing = refKeys.filter(k => !targetKeys.includes(k));
      const extra = targetKeys.filter(k => !refKeys.includes(k));

      if (missing.length > 0) {
        console.warn(`${locale}/${namespace}: Missing ${missing.length} keys`);
      }
      if (extra.length > 0) {
        console.warn(`${locale}/${namespace}: Extra ${extra.length} keys`);
      }
    }
  }
}
```

### 6.2 CI/CD Integration

```yaml
# .github/workflows/translations.yml
name: Translation Validation

on:
  pull_request:
    paths:
      - 'server/public/locales/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate JSON syntax
        run: |
          for file in server/public/locales/**/*.json; do
            jq empty "$file" || exit 1
          done

      - name: Check for missing keys
        run: npx ts-node scripts/validate-translations.ts

      - name: Check for duplicate keys
        run: npx ts-node scripts/check-duplicate-keys.ts
```

### 6.3 Translation Management Options

| Option | Pros | Cons | Cost |
|--------|------|------|------|
| **Manual JSON editing** | Simple, no vendor lock-in | Error-prone, no workflow | Free |
| **Crowdin** | GitHub sync, in-context editing | Subscription | $50-200/mo |
| **Lokalise** | CLI tools, screenshots | Subscription | $120-400/mo |
| **Weblate** | Self-hosted option, free tier | Setup complexity | Free-$100/mo |
| **AI + Human review** | Fast, cost-effective | Quality varies | ~$0.02/word |

**Recommendation**: Start with AI translation (GPT-4/Claude) + human review for Polish, then evaluate Crowdin for ongoing maintenance.

---

## Phase 7: Cleanup & Rollout (Week 10-12)

### 7.1 Remove Hybrid Code

Once fully rolled out, remove the feature flag checks:

```typescript
// BEFORE (during migration)
const { enabled: i18nEnabled } = useFeatureFlag('msp-i18n-enabled');
const label = i18nEnabled ? t('fields.hours') : 'Hours';

// AFTER (cleanup)
const { t } = useTranslation('msp/time');
const label = t('fields.hours');
```

### 7.2 Rollout Strategy

```
Week 10: Internal testing (your tenant, flag ON)
         - Test all MSP features in Polish and English
         - Fix any issues found

Week 11: Beta tenants (opt-in, 5-10 tenants)
         - Enable flag for beta tenants
         - Gather feedback

Week 12: Gradual rollout
         - 10% of tenants -> Monitor for issues
         - 50% of tenants -> Monitor for issues
         - 100% of tenants -> Flag becomes permanent ON

Week 13: Cleanup
         - Remove feature flag checks from code
         - Remove fallback strings
         - Simplify useMspTranslation hook
```

---

## Appendix A: File Inventory

### Components Requiring Translation (Top Priority)

| File | Hardcoded Strings | Namespace |
|------|-------------------|-----------|
| `Dashboard.tsx` | ~25 | msp/dashboard |
| `BillingDashboard.tsx` | ~40 | msp/billing |
| `InvoiceList.tsx` | ~30 | msp/billing |
| `ContractList.tsx` | ~35 | msp/billing |
| `TicketList.tsx` | ~25 | msp/tickets |
| `TicketDetails.tsx` | ~40 | msp/tickets |
| `ProjectBoard.tsx` | ~30 | msp/projects |
| `TimeEntryForm.tsx` | ~20 | msp/time |
| `SettingsLayout.tsx` | ~15 | msp/settings |

### Namespace Key Estimates (Revised Structure)

**Shared Features (used by both portals - no duplication)**

| Namespace | Est. Keys | Source | Status |
|-----------|-----------|--------|--------|
| common.json | ~400 | Existing + enhanced | Exists |
| features/tickets | ~150 | Extract from clientPortal | To extract |
| features/documents | ~190 | Extract from clientPortal | To extract |
| features/projects | ~100 | Extract from clientPortal | To extract |
| features/billing | ~150 | Extract from clientPortal | To extract |
| features/appointments | ~140 | Extract from clientPortal | To extract |
| features/notifications | ~50 | Extract from clientPortal | To extract |
| features/contacts | ~80 | New | To create |
| features/profile | ~100 | Extract from clientPortal | To extract |
| features/assets | ~100 | New | To create |
| **Subtotal (shared)** | **~1,460** | | |

**Client Portal UI Chrome Only**

| Namespace | Est. Keys | Source | Status |
|-----------|-----------|--------|--------|
| client-portal/core | ~50 | Extract from clientPortal (nav) | To extract |
| client-portal/dashboard | ~40 | Extract from clientPortal | To extract |
| client-portal/auth | ~100 | Extract from clientPortal | To extract |
| **Subtotal (client)** | **~190** | | |

**MSP Portal Only (features not in client portal)**

> **Revised 2026-03-20** after component-level scan. Contracts/billing and workflows were
> severely underestimated in the original plan.

| Namespace | Est. Keys | Files | Source | Status |
|-----------|-----------|-------|--------|--------|
| msp/core | 150 | 10 | Extraction complete | ✅ Done |
| msp/dashboard | 89 | 5 | Extraction complete | ✅ Done |
| msp/settings | 769 | 32 | Extraction complete | ✅ Done |
| msp/time-entry | ~275-300 | 34 | New extraction | To create |
| msp/dispatch | ~120-150 | 13 | New extraction | To create |
| msp/reports | ~180-220 | 4 | New extraction | To create |
| msp/admin | ~140-180 | 4 | New extraction | To create |
| msp/contracts | ~800-1,000 | ~31 | New extraction | To create |
| msp/contract-lines | ~600-800 | ~15 | New extraction | To create |
| msp/quotes | ~300-400 | ~10 | New extraction | To create |
| msp/invoicing | ~400-500 | ~6 | New extraction | To create |
| msp/service-catalog | ~300-400 | ~20 | New extraction | To create |
| msp/billing-misc | ~200-300 | ~20 | New extraction | To create |
| msp/workflows (5 sub-namespaces) | ~3,980 | 105 | Partial + new (EE) | Partially exists |
| msp/clients | ~1,000-2,100 | 32 | New extraction | To create |
| msp/contacts | ~650-1,350 | 13 | New extraction | To create |
| msp/assets | ~1,100-2,200 | 39 | New extraction | To create |
| msp/onboarding (wizard) | ~550-1,100 | 8 | New extraction | To create |
| msp/surveys | ~780 | 26 | New extraction | To create |
| msp/schedule | ~400 | 11 | New extraction | To create |
| msp/knowledge-base | ~380 | 12 | New extraction | To create |
| msp/jobs | ~220 | 7 | New extraction | To create |
| msp/email-logs | ~140 | 1 | New extraction | To create |
| msp/profile | ~160 | 5 | New extraction | To create |
| msp/extensions + misc | ~200 | 10 | New extraction | To create |
| **Subtotal (MSP)** | **~12,500** | | | |

**Grand Total: ~14,150 unique keys** (up from original ~3,250 estimate)

Benefits of this structure:
- **Shared features** used by both portals (~1,460 keys)
- **Client-only** UI chrome (~190 keys)
- **MSP-only** features (~12,500 keys — bulk of the work)
- **Zero duplication** — no keys repeated between namespaces

---

## Appendix B: Polish Translation Resources

### Professional Translation Services
- **Gengo**: ~$0.06/word, 24-48h turnaround
- **One Hour Translation**: ~$0.08/word, same-day available
- **Local freelancers (Upwork)**: ~$0.03-0.05/word

### AI-Assisted Translation Workflow
1. Export English JSON files
2. Use GPT-4/Claude to generate initial Polish translations
3. Have native speaker review and correct
4. Import reviewed translations

### Polish-Specific Considerations
- **Grammatical gender**: Polish has masculine, feminine, neuter
- **Plural forms**: Polish has complex plural rules (1, 2-4, 5+)
- **Formal/informal**: Use formal "Pan/Pani" in UI
- **Date format**: DD.MM.YYYY
- **Number format**: 1 234,56 (space as thousand separator, comma as decimal)

```typescript
// i18next plural rules for Polish
{
  "items": "{{count}} element",
  "items_few": "{{count}} elementy",     // 2-4
  "items_many": "{{count}} elementow"   // 5+
}
```

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Translation coverage | 100% | Automated script |
| Missing key errors | 0 | Sentry monitoring |
| User language adoption | >20% non-English | Analytics |
| Translation quality | >4.5/5 | User surveys |
| Page load impact | <50ms | Performance monitoring |

---

## Timeline Summary

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1 | Phase 0.1-0.3 | Polish config, feature flag, fix duplicate keys |
| 1 | Phase 0.7 | **CRITICAL**: Fix technical gaps (I18nWrapper in MSP, lazy loading) |
| 1-2 | Phase 0.4-0.6 | Namespace structure, extraction scripts |
| 2-3 | Phase 2a | Extract shared features from clientPortal.json |
| 3-6 | Phase 2b | Extract MSP-only strings (msp/core, dashboard, time-entry, contracts) |
| 6-8 | Phase 3 | Component migration (batched by priority) |
| 8-9 | Phase 4 | User language settings for MSP users |
| 9-10 | Phase 5 | Localized notifications, email templates with locale resolution |
| 10-12 | Phase 7 | Gradual rollout, cleanup |

**Total estimated effort**: 10-12 weeks

**Key milestones:**
- Week 1: I18nWrapper added to MSP layout, lazy loading fixed, Polish config added
- Week 2: Namespace restructuring complete
- Week 3: Shared features extracted (tickets, documents, projects, billing, appointments)
- Week 6: Critical MSP namespaces complete
- Week 9: Internal notifications and emails use user locale preferences
- Week 10: Full rollout begins

**Completed:**
- ✅ Phase 0.1: Polish language support (config + translation files)
- ✅ Phase 0.3: MSP feature flag (`msp-i18n-enabled`)
- ✅ Phase 0.7: All technical gaps (I18nWrapper in MSP layout, lazy loading, route-aware namespaces, email locale resolution)
- ✅ Phase 0.8: CustomTabs refactoring (id/label separation, all components migrated)
- ✅ Batch 2b-1: msp/core (150 keys — nav, sidebar, header, banners, quick-create, dialogs)
- ✅ Batch 2b-2: msp/dashboard (89 keys — welcome banners, feature cards, onboarding checklist)
- ✅ Batch 2b-6: msp/settings (769 keys, 32 components)
- ✅ Batch 2b-21a: MSP tickets migration (`features/tickets` now 887 English leaf strings; 23 previously unwired MSP ticket components wired, plus `/msp/settings` and `/msp/service-requests` namespace coverage)

**Next:** Phase 2b string extraction — quick wins first (dispatch → reports → admin → time-entry), then contracts/billing sub-batches, then workflows

**Revised total MSP-only estimate:** ~13,500 keys (done: ~1,008; planned: ~7,480; newly discovered: ~5,510)

TODO: plan to add language selector on onboarding wizard first page
