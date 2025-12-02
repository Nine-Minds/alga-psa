# RMM Data Management Architecture

## Executive Summary

This document defines the data management architecture for Remote Monitoring and Management (RMM) integrations in Alga PSA. The architecture establishes Alga PSA as the authoritative source of truth for asset data while supporting multiple external data sources, historical tracking, and comprehensive reporting capabilities.

## Table of Contents

1. [Design Principles](#design-principles)
2. [Data Storage Strategy](#data-storage-strategy)
3. [Current Schema Analysis](#current-schema-analysis)
4. [Proposed Schema Enhancements](#proposed-schema-enhancements)
5. [Data Ingestion Architecture](#data-ingestion-architecture)
6. [Sync Strategy](#sync-strategy)
7. [Migration Considerations](#migration-considerations)
8. [Implementation Roadmap](#implementation-roadmap)

---

## Design Principles

### Core Tenets

1. **Alga PSA as Source of Truth** - Asset records in Alga PSA represent the canonical view of managed assets, aggregating data from multiple sources
2. **Provider Agnostic Design** - All data structures and interfaces abstract away provider-specific details
3. **Historical Completeness** - Track changes over time for compliance, reporting, and troubleshooting
4. **Multi-Source Support** - Architecture accommodates multiple data sources reporting on the same physical asset
5. **Extensibility** - Design supports additional data sources without schema changes

---

## Data Strategy

### Why Alga PSA Should Store Asset Data

Alga PSA serves as the central business platform for managed service providers. Establishing data storage within Alga provides significant value:

**Unified Asset View**
- MSPs frequently manage assets across multiple RMM platforms (e.g., different tools for different client segments)
- A single PSA-stored asset record provides one authoritative view regardless of monitoring source
- Eliminates data silos and reduces context switching for technicians

**Historical Reporting and Analytics**
- RMM platforms often have limited historical data retention
- PSA-stored data enables long-term trend analysis, capacity planning, and executive reporting
- Historical software inventory enables license compliance audits spanning years

**Compliance and Auditing**
- Regulatory requirements (SOC 2, HIPAA, etc.) often mandate asset inventory documentation
- Immutable audit trails of hardware and software changes support compliance evidence
- Data availability independent of vendor relationships

**Provider Portability**
- Organizations change RMM vendors; PSA-stored data ensures continuity
- Historical context preserved during transitions
- Reduces lock-in to any single RMM platform

**Enhanced Business Context**
- PSA can enrich asset data with business context (contracts, billing, SLAs)
- Asset costs, warranty information, and lifecycle data integrate naturally
- Ticket and project history provides operational context

### Data Storage Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Alga PSA (Source of Truth)                 │
├─────────────────────────────────────────────────────────────────────┤
│  Asset Record                                                       │
│  ├── Core Identity (name, serial, asset_tag)                       │
│  ├── Business Context (client, location, status)                   │
│  ├── Hardware Details (CPU, RAM, storage)                          │
│  ├── Software Inventory (current + historical)                     │
│  ├── Patch Records (detailed history)                              │
│  ├── Performance Metrics (time-series)                             │
│  └── Change History (audit trail)                                  │
├─────────────────────────────────────────────────────────────────────┤
│  Data Sources (Contributors)                                        │
│  ├── RMM Integration A                                             │
│  ├── RMM Integration B                                             │
│  ├── Manual Entry                                                  │
│  └── Direct Agent Reporting                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Current Schema Analysis

### Existing Tables

#### Core Asset Tables
- `assets` - Base asset record with RMM fields (rmm_provider, rmm_device_id, agent_status, last_seen_at)
- `workstation_assets` - Extension for workstation-specific data
- `server_assets` - Extension for server-specific data
- `network_device_assets` - Extension for network device data
- `mobile_device_assets` - Extension for mobile device data
- `printer_assets` - Extension for printer data
- `asset_history` - Change audit trail

#### RMM Integration Tables
- `rmm_integrations` - Tenant RMM connection configuration
- `rmm_organization_mappings` - RMM org to Alga client mapping
- `rmm_alerts` - Synced alerts from RMM systems
- `rmm_alert_rules` - Alert-to-ticket automation rules

#### Supporting Tables
- `tenant_external_entity_mappings` - Cross-system entity correlation

### Current Limitations

1. **Single-Source Design**
   - `rmm_provider` field on assets is singular
   - No mechanism to reconcile data from multiple sources
   - Switching providers requires data migration

2. **Point-in-Time Software Data**
   - `installed_software` JSONB stores current state only
   - No history of software changes over time
   - Cannot answer "when was X installed/removed"

3. **Aggregate Patch Data**
   - Only `pending_patches`, `failed_patches` counts stored
   - No individual patch records
   - Cannot identify specific missing patches

4. **No Metrics Storage**
   - CPU/memory/disk usage captured as current values only
   - No time-series data for trend analysis
   - Cannot identify patterns or anomalies over time

5. **Limited Hardware Change Tracking**
   - Hardware changes only captured in generic `asset_history`
   - No structured hardware component inventory
   - Difficult to query component-level changes

---

## Proposed Schema Enhancements

### New Tables

#### 1. Asset Data Sources

Track all data sources contributing to an asset record:

```sql
CREATE TABLE asset_data_sources (
    tenant UUID NOT NULL,
    source_id UUID DEFAULT gen_random_uuid() NOT NULL,
    asset_id UUID NOT NULL,
    source_type VARCHAR(50) NOT NULL,  -- 'ninjaone', 'datto', 'direct', etc.
    integration_id UUID,                -- FK to rmm_integrations for external sources
    external_device_id VARCHAR(255),
    external_organization_id VARCHAR(255),
    is_primary BOOLEAN DEFAULT false,   -- Primary source for conflict resolution
    priority INTEGER DEFAULT 0,         -- Higher priority wins in conflicts
    agent_status VARCHAR(20),           -- 'online', 'offline', 'unknown'
    last_seen_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    sync_status VARCHAR(20) DEFAULT 'pending',
    sync_error TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (tenant, source_id),
    FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant, integration_id) REFERENCES rmm_integrations(tenant, integration_id) ON DELETE SET NULL,
    UNIQUE (tenant, asset_id, source_type, external_device_id)
);

CREATE INDEX idx_asset_data_sources_asset ON asset_data_sources(tenant, asset_id);
CREATE INDEX idx_asset_data_sources_external ON asset_data_sources(tenant, source_type, external_device_id);
```

#### 2. Software Inventory with History

Track software installations over time:

```sql
CREATE TABLE asset_software_inventory (
    tenant UUID NOT NULL,
    record_id UUID DEFAULT gen_random_uuid() NOT NULL,
    asset_id UUID NOT NULL,
    source_id UUID,                     -- Which data source reported this
    name VARCHAR(500) NOT NULL,
    version VARCHAR(100),
    publisher VARCHAR(255),
    install_date DATE,
    install_location VARCHAR(500),
    size_bytes BIGINT,
    software_type VARCHAR(50),          -- 'application', 'driver', 'update', etc.
    is_current BOOLEAN DEFAULT true,    -- Currently installed
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    removed_at TIMESTAMPTZ,             -- When software was uninstalled
    metadata JSONB DEFAULT '{}',

    PRIMARY KEY (tenant, record_id),
    FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant, source_id) REFERENCES asset_data_sources(tenant, source_id) ON DELETE SET NULL
);

CREATE INDEX idx_software_inventory_asset ON asset_software_inventory(tenant, asset_id);
CREATE INDEX idx_software_inventory_current ON asset_software_inventory(tenant, asset_id) WHERE is_current = true;
CREATE INDEX idx_software_inventory_name ON asset_software_inventory(tenant, name);
```

#### 3. Patch Records

Store individual patch details:

```sql
CREATE TABLE asset_patches (
    tenant UUID NOT NULL,
    record_id UUID DEFAULT gen_random_uuid() NOT NULL,
    asset_id UUID NOT NULL,
    source_id UUID,
    patch_id VARCHAR(100) NOT NULL,     -- KB number, update ID, etc.
    title VARCHAR(500) NOT NULL,
    description TEXT,
    severity VARCHAR(20),               -- 'critical', 'important', 'moderate', 'low'
    patch_type VARCHAR(50),             -- 'security', 'feature', 'driver', etc.
    category VARCHAR(100),              -- 'Windows Security', 'Office', etc.
    vendor VARCHAR(100),
    release_date DATE,
    status VARCHAR(30) NOT NULL,        -- 'pending', 'installed', 'failed', 'superseded'
    install_date TIMESTAMPTZ,
    failure_reason TEXT,
    requires_reboot BOOLEAN DEFAULT false,
    first_detected_at TIMESTAMPTZ NOT NULL,
    last_checked_at TIMESTAMPTZ NOT NULL,
    installed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',

    PRIMARY KEY (tenant, record_id),
    FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant, source_id) REFERENCES asset_data_sources(tenant, source_id) ON DELETE SET NULL,
    UNIQUE (tenant, asset_id, patch_id)
);

CREATE INDEX idx_patches_asset ON asset_patches(tenant, asset_id);
CREATE INDEX idx_patches_status ON asset_patches(tenant, status);
CREATE INDEX idx_patches_severity ON asset_patches(tenant, severity) WHERE status = 'pending';
```

#### 4. Performance Metrics Time-Series

Store historical performance data:

```sql
CREATE TABLE asset_metrics (
    tenant UUID NOT NULL,
    asset_id UUID NOT NULL,
    source_id UUID,
    metric_type VARCHAR(50) NOT NULL,   -- 'cpu', 'memory', 'disk', 'network'
    metric_name VARCHAR(100) NOT NULL,  -- 'usage_percent', 'bytes_used', etc.
    metric_value DECIMAL(15, 4) NOT NULL,
    metric_unit VARCHAR(20),            -- 'percent', 'bytes', 'iops', etc.
    dimension VARCHAR(100),             -- disk drive letter, network interface, etc.
    recorded_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (tenant, asset_id, metric_type, metric_name, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Create monthly partitions (automated by maintenance job)
CREATE INDEX idx_metrics_asset_time ON asset_metrics(tenant, asset_id, recorded_at DESC);
CREATE INDEX idx_metrics_type ON asset_metrics(tenant, metric_type, recorded_at DESC);
```

#### 5. Hardware Components

Track hardware component inventory:

```sql
CREATE TABLE asset_hardware_components (
    tenant UUID NOT NULL,
    component_id UUID DEFAULT gen_random_uuid() NOT NULL,
    asset_id UUID NOT NULL,
    source_id UUID,
    component_type VARCHAR(50) NOT NULL, -- 'cpu', 'memory', 'disk', 'network_adapter', etc.
    manufacturer VARCHAR(255),
    model VARCHAR(255),
    serial_number VARCHAR(255),
    capacity_value BIGINT,              -- Bytes for storage/memory
    capacity_unit VARCHAR(20),
    slot_number INTEGER,
    firmware_version VARCHAR(100),
    status VARCHAR(30) DEFAULT 'active', -- 'active', 'removed', 'failed'
    properties JSONB DEFAULT '{}',       -- Component-specific details
    first_detected_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    removed_at TIMESTAMPTZ,

    PRIMARY KEY (tenant, component_id),
    FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant, source_id) REFERENCES asset_data_sources(tenant, source_id) ON DELETE SET NULL
);

CREATE INDEX idx_hardware_asset ON asset_hardware_components(tenant, asset_id);
CREATE INDEX idx_hardware_type ON asset_hardware_components(tenant, component_type);
CREATE INDEX idx_hardware_serial ON asset_hardware_components(tenant, serial_number) WHERE serial_number IS NOT NULL;
```

### Schema Modifications

#### Assets Table Enhancements

```sql
-- Add multi-source tracking fields
ALTER TABLE assets ADD COLUMN IF NOT EXISTS primary_source_type VARCHAR(50);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS source_count INTEGER DEFAULT 0;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS data_quality_score DECIMAL(3, 2);  -- 0.00 to 1.00
ALTER TABLE assets ADD COLUMN IF NOT EXISTS last_data_reconciliation_at TIMESTAMPTZ;

CREATE INDEX idx_assets_primary_source ON assets(tenant, primary_source_type);
```

---

## Data Ingestion Architecture

### Abstract Data Source Interface

```typescript
/**
 * Abstract interface for all data sources feeding asset information
 */
interface IAssetDataSource {
  /** Unique identifier for this source type */
  readonly sourceType: string;

  /** Human-readable name */
  readonly displayName: string;

  /** Fetch all devices/assets from this source */
  fetchDevices(options: FetchOptions): Promise<SourceDevice[]>;

  /** Fetch a single device by external ID */
  fetchDevice(externalId: string): Promise<SourceDevice | null>;

  /** Fetch software inventory for a device */
  fetchSoftware(externalDeviceId: string): Promise<SourceSoftwareItem[]>;

  /** Fetch patch status for a device */
  fetchPatches(externalDeviceId: string): Promise<SourcePatch[]>;

  /** Fetch current metrics for a device */
  fetchMetrics(externalDeviceId: string): Promise<SourceMetric[]>;

  /** Fetch hardware inventory for a device */
  fetchHardware(externalDeviceId: string): Promise<SourceHardwareComponent[]>;

  /** Configure webhook for real-time updates (if supported) */
  configureWebhook?(config: WebhookConfig): Promise<WebhookRegistration>;

  /** Process incoming webhook payload */
  handleWebhook?(payload: unknown): Promise<WebhookEvent>;
}
```

### Data Source Implementations

```
ee/server/src/lib/integrations/
├── abstract/
│   ├── IAssetDataSource.ts       # Abstract interface
│   ├── BaseDataSource.ts         # Common implementation
│   ├── DataSourceRegistry.ts     # Source registration and lookup
│   └── types.ts                  # Shared types
├── ninjaone/
│   ├── NinjaOneDataSource.ts     # Implements IAssetDataSource
│   └── mappers/                  # NinjaOne-specific mapping
├── datto/                        # Future
│   └── DattoDataSource.ts
└── direct/                       # Direct agent reporting
    └── DirectAgentDataSource.ts
```

### Ingestion Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Data Ingestion Pipeline                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐    │
│  │   RMM A     │   │   RMM B     │   │   RMM C     │   │   Direct    │    │
│  │   Webhook   │   │   Polling   │   │   Webhook   │   │   Agent     │    │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘    │
│         │                 │                 │                 │            │
│         ▼                 ▼                 ▼                 ▼            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │                      Data Source Adapter                         │     │
│  │  - Normalize to SourceDevice/SourceSoftware/etc.                │     │
│  │  - Validate data                                                 │     │
│  │  - Handle rate limiting                                          │     │
│  └────────────────────────────┬─────────────────────────────────────┘     │
│                               │                                            │
│                               ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │                      Ingestion Queue (Redis)                      │     │
│  │  - Batch writes for efficiency                                    │     │
│  │  - Retry failed ingestions                                        │     │
│  │  - Preserve ordering per device                                   │     │
│  └────────────────────────────┬─────────────────────────────────────┘     │
│                               │                                            │
│                               ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │                      Reconciliation Engine                        │     │
│  │  - Match to existing assets                                       │     │
│  │  - Resolve conflicts (priority-based)                             │     │
│  │  - Merge multi-source data                                        │     │
│  │  - Track changes                                                  │     │
│  └────────────────────────────┬─────────────────────────────────────┘     │
│                               │                                            │
│                               ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │                      PostgreSQL (Canonical Store)                 │     │
│  └────────────────────────────┬─────────────────────────────────────┘     │
│                               │                                            │
│                               ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │                      Event Bus (Redis Streams)                    │     │
│  │  - ASSET_UPDATED, SOFTWARE_CHANGED, PATCH_STATUS_CHANGED         │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Conflict Resolution

When multiple sources report on the same asset:

```typescript
interface ConflictResolutionStrategy {
  resolveField(
    field: string,
    values: Array<{
      sourceId: string;
      sourceType: string;
      priority: number;
      value: unknown;
      timestamp: Date;
    }>
  ): unknown;
}

// Strategy by field type:
// - Identity fields (serial, MAC): First non-null, validate consistency
// - Status fields (online/offline): Most recent timestamp wins
// - Hardware fields: Highest priority source wins
// - Default: Priority then recency
```

---

## Sync Strategy

### Sync Types

| Sync Type | Trigger | Scope | Frequency |
|-----------|---------|-------|-----------|
| Full Sync | Manual, Initial connection | All devices in mapped orgs | On-demand, Weekly scheduled |
| Incremental Sync | Scheduled | Changed devices since last sync | Every 15-60 minutes |
| Device Sync | Webhook, On-demand | Single device | Real-time |
| Software Sync | Scheduled | All devices | Every 4-24 hours |
| Patch Sync | Scheduled | All devices | Every 1-4 hours |
| Metrics Sync | Scheduled | All devices with metrics | Every 5-15 minutes |

### Data Retention Policies

| Data Type | Active Retention | Archive Retention | Notes |
|-----------|-----------------|-------------------|-------|
| Software Inventory (current) | Indefinite | - | Current state always retained |
| Software Inventory (history) | 2 years | 7 years | Compressed after active period |
| Patch Records | 2 years | 7 years | Required for compliance |
| Performance Metrics | 90 days | 1 year | Aggregated after active period |
| Hardware Components | Indefinite | - | Component history valuable |
| Alert History | 1 year | 5 years | Incident analysis |

### Metrics Aggregation

```sql
-- Automated aggregation job for older metrics
CREATE TABLE asset_metrics_daily_summary (
    tenant UUID NOT NULL,
    asset_id UUID NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    dimension VARCHAR(100),
    summary_date DATE NOT NULL,
    min_value DECIMAL(15, 4),
    max_value DECIMAL(15, 4),
    avg_value DECIMAL(15, 4),
    p50_value DECIMAL(15, 4),
    p95_value DECIMAL(15, 4),
    sample_count INTEGER,

    PRIMARY KEY (tenant, asset_id, metric_type, metric_name, dimension, summary_date)
);
```

---

## Migration Considerations

### Transitioning Between Data Sources

When a customer changes RMM providers or adds additional sources:

#### Scenario 1: Adding a New Data Source

1. **Discovery Phase**
   - New source syncs devices to staging
   - Matching algorithm identifies existing assets
   - Generate mapping report for review

2. **Mapping Phase**
   - Auto-match by: Serial Number > MAC Address > Hostname + IP
   - Manual mapping UI for unmatched devices
   - Configurable match confidence thresholds

3. **Activation Phase**
   - Create `asset_data_sources` records for matched assets
   - Set source priority (new source typically lower priority)
   - Begin ongoing sync

4. **Transition Phase (if replacing)**
   - Gradually increase new source priority
   - Monitor data quality scores
   - Retire old source when ready

#### Scenario 2: Migrating Primary Data Source

```
Week 1-2: Discovery
├── Connect new source, sync to staging
├── Run matching algorithm
├── Generate unmatched device report
└── Manual mapping for exceptions

Week 3: Parallel Operation
├── Both sources active
├── New source at priority 5, old at priority 10
├── Monitor for data discrepancies
└── Resolve conflicts manually if needed

Week 4: Cutover
├── Promote new source to priority 10
├── Demote old source to priority 1
├── Verify all critical fields from new source
└── Document any data loss/gaps

Week 5+: Cleanup
├── Disable old source sync
├── Archive old source records
├── Remove old source data after retention period
└── Update documentation and runbooks
```

### Data Continuity Guarantees

1. **Historical Data Preserved** - Software/patch history from old source retained
2. **Audit Trail Maintained** - All changes during transition logged
3. **Metrics Continuity** - Time-series data continues uninterrupted
4. **No Data Loss** - Multi-source design means data is additive

---

## Implementation Roadmap

### Phase 1: Multi-Source Foundation (4-6 weeks)

**Schema Work**
- [ ] Create `asset_data_sources` table
- [ ] Modify assets table with multi-source fields
- [ ] Create `asset_software_inventory` table
- [ ] Create `asset_patches` table
- [ ] Migration for existing RMM data

**Interface Work**
- [ ] Define `IAssetDataSource` interface
- [ ] Create `DataSourceRegistry`
- [ ] Refactor existing sync engine to implement interface
- [ ] Create base data source adapter

### Phase 2: Historical Tracking (3-4 weeks)

**Software History**
- [ ] Migrate from JSONB to relational software inventory
- [ ] Implement change detection on software sync
- [ ] Add software history query API
- [ ] Update UI for software history view

**Patch Details**
- [ ] Implement detailed patch record sync
- [ ] Replace aggregate counts with rollup queries
- [ ] Add patch timeline UI

### Phase 3: Metrics Infrastructure (3-4 weeks)

**Time-Series Storage**
- [ ] Create partitioned `asset_metrics` table
- [ ] Implement metrics ingestion pipeline
- [ ] Create aggregation job for older data
- [ ] Add metrics API endpoints

**UI Integration**
- [ ] Asset detail metrics charts
- [ ] Fleet health dashboard
- [ ] Alerting on metric thresholds

### Phase 4: Multi-Source Reconciliation (4-6 weeks)

**Conflict Resolution**
- [ ] Implement conflict resolution strategies
- [ ] Create reconciliation engine
- [ ] Add data quality scoring
- [ ] Admin UI for conflict review

**Additional Sources**
- [ ] Add second RMM provider integration
- [ ] Validate multi-source sync
- [ ] Document provider onboarding process

---

## Appendix: Query Examples

### Software Compliance Report

```sql
-- Find all assets with specific software installed
SELECT
    a.asset_id,
    a.name,
    c.company_name,
    si.name as software_name,
    si.version,
    si.first_seen_at,
    si.last_seen_at
FROM assets a
JOIN companies c ON a.tenant = c.tenant AND a.company_id = c.company_id
JOIN asset_software_inventory si ON a.tenant = si.tenant AND a.asset_id = si.asset_id
WHERE a.tenant = $1
  AND si.is_current = true
  AND si.name ILIKE '%' || $2 || '%'
ORDER BY c.company_name, a.name;
```

### Patch Compliance Summary

```sql
-- Patch compliance by severity across fleet
SELECT
    c.company_name,
    p.severity,
    COUNT(*) FILTER (WHERE p.status = 'pending') as pending_count,
    COUNT(*) FILTER (WHERE p.status = 'installed') as installed_count,
    COUNT(*) FILTER (WHERE p.status = 'failed') as failed_count
FROM asset_patches p
JOIN assets a ON p.tenant = a.tenant AND p.asset_id = a.asset_id
JOIN companies c ON a.tenant = c.tenant AND a.company_id = c.company_id
WHERE p.tenant = $1
  AND p.last_checked_at > NOW() - INTERVAL '7 days'
GROUP BY c.company_name, p.severity
ORDER BY c.company_name,
    CASE p.severity
        WHEN 'critical' THEN 1
        WHEN 'important' THEN 2
        WHEN 'moderate' THEN 3
        ELSE 4
    END;
```

### Multi-Source Device Status

```sql
-- Show all data sources for a device with their status
SELECT
    a.asset_id,
    a.name,
    ads.source_type,
    ads.external_device_id,
    ads.is_primary,
    ads.priority,
    ads.agent_status,
    ads.last_seen_at,
    ads.sync_status
FROM assets a
JOIN asset_data_sources ads ON a.tenant = ads.tenant AND a.asset_id = ads.asset_id
WHERE a.tenant = $1
  AND a.asset_id = $2
ORDER BY ads.priority DESC;
```

---

*Document Version: 1.0*
*Last Updated: 2025-11-25*
*Status: Proposed*
