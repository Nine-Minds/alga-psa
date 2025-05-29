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

#### 1.5 Extension Storage Service - 80/20 Approach

**Pareto Analysis of Storage Features**

| Feature | Benefit | Implementation Cost | 80/20 Decision | Reasoning |
|---------|---------|---------------------|----------------|-----------|
| Basic CRUD operations | High | Low | **Include** | Core functionality needed by all extensions |
| Type-safe interface | High | Low | **Include** | Prevents runtime errors with minimal effort |
| Tenant isolation | High | Low | **Include** | Critical security requirement |
| JSON serialization | High | Low | **Include** | Essential for storing complex data |
| Simple TTL support | Medium | Low | **Include** | Basic version provides value at low cost |
| Error handling | High | Low | **Include** | Required for reliability |
| Basic caching | High | Medium | **Include** | Significant performance benefit |
| Storage quotas | High | Medium | **Include** | Prevents resource abuse |
| Batch operations | Medium | Low | **Include** | Performance benefit for bulk operations |
| Namespacing | Medium | Low | **Include** | Helps organize data with minimal effort |
| Transactions | Medium | High | **Defer** | Complex to implement, can use batching instead |
| Advanced caching | Medium | High | **Defer** | Basic caching provides most of the value |
| Data versioning | Low | High | **Defer** | Complex for limited initial use cases |
| Search capabilities | Low | High | **Defer** | Extensions can implement their own search |
| Optimistic locking | Low | Medium | **Defer** | Not needed for most extension scenarios |
| Encryption at rest | Medium | Medium | **Defer** | Can be added later for sensitive data |

**Tasks (Core Implementation):**

- [ ] Define extension storage interfaces:
  - Create TypeScript interface with generics for type safety
  - Define core methods: get, set, delete, has
  - Add simple options including basic TTL
  - Document method contracts and error handling

- [ ] Implement basic `ExtensionStorageService`:
  - Create class implementing the storage interface
  - Add error handling with specific error types
  - Implement logging for operations
  - Ensure proper tenant isolation

- [ ] Add core storage features:
  - Type-safe get/set with JSON serialization
  - Support for primitive types and objects
  - Basic key namespacing (prefix-based)
  - Simple TTL implementation with expiry timestamp
  - Batch operations for better performance

- [ ] Implement tenant isolation:
  - Enforce tenant boundaries in all operations
  - Prevent cross-tenant data access
  - Add tenant ID to all database queries

- [ ] Add simple caching layer:
  - Implement in-memory cache with LRU policy
  - Add cache invalidation on updates
  - Keep cache implementation simple and testable

- [ ] Create basic quota management:
  - Implement per-extension storage limits
  - Add size checking on write operations
  - Create simple reporting for administrators

- [ ] Add maintenance functionality:
  - Create simple job to clean expired items (daily)
  - Implement basic orphaned data cleanup

**Files to Create:**

- `/server/src/lib/extensions/storage/index.ts` - Main entry point and interface definitions
- `/server/src/lib/extensions/storage/storageService.ts` - Core service implementation
- `/server/src/lib/extensions/storage/storageErrors.ts` - Custom error classes
- `/server/src/lib/extensions/storage/cache.ts` - Simple caching implementation
- `/server/src/lib/extensions/storage/quota.ts` - Basic quota management
- `/server/src/lib/extensions/storage/maintenance.ts` - Cleanup jobs
- `/server/src/lib/extensions/storage/types.ts` - TypeScript type definitions

**Example Implementation (80/20 Focused):**

