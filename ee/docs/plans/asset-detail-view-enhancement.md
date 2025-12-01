# Asset Detail View Enhancement Plan

## Vision Overview

Transform the asset detail view from a basic information display into a comprehensive RMM-integrated dashboard that surfaces critical operational data, enables quick actions, and provides at-a-glance status indicators for technicians.

### Key Changes Summary
- Redesigned header with RMM status badge and quick action buttons
- New key metrics summary banner (health, tickets, security, warranty)
- Two-column dashboard layout with live RMM vitals
- Enhanced tabbed navigation with expanded capabilities
- Deep integration with NinjaOne (and future RMM providers)

---

## Part 1: Backend Updates

### 1.1 New API Endpoints

#### 1.1.1 Asset RMM Data Endpoint (Database-Cached Approach)
**File**: `ee/server/src/app/api/assets/[assetId]/rmm/route.ts`

Create an endpoint that returns RMM data from our database (populated during sync) with an optional refresh capability:

```typescript
GET /api/assets/[assetId]/rmm?refresh=false
Response: {
  provider: 'ninjaone' | 'datto' | 'connectwise_automate',
  agent_status: 'online' | 'offline' | 'unknown',
  last_check_in: ISO8601,
  last_rmm_sync_at: ISO8601,  // When we last synced this data
  current_user: string | null,
  uptime_seconds: number | null,
  lan_ip: string | null,
  wan_ip: string | null,
  cpu_utilization_percent: number | null,
  memory_utilization_percent: number | null,
  memory_used_gb: number | null,
  memory_total_gb: number | null,
  remote_control_url: string | null,
  storage: Array<{
    name: string,
    total_gb: number,
    free_gb: number,
    utilization_percent: number
  }>
}

POST /api/assets/[assetId]/rmm/refresh
// Triggers a single-device sync from RMM and returns updated data
```

**Implementation Steps**:
1. Create GET route that reads RMM data from workstation_assets/server_assets tables
2. Include `last_rmm_sync_at` timestamp so UI can show "as of X" indicator
3. Create POST refresh route that calls sync engine for single device
4. Map database fields to standardized RMM response format
5. Handle missing RMM data gracefully (asset not linked to RMM)

#### 1.1.2 Asset Summary Metrics Endpoint
**File**: `server/src/app/api/assets/[assetId]/summary/route.ts`

Create endpoint for the key metrics banner:

```typescript
GET /api/assets/[assetId]/summary
Response: {
  health_status: 'healthy' | 'warning' | 'critical' | 'unknown',
  health_reason: string | null,
  open_tickets_count: number,
  security_status: 'secure' | 'at_risk' | 'critical',
  security_issues: string[],  // e.g., ["3 Critical OS Patches missing"]
  warranty_days_remaining: number | null,
  warranty_status: 'active' | 'expiring_soon' | 'expired' | 'unknown'
}
```

**Implementation Steps**:
1. Query open tickets associated with asset
2. Calculate health status from RMM alerts (severity-based)
3. Calculate security status from patch/antivirus data
4. Compute warranty days remaining from warranty_end_date

#### 1.1.3 Remote Control URL Generation
**File**: `ee/server/src/lib/integrations/ninjaone/remoteControl.ts`

```typescript
getRemoteControlUrl(deviceId: string): Promise<string | null>
```

**Implementation Steps**:
1. Research NinjaOne API for remote session initiation
2. Generate deep-link URL or session token for remote access
3. Handle cases where remote control is unavailable

---

### 1.2 Database Schema Updates

#### 1.2.1 New Fields for Workstation/Server Assets (RMM Data Cache)
**Migration**: `20251201000001_add_asset_rmm_cached_fields.cjs`

Add columns to `workstation_assets` and `server_assets` to cache RMM data during sync.
This allows instant display of "as of last sync" data without live API calls:

```sql
-- Current user logged into the device
ALTER TABLE workstation_assets ADD COLUMN current_user VARCHAR(255);
ALTER TABLE server_assets ADD COLUMN current_user VARCHAR(255);

-- Uptime in seconds (synced from RMM)
ALTER TABLE workstation_assets ADD COLUMN uptime_seconds BIGINT;
ALTER TABLE server_assets ADD COLUMN uptime_seconds BIGINT;

-- Network addresses (can change, synced from RMM)
ALTER TABLE workstation_assets ADD COLUMN lan_ip VARCHAR(45);
ALTER TABLE workstation_assets ADD COLUMN wan_ip VARCHAR(45);
ALTER TABLE server_assets ADD COLUMN lan_ip VARCHAR(45);
ALTER TABLE server_assets ADD COLUMN wan_ip VARCHAR(45);

-- CPU utilization (percentage, 0-100)
ALTER TABLE workstation_assets ADD COLUMN cpu_utilization_percent NUMERIC(5,2);
ALTER TABLE server_assets ADD COLUMN cpu_utilization_percent NUMERIC(5,2);

-- Memory utilization
ALTER TABLE workstation_assets ADD COLUMN memory_used_gb NUMERIC(10,2);
ALTER TABLE server_assets ADD COLUMN memory_used_gb NUMERIC(10,2);
-- Note: memory_usage_percent already exists on server_assets, add to workstation:
ALTER TABLE workstation_assets ADD COLUMN memory_usage_percent NUMERIC(5,2);

-- Storage info (array of drive details, synced from RMM)
-- Note: disk_usage already exists on server_assets as JSONB, add to workstation:
ALTER TABLE workstation_assets ADD COLUMN disk_usage JSONB;
-- Format: [{ "name": "Macintosh HD", "total_gb": 1850, "free_gb": 1200 }, ...]

-- Last reboot timestamp (more precise than just uptime)
-- Note: last_reboot_at already exists, ensure it's being synced
```

#### 1.2.2 Asset Notes Document Reference
**Migration**: `20251201000002_add_notes_document_id_to_assets.cjs`

Following the same pattern as company notes, add a document reference to assets.
This enables rich BlockNote-formatted notes with the existing document system:

```sql
-- Add notes_document_id to assets table (1:1 relationship with documents)
ALTER TABLE assets ADD COLUMN notes_document_id UUID;

-- Add composite foreign key for tenant isolation
ALTER TABLE assets ADD CONSTRAINT fk_assets_notes_document
  FOREIGN KEY (tenant, notes_document_id)
  REFERENCES documents(tenant, document_id)
  ON DELETE SET NULL;

-- Index for efficient lookups
CREATE INDEX idx_assets_notes_document ON assets(tenant, notes_document_id)
  WHERE notes_document_id IS NOT NULL;
```

**How This Works** (following company notes pattern):
1. When user creates a note, we create a document in `documents` table
2. Store BlockNote JSON in `document_block_content.block_data`
3. Link document to asset via `assets.notes_document_id`
4. Use existing `createBlockDocument()`, `getBlockContent()`, `updateBlockContent()` actions
5. Render with existing `TextEditor` component (BlockNote)

#### 1.2.3 Normalized Software Inventory Tables
**Migration**: `20251201000003_create_software_inventory_tables.cjs`

Replace the JSONB `installed_software` column with normalized tables for better querying,
reporting, and future features (license tracking, vulnerability matching).

