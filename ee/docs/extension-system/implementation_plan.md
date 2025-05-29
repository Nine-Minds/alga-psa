# Extension System Implementation Plan - 80/20 Approach

This document outlines the focused implementation plan for the Alga PSA Client Extension System, designed to deliver maximum value with minimal effort.

## Core Implementation Phases

### Phase 1: Minimum Viable Extension System

#### 1.0 Database Schema Planning

**Tasks:**
- [ ] Analyze existing database structure to determine optimal extension table placement
- [ ] Document extension-related data requirements and relationships
- [ ] Finalize schema naming conventions and constraints


#### 1.1 Extension Tables Migration

**Tasks:**
- [ ] Create migration file for `extensions` table with fields:
  - `id` (UUID primary key)
  - `tenant_id` (for multi-tenant support)
  - `name` (display name)
  - `description` (extension description)
  - `version` (semantic version string)
  - `manifest` (JSONB for storing manifest data)
  - `main_entry_point` (path to main JS file)
  - `is_enabled` (boolean activation status)
  - `created_at`, `updated_at` timestamps
  - Appropriate indexes on `tenant_id`, `name`, etc.
- [ ] Create migration for `extension_permissions` table with:
  - `id` (UUID primary key)
  - `extension_id` (foreign key to extensions)
  - `resource` (string, e.g. "tickets")
  - `action` (string, e.g. "read")
  - `created_at` timestamp
- [ ] Create migration for `extension_files` table with:
  - `id` (UUID primary key)
  - `extension_id` (foreign key to extensions)
  - `path` (relative file path)
  - `content_hash` (for integrity verification)
  - `size` (file size in bytes)
  - Appropriate indexes
- [ ] Add RLS (Row-Level Security) policies for tenant isolation
- [ ] Create database functions for extension management operations

**Files to Create:**
- `/server/migrations/TIMESTAMP_create_extension_tables.cjs`
- `/server/migrations/TIMESTAMP_create_extension_permissions_table.cjs`
- `/server/migrations/TIMESTAMP_create_extension_files_table.cjs`
- `/server/migrations/TIMESTAMP_add_extension_rls_policies.cjs`

**Dependencies:**
- Database migration system
- Existing tenant system
- Access to Postgres with JSONB support

#### 1.2 Extension Data Storage Tables

**Tasks:**
- [ ] Create migration for `extension_storage` table with:
  - `id` (UUID primary key)
  - `extension_id` (foreign key to extensions)
  - `tenant_id` (for multi-tenant isolation)
  - `key` (storage key name)
  - `value` (JSONB for stored values)
  - `created_at`, `updated_at` timestamps
  - Unique constraint on `(extension_id, tenant_id, key)`
- [ ] Create migration for `extension_settings` table with:
  - `id` (UUID primary key)
  - `extension_id` (foreign key to extensions)
  - `tenant_id` (for multi-tenant settings)
  - `settings` (JSONB for configuration)
  - `created_at`, `updated_at` timestamps
- [ ] Add appropriate indexes for query performance
- [ ] Add tenant isolation constraints
- [ ] Create utility functions for storage operations

**Files to Create:**
- `/server/migrations/TIMESTAMP_create_extension_storage_table.cjs`
- `/server/migrations/TIMESTAMP_create_extension_settings_table.cjs`
- `/server/migrations/TIMESTAMP_add_extension_storage_indexes.cjs`

**Dependencies:**
- Extension tables from previous step
- Knowledge of key-value storage patterns

#### 1.3 Basic Extension Registry Service

**Tasks:**
- [ ] Create `ExtensionRegistry` class with:
  - Method to register extensions from manifest
  - Method to list all registered extensions
  - Method to get extension by ID
  - Method to enable/disable extensions
  - Method to check if an extension is enabled
- [ ] Implement extension initialization queue
- [ ] Create extension context factory
- [ ] Implement extension lifecycle hooks (register, init, enable, disable)
- [ ] Add manifest version compatibility checking
- [ ] Create permission validation logic
- [ ] Add event emitters for extension lifecycle events
- [ ] Implement basic error handling and logging

