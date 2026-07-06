# Scout Report: Disambiguation of "Inventory" in the Alga PSA Assets Module

**Goal:** Determine whether the term "inventory" in asset-related files refers to *discovered software on client devices* (via RMM) or *physical product stock*.

**Verdict:** Every use of "inventory" in the assets domain means **software discovered on client devices via RMM integrations**. There is zero connection to physical product stock, a product catalog, or a stock ledger.

---

## 1. Assets Package Structure and "Software Inventory" Component

### Files Retrieved
1. `packages/assets/src/index.ts` (lines 1-9) — package entry point, docblock says "asset tracking, inventory, and device management"
2. `packages/assets/src/components/AssetSoftwareInventory.tsx` (lines 1-31) — dynamic import wrapper
3. `packages/assets/src/components/tabs/SoftwareInventoryTab.tsx` (lines 1-123) — full software inventory tab component
4. `packages/ee/src/components/assets/AssetSoftwareInventory.tsx` (lines 1-183) — EE stub (returns null for CE)
5. `ee/server/src/components/assets/AssetSoftwareInventory.tsx` (lines 1-195) — EE full implementation
6. `packages/assets/src/components/AssetDetailDrawerClient.tsx` (lines 396-399) — import site with comment

### Key Code

**`packages/assets/src/index.ts` (line 5):**
> Provides asset tracking, inventory, and device management.

**`packages/assets/src/components/AssetSoftwareInventory.tsx` (lines 5-8):**
> /**
>  * Dynamically imports the EE or CE version of the AssetSoftwareInventory.
>  * EE version displays installed software from RMM data.
>  * CE version renders nothing.
>  */

**`packages/assets/src/components/tabs/SoftwareInventoryTab.tsx` (lines 19-21):**
> // Fallback to getting software from asset extension data
> // In a real implementation, this would query the normalized asset_software table

**`packages/assets/src/components/AssetDetailDrawerClient.tsx` (lines 397-399):**
> {/* RMM Software Inventory - Shows installed software for workstations/servers */}
> <AssetSoftwareInventory asset={asset} />

**`ee/server/src/components/assets/AssetSoftwareInventory.tsx` (lines 55-56):**
> Only renders for workstations and servers that are RMM-managed:
> `if (!asset.rmm_provider || !asset.rmm_device_id) { return null; }`

**`ee/server/src/components/assets/AssetSoftwareInventory.tsx` (lines 69-75):**
> Parses `asset.workstation.installed_software` or `asset.server.installed_services` — these are **JSONB columns** (legacy), sourced from RMM sync.

**The `SoftwareInventoryTab.tsx` (lines 27-35) parses the installed_software JSONB from asset extension data:**
> `const rawList = asset.workstation?.installed_software || asset.server?.installed_software || [];`

### Architecture
The `AssetSoftwareInventory` component is a dynamic import wrapper that loads either the EE or CE version. The EE version (`ee/server/src/components/assets/`) displays a collapsible panel of installed software parsed from `asset.workstation.installed_software` or `asset.server.installed_services` — these are JSONB columns populated by RMM integrations. The CE stub (`packages/ee/src/components/assets/AssetSoftwareInventory.tsx`) returns null. A newer `SoftwareInventoryTab` component in `packages/assets/src/components/tabs/` is a more polished table-based UI that also reads from the same JSONB fallback. Both are purely about **discovered software on IT assets**, not product stock.

---

## 2. Software Inventory Migration Tables

### Files Retrieved
1. `server/migrations/20251130120002_create_software_inventory_tables.cjs` (lines 1-140) — migration that creates normalized tables
2. `server/migrations/20251130120003_migrate_software_jsonb_to_normalized.cjs` (lines 1-61) — migration that populates tables from old JSONB

### Key Code

**`server/migrations/20251130120002_create_software_inventory_tables.cjs` (lines 1-16):**
> /**
>  * Replaces the JSONB installed_software columns with normalized tables for:
>  * - Better querying ("find all assets with Chrome installed")
>  * - Deduplication (same software across assets shares one catalog entry)
>  * - Change tracking (detect installs/uninstalls between syncs)
>  * - Category support (Browser, Security, Productivity, etc.)
>  * - Future features (license tracking, vulnerability matching)
>  */

### Tables Created