```sql
-- ============================================================================
-- SOFTWARE CATALOG: Canonical list of software (deduplicated per tenant)
-- ============================================================================
CREATE TABLE software_catalog (
  software_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant UUID NOT NULL REFERENCES tenants(tenant),

  -- Identification
  name VARCHAR(500) NOT NULL,              -- Software name (e.g., "Google Chrome")
  publisher VARCHAR(255),                   -- Publisher (e.g., "Google LLC")
  normalized_name VARCHAR(500),             -- Lowercase, trimmed for matching

  -- Classification
  category VARCHAR(100),                    -- e.g., "Browser", "Productivity", "Security", "Development"
  software_type VARCHAR(50) DEFAULT 'application',  -- 'application', 'driver', 'update', 'system'

  -- Management flags
  is_managed BOOLEAN DEFAULT FALSE,         -- Tracked for patching/licensing
  is_security_relevant BOOLEAN DEFAULT FALSE, -- Antivirus, firewall, etc.

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure unique software per tenant (by normalized name + publisher)
  UNIQUE(tenant, normalized_name, publisher)
);

CREATE INDEX idx_software_catalog_tenant ON software_catalog(tenant);
CREATE INDEX idx_software_catalog_name ON software_catalog(tenant, normalized_name);
CREATE INDEX idx_software_catalog_publisher ON software_catalog(tenant, publisher);
CREATE INDEX idx_software_catalog_category ON software_catalog(tenant, category);

-- RLS
ALTER TABLE software_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON software_catalog
  USING (tenant = current_setting('app.current_tenant')::UUID);

-- ============================================================================
-- ASSET SOFTWARE: Junction table linking assets to installed software
-- ============================================================================
CREATE TABLE asset_software (
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  asset_id UUID NOT NULL,
  software_id UUID NOT NULL REFERENCES software_catalog(software_id) ON DELETE CASCADE,

  -- Installation details
  version VARCHAR(100),                     -- Installed version
  install_date DATE,                        -- When it was installed (from RMM)
  install_path TEXT,                        -- Installation location
  size_bytes BIGINT,                        -- Size on disk

  -- Sync tracking
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- When we first detected it
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- Updated each sync

  -- Status
  is_current BOOLEAN DEFAULT TRUE,          -- FALSE = was uninstalled (soft delete)
  uninstalled_at TIMESTAMPTZ,               -- When we detected removal

  -- Composite primary key
  PRIMARY KEY (tenant, asset_id, software_id),

  -- Foreign key to assets
  FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE
);

-- Query patterns we need to optimize:
-- 1. "Show all software on asset X" (asset detail page)
CREATE INDEX idx_asset_software_asset ON asset_software(tenant, asset_id)
  WHERE is_current = TRUE;

-- 2. "Find all assets with software Y installed" (fleet search)
CREATE INDEX idx_asset_software_software ON asset_software(tenant, software_id)
  WHERE is_current = TRUE;

-- 3. "Show recently installed software" (audit/reporting)
CREATE INDEX idx_asset_software_first_seen ON asset_software(tenant, first_seen_at DESC);

-- 4. "Show uninstalled software" (change tracking)
CREATE INDEX idx_asset_software_uninstalled ON asset_software(tenant, uninstalled_at DESC)
  WHERE is_current = FALSE;

-- RLS
ALTER TABLE asset_software ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON asset_software
  USING (tenant = current_setting('app.current_tenant')::UUID);

-- ============================================================================
-- MIGRATION: Move existing JSONB data to normalized tables
-- ============================================================================
-- This will be handled in the migration script:
-- 1. For each asset with installed_software JSONB:
--    a. Parse the JSON array
--    b. For each software item:
--       - Find or create entry in software_catalog (match on normalized_name + publisher)
--       - Create entry in asset_software with version, install_date, etc.
-- 2. After migration, drop the installed_software columns (or keep for rollback)

-- ============================================================================
-- HELPER VIEW: Denormalized view for easy querying
-- ============================================================================
CREATE VIEW v_asset_software_details AS
SELECT
  asw.tenant,
  asw.asset_id,
  a.name AS asset_name,
  a.asset_type,
  a.client_id,
  sc.software_id,
  sc.name AS software_name,
  sc.publisher,
  sc.category,
  sc.is_managed,
  sc.is_security_relevant,
  asw.version,
  asw.install_date,
  asw.size_bytes,
  asw.first_seen_at,
  asw.last_seen_at,
  asw.is_current
FROM asset_software asw
JOIN software_catalog sc ON sc.software_id = asw.software_id
JOIN assets a ON a.tenant = asw.tenant AND a.asset_id = asw.asset_id;
```

**Key Design Decisions:**

1. **Normalized name matching**: Store `normalized_name` (lowercase, trimmed) to handle variations like "Google Chrome" vs "google chrome" vs " Google Chrome "

2. **Soft delete for uninstalls**: When software disappears from a sync, set `is_current = FALSE` and `uninstalled_at`. This preserves history and enables "what changed" reporting.

3. **Publisher in unique constraint**: "Chrome" from "Google LLC" is different from a hypothetical "Chrome" from another publisher.

4. **Category field**: Allows filtering by type (browsers, security tools, etc.) - can be populated manually or via heuristics.

5. **is_managed flag**: Marks software that should be tracked for patching/licensing.

---

### 1.3 Sync Engine Enhancements

#### 1.3.1 Enhanced Device Data Mapping
**File**: `ee/server/src/lib/integrations/ninjaone/mappers/deviceMapper.ts`

Update mapper to extract all cached RMM fields during sync:

```typescript
// Add to mapDeviceToAsset():
current_user: device.lastLoggedInUser || null,
uptime_seconds: device.uptimeSeconds || null,
lan_ip: extractPrimaryLanIp(device.networkInterfaces),
wan_ip: device.publicIP || null,
cpu_utilization_percent: device.system?.cpuUsage || null,
memory_usage_percent: device.system?.memoryUsage || null,
memory_used_gb: calculateMemoryUsedGb(device.system),
disk_usage: mapDiskUsage(device.volumes),  // [{ name, total_gb, free_gb }]
```

**Helper Functions to Add**:
```typescript
function extractPrimaryLanIp(networkInterfaces: NinjaOneNetworkInterface[]): string | null {
  // Find primary non-virtual interface with IPv4 address
}

function calculateMemoryUsedGb(system: NinjaOneSystemInfo): number | null {
  if (!system?.totalMemory || !system?.availableMemory) return null;
  return (system.totalMemory - system.availableMemory) / (1024 * 1024 * 1024);
}

function mapDiskUsage(volumes: NinjaOneVolume[]): DiskUsageEntry[] {
  return volumes.map(v => ({
    name: v.name || v.deviceName,
    total_gb: v.capacity / (1024 * 1024 * 1024),
    free_gb: v.freeSpace / (1024 * 1024 * 1024),
  }));
}
```

#### 1.3.2 Single-Device Refresh Sync
**File**: `ee/server/src/lib/integrations/ninjaone/sync/syncEngine.ts`

Add method to refresh a single device on-demand (for manual refresh button):

```typescript
async syncSingleDeviceById(assetId: string): Promise<SyncResult> {
  // 1. Look up asset to get rmm_device_id
  // 2. Call NinjaOne API for single device detail
  // 3. Update workstation_assets/server_assets with new data
  // 4. Update assets.last_rmm_sync_at timestamp
  // 5. Return updated data
}
```

#### 1.3.3 Software Inventory Sync (Refactored for Normalized Tables)
**File**: `ee/server/src/lib/integrations/ninjaone/sync/softwareSync.ts`

Refactor the existing software sync to use the new normalized tables instead of JSONB.