**Files to Create:**
- `/server/src/lib/extensions/registry.ts`
- `/server/src/lib/extensions/context.ts`
- `/server/src/lib/extensions/lifecycle.ts`
- `/server/src/lib/extensions/errors.ts`
- `/server/src/lib/extensions/index.ts`

**Dependencies:**
- Extension database tables
- Event emitter system
- Logging infrastructure

#### 1.4 Manifest Validation System

**Tasks:**
- [ ] Create Zod schema for extension manifest validation
- [ ] Implement required field validation
- [ ] Add semantic version validation
- [ ] Create permission schema validation
- [ ] Implement extension point validation
- [ ] Add validation for component paths
- [ ] Create validation error reporting system
- [ ] Implement custom validators for specific fields
- [ ] Add schema documentation generation

**Files to Create:**
- `/server/src/lib/extensions/validator.ts`
- `/server/src/lib/extensions/schemas/manifest.schema.ts`
- `/server/src/lib/extensions/schemas/permissions.schema.ts`
- `/server/src/lib/extensions/schemas/extension-points.schema.ts`

**Dependencies:**
- Zod validation library
- Extension registry

#### 1.5 Extension Storage Service

**Tasks:**
- [ ] Design storage service architecture:
  - Create architecture diagram for extension storage
  - Define service interfaces and contracts
  - Document storage limits and performance targets
  - Design error handling and recovery strategies
  - Plan multi-tenant isolation approach

- [ ] Implement `ExtensionStorageService` class with:
  - Core interface definition with TypeScript generics for type safety
  - Robust error handling with custom error classes
  - Comprehensive logging with request context
  - Performance metrics collection

- [ ] Create key-value operations implementation:
  - Type-safe get/set methods with JSON serialization
  - Support for primitive types, arrays, and objects
  - Efficient batch get/set/delete operations
  - Key namespacing for organization
  - Atomic operations support
  - TTL (time-to-live) support for temporary data

- [ ] Add advanced storage features:
  - Transaction support with commit/rollback
  - Optimistic locking for concurrent operations
  - Data versioning with history tracking
  - Data validation hooks
  - Search capabilities for stored values
  - Import/export functionality

- [ ] Implement tenant isolation:
  - Strict tenant boundary enforcement
  - Tenant-aware caching strategies
  - Cross-tenant operation prevention
  - Tenant storage usage reporting

- [ ] Create storage quota management:
  - Per-extension storage limits configuration
  - Storage usage tracking and reporting
  - Quota enforcement with graceful handling
  - Admin alerts for approaching limits
  - Automatic cleanup policies for unused data

- [ ] Implement caching strategy:
  - Multi-level cache (memory, Redis)
  - Cache invalidation patterns
  - Cache warming for frequently accessed data
  - Configurable TTL by data category
  - Intelligent prefetching for related keys

- [ ] Add data integrity and security features:
  - Sensitive data encryption at rest
  - Automated data validation
  - Data integrity checks
  - Audit logging for all operations
  - Compliance with data protection requirements

- [ ] Implement automated maintenance:
  - Scheduled data cleanup jobs
  - Orphaned data detection and removal
  - Index optimization
  - Storage compaction
  - Backup integration

**Files to Create:**
- `/server/src/lib/extensions/storage/index.ts` - Main entry point and interface definitions
- `/server/src/lib/extensions/storage/storageService.ts` - Core service implementation
- `/server/src/lib/extensions/storage/kvStore.ts` - Key-value storage implementation
- `/server/src/lib/extensions/storage/cacheManager.ts` - Caching implementation
- `/server/src/lib/extensions/storage/quotaManager.ts` - Storage quota tracking and enforcement
- `/server/src/lib/extensions/storage/transactionManager.ts` - Transaction support
- `/server/src/lib/extensions/storage/storageErrors.ts` - Custom error classes
- `/server/src/lib/extensions/storage/encryptionService.ts` - Data encryption utilities
- `/server/src/lib/extensions/storage/maintenanceJobs.ts` - Cleanup and maintenance
- `/server/src/lib/extensions/storage/metrics.ts` - Performance monitoring
- `/server/src/lib/extensions/storage/types.ts` - TypeScript type definitions

