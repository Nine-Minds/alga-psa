# Accounting Mapping UI Unification Plan

## Purpose & Overview
Create a reusable accounting mapping experience that any adapter (QuickBooks Online/Desktop, Xero, future ERPs) can plug into. Today the UI under `server/src/components/integrations/qbo/*` is hard-coded to QuickBooks item/tax/term catalog calls. This plan introduces a small abstraction layer so adapters supply their own catalog loaders, labels, and mapping metadata while sharing one consistent experience for finance teams.

Primary outcomes:
- A configuration-driven mapping UI that renders service/tax/term (and future) mapping tables from a single set of generic components.
- Adapter-specific providers for QuickBooks and Xero that supply catalog fetch actions, mapping labels, and overrides while persisting to `tenant_external_entity_mappings`.
- Updated tests and tooling (Playwright harness, integration tests) that exercise both adapters through the same surface.

---

## Current State Findings *(Completed)*
- **UI hard-coupled to QBO:** `QboItemMappingTable`, `QboTaxCodeMappingTable`, and `QboTermMappingTable` call `getQbo*` actions, hardcode `integrationType: 'quickbooks_online'`, and label columns/buttons specifically for QuickBooks.
- **Dialog not reusable:** `QboMappingFormDialog` sets `integration_type` to QuickBooks and expects `QboItem`-shaped data. It cannot be reused for Xero without duplicating logic.
- **Playwright harness:** `/test/accounting/mapping-crud` registers overrides via `window.__ALGA_PLAYWRIGHT_QBO__`, reinforcing the coupling.
- **Server actions already generic:** `externalMappingActions.ts` work for any adapter string, and `AccountingMappingResolver` resolves mappings for both QuickBooks and Xero, so the backend is ready for a generic UI.
- **No Xero UI:** Xero adapter code (`server/src/lib/adapters/accounting/xeroAdapter.ts`, `server/src/lib/xero/xeroClientService.ts`) expects mappings to exist but there is no surface to create them.

---

## Goals & Non-Goals
**Goals**
- Introduce a reusable mapping component set that accepts adapter-specific configuration (labels, catalog loaders, metadata schema).
- Port the existing QuickBooks UI to the new abstraction without regressing current functionality or tests.
- Add Xero mapping tabs (services/accounts, tax rates, payment terms, tracking categories) using the same abstraction.

**Non-Goals**
- Building mapping screens for adapters that do not exist yet (e.g., NetSuite).
- Redesigning broader Accounting Settings navigation.
- Changing the underlying mapping schema (`tenant_external_entity_mappings`).

---

## Solution Outline
1. **Configuration contract:** Define an `AccountingMappingModule` interface (adapter type, entity descriptors, data loaders, CRUD handlers, optional metadata editors, Playwright override hooks).
2. **Generic components:**
   - `AccountingMappingTable` – renders the table using injected columns/labels, fetches data via config.
   - `AccountingMappingDialog` – generic form with adapter-provided select options and metadata parsing logic.
   - `AccountingMappingManager` – renders tabs based on an array of module configs.
3. **Adapter providers:** Implement `createQboMappingModules(realmId)` and `createXeroMappingModules(connectionId)` that return module arrays for the manager.
4. **UI integration:** Update Settings screens (QuickBooks tab now calls the generic manager with QBO modules; create an equivalent Xero settings view).
5. **Testing:** Update Playwright harness to register overrides generically, add integration coverage for Xero paths, ensure unit tests cover config edge cases (metadata, disabled operations).

---

## Phase 1 – Generic Mapping Framework
- [ ] **Define configuration primitives**
  - Add types under `server/src/components/accounting-mappings/types.ts` describing module shape: labels, adapterType, entity keys, loader functions, metadata schema hints, feature flags.
  - Decide how pagination/filtering is surfaced (initial phase can keep existing one-shot fetch).
- [ ] **Extract shared table/dialog**
  - Move reusable logic from `QboItemMappingTable` and `QboMappingFormDialog` into `AccountingMappingTable` and `AccountingMappingDialog`.
  - Support read/write overrides (used by Playwright) via optional callbacks in the config.
  - Expose hooks for disabling metadata editing or converting metadata between adapter formats.