```typescript
interface SoftwareSyncContext {
  tenant: string;
  assetId: string;
  syncTimestamp: Date;
}

async function syncAssetSoftware(
  ctx: SoftwareSyncContext,
  ninjaSoftware: NinjaOneSoftware[]
): Promise<void> {
  const { tenant, assetId, syncTimestamp } = ctx;

  // 1. Get current software IDs for this asset
  const currentSoftwareIds = await knex('asset_software')
    .where({ tenant, asset_id: assetId, is_current: true })
    .pluck('software_id');

  const seenSoftwareIds = new Set<string>();

  // 2. Process each software item from NinjaOne
  for (const sw of ninjaSoftware) {
    // Find or create catalog entry
    const softwareId = await findOrCreateSoftwareCatalogEntry(tenant, {
      name: sw.name,
      publisher: sw.publisher,
    });

    seenSoftwareIds.add(softwareId);

    // Upsert asset_software record
    await knex('asset_software')
      .insert({
        tenant,
        asset_id: assetId,
        software_id: softwareId,
        version: sw.version,
        install_date: sw.installDate,
        install_path: sw.location,
        size_bytes: sw.size,
        first_seen_at: syncTimestamp,
        last_seen_at: syncTimestamp,
        is_current: true,
        uninstalled_at: null,
      })
      .onConflict(['tenant', 'asset_id', 'software_id'])
      .merge({
        version: sw.version,           // Version may have changed
        last_seen_at: syncTimestamp,   // Always update last seen
        is_current: true,              // Re-mark as current if previously uninstalled
        uninstalled_at: null,
      });
  }

  // 3. Mark software no longer present as uninstalled
  const removedSoftwareIds = currentSoftwareIds.filter(
    id => !seenSoftwareIds.has(id)
  );

  if (removedSoftwareIds.length > 0) {
    await knex('asset_software')
      .where({ tenant, asset_id: assetId })
      .whereIn('software_id', removedSoftwareIds)
      .update({
        is_current: false,
        uninstalled_at: syncTimestamp,
      });
  }
}

async function findOrCreateSoftwareCatalogEntry(
  tenant: string,
  software: { name: string; publisher?: string }
): Promise<string> {
  const normalizedName = software.name.toLowerCase().trim();
  const publisher = software.publisher?.trim() || null;

  // Try to find existing entry
  const existing = await knex('software_catalog')
    .where({ tenant, normalized_name: normalizedName, publisher })
    .first();

  if (existing) {
    return existing.software_id;
  }

  // Create new entry
  const [entry] = await knex('software_catalog')
    .insert({
      tenant,
      name: software.name.trim(),
      normalized_name: normalizedName,
      publisher,
      category: inferSoftwareCategory(software.name), // Optional heuristic
    })
    .returning('software_id');

  return entry.software_id;
}

// Optional: Simple heuristic to auto-categorize common software
function inferSoftwareCategory(name: string): string | null {
  const lower = name.toLowerCase();
  if (/chrome|firefox|safari|edge|opera|brave/.test(lower)) return 'Browser';
  if (/office|word|excel|powerpoint|outlook/.test(lower)) return 'Productivity';
  if (/visual studio|vscode|intellij|xcode|android studio/.test(lower)) return 'Development';
  if (/antivirus|defender|norton|mcafee|sentinelone|crowdstrike/.test(lower)) return 'Security';
  if (/zoom|teams|slack|discord/.test(lower)) return 'Communication';
  if (/adobe|photoshop|illustrator|acrobat/.test(lower)) return 'Creative';
  return null;
}
```

**Key Changes from Current Implementation:**

1. **No more JSONB**: Software stored in relational tables
2. **Deduplication**: Same software across assets shares one catalog entry
3. **Change tracking**: `is_current` and `uninstalled_at` track install/uninstall events
4. **Upsert logic**: Handles version updates and reinstalls gracefully
5. **Category inference**: Optional auto-categorization for common software

---

### 1.4 Service Layer Updates

#### 1.4.1 Asset Actions Enhancement
**File**: `server/src/lib/actions/asset-actions/assetActions.ts`

Add new server actions:

```typescript
// Get asset summary metrics (health, tickets, security, warranty)
export async function getAssetSummaryMetrics(assetId: string): Promise<AssetSummaryMetrics>
```

#### 1.4.2 Asset Notes Actions (Using Document System)
**File**: `server/src/lib/actions/asset-actions/assetNoteActions.ts` (new file)

Following the company notes pattern from `ClientDetails.tsx`:

```typescript
// Load note content for an asset
export async function getAssetNoteContent(assetId: string): Promise<{
  document: Document | null;
  blockData: PartialBlock[] | null;
}> {
  // 1. Fetch asset to get notes_document_id
  // 2. If exists, call getDocument() and getBlockContent()
  // 3. Parse block_data JSON and return
}

// Save note content (create or update)
export async function saveAssetNote(
  assetId: string,
  blockData: PartialBlock[],
  userId: string
): Promise<{ document_id: string }> {
  const asset = await getAsset(assetId);

  if (asset.notes_document_id) {
    // Update existing document
    await updateBlockContent(asset.notes_document_id, {
      block_data: JSON.stringify(blockData),
      user_id: userId
    });
    return { document_id: asset.notes_document_id };
  } else {
    // Create new document and link to asset
    const { document_id } = await createBlockDocument({
      document_name: `${asset.name} Notes`,
      user_id: userId,
      block_data: JSON.stringify(blockData),
      entityId: assetId,
      entityType: 'asset'
    });

    // Update asset with notes_document_id
    await updateAsset(assetId, { notes_document_id: document_id });
    return { document_id };
  }
}
```

#### 1.4.3 RMM Actions
**File**: `ee/server/src/lib/actions/asset-actions/rmmActions.ts` (new file)

```typescript
// Get cached RMM data from database (fast, no API call)
export async function getAssetRmmData(assetId: string): Promise<RmmCachedData | null>

// Trigger single-device sync and return updated data
export async function refreshAssetRmmData(assetId: string): Promise<RmmCachedData | null>

// Get remote control URL
export async function getAssetRemoteControlUrl(assetId: string): Promise<string | null>

// Trigger RMM actions (for Actions dropdown)
export async function triggerRmmReboot(assetId: string): Promise<{ success: boolean, message: string }>
export async function triggerRmmScript(assetId: string, scriptId: string): Promise<{ success: boolean, jobId: string }>
```

---

### 1.5 Interface Updates

#### 1.5.1 New Types
**File**: `server/src/interfaces/asset.interfaces.tsx`

```typescript
export interface AssetSummaryMetrics {
  health_status: 'healthy' | 'warning' | 'critical' | 'unknown';
  health_reason: string | null;
  open_tickets_count: number;
  security_status: 'secure' | 'at_risk' | 'critical';
  security_issues: string[];
  warranty_days_remaining: number | null;
  warranty_status: 'active' | 'expiring_soon' | 'expired' | 'unknown';
}

// Add to Asset interface:
export interface Asset {
  // ... existing fields ...
  notes_document_id?: string | null;  // Reference to document for BlockNote notes
}
```

**File**: `ee/server/src/interfaces/rmm.interfaces.ts`

```typescript
// Cached RMM data from database (populated during sync)
export interface RmmCachedData {
  provider: RmmProvider;
  agent_status: 'online' | 'offline' | 'unknown';
  last_check_in: string | null;
  last_rmm_sync_at: string | null;  // When we last synced from RMM
  current_user: string | null;
  uptime_seconds: number | null;
  lan_ip: string | null;
  wan_ip: string | null;
  cpu_utilization_percent: number | null;
  memory_utilization_percent: number | null;
  memory_used_gb: number | null;
  memory_total_gb: number | null;
  storage: RmmStorageInfo[];
}

export interface RmmStorageInfo {
  name: string;
  total_gb: number;
  free_gb: number;
  utilization_percent: number;  // Calculated: (total - free) / total * 100
}

// Workstation extension fields for RMM cache
export interface RmmWorkstationCacheFields {
  current_user: string | null;
  uptime_seconds: number | null;
  lan_ip: string | null;
  wan_ip: string | null;
  cpu_utilization_percent: number | null;
  memory_usage_percent: number | null;
  memory_used_gb: number | null;
  disk_usage: RmmStorageInfo[] | null;
}
```

**File**: `server/src/interfaces/software.interfaces.ts` (new file)

```typescript
// Canonical software entry (deduplicated per tenant)
export interface SoftwareCatalogEntry {
  software_id: string;
  tenant: string;
  name: string;
  publisher: string | null;
  normalized_name: string;
  category: string | null;           // 'Browser', 'Security', 'Productivity', etc.
  software_type: 'application' | 'driver' | 'update' | 'system';
  is_managed: boolean;               // Tracked for patching/licensing
  is_security_relevant: boolean;     // Antivirus, firewall, etc.
  created_at: string;
  updated_at: string;
}

// Software installed on a specific asset
export interface AssetSoftwareInstall {
  tenant: string;
  asset_id: string;
  software_id: string;
  version: string | null;
  install_date: string | null;
  install_path: string | null;
  size_bytes: number | null;
  first_seen_at: string;
  last_seen_at: string;
  is_current: boolean;
  uninstalled_at: string | null;

  // Joined from software_catalog (when needed)
  software?: SoftwareCatalogEntry;
}

// For display in asset detail software tab
export interface AssetSoftwareDisplayItem {
  software_id: string;
  name: string;
  publisher: string | null;
  category: string | null;
  version: string | null;
  install_date: string | null;
  size_bytes: number | null;
  first_seen_at: string;
  is_current: boolean;
}

// For fleet-wide software search results
export interface SoftwareSearchResult {
  software_id: string;
  name: string;
  publisher: string | null;
  category: string | null;
  install_count: number;             // How many assets have this installed
  assets: Array<{
    asset_id: string;
    asset_name: string;
    client_id: string;
    client_name: string;
    version: string | null;
  }>;
}
```