**Example Implementation:**

```typescript
// Basic interface
interface ExtensionStorage {
  // Basic operations
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: StorageOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  
  // Batch operations
  getBatch<T>(keys: string[]): Promise<Map<string, T>>;
  setBatch<T>(entries: Map<string, T>, options?: StorageOptions): Promise<void>;
  deleteBatch(keys: string[]): Promise<number>;
  
  // Namespacing
  getNamespace(namespace: string): ExtensionStorage;
  
  // Transactions
  beginTransaction(): Promise<StorageTransaction>;
  
  // Utilities
  clear(): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
  size(): Promise<number>;
}

// Implementation
class ExtensionStorageService implements ExtensionStorage {
  private extensionId: string;
  private tenantId: string;
  private cacheManager: CacheManager;
  private quotaManager: QuotaManager;
  private db: Database;
  private metrics: StorageMetrics;
  
  constructor(extensionId: string, tenantId: string, options: StorageServiceOptions) {
    this.extensionId = extensionId;
    this.tenantId = tenantId;
    this.cacheManager = new CacheManager(options.cache);
    this.quotaManager = new QuotaManager(extensionId, tenantId);
    this.db = options.database;
    this.metrics = new StorageMetrics(extensionId);
  }
  
  async get<T>(key: string): Promise<T | null> {
    const metricTimer = this.metrics.startTimer('get');
    const fullKey = this.getFullKey(key);
    
    try {
      // Try cache first
      const cachedValue = await this.cacheManager.get<T>(fullKey);
      if (cachedValue !== null) {
        metricTimer.end(true);
        return cachedValue;
      }
      
      // Get from database
      const result = await this.db.query(
        'SELECT value FROM extension_storage WHERE extension_id = $1 AND tenant_id = $2 AND key = $3',
        [this.extensionId, this.tenantId, key]
      );
      
      if (result.rows.length === 0) {
        metricTimer.end(true);
        return null;
      }
      
      const value = JSON.parse(result.rows[0].value);
      
      // Cache the result for future queries
      await this.cacheManager.set(fullKey, value);
      
      metricTimer.end(true);
      return value;
    } catch (error) {
      metricTimer.end(false);
      throw new StorageError(`Failed to get key ${key}`, { cause: error });
    }
  }
  
  // Other methods...
}
```

**Dependencies:**
- Extension registry for extension validation
- Database connection pool for persistent storage
- Redis for distributed caching (optional but recommended)
- Metrics collection system
- Job scheduler for maintenance tasks

#### 1.6 Core UI Extension Framework

**Tasks:**
- [ ] Design component architecture for extension rendering
- [ ] Create `ExtensionSlot` component for defining extension points
- [ ] Implement `ExtensionRenderer` to load and render extension components
- [ ] Add `ExtensionErrorBoundary` for graceful error handling
- [ ] Create extension context provider for React
- [ ] Implement dynamic component loading
- [ ] Add permissions checking for UI components
- [ ] Create extension component caching mechanism
- [ ] Implement sandbox attributes for security
- [ ] Add performance monitoring hooks

**Files to Create:**
- `/server/src/lib/extensions/ui/ExtensionSlot.tsx`
- `/server/src/lib/extensions/ui/ExtensionRenderer.tsx`
- `/server/src/lib/extensions/ui/ExtensionErrorBoundary.tsx`
- `/server/src/lib/extensions/ui/ExtensionProvider.tsx`
- `/server/src/lib/extensions/ui/ExtensionLoader.tsx`
- `/server/src/lib/extensions/ui/sandbox.ts`
- `/server/src/lib/extensions/ui/index.ts`

**Dependencies:**
- Extension registry
- React component system
- Dynamic import capability
- Performance monitoring tools

