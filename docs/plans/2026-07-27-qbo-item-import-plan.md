# QBO Products & Services Import — Implementation Plan

**Branch:** `feature/qbo-import-products-services`
**Status:** Approved design, ready for implementation
**Scope:** Flag-gated bulk import of QuickBooks Online Items (services & products) into `service_catalog`, delivered as a new step in the existing QBO onboarding wizard, factored so CDC-based incremental sync can later feed the same resolve/apply pipeline.

---

## 1. Settled design decisions

| Question | Decision |
|---|---|
| Item types | Import `Service`, `NonInventory`, **and** `Inventory` (metadata only — no quantity/asset semantics). `Category` items are **not** imported as catalog entries and no category tree is built; item names are flattened (use the leaf name; the fully qualified `Parent:Child` name is kept in mapping metadata). |
| Update policy for matched items | **QBO wins on QBO-authoritative fields** (`service_name`, `default_rate`, `sku`, `description`, `cost`, `is_active`). Alga-authoritative fields (`billing_method`, `unit_of_measure`, `custom_service_type_id`, category assignment) are never touched by import or future CDC. Preview shows the exact per-row diff. |
| Inactive items | Imported as `is_active=false`, flagged in preview. "Include inactive" toggle, default **on**. Nothing silently skipped. |
| Unmapped tax codes | Imported with `tax_rate_id=null`, flagged in preview. |
| Match precedence | Existing mapping ledger row → SKU (products, exact) → exact name → create new. |
| UI placement | New **"Products & Services" step in `QboOnboardingWizard`**, flag-gated step visibility. No new settings slot. |
| Realm scope | Import is realm-scoped; UI states the active realm (consistent with mapping manager copy). |
| Gating | EE (`assertEnterpriseEdition` server-side + existing `NEXT_PUBLIC_EDITION` client gate, both already applied to the QBO area) + PostHog flag `qbo-item-import` on both UI and actions. |

## 2. Architecture

The one-time import is a bulk run of the same resolve/apply machinery CDC will later feed one change at a time:

```
QboOnboardingWizard
  └─ new step: QboItemImportStep (flag-gated)
       └─ previewQboItemImport / executeQboItemImport (server actions)
            └─ qboItemImportService
                 ├─ fetch: paged SELECT * FROM Item (STARTPOSITION/MAXRESULTS, 1000/page,
                 │         active + inactive via explicit query), pattern from
                 │         fetchQboInvoicesPaged (packages/billing/src/actions/qboOnboardingActions.ts:317)
                 ├─ resolve: qboItemResolver — pure matching, no I/O side effects
                 └─ apply: qboItemApplier — create/update service_catalog rows,
                       write tenant_external_entity_mappings rows (provenance metadata),
                       seed sync-cycle cursor on completion
```

### CDC-readiness commitments (built into Phase 1)

1. **Ledger row for every imported or matched item**: `integration_type='quickbooks_online'`, `alga_entity_type='service'`, `external_entity_id=<QBO Item Id>`, `external_realm_id=<realm>`, `sync_status='synced'`, `last_synced_at=now`.
2. **Provenance in mapping `metadata`**: `{ syncToken, lastUpdatedTime, incomeAccountId, expenseAccountId, qboType, fullyQualifiedName }`.
3. **Cursor seeding**: on successful execute, write a successful sync-cycle row with `cursor_after = max(MetaData.LastUpdatedTime seen, import start)` for tenant+`quickbooks_online`+realm, so the first Item CDC cycle continues without gap or re-import (`CURSOR_OVERLAP_MS` guards the boundary — accountingSyncCycleService.ts:57,113-118).
4. **Shared resolver/applier modules** — import feeds full catalog; CDC later feeds change sets. Adding CDC = add `'Item'` to `CDC_ENTITIES` + `AccountingExternalChangeEntity` union and route into the same applier. Out of scope now.
5. **Per-field authority policy** encoded as a constant in the resolver module (single source of truth for import updates and future CDC).