---

### 1.6 Backend Task Checklist

**Database & Migrations:**
- [ ] Create migration for RMM cached fields on workstation/server tables (cpu, memory, IPs, disk_usage)
- [ ] Create migration to add `notes_document_id` to assets table with FK to documents
- [ ] Create migration for normalized software tables (`software_catalog`, `asset_software`)
- [ ] Create migration to populate normalized tables from existing JSONB data
- [ ] Create helper view `v_asset_software_details`

**Sync Engine:**
- [ ] Update device mapper to extract current_user, uptime, IPs, CPU, memory, disk_usage
- [ ] Add `syncSingleDeviceById()` method for on-demand refresh
- [ ] Ensure all new fields are populated during full/incremental sync
- [ ] Refactor `softwareSync.ts` to use normalized tables instead of JSONB
- [ ] Implement `findOrCreateSoftwareCatalogEntry()` with deduplication
- [ ] Implement soft-delete for uninstalled software (`is_current = false`)
- [ ] Add optional category inference for common software

**API Endpoints:**
- [ ] Create `GET /api/assets/[assetId]/rmm` endpoint (reads from DB cache)
- [ ] Create `POST /api/assets/[assetId]/rmm/refresh` endpoint (triggers single-device sync)
- [ ] Create `GET /api/assets/[assetId]/summary` endpoint
- [ ] Create `GET /api/assets/[assetId]/software` endpoint (paginated, filterable)
- [ ] Create `GET /api/software/search` endpoint (fleet-wide software search)

**Server Actions:**
- [ ] Create `assetNoteActions.ts` with `getAssetNoteContent()` and `saveAssetNote()`
- [ ] Create `rmmActions.ts` with `getAssetRmmData()` and `refreshAssetRmmData()`
- [ ] Add `getAssetSummaryMetrics()` server action
- [ ] Add `getAssetRemoteControlUrl()` action
- [ ] Create `softwareActions.ts` with `getAssetSoftware()`, `searchSoftwareFleetWide()`

**Interface Updates:**
- [ ] Add `notes_document_id` to Asset interface
- [ ] Add `RmmCachedData` and `RmmWorkstationCacheFields` interfaces
- [ ] Add `AssetSummaryMetrics` interface
- [ ] Add `SoftwareCatalogEntry` and `AssetSoftwareInstall` interfaces

**RMM Integration:**
- [ ] Research and implement NinjaOne remote control URL generation
- [ ] Add NinjaOne API methods for script execution (for Actions menu)

**Testing:**
- [ ] Add unit tests for new endpoints
- [ ] Add integration tests for RMM data sync and refresh
- [ ] Add tests for software sync with normalized tables
- [ ] Add tests for software deduplication logic

---

## Part 2: UI Updates

### 2.1 Component Architecture

#### New Component Structure
```
server/src/components/assets/
├── AssetDetailView.tsx              # New: Full-page detail view (replaces drawer for RMM assets)
├── AssetDetailHeader.tsx            # New: Header with status badge and action buttons
├── AssetMetricsBanner.tsx           # New: Key metrics summary banner
├── AssetDashboardGrid.tsx           # New: Two-column dashboard layout
├── panels/
│   ├── RmmVitalsPanel.tsx           # New: Live RMM connectivity data
│   ├── HardwareSpecsPanel.tsx       # New: Enhanced hardware with utilization bars
│   ├── SecurityPatchingPanel.tsx    # New: Security & patching status
│   ├── AssetInfoPanel.tsx           # New: Static asset info & lifecycle
│   └── AssetNotesPanel.tsx          # New: Technician notes
├── tabs/
│   ├── ServiceHistoryTab.tsx        # Enhanced: Ticket history
│   ├── SoftwareInventoryTab.tsx     # Enhanced: Searchable software list
│   ├── MaintenanceSchedulesTab.tsx  # Enhanced: Schedule list view
│   ├── RelatedAssetsTab.tsx         # Existing: Related assets
│   ├── DocumentsPasswordsTab.tsx    # Existing: Documents
│   └── AuditLogTab.tsx              # New: Asset change audit trail
└── shared/
    ├── StatusBadge.tsx              # New: Reusable status badges
    ├── UtilizationBar.tsx           # New: Visual utilization bars
    └── CopyableField.tsx            # New: Field with copy-to-clipboard
```

---

### 2.2 Header & Quick Actions Bar

#### 2.2.1 AssetDetailHeader Component
**File**: `server/src/components/assets/AssetDetailHeader.tsx`

