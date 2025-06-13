# SoftwareOne ↔ Alga PSA Extension

Expanded Functional Specification & End‑to‑end Implementation Plan (v1.0‑draft)

**Last Updated**: 2025-01-10  
**Current Status**: Extension created but not visible in UI - debugging in progress

⸻

## 1. Scope recap

Topic    Goal
Purpose    Allow MSPs that use Alga PSA to see, activate and bill SoftwareOne agreements & statements without leaving Alga.
MVP target    Read‑only listing + detail views, manual "Activate Agreement", push agreements into Alga Billing.
Stretch    Editable local‑markup, self‑service exposure to customer portal, scheduled auto‑sync.

⸻

## 2. Current Implementation Status

### ✅ Completed Tasks

#### Phase 0 - Project Setup
- ✅ Created extension structure at `/extensions/softwareone-ext/`
- ✅ Added package.json with dependencies (axios, etc.)
- ✅ Added TypeScript configuration

#### Phase 1 - Platform Plumbing (Partial)
- ✅ **1.1 Manifest & permissions** - Created comprehensive manifest with all required components
- ✅ **1.3 Basic API client** - Created `src/api/softwareOneClient.ts`
- ✅ **1.4 Sync handler** - Created `src/handlers/runSync.ts`
- ✅ **1.5 React-query wrapper** - Created `src/hooks/useSwoneQuery.ts`

#### Phase 3 - Component Structure (Structure Only)
- ✅ Created `AgreementsList.tsx` component structure
- ✅ Created `AgreementDetail.tsx` component structure
- ✅ Created `activateAgreement` handler structure

### ❌ Not Completed / Issues

#### Critical Issues
- **Extension Not Loading** - Menu item not visible despite setup
- **ExtensionRenderer** - Only placeholder implementation exists
- **Component Loading** - No mechanism to serve extension JavaScript

#### Phase 1 - Platform Plumbing
- ❌ **1.2 Storage namespaces** - ExtensionStorageService integration not implemented

#### Phase 2 - Settings UX
- ❌ Actual settings storage/retrieval
- ❌ Test connection functionality
- ❌ Encryption of API tokens

#### Phase 3-6
- ❌ All actual functionality (only structure created)

### ⚠️ Unplanned Changes Made

1. **Debug Infrastructure** (should be removed)
   - `/api/extensions/navigation-debug.ts` - Debug endpoint
   - `/api/extensions/fix-navigation-slot.ts` - Temporary fix
   - `/pages/debug-extensions.tsx` - Debug UI page

2. **Inappropriate Files**
   - Source files duplicated in `server/public/extensions/`
   - Standalone placeholder pages that bypass extension system

3. **Core System Changes**
   - Modified layout with ExtensionProvider
   - Created DynamicNavigationSlot components
   - These should be separate from extension work

⸻

## 3. Mapping rough design → Alga Client‑Extension primitives

Rough‑design element    Alga extension point    Notes
"SoftwareOne" item in main sidebar    navigation extension (manifest extensionPoints.ui.navItems)    Already supported in v1 framework.
Settings > SoftwareOne 3‑tab page    custom page (extensionPoints.ui.pages) routed to /settings/softwareone    Settings "slot" doesn't exist yet; we ship complete page under Settings category & link to it from nav.
Agreements & Statements pages    custom pages with own internal routes /softwareone/agreements etc.    Use Alga layout components for coherent look.
Lists with sortable columns    Use context.uiComponents.DataGrid.    
Agreement detail with 6 tabs    Rendered inside one custom page; implement inner tab strip via Radix Tabs (already bundled in Alga UI lib).    
Activation popup, edit dialog    context.uiComponents.Dialog.    
API polling / caching    ExtensionStorageService + Redis caching (phase 1.5 finished).    
Background nightly sync    deficiency – no scheduler yet (see §7). For MVP run on‑demand "Refresh" button; later use global Cron service once core provides it.    

⸻

## 4. High‑level architecture

SoftwareOne REST API
        ▲
        │   (token, endpoint configured per tenant)