```typescript
// Core storage interface (simplified for 80/20)
interface ExtensionStorage {
  // Basic operations
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: StorageOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  
  // Batch operations for performance
  getBatch<T>(keys: string[]): Promise<Map<string, T>>;
  setBatch<T>(entries: Record<string, T>, options?: StorageOptions): Promise<void>;
  
  // Simple namespace support
  getNamespace(namespace: string): ExtensionStorage;
  
  // Basic utilities
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

// Storage options (simplified)
interface StorageOptions {
  // Simple TTL in seconds
  expiresIn?: number;
}

// Implementation
class ExtensionStorageService implements ExtensionStorage {
  private extensionId: string;
  private tenantId: string;
  private cache: SimpleCache;
  private db: Database;
  private namespace: string = '';
  
  constructor(extensionId: string, tenantId: string, options: { namespace?: string } = {}) {
    this.extensionId = extensionId;
    this.tenantId = tenantId;
    this.cache = new SimpleCache(1000); // Simple LRU cache with 1000 items limit
    this.db = getDatabase();
    this.namespace = options.namespace || '';
  }
  
  // Build the full key with tenant and namespace isolation
  private getFullKey(key: string): string {
    return `${this.tenantId}:${this.extensionId}:${this.namespace}:${key}`;
  }
  
  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key);
    
    try {
      // Try cache first for performance
      const cachedValue = this.cache.get<T>(fullKey);
      if (cachedValue !== undefined) {
        return cachedValue;
      }
      
      // Get from database with tenant isolation
      const result = await this.db.query(
        'SELECT value, expires_at FROM extension_storage WHERE extension_id = $1 AND tenant_id = $2 AND key = $3',
        [this.extensionId, this.tenantId, key]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      // Check if the data has expired
      if (result.rows[0].expires_at && new Date(result.rows[0].expires_at) < new Date()) {
        // Data has expired, delete it asynchronously and return null
        this.delete(key).catch(err => {
          console.error('Failed to delete expired key', { key, error: err });
        });
        return null;
      }
      
      // Parse the JSON value
      const value = JSON.parse(result.rows[0].value);
      
      // Cache the result for future queries
      this.cache.set(fullKey, value);
      
      return value;
    } catch (error) {
      console.error('Failed to get key', { key, error });
      throw new StorageError(`Failed to get key ${key}`, { cause: error });
    }
  }
  
  async set<T>(key: string, value: T, options: StorageOptions = {}): Promise<void> {
    const fullKey = this.getFullKey(key);
    
    try {
      // Check quota before storing
      await this.checkQuota(key, JSON.stringify(value).length);
      
      // Calculate expiration time if TTL is provided
      const expiresAt = options.expiresIn 
        ? new Date(Date.now() + options.expiresIn * 1000) 
        : null;
      
      // Store in database with tenant isolation
      await this.db.query(
        `INSERT INTO extension_storage (extension_id, tenant_id, key, value, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (extension_id, tenant_id, key) 
         DO UPDATE SET value = $4, expires_at = $5, updated_at = NOW()`,
        [this.extensionId, this.tenantId, key, JSON.stringify(value), expiresAt]
      );
      
      // Update cache
      this.cache.set(fullKey, value);
    } catch (error) {
      console.error('Failed to set key', { key, error });
      throw new StorageError(`Failed to set key ${key}`, { cause: error });
    }
  }
  
  // Simple namespace implementation
  getNamespace(namespace: string): ExtensionStorage {
    return new ExtensionStorageService(
      this.extensionId, 
      this.tenantId, 
      { namespace: this.namespace ? `${this.namespace}.${namespace}` : namespace }
    );
  }
  
  // Basic quota check
  private async checkQuota(key: string, dataSize: number): Promise<void> {
    const quotaLimit = await getExtensionQuota(this.extensionId);
    const currentUsage = await this.getCurrentUsage();
    
    // Check if this update would exceed the quota
    if (currentUsage + dataSize > quotaLimit) {
      throw new QuotaExceededError(
        `Storage quota exceeded for extension ${this.extensionId}`
      );
    }
  }
  
  // Other methods...
}
```

**Features Deferred for Future Phases:**

1. **Advanced Transactions**: Will implement simpler atomic operations first, add full transactions later
2. **Complex Caching Strategies**: Start with basic in-memory cache, enhance with Redis/distributed caching later
3. **Data Versioning**: Not needed for initial implementation
4. **Advanced Search**: Extensions can implement their own search logic initially
5. **Encryption at Rest**: Will be added when handling more sensitive data
6. **Advanced Prefetching**: Basic cache will provide most performance benefits

**Dependencies:**
- Extension registry for extension validation
- Database connection pool for persistent storage
- Simple caching implementation
- Basic job scheduler for cleanup tasks

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