**Layout**:
```
┌─────────────────────────────────────────────────────────────────────────┐
│ [Icon] Asset Name  [● Online - NinjaOne]          [Remote] [Ticket] [▾]│
│         Asset Tag: NINJA-K93H2QG3GH                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features**:
- Asset type icon (Mac, Windows, Server, etc.)
- Large asset name with RMM status badge
- Status badge color: green (online), gray (offline), orange (unknown)
- Badge shows provider name (NinjaOne, Datto, etc.)
- Asset tag displayed subtly below name
- Action buttons right-aligned:
  - **Remote Control** (blue, prominent) - opens RMM remote session
  - **Create Ticket** - existing functionality, pre-fills asset
  - **Actions** dropdown:
    - Run RMM Script (submenu with available scripts)
    - Edit Asset
    - Reboot Device (RMM action)
    - Archive Asset
    - Delete Asset

---

### 2.3 Key Metrics Summary Banner

#### 2.3.1 AssetMetricsBanner Component
**File**: `server/src/components/assets/AssetMetricsBanner.tsx`

**Layout**:
```
┌────────────────┬────────────────┬────────────────┬────────────────┐
│ Health Status  │  Open Tickets  │ Security Status│   Warranty     │
│ [✓ Healthy]    │  [2 Active]    │ [⚠ 3 Missing]  │ [142 Days]     │
└────────────────┴────────────────┴────────────────┴────────────────┘
```

**Features**:
- Four equal-width panels in horizontal layout
- Each panel has:
  - Label (small, gray text)
  - Value with status icon
  - Color coding based on status
- **Health Status**:
  - Green checkmark for healthy
  - Yellow warning for issues
  - Red X for critical
  - Tooltip with reason if unhealthy
- **Open Tickets**:
  - Clickable, navigates to tickets tab
  - Shows count with "Active" label
- **Security Status**:
  - Green: "Secure"
  - Yellow: "X Missing Patches" with warning icon
  - Red: "Critical" for antivirus issues
- **Warranty**:
  - Green: > 90 days remaining
  - Yellow: 30-90 days ("Expiring Soon")
  - Red: < 30 days or expired
  - Gray: Unknown/not set

---

### 2.4 Main Dashboard Grid

#### 2.4.1 AssetDashboardGrid Component
**File**: `server/src/components/assets/AssetDashboardGrid.tsx`

**Layout**:
```
┌─────────────────────────────────────┬──────────────────────────┐
│ RMM Vitals & Connectivity           │ Asset Info & Lifecycle   │
│ (Panel A)                           │ (Panel D)                │
├─────────────────────────────────────┤                          │
│ Hardware Specifications             │                          │
│ (Panel B)                           ├──────────────────────────┤
├─────────────────────────────────────┤ Notes & Quick Info       │
│ Security & Patching                 │ (Panel E)                │
│ (Panel C)                           │                          │
└─────────────────────────────────────┴──────────────────────────┘
```

**Implementation**:
- CSS Grid with 2 columns (2fr 1fr ratio)
- Left column: 3 stacked panels
- Right column: 2 panels (Info taller, Notes shorter)
- Responsive: Stack vertically on mobile

---

### 2.5 Dashboard Panels

#### 2.5.1 RmmVitalsPanel
**File**: `server/src/components/assets/panels/RmmVitalsPanel.tsx`

**Content**:
```
RMM Vitals & Connectivity                              [🔄 Refresh]
─────────────────────────────────────────────────────────────────────
Agent Status:   Online (Last check-in: 2 minutes ago)
Current User:   j.appleseed
Uptime:         4 days, 12 hours, 33 minutes
Last RMM Sync:  Today, 10:45 AM                    ← "as of" indicator
Network:        LAN IP: 192.168.1.45 [📋]  |  WAN IP: 45.12.123.99 [📋]
```

**Features**:
- Data loaded from database cache (instant display on page load)
- **"Last RMM Sync"** shows when data was last refreshed from NinjaOne
- **Refresh button** triggers `POST /api/assets/[assetId]/rmm/refresh`
  - Shows loading spinner during refresh
  - Updates all displayed data on completion
- Status indicator with time since last check-in
- Copy-to-clipboard buttons for IPs
- Graceful degradation when RMM data unavailable (show "Not connected to RMM")
- Loading skeleton on initial page load

#### 2.5.2 HardwareSpecsPanel
**File**: `server/src/components/assets/panels/HardwareSpecsPanel.tsx`

**Content**:
```
Hardware Specifications
───────────────────────
CPU:     Apple M4 Max (12 Cores)  |  Utilization: [██████────] 45%
RAM:     32GB Unified Memory      |  Utilization: [████████──] 78% (25GB Used)
Storage: Macintosh HD (NVMe): 1.85TB Total  |  [██████████] 1.2TB Free
GPU:     Apple M4 Max (38-core GPU)
```

**Features**:
- Visual utilization bars (animated)
- Color-coded utilization (green < 70%, yellow 70-90%, red > 90%)
- Multiple storage drives if applicable
- Tooltips with exact values
- Show "N/A" gracefully for missing data

#### 2.5.3 SecurityPatchingPanel
**File**: `server/src/components/assets/panels/SecurityPatchingPanel.tsx`

**Content**:
```
Security & Patching
───────────────────
OS Version:     macOS Sonoma 14.5 (Latest Build)
Antivirus:      SentinelOne [✓ Installed & Running]  |  Last Scan: Today, 3:00 AM
Patch Status:   [⚠ At Risk] - 3 Critical OS Patches missing.
Firewall:       [✓ On]
```

**Features**:
- Status indicators with icons (checkmarks, warnings)
- Color-coded status badges
- Patch count with severity breakdown
- Click patch status to see details (modal or expand)
- Antivirus product name and status

#### 2.5.4 AssetInfoPanel
**File**: `server/src/components/assets/panels/AssetInfoPanel.tsx`

**Content**:
```
Asset Info & Lifecycle
──────────────────────
Client:         Emerald City →
Location:       HQ - Floor 2, Design Dept.
Model:          MacBook Pro 16-inch (M4 Max, Late 2024)
Serial:         K93H2QG3GH
Purchase Date:  01/15/2025
Warranty End:   01/15/2026 (AppleCare+)
```

**Features**:
- Client name is a link to client dashboard
- All static data from asset record
- Serial number with copy button
- Warranty with status indicator

#### 2.5.5 AssetNotesPanel
**File**: `server/src/components/assets/panels/AssetNotesPanel.tsx`

**Content**:
```
Notes & Quick Info                                         [Save]
──────────────────────────────────────────────────────────────────
┌────────────────────────────────────────────────────────────────┐
│ [BlockNote Editor]                                              │
│                                                                 │
│ • User is VIP, handle with care.                               │
│ • Known issue with USB-C port 2. - @t.smith                    │
│                                                                 │
│ Last updated: Today, 2:30 PM by j.smith                        │
└────────────────────────────────────────────────────────────────┘
```

**Features** (following company notes pattern):
- Uses existing `TextEditor` component (BlockNote) for rich formatting
- Supports all BlockNote features: headings, lists, bold, italic, etc.
- **@mentions** supported (triggers user search, sends notifications)
- **Auto-save** on content change (debounced) or explicit Save button
- Document stored in `documents` + `document_block_content` tables
- Linked to asset via `assets.notes_document_id`
- Shows "Add a note..." placeholder when no note exists
- Displays last updated timestamp and author from document metadata

**Implementation** (mirrors `ClientDetails.tsx` notes handling):
```typescript
// Load note on mount
useEffect(() => {
  if (asset.notes_document_id) {
    const content = await getBlockContent(asset.notes_document_id);
    setCurrentContent(content.block_data);
  }
}, [asset.notes_document_id]);

// Save note
const handleSaveNote = async () => {
  await saveAssetNote(asset.asset_id, currentContent, currentUser.user_id);
};
```

---

### 2.6 Tabbed Navigation

#### 2.6.1 Enhanced Tab Structure
**File**: `server/src/components/assets/AssetDetailTabs.tsx`

**Tabs**:
1. **Service History (Tickets)** - Default active
2. **Software Inventory**
3. **Maintenance Schedules**
4. **Related Assets**
5. **Documents & Passwords**
6. **Audit Log**

#### 2.6.2 ServiceHistoryTab
**File**: `server/src/components/assets/tabs/ServiceHistoryTab.tsx`

**Content**:
```
┌──────────┬──────────────────────────────────┬────────────┬─────────────┐
│ Ticket ID│ Subject                          │ Status     │ Date Closed │
├──────────┼──────────────────────────────────┼────────────┼─────────────┤
│ #12345   │ Outlook Crashing                 │ In Progress│ N/A         │
│ #12300   │ New User Setup                   │ Closed     │ 10/25/2025  │
│ #12289   │ RAM Upgrade Request              │ Closed     │ 10/20/2025  │
└──────────┴──────────────────────────────────┴────────────┴─────────────┘
```

**Features**:
- Sortable columns
- Ticket ID links to ticket detail
- Status with color-coded badge
- Pagination for long histories
- "Create Ticket" button in tab header

#### 2.6.3 SoftwareInventoryTab
**File**: `server/src/components/assets/tabs/SoftwareInventoryTab.tsx`

**Content** (using normalized tables):
```
┌────────────────────────┬──────────┬─────────────────┬────────────┬─────────────┐
│ Name                   │ Version  │ Publisher       │ Category   │ First Seen  │
├────────────────────────┼──────────┼─────────────────┼────────────┼─────────────┤
│ Google Chrome          │ 120.0.1  │ Google LLC      │ Browser    │ 10/15/2025  │
│ Microsoft Office 365   │ 16.80    │ Microsoft       │ Productivi │ 01/15/2025  │
│ SentinelOne Agent      │ 23.1.2   │ SentinelOne     │ Security   │ 01/15/2025  │
│ Visual Studio Code     │ 1.85.0   │ Microsoft       │ Developmen │ 09/01/2025  │
└────────────────────────┴──────────┴─────────────────┴────────────┴─────────────┘
                                              [Show uninstalled software ☐]
```

**Features**:
- Queries `asset_software` + `software_catalog` (fast, indexed)
- Searchable by name, publisher
- Sortable by any column
- **Filter by category** dropdown (Browser, Security, Productivity, etc.)
- **Toggle "Show uninstalled"** to see software that was removed
- Version change indicator (if version differs from last sync)
- First seen date (when we first detected installation)
- Export to CSV option

**Data Hook**:
```typescript
function useAssetSoftware(assetId: string, options: {
  search?: string;
  category?: string;
  showUninstalled?: boolean;
}) {
  return useQuery({
    queryKey: ['asset', assetId, 'software', options],
    queryFn: () => getAssetSoftware(assetId, options),
  });
}
```

#### 2.6.4 MaintenanceSchedulesTab
**File**: `server/src/components/assets/tabs/MaintenanceSchedulesTab.tsx`

**Content**:
```
Upcoming
────────
[📅] Quarterly Disk Cleanup        Due: 11/01/2025     [Mark Complete]
[📅] Annual Security Audit         Due: 01/15/2026     [Mark Complete]