#### 1.7 Extension Administration UI

**Tasks:**
- [ ] Create extensions list page with:
  - Display of all installed extensions
  - Status indicators (enabled/disabled)
  - Basic filtering and sorting
- [ ] Implement extension detail view with:
  - Manifest information display
  - Requested permissions list
  - Enable/disable toggle
  - Uninstall button
  - Extension settings section
- [ ] Create extension installation workflow:
  - File upload component
  - Manifest validation display
  - Permission review step
  - Installation confirmation
- [ ] Add extension management actions:
  - Enable/disable server action
  - Uninstall server action
  - Reset settings server action
- [ ] Implement notifications for extension operations
- [ ] Add loading states and error handling

**Files to Create:**
- `/server/src/components/settings/extensions/Extensions.tsx`
- `/server/src/components/settings/extensions/ExtensionDetails.tsx`
- `/server/src/components/settings/extensions/InstallExtension.tsx`
- `/server/src/components/settings/extensions/ExtensionPermissions.tsx`
- `/server/src/components/settings/extensions/ExtensionSettings.tsx`
- `/server/src/lib/actions/extension-actions/extensionActions.ts`

**Dependencies:**
- Extension registry
- UI components library
- Server actions framework
- File upload handling

#### 1.8 RBAC Integration

**Tasks:**
- [ ] Create extension permission mapping strategy document
- [ ] Update permission table to track extension-owned permissions:
  - Add `extension_id` column to `permissions` table
  - Create `extension_permissions` view for easier querying
  - Add appropriate indexes for permission lookups
- [ ] Implement permission registration during extension installation:
  - Extract permissions from extension manifest
  - Create permission records with extension_id reference
  - Assign permissions to default roles if specified
- [ ] Add permission checks to extension components:
  - Create permission-aware extension slot component
  - Implement useExtensionPermission hook
  - Add permission checking to extension loader
- [ ] Create permission middleware for extension API endpoints:
  - Implement extensionPermissionMiddleware
  - Add required permission extraction from manifest
  - Integrate with existing RBAC permission checking
- [ ] Enhance admin UI for extension permissions:
  - Add extension permissions to role management UI
  - Create UI for granting/revoking extension permissions
  - Display permissions required by each extension
- [ ] Implement automatic permission cleanup during extension uninstallation
- [ ] Add permission migration for extension updates

**Files to Create/Modify:**
- `/server/migrations/TIMESTAMP_update_permissions_for_extensions.cjs`
- `/server/src/lib/extensions/permissions.ts`
- `/server/src/lib/extensions/ui/PermissionAwareSlot.tsx`
- `/server/src/lib/extensions/hooks/useExtensionPermission.ts`
- `/server/src/middleware/extensionPermissionMiddleware.ts`
- `/server/src/components/settings/roles/ExtensionPermissions.tsx`
- `/server/src/lib/actions/role-actions/extensionPermissionActions.ts`

**Dependencies:**
- Extension registry
- Existing RBAC system
- User role system
- Permission database tables

### Phase 2: Core UI Extensions

#### 2.1 Navigation Extensions

**Tasks:**
- [ ] Implement navigation extension points
- [ ] Create simple navigation item renderer
- [ ] Update main layout to include extension nav items

**Files to Create/Modify:**
- `/server/src/components/layout/Navigation.tsx` (modify)
- `/server/src/lib/extensions/ui/navigation/NavItemRenderer.tsx`

**Dependencies:**
- Core extension system
- Navigation component

#### 2.2 Dashboard Widget Extensions

**Tasks:**
- [ ] Implement basic dashboard extension slots
- [ ] Create simple dashboard widget renderer
- [ ] Update dashboard component to include extension widgets

**Files to Create/Modify:**
- `/server/src/components/dashboard/Dashboard.tsx` (modify)
- `/server/src/lib/extensions/ui/dashboard/WidgetRenderer.tsx`

**Dependencies:**
- Core extension system
- Dashboard component

#### 2.3 Custom Page Extensions