┌─────────────────────┐
│   swone-api-client  │  (under src/handlers/)
└─────────┬───────────┘
          │ normalized DTOs
┌─────────▼───────────┐
│  Sync service       │   - pull Accounts, Agreements, Subs, Orders, Stmts<br>- map to Agreement model (see §4) <br>- cache raw JSON for 15 min
└─────────┬───────────┘
          │ stores
┌─────────▼───────────┐
│  ExtensionStorage   │   tenant‑scoped, namespace `swone` (phase 1.5)  
└─────────┬───────────┘
          │ React query hooks
┌─────────▼───────────┐
│  UI pages/components│   SettingsPage, AgreementsList, AgreementDetail, Statements…  
└─────────────────────┘

⸻

## 5. Data model translation

SoftwareOne field    Agreement interface field (ext.local alias)    Type
agreementId    id    string
agreementName    name    string
productName    product    string
vendorName    vendor    string
billingConfigId    billingConfigId    string
contractCurrency    currency    string
spxYear    spxy    number
marginRpxy    marginRpxy    number
consumer (id)    consumer    string
ops visibility    operations    enum
status    status    enum

Stored verbatim JSON from SoftwareOne under storage.set('swone/raw/agreements', …) for debugging.

⸻

## 6. Extension manifest skeleton

```json
{
  "id": "com.alga.softwareone",
  "name": "SoftwareOne Integration",
  "version": "0.1.0",
  "description": "Browse & bill SoftwareOne agreements inside Alga PSA",
  "minAppVersion": "1.5.0",
  "tenantMode": "specific",
  "main": "dist/index.js",
  "permissions": {
    "api": [
      "companies:read",          // link consumer->company
      "invoices:write",          // create draft invoice rows (phase 2)
      "settings:read", "settings:write"
    ],
    "ui": { "navigation": ["main"], "dashboards": [] }
  },
  "extensionPoints": {
    "ui": {
      "navItems": [{
        "id": "swone-main-nav",
        "displayName": "SoftwareOne",
        "icon": "CloudIcon",
        "component": "dist/components/NavItem.js",
        "permissions": []
      }],
      "pages": [
        { "id": "swone-settings",   "path": "/settings/softwareone",     "displayName": "SoftwareOne", "component": "dist/pages/SettingsPage.js" },
        { "id": "swone-agreements", "path": "/softwareone/agreements",   "displayName": "Agreements",  "component": "dist/pages/AgreementsList.js" },
        { "id": "swone-statements", "path": "/softwareone/statements",   "displayName": "Statements",  "component": "dist/pages/StatementsList.js" },
        { "id": "swone-agreement",  "path": "/softwareone/agreement/:id","displayName": "Agreement",   "component": "dist/pages/AgreementDetail.js", "permissions": [] }
      ]
    },
    "api": {
      "endpoints": [
        { "id": "sync", "path": "/sync", "method": "POST", "handler": "dist/handlers/runSync.js" }
      ]
    }
  },
  "configurationSchema": {
    "type": "object",
    "properties": {
      "apiEndpoint": { "type": "string" },
      "apiToken":    { "type": "string" }
    },
    "required": ["apiEndpoint", "apiToken"]
  }
}
```

Key relationships to the extension‑system docs:
    •    Navigation & Custom Pages use Phase 2.2 and 2.3 features – already available.
    •    Settings page is simply another page under the /settings subtree; no special slot is yet provided.
    •    Endpoint under /api/extensions/com.alga.softwareone/sync relies on Phase 3.1 simple custom API endpoints.

⸻

## 7. Work‑break‑down (detailed) - WITH CURRENT STATUS

### Phase 0 – Project setup (½ day) ✅ COMPLETE
    1. ✅ alga-extension create softwareone-ext
    2. ✅ Add libs: axios, react-query
    3. ✅ Add ts‑path aliases @swone/api, @swone/components.

### Phase 1 – Platform plumbing (2 days) ⚠️ PARTIAL