Past Maintenance
────────────────
[✓] Monthly Backup Verification    Completed: 10/01/2025 by j.smith
[✓] Quarterly Disk Cleanup         Completed: 08/01/2025 by t.jones
```

**Features**:
- Upcoming vs completed sections
- Due date with color coding (overdue = red)
- Mark complete action
- Link to schedule recurring tasks

#### 2.6.5 AuditLogTab (New)
**File**: `server/src/components/assets/tabs/AuditLogTab.tsx`

**Content**:
```
Timeline
────────
Today, 10:45 AM    │ RMM Sync         System synced device data from NinjaOne
Yesterday, 2:30 PM │ Field Updated    Location changed from "Floor 1" to "Floor 2"
                   │                  by j.smith
10/25/2025         │ Ticket Closed    #12300 "New User Setup" resolved
10/20/2025         │ Asset Created    Asset created by t.jones
```

**Features**:
- Timeline view of asset changes
- WHO/WHAT/WHEN for each entry
- Filter by change type
- Pagination for long histories

---

### 2.7 Shared Components

#### 2.7.1 StatusBadge
**File**: `server/src/components/assets/shared/StatusBadge.tsx`

```typescript
interface StatusBadgeProps {
  status: 'online' | 'offline' | 'healthy' | 'warning' | 'critical' | 'unknown';
  provider?: string;  // e.g., "NinjaOne"
  size?: 'sm' | 'md' | 'lg';
}
```

#### 2.7.2 UtilizationBar
**File**: `server/src/components/assets/shared/UtilizationBar.tsx`

```typescript
interface UtilizationBarProps {
  value: number;  // 0-100
  label?: string;  // e.g., "45%"
  showLabel?: boolean;
  colorThresholds?: { warning: number; critical: number };
}
```

#### 2.7.3 CopyableField
**File**: `server/src/components/assets/shared/CopyableField.tsx`

```typescript
interface CopyableFieldProps {
  label: string;
  value: string;
  showCopyButton?: boolean;
}
```

---

### 2.8 State Management & Data Fetching

#### 2.8.1 Asset Detail Data Hook
**File**: `server/src/hooks/useAssetDetail.ts`

```typescript
function useAssetDetail(assetId: string) {
  // Fetch base asset data (includes notes_document_id)
  const { data: asset, isLoading: assetLoading } = useQuery({
    queryKey: ['asset', assetId],
    queryFn: () => getAsset(assetId),
  })

  // Fetch summary metrics
  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['asset', assetId, 'summary'],
    queryFn: () => getAssetSummaryMetrics(assetId),
  })

  // Fetch cached RMM data from database (fast, no external API call)
  const { data: rmmData, isLoading: rmmLoading, refetch: refetchRmm } = useQuery({
    queryKey: ['asset', assetId, 'rmm'],
    queryFn: () => getAssetRmmData(assetId),
    // No automatic polling - data comes from our DB cache
    // User can manually refresh via button
  })

  // Manual refresh function
  const refreshRmmData = useMutation({
    mutationFn: () => refreshAssetRmmData(assetId),
    onSuccess: () => refetchRmm(),
  })

  return {
    asset,
    metrics,
    rmmData,
    isLoading: assetLoading || metricsLoading,
    refreshRmmData: refreshRmmData.mutate,
    isRefreshing: refreshRmmData.isPending,
  }
}
```

#### 2.8.2 Asset Notes Hook (Using Document System)
**File**: `server/src/hooks/useAssetNotes.ts`

```typescript
function useAssetNotes(assetId: string, notesDocumentId: string | null) {
  // Fetch note content from document system
  const { data: noteContent, isLoading } = useQuery({
    queryKey: ['asset', assetId, 'notes'],
    queryFn: () => getAssetNoteContent(assetId),
    enabled: !!assetId,
  })

  // Save note mutation
  const { mutate: saveNote, isPending: isSaving } = useMutation({
    mutationFn: (blockData: PartialBlock[]) =>
      saveAssetNote(assetId, blockData, currentUser.user_id),
    onSuccess: () => {
      // Invalidate asset query to get updated notes_document_id
      queryClient.invalidateQueries({ queryKey: ['asset', assetId] });
    },
  })

  return {
    noteContent: noteContent?.blockData,
    noteDocument: noteContent?.document,
    isLoading,
    saveNote,
    isSaving,
  }
}
```

---

### 2.9 UI Task Checklist

**Core Layout Components:**
- [ ] Create AssetDetailView component (full-page layout)
- [ ] Create AssetDetailHeader with status badge and action buttons
- [ ] Create AssetMetricsBanner with four metric panels
- [ ] Create AssetDashboardGrid with responsive two-column layout

**Dashboard Panels:**
- [ ] Create RmmVitalsPanel with cached data display and refresh button
- [ ] Create HardwareSpecsPanel with utilization bars (uses cached disk_usage, cpu, memory)
- [ ] Create SecurityPatchingPanel with status indicators
- [ ] Create AssetInfoPanel with client link
- [ ] Create AssetNotesPanel with BlockNote editor (uses TextEditor component)

**Tab Components:**
- [ ] Enhance ServiceHistoryTab with sortable columns
- [ ] Create SoftwareInventoryTab with search/filter
- [ ] Enhance MaintenanceSchedulesTab with list view
- [ ] Create AuditLogTab with timeline view

**Shared Components:**
- [ ] Create StatusBadge shared component
- [ ] Create UtilizationBar shared component
- [ ] Create CopyableField shared component

**Hooks & State:**
- [ ] Create useAssetDetail hook (fetches asset, metrics, cached RMM data)
- [ ] Add manual refresh functionality to useAssetDetail
- [ ] Create useAssetNotes hook (integrates with document system)

**Polish & Testing:**
- [ ] Add loading skeletons for all panels
- [ ] Add error states for failed data fetching
- [ ] Implement responsive design for mobile/tablet
- [ ] Add keyboard navigation for accessibility
- [ ] Write component tests
- [ ] Update existing drawer to use new components (or replace entirely)

---

## Implementation Order

### Phase 1: Database Foundation
1. Database migrations:
   - RMM cached fields on workstation/server tables
   - `notes_document_id` on assets table
   - Normalized software tables (`software_catalog`, `asset_software`)
   - Helper view `v_asset_software_details`
2. Data migration script: Populate normalized tables from existing JSONB
3. Interface/type updates (Asset, RmmCachedData, SoftwareCatalogEntry, etc.)

### Phase 2: Sync Engine Updates
1. Device mapper enhancements for all cached RMM fields
2. Single-device refresh sync method (`syncSingleDeviceById`)
3. Refactor `softwareSync.ts` to use normalized tables
4. Implement `findOrCreateSoftwareCatalogEntry()` with deduplication
5. Implement soft-delete for uninstalled software
6. Add category inference for common software

### Phase 3: Backend API & Actions
1. `assetNoteActions.ts` (uses existing document system)
2. `rmmActions.ts` (getAssetRmmData, refreshAssetRmmData)
3. `softwareActions.ts` (getAssetSoftware, searchSoftwareFleetWide)
4. Summary metrics server action
5. RMM data endpoints (GET cached, POST refresh)
6. Software endpoints (asset software list, fleet search)

### Phase 4: Core UI Components
1. Shared components (StatusBadge, UtilizationBar, CopyableField)
2. Data fetching hooks (useAssetDetail, useAssetNotes, useAssetSoftware)
3. AssetDetailHeader
4. AssetMetricsBanner

### Phase 5: Dashboard Panels
1. AssetInfoPanel (uses existing data)
2. AssetNotesPanel (with BlockNote editor)
3. HardwareSpecsPanel (uses cached data)
4. SecurityPatchingPanel
5. RmmVitalsPanel (with refresh button)

### Phase 6: Tabbed Content
1. ServiceHistoryTab (enhance existing)
2. SoftwareInventoryTab (queries normalized tables, searchable, filterable by category)
3. MaintenanceSchedulesTab (enhance existing)
4. AuditLogTab (new)

### Phase 7: Integration & Polish
1. AssetDashboardGrid layout
2. AssetDetailView full page
3. Action button functionality (remote control, etc.)
4. Responsive design
5. Testing and refinement
6. Deprecate/remove JSONB `installed_software` columns (after validation)

---

## Dependencies & Considerations

### External Dependencies
- NinjaOne API access for device detail data
- Remote control URL generation (research needed)
- Script execution API (for Actions menu)

### Existing Code Impact
- `AssetDetailDrawer.tsx` - May be replaced or heavily modified
- `AssetDetails.tsx` - Components will be restructured
- `AssetForm.tsx` - May need updates for new fields
- Sync engine - Enhanced to populate all cached fields

### Leveraging Existing Systems
- **Document System**: Asset notes use existing `documents` + `document_block_content` tables
- **BlockNote Editor**: Use existing `TextEditor` component with @mentions
- **Document Actions**: Use existing `createBlockDocument()`, `getBlockContent()`, `updateBlockContent()`
- **Company Notes Pattern**: Follow same flow as `ClientDetails.tsx`

### EE vs CE Split
- RMM-specific panels (RmmVitalsPanel, SecurityPatchingPanel) are EE-only
- Base asset info and notes are CE (notes use CE document system)
- Graceful degradation when RMM not connected

### Performance Considerations
- **Database-cached RMM data**: Instant page load, no external API calls on view
- **Manual refresh**: User-triggered sync for fresh data when needed
- **Automatic sync**: Background job keeps cache reasonably fresh
- Use React Query for efficient data fetching and cache invalidation
- Lazy load tab content
- Skeleton loading states for perceived performance

---

## Task Breakdown

### Backend Phases & Tasks

#### Phase B1: Database Migrations
| Task | Description | Plan Reference |
|------|-------------|----------------|
| B1.1 | Create migration for RMM cached fields (current_user, uptime, IPs, CPU, memory, disk_usage) on workstation_assets and server_assets | §1.2.1 |
| B1.2 | Create migration to add `notes_document_id` to assets table with FK to documents | §1.2.2 |
| B1.3 | Create migration for `software_catalog` table | §1.2.3 |
| B1.4 | Create migration for `asset_software` junction table | §1.2.3 |
| B1.5 | Create helper view `v_asset_software_details` | §1.2.3 |
| B1.6 | Create data migration script to populate normalized tables from existing JSONB | §1.2.3 |

#### Phase B2: Interface & Type Definitions
| Task | Description | Plan Reference |
|------|-------------|----------------|
| B2.1 | Add `notes_document_id` to Asset interface | §1.5.1 |
| B2.2 | Create `RmmCachedData` interface | §1.5.1 |
| B2.3 | Create `RmmStorageInfo` interface | §1.5.1 |
| B2.4 | Create `RmmWorkstationCacheFields` interface | §1.5.1 |
| B2.5 | Create `AssetSummaryMetrics` interface | §1.5.1 |
| B2.6 | Create `software.interfaces.ts` with SoftwareCatalogEntry, AssetSoftwareInstall, etc. | §1.5.1 |

#### Phase B3: Sync Engine Updates
| Task | Description | Plan Reference |
|------|-------------|----------------|
| B3.1 | Update device mapper to extract current_user, uptime_seconds | §1.3.1 |
| B3.2 | Update device mapper to extract lan_ip, wan_ip | §1.3.1 |
| B3.3 | Update device mapper to extract cpu_utilization_percent, memory stats | §1.3.1 |
| B3.4 | Update device mapper to extract disk_usage array | §1.3.1 |
| B3.5 | Add helper functions: extractPrimaryLanIp, calculateMemoryUsedGb, mapDiskUsage | §1.3.1 |
| B3.6 | Add `syncSingleDeviceById()` method for on-demand refresh | §1.3.2 |
| B3.7 | Refactor `softwareSync.ts` to use normalized tables | §1.3.3 |
| B3.8 | Implement `findOrCreateSoftwareCatalogEntry()` with deduplication | §1.3.3 |
| B3.9 | Implement soft-delete for uninstalled software (is_current = false) | §1.3.3 |
| B3.10 | Add `inferSoftwareCategory()` for auto-categorization | §1.3.3 |

#### Phase B4: Server Actions
| Task | Description | Plan Reference |
|------|-------------|----------------|
| B4.1 | Create `assetNoteActions.ts` with `getAssetNoteContent()` | §1.4.2 |
| B4.2 | Add `saveAssetNote()` to assetNoteActions.ts | §1.4.2 |
| B4.3 | Create `rmmActions.ts` with `getAssetRmmData()` | §1.4.3 |
| B4.4 | Add `refreshAssetRmmData()` to rmmActions.ts | §1.4.3 |
| B4.5 | Add `getAssetRemoteControlUrl()` to rmmActions.ts | §1.4.3 |
| B4.6 | Add `triggerRmmReboot()` and `triggerRmmScript()` to rmmActions.ts | §1.4.3 |
| B4.7 | Add `getAssetSummaryMetrics()` server action | §1.4.1 |
| B4.8 | Create `softwareActions.ts` with `getAssetSoftware()` | §1.6 (checklist) |
| B4.9 | Add `searchSoftwareFleetWide()` to softwareActions.ts | §1.6 (checklist) |

#### Phase B5: API Endpoints
| Task | Description | Plan Reference |
|------|-------------|----------------|
| B5.1 | Create `GET /api/assets/[assetId]/rmm` endpoint (reads from DB cache) | §1.1.1 |
| B5.2 | Create `POST /api/assets/[assetId]/rmm/refresh` endpoint | §1.1.1 |
| B5.3 | Create `GET /api/assets/[assetId]/summary` endpoint | §1.1.2 |
| B5.4 | Create `GET /api/assets/[assetId]/software` endpoint (paginated, filterable) | §1.6 (checklist) |
| B5.5 | Create `GET /api/software/search` endpoint (fleet-wide search) | §1.6 (checklist) |

#### Phase B6: RMM Integration Research
| Task | Description | Plan Reference |
|------|-------------|----------------|
| B6.1 | Research NinjaOne API for remote control URL generation | §1.1.3 |
| B6.2 | Implement remote control URL generation | §1.1.3 |
| B6.3 | Research NinjaOne API for script execution | §1.6 (checklist) |
| B6.4 | Implement script execution actions | §1.4.3 |

#### Phase B7: Backend Testing
| Task | Description | Plan Reference |
|------|-------------|----------------|
| B7.1 | Add unit tests for RMM data endpoints | §1.6 (checklist) |
| B7.2 | Add unit tests for summary metrics endpoint | §1.6 (checklist) |
| B7.3 | Add integration tests for RMM data sync and refresh | §1.6 (checklist) |
| B7.4 | Add tests for software sync with normalized tables | §1.6 (checklist) |
| B7.5 | Add tests for software deduplication logic | §1.6 (checklist) |
| B7.6 | Add tests for asset note actions | §1.6 (checklist) |

#### Phase B8: Cleanup
| Task | Description | Plan Reference |
|------|-------------|----------------|
| B8.1 | Validate normalized software data matches JSONB data | §1.2.3 |
| B8.2 | Deprecate/remove JSONB `installed_software` columns | Implementation Order |

---

### Frontend Phases & Tasks

#### Phase F1: Shared Components
| Task | Description | Plan Reference |
|------|-------------|----------------|
| F1.1 | Create `StatusBadge` component (online/offline/healthy/warning/critical) | §2.7.1 |
| F1.2 | Create `UtilizationBar` component with color thresholds | §2.7.2 |
| F1.3 | Create `CopyableField` component with clipboard button | §2.7.3 |

#### Phase F2: Data Fetching Hooks
| Task | Description | Plan Reference |
|------|-------------|----------------|
| F2.1 | Create `useAssetDetail` hook (fetches asset, metrics, cached RMM data) | §2.8.1 |
| F2.2 | Add manual refresh functionality to useAssetDetail | §2.8.1 |
| F2.3 | Create `useAssetNotes` hook (integrates with document system) | §2.8.2 |
| F2.4 | Create `useAssetSoftware` hook (paginated, filterable) | §2.6.3 |

#### Phase F3: Header & Metrics Banner
| Task | Description | Plan Reference |
|------|-------------|----------------|
| F3.1 | Create `AssetDetailHeader` component structure | §2.2.1 |
| F3.2 | Add asset type icon and name display | §2.2.1 |
| F3.3 | Add RMM status badge (Online/Offline - Provider) | §2.2.1 |
| F3.4 | Add Remote Control button (links to RMM) | §2.2.1 |
| F3.5 | Add Create Ticket button | §2.2.1 |
| F3.6 | Add Actions dropdown (Edit, Reboot, Run Script, Archive, Delete) | §2.2.1 |
| F3.7 | Create `AssetMetricsBanner` component structure | §2.3.1 |
| F3.8 | Add Health Status panel with tooltip | §2.3.1 |
| F3.9 | Add Open Tickets panel (clickable) | §2.3.1 |
| F3.10 | Add Security Status panel | §2.3.1 |
| F3.11 | Add Warranty panel with color-coded countdown | §2.3.1 |

#### Phase F4: Dashboard Panels - Left Column
| Task | Description | Plan Reference |
|------|-------------|----------------|
| F4.1 | Create `RmmVitalsPanel` component structure | §2.5.1 |
| F4.2 | Add agent status with last check-in time | §2.5.1 |
| F4.3 | Add current user display | §2.5.1 |
| F4.4 | Add uptime display (formatted) | §2.5.1 |
| F4.5 | Add last RMM sync timestamp ("as of" indicator) | §2.5.1 |
| F4.6 | Add network IPs with copy buttons | §2.5.1 |
| F4.7 | Add Refresh button with loading state | §2.5.1 |
| F4.8 | Create `HardwareSpecsPanel` component | §2.5.2 |
| F4.9 | Add CPU info with utilization bar | §2.5.2 |
| F4.10 | Add RAM info with utilization bar | §2.5.2 |
| F4.11 | Add storage drives with utilization bars | §2.5.2 |
| F4.12 | Add GPU info | §2.5.2 |
| F4.13 | Create `SecurityPatchingPanel` component | §2.5.3 |
| F4.14 | Add OS version display | §2.5.3 |
| F4.15 | Add antivirus status with product name | §2.5.3 |
| F4.16 | Add patch status with severity breakdown | §2.5.3 |
| F4.17 | Add firewall status | §2.5.3 |

#### Phase F5: Dashboard Panels - Right Column
| Task | Description | Plan Reference |
|------|-------------|----------------|
| F5.1 | Create `AssetInfoPanel` component | §2.5.4 |
| F5.2 | Add client name with link to dashboard | §2.5.4 |
| F5.3 | Add location display | §2.5.4 |
| F5.4 | Add model display | §2.5.4 |
| F5.5 | Add serial number with copy button | §2.5.4 |
| F5.6 | Add purchase date display | §2.5.4 |
| F5.7 | Add warranty end date with status indicator | §2.5.4 |
| F5.8 | Create `AssetNotesPanel` component | §2.5.5 |
| F5.9 | Integrate BlockNote TextEditor for notes | §2.5.5 |
| F5.10 | Add save functionality (auto-save or button) | §2.5.5 |
| F5.11 | Add last updated timestamp and author | §2.5.5 |
| F5.12 | Handle empty state ("Add a note...") | §2.5.5 |

#### Phase F6: Dashboard Layout
| Task | Description | Plan Reference |
|------|-------------|----------------|
| F6.1 | Create `AssetDashboardGrid` component with CSS Grid | §2.4.1 |
| F6.2 | Implement two-column layout (2fr 1fr) | §2.4.1 |
| F6.3 | Add responsive stacking for mobile | §2.4.1 |

#### Phase F7: Tabbed Content
| Task | Description | Plan Reference |
|------|-------------|----------------|
| F7.1 | Create `AssetDetailTabs` container component | §2.6.1 |
| F7.2 | Enhance `ServiceHistoryTab` with sortable columns | §2.6.2 |
| F7.3 | Add ticket ID links to ticket detail | §2.6.2 |
| F7.4 | Add status badges and pagination | §2.6.2 |
| F7.5 | Create `SoftwareInventoryTab` component | §2.6.3 |
| F7.6 | Add search input for software name/publisher | §2.6.3 |
| F7.7 | Add category filter dropdown | §2.6.3 |
| F7.8 | Add "Show uninstalled" toggle | §2.6.3 |
| F7.9 | Add sortable columns and pagination | §2.6.3 |
| F7.10 | Add CSV export option | §2.6.3 |
| F7.11 | Enhance `MaintenanceSchedulesTab` with list view | §2.6.4 |
| F7.12 | Add upcoming vs completed sections | §2.6.4 |
| F7.13 | Add mark complete action | §2.6.4 |
| F7.14 | Create `AuditLogTab` component | §2.6.5 |
| F7.15 | Add timeline view with WHO/WHAT/WHEN | §2.6.5 |
| F7.16 | Add change type filter | §2.6.5 |

#### Phase F8: Full Page Assembly
| Task | Description | Plan Reference |
|------|-------------|----------------|
| F8.1 | Create `AssetDetailView` full-page component | §2.1 |
| F8.2 | Integrate header, metrics banner, dashboard grid, and tabs | §2.1 |
| F8.3 | Add loading skeletons for all panels | §2.9 (checklist) |
| F8.4 | Add error states for failed data fetching | §2.9 (checklist) |
| F8.5 | Wire up action buttons (remote control, create ticket, etc.) | §2.2.1 |

#### Phase F9: Polish & Accessibility
| Task | Description | Plan Reference |
|------|-------------|----------------|
| F9.1 | Implement responsive design for tablet | §2.9 (checklist) |
| F9.2 | Implement responsive design for mobile | §2.9 (checklist) |
| F9.3 | Add keyboard navigation | §2.9 (checklist) |
| F9.4 | Add ARIA labels and roles | §2.9 (checklist) |
| F9.5 | Update existing drawer to use new components (or replace) | §2.9 (checklist) |

#### Phase F10: Frontend Testing
| Task | Description | Plan Reference |
|------|-------------|----------------|
| F10.1 | Write tests for shared components | §2.9 (checklist) |
| F10.2 | Write tests for data hooks | §2.9 (checklist) |
| F10.3 | Write tests for dashboard panels | §2.9 (checklist) |
| F10.4 | Write tests for tab components | §2.9 (checklist) |
| F10.5 | Write integration tests for full page | §2.9 (checklist) |

---

## Task Summary

### Backend: 8 Phases, 44 Tasks
| Phase | Name | Tasks |
|-------|------|-------|
| B1 | Database Migrations | 6 |
| B2 | Interface & Type Definitions | 6 |
| B3 | Sync Engine Updates | 10 |
| B4 | Server Actions | 9 |
| B5 | API Endpoints | 5 |
| B6 | RMM Integration Research | 4 |
| B7 | Backend Testing | 6 |
| B8 | Cleanup | 2 |

### Frontend: 10 Phases, 55 Tasks
| Phase | Name | Tasks |
|-------|------|-------|
| F1 | Shared Components | 3 |
| F2 | Data Fetching Hooks | 4 |
| F3 | Header & Metrics Banner | 11 |
| F4 | Dashboard Panels - Left Column | 17 |
| F5 | Dashboard Panels - Right Column | 12 |
| F6 | Dashboard Layout | 3 |
| F7 | Tabbed Content | 16 |
| F8 | Full Page Assembly | 5 |
| F9 | Polish & Accessibility | 5 |
| F10 | Frontend Testing | 5 |

### Recommended Execution Order
1. **B1** → **B2** → **B3** (Database and sync engine foundation)
2. **B4** → **B5** (Server actions and API endpoints)
3. **F1** → **F2** (Shared components and hooks - can start once B4/B5 are done)
4. **F3** → **F4** → **F5** → **F6** (UI components in parallel with backend)
5. **B6** (RMM integration research - can be parallel)
6. **F7** → **F8** (Tabs and full page assembly)
7. **B7** → **F9** → **F10** (Testing and polish)
8. **B8** (Cleanup after everything is validated)