### Field mapping (QBO Item → `service_catalog`)

| QBO | Alga | Notes |
|---|---|---|
| `Type='Service'` | `item_kind='service'` | |
| `Type='NonInventory'`/`'Inventory'` | `item_kind='product'` | metadata only |
| `Type='Category'` | skipped | reason shown in preview |
| `Name` (leaf) | `service_name` | fully qualified name → mapping metadata |
| `Sku` | `sku` | partial unique index (tenant, sku) WHERE item_kind='product' AND sku NOT NULL — conflicts surfaced in preview |
| `UnitPrice` | `default_rate` | dollars → minor units; currency from `getPreferences()` HomeCurrency |
| `PurchaseCost` | `cost` + `cost_currency` | same conversion |
| `Description` | `description` | |
| `Active` | `is_active` | |
| `SalesTaxCodeRef` | `tax_rate_id` | via existing tax mappings; unresolved → null + flag |
| `IncomeAccountRef`, `SyncToken`, `MetaData.LastUpdatedTime` | mapping metadata | |
| — | `custom_service_type_id` (required), `billing_method`, `unit_of_measure` | collected as defaults in the wizard step: service-type picker (required), billing method (`fixed` default for products, choice for services), unit of measure. Alga-authoritative thereafter. |

## 3. Work items

### 3.1 QBO client & types (additive)
- Extend `QboItem` (packages/integrations/src/lib/qbo/types.ts:163) with `Sku?, Description?, UnitPrice?, PurchaseCost?, Active?, Taxable?, SubItem?, ParentRef?, FullyQualifiedName?, SalesTaxCodeRef?, MetaData?` (it already has `SyncToken?, IncomeAccountRef?, ExpenseAccountRef?, AssetAccountRef?`).
- New paged fetch (in the new service, following `fetchQboInvoicesPaged`): `SELECT * FROM Item [WHERE Active IN (true,false)] STARTPOSITION n MAXRESULTS 1000`. Do **not** touch `getQboItems` (qboActions.ts:710) or its `itemCache` — the mapping-dropdown path stays as-is, and the import must not read that cache.

### 3.2 Resolver — `packages/billing/src/services/accountingSync/qboItemResolver.ts`
Pure module: `(qboItems, existingServices, existingMappings, defaults) → ItemResolution[]` where each resolution is `{ qboItem, action: 'create'|'update'|'link'|'skip', matchedServiceId?, fieldChanges?, flags: ('inactive'|'unmapped_tax'|'sku_conflict'|'name_collision'|'category_skipped')[], reason? }`. Exports `QBO_AUTHORITATIVE_FIELDS` / `ALGA_AUTHORITATIVE_FIELDS` constants. Match precedence: ledger mapping → SKU → exact name → create. Name/SKU collisions with an already-mapped-to-different-item row → `skip` with conflict reason (operator resolves manually via mapping manager).

### 3.3 Import service — `packages/billing/src/services/accountingSync/qboItemImportService.ts`
- `preview(tenant, realm, defaults)`: paged fetch → resolve → summary + rows. No writes.
- `execute(tenant, realm, defaults)`: re-fetch + re-resolve (don't trust a stale preview), then per-row apply inside a transaction-per-row (per Xero CSV precedent — one bad row doesn't abort the batch; per-row errors captured and reported). Apply = `createService`-equivalent insert or authoritative-field update, plus `SyncMappingLedger.insert`/`update` (no upsert helper exists — check `findByExternalId` first). On completion, seed the sync-cycle cursor row. Returns `{ created, updated, linked, skipped, errors[] }`.
- Service creation must satisfy `createService` invariants (packages/billing/src/actions/serviceActions.ts:407): required `custom_service_type_id`, publish `SERVICE_CATALOG_CREATED` search events.

