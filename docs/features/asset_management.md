# Asset Management System

The Asset Management System is a comprehensive solution for managing IT assets within our MSP PSA platform. It provides robust capabilities for tracking, managing, and optimizing IT assets across multiple clients.

## Core Features

### Asset Types and Classification
- Hierarchical type system with inheritance
- Type-specific extension tables for specialized attributes
- Parent/child relationships with cycle prevention
- Dedicated tables for each asset type (workstation, server, network device, etc.)

### Asset Tracking
- Unique asset identification
- Serial number tracking
- Location management
- Warranty tracking
- Client association
- Status management

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
    company_id UUID NOT NULL, -- Client association
    asset_tag TEXT NOT NULL,
    serial_number TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    location TEXT,
    purchase_date DATE,
    warranty_end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant, asset_id),
    FOREIGN KEY (tenant, type_id) REFERENCES asset_types(tenant, type_id),
    FOREIGN KEY (tenant, company_id) REFERENCES companies(tenant, company_id)
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
- Row-level security
- Tenant isolation
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
- API development
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