| Table | Purpose |
|-------|---------|
| `software_catalog` | Canonical deduplicated list of software per tenant. Columns: `software_id`, `tenant`, `name`, `publisher`, `normalized_name`, `category` (Browser/Productivity/etc.), `software_type` (application/driver/update/system), `is_managed`, `is_security_relevant`. Primary key: `[tenant, software_id]`. Unique on `[tenant, normalized_name, publisher]`. |
| `asset_software` | Junction table linking assets to installed software. Columns: `tenant`, `asset_id`, `software_id`, `version`, `install_date`, `install_path`, `size_bytes`, `first_seen_at`, `last_seen_at`, `is_current` (soft delete for uninstalls), `uninstalled_at`. Primary key: `[tenant, asset_id, software_id]`. |
| `v_asset_software_details` | Helper view joining `asset_software` → `software_catalog` → `assets` → `clients` for easy querying. |

### Confirmation
This is **per-asset discovered software** — a normalized catalog of software names/publishers with installation records per asset. The migration comment explicitly says: *"Replaces the JSONB installed_software columns"* and *"Deduplication (same software across assets shares one catalog entry)"*. Nothing about product stock, procurement, or inventory ledger.

**`server/migrations/20251130120003_migrate_software_jsonb_to_normalized.cjs`** (lines 1-4):
> Populates the new software_catalog and asset_software tables from existing installed_software JSONB columns in workstation_assets and server_assets.

---

## 3. Tactical RMM Software Ingest

### Files Retrieved
1. `packages/integrations/src/actions/integrations/tacticalRmmActions.ts` (lines 1337-1547) — `normalizeSoftwareName`, `findOrCreateSoftwareCatalogEntry`, `syncAssetSoftwareToNormalizedTables`, `ingestTacticalRmmSoftwareInventory`

### Key Code

**`ingestTacticalRmmSoftwareInventory` (line 1450):**
> `export const ingestTacticalRmmSoftwareInventory = withAuth(...)`

**Data flow (lines 1484-1516):**
```
1. GET /api/software/  ← Tactical RMM API
2. Group by agent_id → map agent_ids to asset_ids via tenant_external_entity_mappings
3. Call syncAssetSoftwareToNormalizedTables(knex, tenant, assetId, softwareList, syncTs)
```

**`syncAssetSoftwareToNormalizedTables` (lines 1374-1447):**
- Uses `findOrCreateSoftwareCatalogEntry` to upsert into `software_catalog`
- Inserts/updates into `asset_software` (version, install_path, first_seen_at, last_seen_at, is_current)
- Marks software no longer present as `is_current = false` with `uninstalled_at` timestamp

**`findOrCreateSoftwareCatalogEntry` (lines 1345-1371):**
- Searches `software_catalog` by `[tenant, normalized_name, publisher]`
- Creates new entries with `category: 'application'`, `software_type: 'application'`, `is_managed: false`, `is_security_relevant: false`

### Confirmation
Software records **come exclusively from Tactical RMM** (an RMM tool). The ingest function calls `GET /api/software/` on the Tactical RMM API, groups results by agent_id, maps to Alga asset_ids, and normalizes into the `software_catalog` + `asset_software` tables. This is **discovered software, not procurement**.

The `packages/assets/src/actions/softwareActions.ts` provides server actions (`getAssetSoftware`, `searchSoftwareFleetWide`, `getAssetSoftwareSummary`, etc.) that **query these same normalized tables** for UI display.

---

## 4. Asset ↔ Product Linkage

### Files Retrieved
1. `packages/types/src/interfaces/asset.interfaces.ts` (lines 1-100) — `Asset` interface

### Key Finding: No Product ID or SKU on Asset

The `Asset` interface has the following fields related to make/model/identifiers:

```
export interface Asset {
  asset_id: string;
  asset_type: string;         // Registry slug (e.g., 'workstation', 'server')
  client_id: string;
  asset_tag: string;           // User-assigned tag
  serial_number?: string;      // Freeform serial
  name: string;
  status: string;
  location_id?: string | null;
  location?: string;
  purchase_date?: string;      // Freeform date
  warranty_end_date?: string;  // Freeform date
  ...
  attributes?: Record<string, unknown> | null;  // Namespaced jsonb
  // Extension tables below:
  workstation?: WorkstationAsset;   // has cpu_model, etc.
  network_device?: NetworkDeviceAsset;
  server?: ServerAsset;              // has cpu_model, etc.
  mobile_device?: MobileDeviceAsset; // has model string
  printer?: PrinterAsset;            // has model string
}
```

