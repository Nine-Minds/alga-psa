# Asset Management System

The Asset Management System is a comprehensive solution for managing IT assets within our MSP PSA platform. It provides robust capabilities for tracking, managing, and optimizing IT assets across multiple clients.

## Core Features

### Asset Types and Classification
- Type-specific extension tables for specialized attributes
- Dedicated tables for each built-in asset type (workstation, server, network device, etc.)

Asset types are defined per tenant in an asset type registry — six built-in types
plus any custom types a tenant adds, each with its own custom fields. An asset's
`asset_type` column holds the type's slug. See
[Custom Asset Types](./custom_asset_types.md) for the registry, slug rules, field
schemas, and the Hudu import mapping.

### Asset Tracking
- Unique asset identification
- Serial number tracking
- Location management (free-text `location` field and structured `location_id` FK to `client_locations`)
- Warranty tracking
- Client association
- Status management

### Asset Tags and Numbering

The `asset_tag` is the physical identifier printed on an asset's label. It is kept separate from the serial number and from integration identities (RMM device IDs and external entity mappings), which never become the printed tag.

- **Automatic numbering.** When an asset is created without a tag, the tag is allocated from one tenant-wide `ASSET` sequence (`next_number`, default: no prefix, 5 digits, starting at 1) and formatted with the client's optional asset prefix in front (`formatAssetTag` in `shared/services/assetNumbering.ts`). There are no per-client counters. The allocator skips any sequence value whose formatted tag is already used or claimed, and issued numbers are never reused, so abandoned numbers leave gaps.
- **Client prefixes.** `clients.asset_prefix` holds up to 10 letters, digits, or hyphens, stored uppercase and unique per tenant. A prefix applies only when a tag is allocated; changing a client's prefix, or moving an asset to another client, never renumbers existing tags.
- **Manual tags.** A supplied tag is kept as entered. Tags are compared in normalized form (leading/trailing spaces trimmed, ASCII letters uppercased) and must be unique in the tenant. Each tag is held by a row in `asset_tag_claims`, keyed by `(tenant, normalized_tag)`; a conflicting create or tag edit fails with `ASSET_TAG_CONFLICT` (HTTP 409 from the REST API).
- **Previews and reservations.** Previews read the next value without consuming it, and printing labels never allocates numbers. A durable reservation (`asset_number_reservations`, 15-minute expiry) claims a tag for a printed label; expiry is bookkeeping only, and the claim is never released for reuse, so a printed label can still be scanned and committed to its asset.
- **One write path.** Manual creation (quick add, full add at `/msp/assets/new`, label-first intake), the REST API, CSV import, inventory delivery, ticket equipment intake, Hudu import, inbound webhook upserts, and RMM ingestion (shared ingestion, NinjaOne, Tactical RMM, Level) all prepare the asset's identity through `prepareAssetIdentity`. Integrations allocate a tag for newly discovered devices and do not change the tag of an existing asset on resync. CSV import uses only an explicitly mapped asset-tag column; it no longer falls back to the serial number or a row identifier.
- **Label-first intake and scan lookup.** Label-first intake creates a minimal `unknown`-type asset for a client with the next tag and opens the asset label dialog. Asset labels print two adjacent copies per asset by default (configurable from 1 to 10). The dashboard's tag lookup normalizes the scanned value, opens the single visible matching asset, reports ambiguity when more than one visible asset matches, and completes a printed reservation by creating its asset.
- **Legacy tags and activation.** The migration preserves all existing tags and records blank tags and every member of a duplicate group in `asset_tag_audit`. Administrators reconcile duplicates under **Settings → Assets → Asset numbering**, mark audit rows reviewed with a note, and select **Activate unique asset tags**. Activation refuses unreviewed duplicates, remaining duplicate tags, and tags held by a pending printed label; it keeps intentionally blank legacy records. See [Asset numbering rollout](../asset-numbering-rollout.md) for deployment order and enforcement details.

### Location Linking

Assets can be linked to a saved client location record (`client_locations`) via the `location_id` UUID field, in addition to the free-text `location` string. When a saved location is selected in the UI, the formatted address is auto-populated into the free-text field but can be overridden with a more specific descriptor (e.g. "Server room — Rack 3").