**Tasks:**
- [ ] Implement custom page extension points
- [ ] Create dynamic route handling for extension pages
- [ ] Add basic permission checking for custom pages

**Files to Create:**
- `/server/src/app/extensions/[extensionId]/[...path]/page.tsx`
- `/server/src/lib/extensions/ui/pages/PageRenderer.tsx`

**Dependencies:**
- Core extension system
- Next.js routing system

### Phase 3: Basic API Extensions

#### 3.1 Simple Custom API Endpoints

**Tasks:**
- [ ] Implement basic custom endpoint registration
- [ ] Create simple endpoint request handler
- [ ] Add basic permission checking for endpoints

**Files to Create:**
- `/server/src/pages/api/extensions/[extensionId]/[...path].ts`
- `/server/src/lib/extensions/api/endpointHandler.ts`

**Dependencies:**
- Core extension system
- API routing system

#### 3.2 Essential Developer SDK

**Tasks:**
- [ ] Define minimal SDK interfaces and types
- [ ] Create simple API client wrapper for extensions
- [ ] Implement basic UI component library for extensions

**Files to Create:**
- `/server/src/lib/extensions/sdk/index.ts`
- `/server/src/lib/extensions/sdk/api-client.ts`
- `/server/src/lib/extensions/sdk/ui-components.ts`

**Dependencies:**
- Extension registry
- API client
- UI component library

#### 3.3 Developer Tools - Essentials

**Tasks:**
- [ ] Create basic extension scaffolding tool
- [ ] Implement simple extension packaging
- [ ] Create extension template project

**Files to Create:**
- `/tools/extension-cli/` (minimal version)
- `/tools/extension-templates/` (basic template files)

**Dependencies:**
- Extension SDK

## Future Phases (Deferred for Later)

### Future Phase A: Advanced UI Extensions
- Entity page extensions
- Action menu integrations
- Extension settings UI
- Form field customizations

### Future Phase B: Advanced API Extensions
- API middleware system
- Extension-specific API tokens
- Resource usage monitoring
- API request sandboxing

### Future Phase C: Data Extensions
- Custom fields framework
- Custom reports
- Data exports

### Future Phase D: Workflow Extensions
- Custom workflow actions
- Custom workflow triggers
- Custom workflow forms

### Future Phase E: Advanced Features
- Extension marketplace
- Extension debugging tools
- Analytics and monitoring
- Advanced security features

## Resource Requirements (80/20 Approach)

### Development Team
- 1 Senior Full-stack Developer (Lead)
- 1 Full-stack Developer
- 1 Technical Writer (part-time)

## Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Security vulnerabilities in extensions | High | Medium | Implement basic permission model, manual approval process |
| Performance issues | Medium | Medium | Basic resource limits, manual review process |
| Breaking changes affecting extensions | High | Medium | Minimal API surface, careful changes |
| Tenant data leakage | High | Low | Basic tenant isolation, careful review |

## CE vs EE Feature Differentiation

### Community Edition
- Core extension registry and lifecycle management
- Navigation menu extensions
- Basic dashboard widgets

### Enterprise Edition
All CE features plus:
- Custom pages
- Custom API endpoints
- Full extension development SDK

## Success Criteria (80/20 Approach)

1. **Performance**
   - Extension loading time < 800ms
   - UI rendering delay < 100ms

2. **Usability**
   - Extension installation requires < 5 steps
   - Administrator can manage extensions without technical knowledge

3. **Adoption**
   - 5 sample extensions available at launch
   - >30% of EE customers using at least one extension within 6 months

## Documentation Plan (80/20 Approach)

1. **Developer Documentation**
   - Extension SDK quick reference
   - Getting started guide
   - Example extensions

2. **Administrator Documentation**
   - Installation guide
   - Basic troubleshooting

## Roadmap Beyond MVP

After delivering the core extension system described above, we'll evaluate usage patterns and customer feedback to prioritize the next set of features from our deferred phases. The long-term vision remains comprehensive, but we'll build incrementally based on real-world usage data.