**No `product_id`, `service_catalog_id`, `sku`, `item_kind`, `entitled_product`, or `installed_product` fields exist on the `Asset` interface.**

The asset has only **freeform make/model/serial** fields:
- `serial_number?: string`
- `purchase_date?: string`
- `warranty_end_date?: string`
- `workstation.cpu_model`, `server.cpu_model` — freeform model strings
- `mobile_device.model`, `printer.model` — freeform model strings

### Cross-check: Where product/SKU references exist
The `sku` and `product` concepts exist elsewhere in the codebase, but **not on assets**:
- `packages/types/src/interfaces/quote.interfaces.ts` — `service_sku`, `service_item_kind: 'service' | 'product'` on **quote line items**
- `packages/types/src/interfaces/invoice.interfaces.ts` — `service_item_kind`, `service_sku` on **invoice charges**
- `packages/types/src/interfaces/billing.interfaces.ts` — `item_kind`, `sku`, `manufacturer`, `product_category` on **service catalog / billing items**
- `packages/types/src/interfaces/material.interfaces.ts` — `sku` on **materials**

### Software Interfaces (for completeness)
`packages/types/src/interfaces/software.interfaces.ts` confirms the software inventory is about:
- `SoftwareCatalogEntry` — canonical deduplicated software per tenant
- `AssetSoftwareInstall` — junction table for asset ↔ software
- `SoftwareSearchResult` — fleet-wide software search

These have **zero connection to products, SKUs, or physical stock**.

---

## 5. The ABAC Inventory Contract Test

### Files Retrieved
1. `server/src/test/unit/authorization/premiumAbacExhaustiveInventory.contract.test.ts` (lines 1-43)

### Key Code

```
it('T025: inventory artifact maps reviewed surfaces to semantics, status, and validating tests/rationales', () => {
    expect(inventorySource).toContain('# Premium ABAC Exhaustive Surface Inventory');
    expect(inventorySource).toContain('## Surface Matrix');
    expect(inventorySource).toContain('| Domain | File / Surface | Chosen Semantics | Status | Validation |');
    expect(inventorySource).toContain('### F034 — Time / Delegation');
    expect(inventorySource).toContain('### F035 — Non-API Entry Points');
    expect(inventorySource).toContain('### F036 — CE/EE Helper Seams');
    expect(inventorySource).toContain('Lifecycle: `T001-T006`');
    expect(inventorySource).toContain('Quotes: `T007-T010`');
    expect(inventorySource).toContain('Documents: `T011-T014`');
    expect(inventorySource).toContain('Assets: `T015-T018`');
    expect(inventorySource).toContain('Projects: `T019-T023`');
    expect(inventorySource).toContain('Time/delegation re-audit: `T024`');
    expect(inventorySource).toContain('Close-out artifact contract: `T025`');
  });
```

### Confirmation
This test validates the existence and format of a **markdown document** at:
`ee/docs/plans/2026-04-22-premium-abac-exhaustive-remediation-sweep/EXHAUSTIVE_SURFACE_INVENTORY.md`

The "inventory" here is a **table of contents / surface area inventory of API routes and authorization surfaces** (grouped into Lifecycle, Quotes, Documents, Assets, Projects, Time/Delegation). It is a route-inventory document for ABAC authorization audit — completely unrelated to software inventory or stock.

The test also validates a **baseline ledger** document cross-linking sweep artifacts — again, an administrative/documentation concern.

---

## 6. Client-Portal Client Assets View

### Files Retrieved
1. `packages/msp-composition/src/clients/MspClientAssets.tsx` (lines 1-500+) — full client assets view

### Key Code

**Component title (lines 595-597):**
> `<h2>{t('clientTabs.assets.inventory.title', { defaultValue: 'Asset Inventory' })}</h2>`
> `<p>{t('clientTabs.assets.inventory.subtitle', { defaultValue: 'Manage and track all client assets' })}</p>`

### Columns shown (DataTable columns):
1. **Asset Tag** — `asset.asset_tag`
2. **Name** — `asset.name`
3. **Type** — `asset.asset_type` (workstation/server/network_device/mobile_device/printer)
4. **Details** — renders `os_type`, `cpu_model`, `ram_gb`, `management_ip`, `model` from extension tables
5. **Serial Number** — `asset.serial_number`
6. **Status** — `asset.status`
7. **Location** — `asset.location`
8. **Purchase Date** — `asset.purchase_date`
9. **Warranty End** — `asset.warranty_end_date`