The REST API (`GET /api/v1/assets`, `POST /api/v1/assets`, `PUT /api/v1/assets/:id`) includes `location_id` as an optional nullable UUID on create, update, and read payloads. The list endpoint accepts `location_id` as a query filter to retrieve all assets at a specific site. The server validates that the supplied `location_id` belongs to the asset's client (active locations only); changing the client without supplying a new `location_id` automatically clears any stale location association.

### Bulk Asset Actions

The asset dashboard supports three bulk operations accessible from the action bar at the bottom of the asset list:

- **Set Status** — update the status of up to 100 selected assets at once.
- **Set Location** — assign a saved client location, enter a custom free-text location, or clear the location for up to 100 selected assets at once.
- **Delete** — permanently delete up to 100 selected assets, with a confirmation dialog before proceeding.

Bulk operations run with controlled concurrency (5 at a time) and produce a per-asset success/failure report via toast notifications.

### Asset Relationships
- Parent/child relationship tracking
- Circular dependency prevention
- Relationship type support
- Hierarchical asset views

### Maintenance Management
- Preventive maintenance scheduling
- Service history tracking
- Notification system
- Compliance monitoring
- Maintenance type categorization

### History and Audit
- Complete change history
- User action tracking
- Modification timestamps
- Structured change tracking

## Database Schema

### Asset Types
```sql
CREATE TABLE asset_types (
    tenant UUID NOT NULL REFERENCES tenants,
    type_id UUID DEFAULT gen_random_uuid() NOT NULL,
    type_name TEXT NOT NULL,
    parent_type_id UUID,
    attributes_schema JSONB, -- Flexible schema definition for type-specific attributes 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, type_id),
    FOREIGN KEY (tenant, parent_type_id) REFERENCES asset_types(tenant, type_id)
);
```

### Assets
```sql
CREATE TABLE assets (
    tenant UUID NOT NULL REFERENCES tenants,
    asset_id UUID DEFAULT gen_random_uuid() NOT NULL,
    type_id UUID NOT NULL,
    client_id UUID NOT NULL, -- Client association
    asset_tag TEXT NOT NULL,      -- Physical label; normalized copy in asset_tag_normalized
    serial_number TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    location TEXT,
    location_id UUID,            -- Optional FK to client_locations; validated against the asset's client
    purchase_date DATE,
    warranty_end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, asset_id),
    FOREIGN KEY (tenant, type_id) REFERENCES asset_types(tenant, type_id),
    FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id),
    FOREIGN KEY (tenant, location_id) REFERENCES client_locations(tenant, location_id)
);
```

### Asset Extension Tables

#### Workstation Assets
```sql
CREATE TABLE workstation_assets (
    tenant UUID NOT NULL,
    asset_id UUID NOT NULL,
    os_type TEXT,
    os_version TEXT,
    cpu_model TEXT,
    cpu_cores INTEGER,
    ram_gb INTEGER,
    storage_type TEXT,
    storage_capacity_gb INTEGER,
    gpu_model TEXT,
    last_login TIMESTAMP,
    installed_software JSONB DEFAULT '[]',
    PRIMARY KEY (tenant, asset_id),
    FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE
);
```

#### Network Device Assets
```sql
CREATE TABLE network_device_assets (
    tenant UUID NOT NULL,
    asset_id UUID NOT NULL,
    device_type TEXT NOT NULL,
    management_ip TEXT,
    port_count INTEGER,
    firmware_version TEXT,
    supports_poe BOOLEAN DEFAULT false,
    power_draw_watts DECIMAL(8,2),
    vlan_config JSONB DEFAULT '{}',
    port_config JSONB DEFAULT '{}',
    PRIMARY KEY (tenant, asset_id),
    FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE
);
```

### Asset Relationships
```sql
CREATE TABLE asset_relationships (
    tenant UUID NOT NULL,
    parent_asset_id UUID NOT NULL,
    child_asset_id UUID NOT NULL,
    relationship_type TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, parent_asset_id, child_asset_id),
    FOREIGN KEY (tenant, parent_asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant, child_asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE
);
```