Task    Owner    Details    Status
1.1 Manifest & permissions    Lead dev    Fill template above; validate with alga-extension validate.    ✅ Complete
1.2 Storage namespaces    Back‑end dev    context.storage.getNamespace('swone') for all caches.    ❌ Not implemented
1.3 Basic API client    Back‑end dev    src/api/softwareOneClient.ts wraps axios with header Authorization: Bearer.    ✅ Structure created
1.4 Sync handler    Back‑end dev    runSync — fetch /agreements, /statements; map & store; support ?full=true.    ✅ Structure created
1.5 React‑query wrapper    Front‑end dev    useSwoneQuery(key, fn) auto invalidates on activation/edit.    ✅ Structure created

### Phase 2 – Settings UX (1 day) ⚠️ PARTIALLY IMPLEMENTED
    1. ✅ Build SettingsPage with Alga Input, Tab, Alert - Full UI implemented with Formik, Tabs
    2. ⚠️ Save creds to storage.set('config', …) - Using localStorage mock, encryption not implemented
    3. ⚠️ "Test connection" button uses API client - UI ready, needs actual API implementation

### Phase 3 – Agreements list & detail (3 days) ⚠️ STRUCTURE ONLY

Component    Details    Status
AgreementsList    DataGrid columns per spec; row click routes to detail.    ✅ Structure, ❌ Implementation
AgreementDetail    Radix TabRoot with SoftwareOne / Subscriptions / Orders / Consumer / Billing / Details; each a functional component loading lazy data.    ✅ Structure, ❌ Implementation
Edit dialog    Formik + Alga UI Dialog; updates Agreement.localConfig then storage.set.    ❌ Not implemented
Activate workflow    Calls /api/extensions/.../activateAgreement handler → PATCH SoftwareOne API → updates cache.    ✅ Handler structure

### Phase 4 – Statements (1.5 days) ❌ NOT IMPLEMENTED

Similar pattern: list grid + detail with Charges tab. Use virtual scroll for big datasets.

### Phase 5 – Billing injection (stretch, 2 days) ❌ NOT STARTED
    •    Map SoftwareOne statement lines → Alga Plan Service lines.
    •    Use invoices:write API to append lines to next draft invoice.

### Phase 6 – Quality & docs (1 day) ❌ NOT STARTED
    •    Unit tests of API client with mocked axios.
    •    Cypress smoke path: settings→list→detail→activate.
    •    README.md usage notes + screenshots.

Total MVP: ≈ 10 person‑days (2 devs for one sprint).

⸻

## 8. Identified gaps / deficiencies in current client‑extension system

### ⚠️ NEW: Critical Implementation Issues Found

Gap    Impact on this extension    Current State    Resolution
ExtensionRenderer placeholder only    Cannot load actual extension components    The ExtensionRenderer shows placeholder UI instead of loading extension JavaScript    ✅ FIXED - Updated to load actual components
No component serving mechanism    Extension JS files cannot be delivered to browser    Need API endpoint to serve extension component files    ✅ FIXED - Created `/api/extensions/[extensionId]/components/[...path].ts`
Extension initialization unclear    Extension may not be loading on startup    Need to verify extension loader is running    ⚠️ Still needs verification

### Original Gaps Still Apply:

Gap    Impact on this extension    Possible mitigation / request
No secure‑at‑rest encryption in ExtensionStorage (deferred in 1.5)    API token is sensitive.    Short‑term: obfuscate token (base64) and rely on DB security; long‑term: prioritise 1.5 "encryption at rest".
No scheduled/background jobs    Automated nightly sync cannot run.    Provide "Sync now" button and fetch lazily on page open. Ask core team to expose simple cron in Phase 3.
RBAC integration (1.8) still WIP    Cannot yet create fine‑grained "view agreements" permission.    Gate UI via Alga roles (admin/finance) for MVP; migrate once 1.8 lands.
Extension Admin UI not finished (1.7)    Tenant admins must install via CLI for now.    Document manual .algaext upload; extension still works.
Entity‑page extension slots missing    Nice‑to‑have: show Agreement under native Company view.    Out of scope MVP; revisit when entity‑slot arrives.
Scheduler hooks for billing cycle    Auto‑post SoftwareOne charges to weekly Alga invoice generation.    Tie into Alga workflow once exposed, else manual "Import statements" action.