### Confirmation
The client assets view shows **IT equipment** — workstations, servers, network devices, mobile devices, printers. It displays hardware details (OS, CPU, RAM, model, serial). There are **no purchased products, no SKU columns, no product catalog items** visible.

The term "inventory" in this view's title (`'Asset Inventory'`) refers to the **fleet of IT assets managed for the client** — not a product/stock inventory.

---

## Summary Table

| Question | Answer |
|----------|--------|
| Is "Software Inventory" about product stock? | **No.** It is software discovered on assets via RMM integrations. |
| Do the migration tables relate to a product catalog? | **No.** `software_catalog` and `asset_software` are about installed software per asset. |
| Do software records come from procurement? | **No.** They come from Tactical RMM API `/api/software/`, grouped by agent/asset. |
| Do assets carry a product_id/SKU? | **No.** Assets have only freeform `serial_number`, `purchase_date`, and `model`/`cpu_model` strings. No `product_id`, `service_catalog_id`, or `sku` field. |
| Is the ABAC contract test about stock inventory? | **No.** It tests a route/surface-inventory document for an ABAC authorization audit. |
| Does the client portal show purchased products? | **No.** It shows IT equipment (workstations, servers, etc.) with hardware specs, serials, and warranty info. |

**Bottom line:** Every use of "inventory" in the assets module is about **discovered software (RMM) or IT asset tracking**. The term has no connection to physical product stock, procurement, or a product catalog anywhere in this codebase.

---

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The investigation was strictly scoped to disambiguating 'inventory' in the assets module. All 6 investigation points were answered without expanding scope to implement changes, add new code, or suggest architectural modifications."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Every finding cites exact file paths and line ranges with embedded quotes. The report was written to the authoritative output path `/home/robert/alga-copies/feature-inventory-module/scout-assets-software-inventory.md`. All 6 items in the task are addressed with specific evidence."
    }
  ],
  "changedFiles": [
    "/home/robert/alga-copies/feature-inventory-module/scout-assets-software-inventory.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "grep/find/read across 15+ files in packages/assets, packages/types, packages/integrations, packages/ee, ee/server, server/migrations, server/src/test, packages/msp-composition, packages/client-portal",
      "result": "passed",
      "summary": "Exploratory search commands successfully retrieved all required evidence"
    }
  ],
  "validationOutput": [
      "Confirmed: Asset interface (asset.interfaces.ts:25-99) has no product_id, service_catalog_id, or sku fields - only freeform serial_number, purchase_date, warranty_end_date, and model strings",
      "Confirmed: software_catalog table (migration 20251130120002) stores canonical software names/publishers, not product SKUs",
      "Confirmed: ingestTacticalRmmSoftwareInventory (tacticalRmmActions.ts:1450) pulls from Tactical RMM API /api/software/ - not procurement",
      "Confirmed: premiumAbacExhaustiveInventory contract test validates a markdown document about API authorization surface area, not stock",
      "Confirmed: MspClientAssets.tsx shows IT equipment (workstations, servers, printers) with no product/SKU columns"
  ],
  "residualRisks": [
    "The EE full AssetSoftwareInventory component (ee/server/src/components/assets/) still references the legacy JSONB installed_software field as a fallback, while the newer normalized-table code path is available in softwareActions.ts. The report identifies both code paths but the migration plan between them was not investigated.",
    "The term 'inventory' in the package-level docblock ('Provides asset tracking, inventory, and device management') could still cause ambiguity for newcomers, but this is a documentation concern outside scope."
  ],
  "noStagedFiles": true,
  "diffSummary": "Only output file was written to the designated path. No source code was modified.",
  "reviewFindings": [
    "no blockers: All 6 investigation points fully answered with file citations and quotes. The report clearly disambiguates 'inventory' as RMM-discovered software / IT asset tracking, not physical product stock."
  ],
  "manualNotes": "The output file is at /home/robert/alga-copies/feature-inventory-module/scout-assets-software-inventory.md. Key takeaway: the assets module has zero connection to product stock, SKUs, or procurement in any of the 6 areas examined."
}
```
