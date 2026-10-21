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
- Tenant-managed status registry (`asset_statuses` table): each status has a lifecycle kind (`active`, `inactive`, or `maintenance`), a display label, and a sort order; built-in statuses can be renamed and reordered; RMM sync no longer overwrites a manually set status
- Procurement tracking: `manufacturer`, `model`, `vendor_id`, `purchase_cost` (with `purchase_cost_currency`), `order_number` — populated from RMM hardware data where available, editable manually
- Contact assignment with full history (`asset_assignments` table): record who is responsible for or in possession of each device; every assign/unassign is stored
- RMM signed-in-user matching to client contacts by email, username, or name — with per-organization suggest/auto-assign mode (`signedInUserMappings`, `autoAssignFromSignedInUser`)
- Asset grouping into bundles (single owner, travels as a unit) or shared workspaces (location + member contacts) via `asset_groups` and `asset_group_members` tables

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
    client_id UUID NOT NULL,
    asset_tag TEXT NOT NULL,
    serial_number TEXT,
    name TEXT NOT NULL,
    status_id UUID,                  -- FK to asset_statuses; replaces the old free-text status column
    location TEXT,
    location_id UUID,                -- Optional FK to client_locations; validated against the asset's client
    purchase_date DATE,
    warranty_end_date DATE,
    -- Procurement fields
    manufacturer TEXT,               -- Hardware maker; synced from RMM system_info where available
    model TEXT,                      -- Device model; synced from RMM system_info where available
    vendor_id UUID,                  -- FK to vendors table
    purchase_cost NUMERIC(12,2),
    purchase_cost_currency TEXT,
    order_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, asset_id),
    FOREIGN KEY (tenant, type_id) REFERENCES asset_types(tenant, type_id),
    FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id),
    FOREIGN KEY (tenant, location_id) REFERENCES client_locations(tenant, location_id),
    FOREIGN KEY (tenant, status_id) REFERENCES asset_statuses(tenant, status_id)
);
```

### Asset Statuses (Tenant-Managed)
```sql
CREATE TABLE asset_statuses (
    tenant UUID NOT NULL REFERENCES tenants,
    status_id UUID DEFAULT gen_random_uuid() NOT NULL,
    label TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('active', 'inactive', 'maintenance')),
    is_builtin BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, status_id)
);
```

### Asset Assignments
```sql
CREATE TABLE asset_assignments (
    tenant UUID NOT NULL REFERENCES tenants,
    assignment_id UUID DEFAULT gen_random_uuid() NOT NULL,
    asset_id UUID NOT NULL,
    contact_id UUID NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    unassigned_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_by UUID NOT NULL,
    PRIMARY KEY (tenant, assignment_id),
    FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant, contact_id) REFERENCES contacts(tenant, contact_id),
    FOREIGN KEY (tenant, created_by) REFERENCES users(tenant, user_id)
);
```

### Asset Groups and Members
```sql
CREATE TABLE asset_groups (
    tenant UUID NOT NULL REFERENCES tenants,
    group_id UUID DEFAULT gen_random_uuid() NOT NULL,
    name TEXT NOT NULL,
    group_type TEXT NOT NULL CHECK (group_type IN ('bundle', 'workspace')),
    owner_contact_id UUID,           -- For bundles: the single owner
    location_id UUID,                -- For workspaces: the shared location
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, group_id),
    FOREIGN KEY (tenant, owner_contact_id) REFERENCES contacts(tenant, contact_id),
    FOREIGN KEY (tenant, location_id) REFERENCES client_locations(tenant, location_id)
);

CREATE TABLE asset_group_members (
    tenant UUID NOT NULL REFERENCES tenants,
    group_id UUID NOT NULL,
    asset_id UUID NOT NULL,
    PRIMARY KEY (tenant, group_id, asset_id),
    FOREIGN KEY (tenant, group_id) REFERENCES asset_groups(tenant, group_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant, asset_id) REFERENCES assets(tenant, asset_id) ON DELETE CASCADE
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
- Tenant-managed asset statuses ✓
  - Status registry CRUD with display_order ✓
  - Built-in status protection ✓
  - RMM sync no longer overwrites manual status ✓
- Procurement fields ✓
  - manufacturer, model, vendor_id, purchase_cost, order_number ✓
  - RMM hardware/system_info backfill ✓
- Contact assignment ✓
  - asset_assignments history table ✓
  - Assign/unassign actions and REST API ✓
  - Portal and mobile (read-only) ✓
- RMM signed-in-user matching ✓
  - Match by email/username/name to client contacts ✓
  - Per-organization suggest/auto-assign mode ✓
- Asset groups ✓
  - Bundles (single owner) ✓
  - Shared workspaces (location + member contacts) ✓
  - REST API and bulk assignment ✓
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