### Maintenance Scheduling
```sql
CREATE TABLE asset_maintenance_schedules (
    tenant UUID NOT NULL,
    schedule_id UUID DEFAULT gen_random_uuid() NOT NULL,
    asset_id UUID NOT NULL,
    schedule_name TEXT NOT NULL,
    description TEXT,
    maintenance_type TEXT NOT NULL,
    frequency TEXT NOT NULL,
    frequency_interval INTEGER NOT NULL,
    schedule_config JSONB NOT NULL,
    last_maintenance TIMESTAMP,
    next_maintenance TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, schedule_id),
    FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant, created_by) REFERENCES users(tenant, user_id)
);
```

### Asset History
```sql
CREATE TABLE asset_history (
    tenant UUID NOT NULL REFERENCES tenants,
    history_id UUID DEFAULT gen_random_uuid() NOT NULL,
    asset_id UUID NOT NULL,
    changed_by UUID NOT NULL,
    change_type TEXT NOT NULL,
    changes JSONB NOT NULL,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, history_id),
    FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id),
    FOREIGN KEY (tenant, changed_by) REFERENCES users(tenant, user_id)
);
```

## Implementation Phases

### Phase 1: Core Asset Management ✓
- Basic asset tracking ✓
- Type system implementation ✓
- Client association ✓
- History tracking ✓
- Database schema ✓
- Core models and interfaces ✓
- Server actions ✓

### Phase 2: Service Integration ✓
- Ticket integration ✓
  - Link assets to tickets ✓
  - Asset-based ticket creation ✓
  - Service history tracking ✓
- Document management ✓
  - Asset documentation ✓
  - Attachment support ✓
  - Version control ✓
- Maintenance scheduling ✓
  - Preventive maintenance ✓
  - Service calendars ✓
  - Notification system ✓
- Basic reporting ✓
  - Asset inventory reports ✓
  - Client asset summaries ✓
  - Maintenance histories ✓

### Phase 3: Advanced Features ✓
- Asset relationships ✓
  - Dependency mapping ✓
  - Impact analysis ✓
  - Service mapping ✓
- Type-specific attributes ✓
  - Extension tables ✓
  - Specialized fields ✓
  - Efficient querying ✓
- Location linking ✓
  - Structured FK to client_locations ✓
  - REST API location_id field and filter ✓
  - Client validation on create/update ✓
- Bulk asset actions ✓
  - Set status ✓
  - Set location ✓
  - Delete ✓
- Advanced reporting
  - Custom report builder
  - Dashboard integration
  - Export capabilities
- SLA monitoring
  - Service level tracking
  - Performance metrics
  - Compliance reporting
- Warranty tracking
  - Expiration alerts
  - Renewal management
  - Coverage tracking

### Phase 4: Automation and Intelligence
- Predictive maintenance
  - Failure prediction
  - Maintenance optimization
  - Cost forecasting
- Asset lifecycle recommendations
  - Replacement planning
  - Upgrade suggestions
  - EOL management
- Risk assessment
  - Security analysis
  - Compliance checking
  - Vulnerability tracking
- Cost analysis
  - TCO calculations
  - ROI analysis
  - Budget planning

## Technical Implementation

### Models and Interfaces
- Asset interfaces for type safety
- Extension table models for type-specific data
- Relationship management with cycle detection
- History tracking implementation
- Tenant isolation support

### Server Actions
- Asset management operations
- Type management
- Relationship management
- Maintenance scheduling
- History tracking
- Cache invalidation

## Integration Points

### Existing Systems
- Document associations
- Ticket system
- Comments system
- Storage system
- Client portal

### Security Considerations
- Tenant isolation (application-enforced via the `tenantDb` facade — see [tenant-isolation.md](../architecture/tenant-isolation.md))
- Role-based access
- Audit logging

## Business Value

### Operational Benefits
- Streamlined asset tracking
- Reduced manual effort
- Improved accuracy
- Better resource allocation
- Type-specific data management

### Client Benefits
- Enhanced service delivery
- Better asset visibility
- Improved planning
- Cost optimization
- Maintenance compliance

### Compliance and Risk
- Better compliance management
- Risk reduction
- Audit readiness
- Security enhancement
- Relationship tracking

## Future Considerations

### Scalability
- Performance optimization
- Index management
- Query optimization
- Cache strategies
- Extension table partitioning

### Integration Expansion
- Third-party integrations
- Mobile access
- Client portal features
- Asset discovery integration

### Feature Enhancement
- AI/ML capabilities
- Automation expansion
- Reporting enhancement
- Analytics development
- Predictive maintenance