⸻

## 9. Security & compliance checklist
    •    Store token in tenant‑scoped storage key swone/config (isolation via RLS).
    •    Use only outbound HTTPS; respect 429 rate‑limits with exponential back‑off.
    •    Log only opaque IDs; redact token in logs (context.logger).
    •    Provide SHA256 signature and developer certificate when packaging (per security_signing.md).

⸻

## 10. Deliverables
    1.    Source repo softwareone-ext/ with TypeScript, tests, lint.
    2.    Packaged com.alga.softwareone-0.1.0.algaext.
    3.    Admin quick‑start guide (install, configure, first sync).
    4.    Architecture diagram (draw.io) – optional.

⸻

## 11. Clean-up Tasks Required

### Remove Debug/Temporary Code:
1. ✅ Remove `/api/extensions/navigation-debug.ts`
2. ✅ Remove `/api/extensions/fix-navigation-slot.ts`
3. ✅ Remove `/pages/debug-extensions.tsx`
4. ⚠️ Remove console.log statements from API endpoints (check remaining files)

### Remove Inappropriate Files:
1. ✅ Remove duplicate source files from `server/public/extensions/softwareone-ext/src/`
2. ✅ Remove standalone placeholder pages:
   - `/pages/softwareone/agreements.tsx`
   - `/pages/softwareone/statements.tsx`
   - `/pages/settings/softwareone.tsx`
3. ✅ Remove `StandaloneNavigationSlot.tsx`

### Extension System Improvements:
1. ✅ Create component serving API endpoint `/api/extensions/[extensionId]/components/[...path].ts`
2. ✅ Update ExtensionRenderer to load actual components via API
3. ✅ Fix NavItem component to work with Next.js navigation
4. ✅ Rebuild extension with updated components

⸻

## 12. Priority Next Steps

### ✅ Completed:
1. **Clean Up Code**
   - ✅ Removed all debug artifacts
   - ✅ Removed duplicate files
   - ✅ Removed placeholder pages
   - ✅ Fixed ExtensionRenderer implementation
   - ✅ Created component serving API

### 🔄 In Progress:
2. **Get Extension Visible**
   - ✅ Fixed instrumentation.ts to call correct initializeApp
   - ✅ Verified extension initialization is called when NEXT_PUBLIC_EDITION=enterprise
   - ✅ Confirmed autoEnable:true in manifest will enable extension on registration
   - ✅ Created check-softwareone API endpoint for debugging
   - ⚠️ Need to verify extension is actually loaded (requires running server)
   - ⚠️ Check if extension is registered in database (requires DB access)
   - ⚠️ Verify navigation API returns extension items
   - ⚠️ Test if NavItem component renders correctly

### ⏳ Next:
3. **Complete Settings Implementation**
   - Replace localStorage with actual extension storage API
   - Implement real SoftwareOne API client
   - Add encryption for API token storage
   
4. **Implement Data Views**
   - Build AgreementsList with DataGrid
   - Implement AgreementDetail with tabs
   - Create StatementsList and detail views

⸻

## 13. Implementation Log

### 2025-01-10 Progress:
1. ✅ Cleaned up all debug/temporary code
2. ✅ Fixed ExtensionRenderer to load actual components via dynamic loading
3. ✅ Created component serving API endpoint `/api/extensions/[extensionId]/components/[...path]`
4. ✅ Updated NavItem component for Next.js navigation
5. ✅ Rebuilt extension with fixes
6. ✅ Fixed instrumentation.ts to use correct initializeApp
7. ✅ Created check-softwareone API endpoint for status verification
8. ✅ Implemented SettingsPage with full UI (Formik, Tabs, validation)
9. ✅ Created wrapper components for extension integration
10. ✅ Updated manifest to use wrapper components
11. ⏳ Still need to verify extension loading and visibility (requires running server)

## Ready for implementation?

**PARTIALLY** - The major blockers have been resolved:
- ExtensionRenderer now loads actual components
- Component serving API is implemented
- Extension is properly built

Remaining issue: Need to verify the extension is loading on server startup and appearing in the navigation.