### 3.4 Server actions — `packages/billing/src/actions/qboItemImportActions.ts`
`previewQboItemImport`, `executeQboItemImport`. Guards in order: `assertEnterpriseEdition` → `featureFlags.isEnabled('qbo-item-import', {userId, tenantId})` (typed "feature not enabled" error, not silent success) → permissions (`billing_settings:update` + `service:create` for execute; `billing_settings:read` for preview). Realm passed explicitly.

### 3.5 UI — new wizard step
- `packages/billing/src/components/accounting/QboItemImportStep.tsx`: defaults form (service type picker, billing method, unit of measure, include-inactive toggle), preview table grouped by action with flags/reasons and per-field diffs for updates, execute button + result summary. Skippable step (import is optional). Playwright override hooks per existing mapping-module convention.
- Wire into `QboOnboardingWizard.tsx` (packages/billing/src/components/accounting/QboOnboardingWizard.tsx:419) as a step between customer mapping and go-live cutoff; step visibility behind `useFeatureFlag('qbo-item-import')` (or `FeatureFlagWrapper` — note: the component is `FeatureFlagWrapper` in `packages/ui/src/components/feature-flags/FeatureFlagWrapper.tsx`, not `FeatureFlag`). Wizard step list/state (`getOnboardingWizardState`, qboOnboardingActions.ts:634) must tolerate the step being absent when the flag is off — completed wizards are unaffected.

### 3.6 Flag
- Register `qbo-item-import` in PostHog (tenant-scoped for piloting); document in `docs/features/feature-flags.md`.
- Flag off ⇒ step invisible, actions return typed error. **Ledger rows written by a past import are never retroactively hidden** — imported mappings are valid mappings and the export adapter should keep using them.

### 3.7 Tests
- **Unit (resolver):** match matrix (mapping/SKU/name/create), collision → skip, authority-field partitioning, category skip, inactive & tax flags, leaf-name flattening.
- **Unit (service):** paged fetch assembly, per-row transaction error isolation, ledger insert-vs-update, provenance metadata shape, cursor seeding value, Alga-authoritative fields untouched on update, currency minor-unit conversion.
- **Contract:** `QboItemImportStep.contract.test.tsx` mirroring `QboCustomerMappingPanel.contract.test.tsx`; wizard renders/omits the step by flag.
- **Actions:** flag-off typed error, permission denials, EE gate.
- Emulator suite (`algasim`, commit 2169ea12ec) available for wire-level QBO Item query/pagination testing if convenient.

## 4. Explicitly out of scope
- CDC incremental sync for Items (Phase 2: add `'Item'` to `CDC_ENTITIES` at qboClientService.ts:543 + type union, route into the Phase 1 applier; make the entity list capability-driven then).
- Inventory quantity/asset tracking; `service_categories` creation from QBO categories; schema migrations (none needed).
- Any change to existing `getQboItems`, `QboLiveMappingManager`, settings slots, or the sync engine.

## 5. Key references
- `packages/integrations/src/lib/qbo/qboClientService.ts` — `query<T>` :598, `fetchChanges`/`CDC_ENTITIES` :542-543, `getPreferences` :658
- `packages/billing/src/actions/qboOnboardingActions.ts` — paged-fetch pattern :317, wizard state :634
- `packages/billing/src/components/accounting/QboOnboardingWizard.tsx` — wizard + entry :419/:488
- `packages/billing/src/services/accountingSync/syncMappingLedger.ts` — ledger (no upsert)
- `packages/billing/src/services/accountingSync/accountingSyncCycleService.ts` — cursor semantics :57, :113-118
- `server/migrations/20260101090000_add_products_fields_to_service_catalog.cjs` (+ `20260107190000` cost_currency, `20260716120000` barcode)
- `packages/billing/src/actions/serviceActions.ts` — `createService` :407
- `packages/ui/src/components/feature-flags/FeatureFlagWrapper.tsx`, `server/src/lib/feature-flags/featureFlags.ts`, `packages/core/src/lib/featureFlagRuntime.ts:107`