- [ ] **Refactor QuickBooks implementation**
  - Replace QBO components with `createQboMappingModules(realmId)` returning module configs for services, tax codes, and payment terms.
  - Update `QboIntegrationSettings` to render the generic `AccountingMappingManager`.
  - Remove hard-coded `'quickbooks_online'` strings from UI components; ensure they are part of the config.
- [ ] **Adjust tests**
  - Update existing React tests (if any) and ensure TypeScript builds with the new abstractions.
  - Keep the Playwright harness working via temporary shims while Phase 2 completes.

### Deliverables
- Shared component library under `server/src/components/accounting-mappings/`.
- QBO settings view using the new abstraction with parity behavior.
- Changelog entry describing refactor and how overrides should use the new config hook.

---

## Phase 2 – Xero Module Implementation
- [ ] **Catalog loaders**
  - Add server actions (or light client fetchers) to surface Xero accounts, tax rates, payment terms, and tracking categories via `XeroClientService`.
  - Handle token/realm selection via existing credential storage (`target_realm`).
- [ ] **Xero config**
  - Implement `createXeroMappingModules(connectionId)` that maps:
    - Services → revenue accounts.
    - Tax regions → Xero tax rates (support multi-component metadata).
    - Payment terms → Xero terms.
    - Optional tracking categories (dimension mapping).
  - Ensure metadata editors allow tax component arrays/tracking category options.
- [ ] **UI integration**
  - Add Xero tab alongside QuickBooks in Accounting Settings (respect feature flags/availability).
  - Show realm/connection context (accounting exports already surface adapter type).
- [ ] **Data validation**
  - Confirm created mappings satisfy `XeroAdapter` requirements (`metadata.taxComponents`, `tracking` arrays, account codes).

### Deliverables
- Xero mapping settings accessible in the UI.
- Documentation snippet on required Xero permissions and mapping workflow.

---

## Phase 3 – Testing, Harness Updates & Rollout
- [ ] **Playwright harness**
  - Replace `window.__ALGA_PLAYWRIGHT_QBO__` with a generic `window.__ALGA_PLAYWRIGHT_ACCOUNTING__` keyed by adapter.
  - Extend harness scenarios to exercise both QuickBooks and Xero modules (create, edit, delete, realm-scoped fetch).
- [ ] **Integration/unit tests**
  - Add Vitest coverage for `createQboMappingModules` and `createXeroMappingModules` (ensuring loader errors bubble, metadata persists).
  - Update accounting export integration tests to confirm resolver finds mappings created via the new UI paths.
- [ ] **Rollout & docs**
  - Update `docs/accounting_exports.md` with mapping UI changes and adapter-specific notes.
  - Capture screenshots or walkthrough for release notes.

### Success Metrics
- 100% of mapping operations route through generic components (no residual imports from `server/src/components/integrations/qbo/*`).
- Playwright suite covers both adapters without adapter-specific UI code.
- Xero export smoke test succeeds after populating mappings through the UI.

---

## Risks & Mitigations
- **Adapter-specific metadata differences:** Xero mapping may need richer metadata (tracking category arrays). Mitigation: allow config to supply custom metadata editors or transformers.
- **Legacy Playwright mocks:** If harness consumers rely on the old global, provide a compatibility shim for one release cycle.
- **Catalog fetch performance:** Multiple adapters may fetch large catalogs; cache results per session or add manual refresh controls.

---

## Dependencies & Coordination
- Requires Xero credential management to be functional (`XeroClientService` OAuth refresh).
- Coordinate with teams touching Accounting Settings UI to avoid merge conflicts.
- Ensure contract wizard integration tests remain stable after component moves (shared jest mocks may need updates).

---

## Exit Criteria
- QuickBooks settings page uses the generic manager with no adapter-specific UI components remaining.
- Xero mapping UI available (behind feature flag if needed) and used to populate mappings that unblock `XeroAdapter`.
- Playwright/integration suites passing with updated harness.
- Documentation updated and shared with finance stakeholders before enabling in production.
