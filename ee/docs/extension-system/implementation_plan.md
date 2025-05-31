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

#### 1.5 Extension Storage Service - 80/20 Approach for Alga PSA

**Integration with Alga's Existing Infrastructure**

The Extension Storage Service will leverage Alga's existing infrastructure:

1. **Database Integration**
   - Utilize Alga's existing PostgreSQL database with proper tenant isolation
   - Follow Alga's migration patterns and naming conventions
   - Leverage existing database connection pooling and transaction support

2. **Redis Integration**
   - Use Alga's existing Redis configuration from `/server/src/config/redisConfig.ts`
   - Adopt the same connection handling and resilience patterns
   - Follow existing Redis key naming conventions

3. **Logging Integration**
   - Use Alga's logging system from `/server/src/utils/logger.tsx`
   - Maintain consistent log formats and levels
   - Integrate with existing monitoring patterns

4. **Error Handling**
   - Follow Alga's error handling patterns from `/server/src/utils/apiErrors.ts`
   - Use consistent error types and status codes
   - Maintain proper error boundaries and fallbacks

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

- [ ] Implement Redis-based caching layer:
  - Leverage existing Redis infrastructure for caching
  - Create adapter for Redis connection and operations
  - Implement TTL support at cache level with expiration time propagation
  - Add cache invalidation patterns for updates and deletes
  - Design fallback mechanism for Redis unavailability
  - Implement circuit breaker pattern for Redis connection issues
  - Add monitoring for cache hit/miss rates

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
- `/server/src/lib/extensions/storage/redisCache.ts` - Redis cache adapter with circuit breaker
- `/server/src/lib/extensions/storage/quota.ts` - Basic quota management
- `/server/src/lib/extensions/storage/maintenance.ts` - Cleanup jobs
- `/server/src/lib/extensions/storage/types.ts` - TypeScript type definitions
- `/server/src/lib/extensions/storage/monitoring.ts` - Cache monitoring utilities

**Monitoring and Maintenance:**

1. **Circuit Breaker Pattern**
   - The Redis cache adapter implements a circuit breaker pattern to handle Redis outages gracefully
   - When Redis fails repeatedly, the circuit opens and database-only mode is used
   - After a timeout period, a half-open state tests Redis connectivity
   - This prevents cascading failures when Redis is experiencing issues

2. **Cache Monitoring**
   - The storage service tracks key metrics like cache hit/miss rates
   - Provides extension-specific Redis usage statistics
   - Exposes monitoring endpoints for dashboards and alerts
   - Logs cache operation performance for troubleshooting

3. **Automated Maintenance**
   - Expired key cleanup job runs regularly to prevent database bloat
   - Orphaned data detection and cleanup for uninstalled extensions
   - Cache synchronization to handle potential inconsistencies
   - Quota usage reporting for extension administrators

4. **TTL Management**
   - Expired values are automatically pruned from both database and cache
   - TTL values are synchronized between database and Redis
   - When retrieving values from database, remaining TTL is calculated and applied to cache
   - Background job handles expired items even when they're not accessed

5. **Fire-and-Forget Cache Operations**
   - Redis cache operations use a fire-and-forget pattern
   - Cache errors never block or delay database operations
   - This ensures the system remains operational even during Redis issues
   - Comprehensive error logging for later investigation

**Example Implementation with Redis Caching:**

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

// Redis cache adapter with circuit breaker
class RedisCacheAdapter {
  private redis: Redis;
  private prefix: string;
  private logger: Logger;
  private circuitBreaker: {
    failures: number;
    lastFailure: number;
    status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  };
  private readonly FAILURE_THRESHOLD = 5;
  private readonly RESET_TIMEOUT_MS = 30000; // 30 seconds
  
  constructor(redisClient: Redis, options: {
    keyPrefix?: string;
    logger?: Logger;
  } = {}) {
    this.redis = redisClient;
    this.prefix = options.keyPrefix || 'ext:storage:';
    this.logger = options.logger || console;
    
    // Initialize circuit breaker
    this.circuitBreaker = {
      failures: 0,
      lastFailure: 0,
      status: 'CLOSED'
    };
  }
  
  private getRedisKey(key: string): string {
    return `${this.prefix}${key}`;
  }
  
  /**
   * Check if circuit breaker should allow operations
   * Implementation of basic circuit breaker pattern to handle Redis outages
   */
  private async checkCircuitBreaker(): Promise<boolean> {
    const now = Date.now();
    
    // If circuit is open, check if we should attempt to close it
    if (this.circuitBreaker.status === 'OPEN') {
      const timeElapsedSinceFailure = now - this.circuitBreaker.lastFailure;
      
      // If we've waited long enough, try half-open state
      if (timeElapsedSinceFailure >= this.RESET_TIMEOUT_MS) {
        this.circuitBreaker.status = 'HALF_OPEN';
        this.logger.info('Circuit breaker entering half-open state', { prefix: this.prefix });
      } else {
        return false; // Still open, don't allow operation
      }
    }
    
    // Check Redis connection by pinging
    if (this.circuitBreaker.status === 'HALF_OPEN') {
      try {
        await this.redis.ping();
        // Success! Close the circuit
        this.circuitBreaker.status = 'CLOSED';
        this.circuitBreaker.failures = 0;
        this.logger.info('Circuit breaker closed, Redis connection restored', { prefix: this.prefix });
        return true;
      } catch (error) {
        // Still failing, open the circuit again
        this.circuitBreaker.status = 'OPEN';
        this.circuitBreaker.lastFailure = now;
        this.logger.warn('Circuit breaker remains open, Redis still unavailable', { prefix: this.prefix });
        return false;
      }
    }
    
    return true; // Circuit is closed, allow operation
  }
  
  /**
   * Handle operation failure and potentially trigger circuit breaker
   */
  private handleFailure(error: any, operation: string): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();
    
    this.logger.warn(`Redis cache ${operation} failed`, { 
      prefix: this.prefix,
      error,
      failures: this.circuitBreaker.failures
    });
    
    // Open circuit if we exceed failure threshold
    if (this.circuitBreaker.failures >= this.FAILURE_THRESHOLD) {
      this.circuitBreaker.status = 'OPEN';
      this.logger.error('Circuit breaker opened due to multiple Redis failures', { 
        prefix: this.prefix,
        failures: this.circuitBreaker.failures
      });
    }
  }
  
  /**
   * Get a value from the cache
   */
  async get<T>(key: string): Promise<T | null> {
    // Skip operation if circuit breaker is open
    if (!(await this.checkCircuitBreaker())) {
      return null;
    }
    
    const redisKey = this.getRedisKey(key);
    try {
      const value = await this.redis.get(redisKey);
      if (!value) return null;
      
      // Reset failure count on success
      if (this.circuitBreaker.failures > 0) {
        this.circuitBreaker.failures = 0;
      }
      
      return JSON.parse(value) as T;
    } catch (error) {
      this.handleFailure(error, 'get');
      return null; // Fallback to database
    }
  }
  
  /**
   * Get multiple values at once (for batch operations)
   */
  async mget<T>(keys: string[]): Promise<Record<string, T | null>> {
    if (keys.length === 0) return {};
    
    // Skip operation if circuit breaker is open
    if (!(await this.checkCircuitBreaker())) {
      return {};
    }
    
    const redisKeys = keys.map(k => this.getRedisKey(k));
    const result: Record<string, T | null> = {};
    
    try {
      const values = await this.redis.mget(...redisKeys);
      
      // Reset failure count on success
      if (this.circuitBreaker.failures > 0) {
        this.circuitBreaker.failures = 0;
      }
      
      // Map redis results back to original keys
      for (let i = 0; i < keys.length; i++) {
        const value = values[i];
        if (value) {
          try {
            result[keys[i]] = JSON.parse(value) as T;
          } catch (e) {
            this.logger.warn('Failed to parse cached value', { key: keys[i], error: e });
            result[keys[i]] = null;
          }
        } else {
          result[keys[i]] = null;
        }
      }
      
      return result;
    } catch (error) {
      this.handleFailure(error, 'mget');
      return {}; // Fallback to individual database lookups
    }
  }
  
  /**
   * Set a value in the cache with optional TTL
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    // Skip operation if circuit breaker is open
    if (!(await this.checkCircuitBreaker())) {
      return;
    }
    
    const redisKey = this.getRedisKey(key);
    const serializedValue = JSON.stringify(value);
    
    try {
      if (ttlSeconds) {
        await this.redis.set(redisKey, serializedValue, 'EX', ttlSeconds);
      } else {
        await this.redis.set(redisKey, serializedValue);
      }
      
      // Reset failure count on success
      if (this.circuitBreaker.failures > 0) {
        this.circuitBreaker.failures = 0;
      }
    } catch (error) {
      this.handleFailure(error, 'set');
      // Non-critical error, we can continue without caching
    }
  }
  
  /**
   * Set multiple values at once with optional TTL
   */
  async mset<T>(entries: Record<string, T>, ttlSeconds?: number): Promise<void> {
    // Skip operation if circuit breaker is open
    if (!(await this.checkCircuitBreaker())) {
      return;
    }
    
    try {
      // Use transaction for atomic operation
      const pipeline = this.redis.pipeline();
      
      for (const [key, value] of Object.entries(entries)) {
        const redisKey = this.getRedisKey(key);
        const serializedValue = JSON.stringify(value);
        
        if (ttlSeconds) {
          pipeline.set(redisKey, serializedValue, 'EX', ttlSeconds);
        } else {
          pipeline.set(redisKey, serializedValue);
        }
      }
      
      await pipeline.exec();
      
      // Reset failure count on success
      if (this.circuitBreaker.failures > 0) {
        this.circuitBreaker.failures = 0;
      }
    } catch (error) {
      this.handleFailure(error, 'mset');
      // Non-critical error, we can continue without caching
    }
  }
  
  /**
   * Delete a value from the cache
   */
  async delete(key: string): Promise<void> {
    // Skip operation if circuit breaker is open
    if (!(await this.checkCircuitBreaker())) {
      return;
    }
    
    const redisKey = this.getRedisKey(key);
    try {
      await this.redis.del(redisKey);
      
      // Reset failure count on success
      if (this.circuitBreaker.failures > 0) {
        this.circuitBreaker.failures = 0;
      }
    } catch (error) {
      this.handleFailure(error, 'delete');
      // Non-critical operation, can continue
    }
  }
  
  /**
   * Delete multiple values at once
   */
  async mdelete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    
    // Skip operation if circuit breaker is open
    if (!(await this.checkCircuitBreaker())) {
      return;
    }
    
    const redisKeys = keys.map(k => this.getRedisKey(k));
    
    try {
      await this.redis.del(...redisKeys);
      
      // Reset failure count on success
      if (this.circuitBreaker.failures > 0) {
        this.circuitBreaker.failures = 0;
      }
    } catch (error) {
      this.handleFailure(error, 'mdelete');
      // Non-critical operation, can continue
    }
  }
  
  /**
   * Clear all values with a specific pattern
   */
  async clear(pattern: string = '*'): Promise<void> {
    // Skip operation if circuit breaker is open
    if (!(await this.checkCircuitBreaker())) {
      return;
    }
    
    try {
      // Find all matching keys
      const keys = await this.redis.keys(`${this.prefix}${pattern}`);
      
      if (keys.length > 0) {
        // Delete them all at once
        await this.redis.del(...keys);
      }
      
      // Reset failure count on success
      if (this.circuitBreaker.failures > 0) {
        this.circuitBreaker.failures = 0;
      }
      
      this.logger.debug('Cache cleared', { pattern, keysRemoved: keys.length });
    } catch (error) {
      this.handleFailure(error, 'clear');
      // Non-critical operation, can continue
    }
  }
  
  /**
   * Get cache stats - useful for monitoring
   */
  async getStats(): Promise<{ 
    keyCount: number; 
    memoryUsage: string;
    circuitStatus: string;
  }> {
    try {
      // Only attempt if circuit is not open
      if (this.circuitBreaker.status !== 'OPEN') {
        const info = await this.redis.info();
        const keyCount = await this.redis.dbsize();
        const memory = info.split('\n').find(line => line.startsWith('used_memory_human:'))?.split(':')[1]?.trim() || 'unknown';
        
        return {
          keyCount,
          memoryUsage: memory,
          circuitStatus: this.circuitBreaker.status
        };
      }
    } catch (error) {
      this.handleFailure(error, 'getStats');
    }
    
    return {
      keyCount: 0,
      memoryUsage: 'unavailable',
      circuitStatus: this.circuitBreaker.status
    };
  }
}

// Storage errors
class StorageError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'StorageError';
  }
}

class QuotaExceededError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

class KeyNotFoundError extends StorageError {
  constructor(key: string) {
    super(`Key not found: ${key}`);
    this.name = 'KeyNotFoundError';
  }
}

class SerializationError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'SerializationError';
  }
}

// Implementation with enhanced Redis integration
class ExtensionStorageService implements ExtensionStorage {
  private extensionId: string;
  private tenantId: string;
  private redisCache: RedisCacheAdapter;
  private db: Database;
  private namespace: string = '';
  private logger: Logger;
  private metrics: {
    cacheHits: number;
    cacheMisses: number;
    dbQueries: number;
    writeOperations: number;
  };
  
  constructor(
    extensionId: string, 
    tenantId: string, 
    options: { 
      namespace?: string;
      redis?: Redis;
      logger?: Logger;
      db?: Database;
    } = {}
  ) {
    this.extensionId = extensionId;
    this.tenantId = tenantId;
    this.db = options.db || getDatabase();
    this.namespace = options.namespace || '';
    this.logger = options.logger || console;
    
    // Initialize metrics for monitoring
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      dbQueries: 0,
      writeOperations: 0
    };
    
    // Initialize Redis cache with tenant and extension isolation
    const redisKeyPrefix = `tenant:${tenantId}:ext:${extensionId}:${this.namespace ? this.namespace + ':' : ''}`;
    this.redisCache = new RedisCacheAdapter(options.redis || getRedisClient(), {
      keyPrefix: redisKeyPrefix,
      logger: this.logger
    });
  }
  
  // Build the full key with namespace isolation
  private getFullKey(key: string): string {
    return key;
  }
  
  // Build the database key for queries
  private getDbKey(key: string): string {
    return this.namespace ? `${this.namespace}:${key}` : key;
  }
  
  /**
   * Get a value from storage
   * First tries Redis cache, then falls back to database
   */
  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key);
    
    try {
      // Try Redis cache first for performance
      const cachedValue = await this.redisCache.get<T>(fullKey);
      
      if (cachedValue !== null) {
        // Cache hit - record metric and return value
        this.metrics.cacheHits++;
        this.logger.debug('Cache hit', { 
          key: fullKey, 
          extension: this.extensionId,
          tenant: this.tenantId,
          hitRate: this.getCacheHitRate()
        });
        return cachedValue;
      }
      
      // Cache miss - need to query database
      this.metrics.cacheMisses++;
      this.metrics.dbQueries++;
      this.logger.debug('Cache miss', { 
        key: fullKey, 
        extension: this.extensionId,
        tenant: this.tenantId,
        hitRate: this.getCacheHitRate()
      });
      
      // Get from database with tenant isolation
      const result = await this.db.query(
        'SELECT value, expires_at FROM extension_storage WHERE extension_id = $1 AND tenant_id = $2 AND key = $3',
        [this.extensionId, this.tenantId, this.getDbKey(key)]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      // Check if the data has expired
      if (result.rows[0].expires_at && new Date(result.rows[0].expires_at) < new Date()) {
        // Data has expired, delete it asynchronously and return null
        this.delete(key).catch(err => {
          this.logger.error('Failed to delete expired key', { 
            key, 
            error: err,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
        return null;
      }
      
      // Parse the JSON value
      let value: T;
      try {
        value = JSON.parse(result.rows[0].value);
      } catch (error) {
        this.logger.error('Failed to parse JSON from database', { 
          key, 
          error,
          extension: this.extensionId,
          tenant: this.tenantId
        });
        throw new SerializationError(`Failed to parse JSON for key ${key}`);
      }
      
      // Calculate TTL for Redis if expires_at is set
      let ttlSeconds: number | undefined;
      if (result.rows[0].expires_at) {
        const expiryDate = new Date(result.rows[0].expires_at);
        const ttlMs = expiryDate.getTime() - Date.now();
        if (ttlMs > 0) {
          ttlSeconds = Math.floor(ttlMs / 1000);
        }
      }
      
      // Cache the result in Redis for future queries (don't await - fire and forget)
      this.redisCache.set(fullKey, value, ttlSeconds)
        .catch(error => {
          // Just log and continue - cache errors shouldn't impact the main flow
          this.logger.warn('Failed to set Redis cache', { 
            key, 
            error,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
      
      return value;
    } catch (error) {
      if (error instanceof SerializationError) {
        throw error;
      }
      
      this.logger.error('Failed to get key', { 
        key, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new StorageError(`Failed to get key ${key}`, { cause: error as Error });
    }
  }
  
  /**
   * Get multiple values at once for better performance
   */
  async getBatch<T>(keys: string[]): Promise<Map<string, T>> {
    if (keys.length === 0) {
      return new Map();
    }
    
    const result = new Map<string, T>();
    const keysToFetch = new Set<string>();
    
    try {
      // Try Redis cache first for all keys
      const cachedValues = await this.redisCache.mget<T>(keys.map(k => this.getFullKey(k)));
      
      // Identify which keys were cache hits and which need database lookups
      for (const key of keys) {
        const fullKey = this.getFullKey(key);
        if (cachedValues[fullKey] !== null && cachedValues[fullKey] !== undefined) {
          // Cache hit
          this.metrics.cacheHits++;
          result.set(key, cachedValues[fullKey] as T);
        } else {
          // Cache miss - need to fetch from database
          this.metrics.cacheMisses++;
          keysToFetch.add(key);
        }
      }
      
      // If all keys were in cache, return early
      if (keysToFetch.size === 0) {
        return result;
      }
      
      // Fetch remaining keys from database
      this.metrics.dbQueries++;
      
      // Convert Set to Array for database query
      const dbKeys = Array.from(keysToFetch);
      const dbPlaceholders = dbKeys.map((_, i) => `$${i + 3}`).join(',');
      
      const dbResult = await this.db.query(
        `SELECT key, value, expires_at FROM extension_storage 
         WHERE extension_id = $1 AND tenant_id = $2 AND key IN (${dbPlaceholders})`,
        [this.extensionId, this.tenantId, ...dbKeys.map(k => this.getDbKey(k))]
      );
      
      // Process database results
      const cacheUpdates: Record<string, T> = {};
      const cacheTTLs: Record<string, number> = {};
      
      for (const row of dbResult.rows) {
        // Check for expiration
        if (row.expires_at && new Date(row.expires_at) < new Date()) {
          // Skip expired entries and delete them asynchronously
          this.delete(row.key).catch(err => {
            this.logger.error('Failed to delete expired key', { 
              key: row.key, 
              error: err,
              extension: this.extensionId,
              tenant: this.tenantId
            });
          });
          continue;
        }
        
        // Parse JSON value
        try {
          const value = JSON.parse(row.value);
          result.set(row.key, value as T);
          
          // Prepare for cache update
          const fullKey = this.getFullKey(row.key);
          cacheUpdates[fullKey] = value as T;
          
          // Calculate TTL if expires_at is set
          if (row.expires_at) {
            const expiryDate = new Date(row.expires_at);
            const ttlMs = expiryDate.getTime() - Date.now();
            if (ttlMs > 0) {
              cacheTTLs[fullKey] = Math.floor(ttlMs / 1000);
            }
          }
        } catch (error) {
          this.logger.error('Failed to parse JSON from database', { 
            key: row.key, 
            error,
            extension: this.extensionId,
            tenant: this.tenantId
          });
          // Skip this entry but continue processing others
        }
      }
      
      // Update Redis cache with all values (fire and forget)
      if (Object.keys(cacheUpdates).length > 0) {
        // For each entry, set with its TTL if it has one
        Object.keys(cacheUpdates).forEach(key => {
          const ttl = cacheTTLs[key];
          this.redisCache.set(key, cacheUpdates[key], ttl).catch(error => {
            this.logger.warn('Failed to update Redis cache', { 
              key, 
              error,
              extension: this.extensionId,
              tenant: this.tenantId
            });
          });
        });
      }
      
      return result;
    } catch (error) {
      this.logger.error('Failed to get batch keys', { 
        keys, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new StorageError(`Failed to get batch keys`, { cause: error as Error });
    }
  }
  
  /**
   * Set a value in storage
   * Updates both database and Redis cache
   */
  async set<T>(key: string, value: T, options: StorageOptions = {}): Promise<void> {
    const fullKey = this.getFullKey(key);
    
    try {
      // Serialize the value to check size
      let serializedValue: string;
      try {
        serializedValue = JSON.stringify(value);
      } catch (error) {
        throw new SerializationError(`Failed to serialize value for key ${key}: ${error.message}`);
      }
      
      // Check quota before storing
      await this.checkQuota(key, serializedValue.length);
      
      // Calculate expiration time if TTL is provided
      const expiresAt = options.expiresIn 
        ? new Date(Date.now() + options.expiresIn * 1000) 
        : null;
      
      // Track metrics
      this.metrics.writeOperations++;
      this.metrics.dbQueries++;
      
      // Store in database with tenant isolation
      await this.db.query(
        `INSERT INTO extension_storage (extension_id, tenant_id, key, value, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (extension_id, tenant_id, key) 
         DO UPDATE SET value = $4, expires_at = $5, updated_at = NOW()`,
        [this.extensionId, this.tenantId, this.getDbKey(key), serializedValue, expiresAt]
      );
      
      // Update Redis cache with the same TTL (fire and forget)
      this.redisCache.set(fullKey, value, options.expiresIn)
        .catch(error => {
          // Just log and continue - cache errors shouldn't impact the main flow
          this.logger.warn('Failed to set Redis cache', { 
            key, 
            error,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
      
    } catch (error) {
      if (error instanceof QuotaExceededError || error instanceof SerializationError) {
        throw error;
      }
      
      this.logger.error('Failed to set key', { 
        key, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new StorageError(`Failed to set key ${key}`, { cause: error as Error });
    }
  }
  
  /**
   * Set multiple values at once for better performance
   */
  async setBatch<T>(entries: Record<string, T>, options: StorageOptions = {}): Promise<void> {
    if (Object.keys(entries).length === 0) {
      return;
    }
    
    try {
      // Prepare batch operation
      const keysToStore = Object.keys(entries);
      
      // Track metrics
      this.metrics.writeOperations += keysToStore.length;
      this.metrics.dbQueries++;
      
      // Serialize all values and check quota
      const serializedEntries: Record<string, string> = {};
      let totalSize = 0;
      
      for (const key of keysToStore) {
        try {
          const serialized = JSON.stringify(entries[key]);
          serializedEntries[key] = serialized;
          totalSize += serialized.length;
        } catch (error) {
          throw new SerializationError(`Failed to serialize value for key ${key}: ${error.message}`);
        }
      }
      
      // Check total quota
      await this.checkQuotaBatch(totalSize);
      
      // Calculate expiration time if TTL is provided
      const expiresAt = options.expiresIn 
        ? new Date(Date.now() + options.expiresIn * 1000) 
        : null;
      
      // Use a transaction for all database operations
      await this.db.transaction(async (client) => {
        for (const key of keysToStore) {
          await client.query(
            `INSERT INTO extension_storage (extension_id, tenant_id, key, value, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (extension_id, tenant_id, key) 
             DO UPDATE SET value = $4, expires_at = $5, updated_at = NOW()`,
            [this.extensionId, this.tenantId, this.getDbKey(key), serializedEntries[key], expiresAt]
          );
        }
      });
      
      // Update Redis cache with all values (fire and forget)
      const cacheEntries: Record<string, T> = {};
      for (const key of keysToStore) {
        cacheEntries[this.getFullKey(key)] = entries[key];
      }
      
      this.redisCache.mset(cacheEntries, options.expiresIn)
        .catch(error => {
          this.logger.warn('Failed to update Redis cache in batch', { 
            keys: keysToStore, 
            error,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
      
    } catch (error) {
      if (error instanceof QuotaExceededError || error instanceof SerializationError) {
        throw error;
      }
      
      this.logger.error('Failed to set batch entries', { 
        keys: Object.keys(entries), 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new StorageError(`Failed to set batch entries`, { cause: error as Error });
    }
  }
  
  /**
   * Delete a value from storage
   * Removes from both database and Redis cache
   */
  async delete(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    
    try {
      // Track metrics
      this.metrics.writeOperations++;
      this.metrics.dbQueries++;
      
      // Delete from database
      const result = await this.db.query(
        'DELETE FROM extension_storage WHERE extension_id = $1 AND tenant_id = $2 AND key = $3 RETURNING key',
        [this.extensionId, this.tenantId, this.getDbKey(key)]
      );
      
      const deleted = result.rowCount > 0;
      
      // Delete from Redis cache regardless of database result (fire and forget)
      this.redisCache.delete(fullKey)
        .catch(error => {
          this.logger.warn('Failed to delete from Redis cache', { 
            key, 
            error,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
      
      return deleted;
    } catch (error) {
      this.logger.error('Failed to delete key', { 
        key, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new StorageError(`Failed to delete key ${key}`, { cause: error as Error });
    }
  }
  
  /**
   * Check if a key exists in storage
   */
  async has(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    
    try {
      // Try Redis cache first for performance
      const cachedValue = await this.redisCache.get(fullKey);
      if (cachedValue !== null) {
        // Cache hit
        this.metrics.cacheHits++;
        return true;
      }
      
      // Cache miss - check database
      this.metrics.cacheMisses++;
      this.metrics.dbQueries++;
      
      const result = await this.db.query(
        'SELECT 1 FROM extension_storage WHERE extension_id = $1 AND tenant_id = $2 AND key = $3 AND (expires_at IS NULL OR expires_at > NOW())',
        [this.extensionId, this.tenantId, this.getDbKey(key)]
      );
      
      return result.rowCount > 0;
    } catch (error) {
      this.logger.error('Failed to check key existence', { 
        key, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new StorageError(`Failed to check if key ${key} exists`, { cause: error as Error });
    }
  }
  
  /**
   * Get all keys in the current namespace
   */
  async keys(): Promise<string[]> {
    try {
      // We always query the database for keys since Redis might have partial data
      this.metrics.dbQueries++;
      
      const queryPrefix = this.namespace ? `${this.namespace}:%` : '';
      const whereClause = this.namespace 
        ? 'AND key LIKE $4' 
        : 'AND key NOT LIKE \'%:%\''; // Exclude namespaced keys when no namespace is specified
      
      const params = [
        this.extensionId, 
        this.tenantId, 
        new Date() // current time for expiration check
      ];
      
      if (this.namespace) {
        params.push(queryPrefix);
      }
      
      const result = await this.db.query(
        `SELECT key FROM extension_storage 
         WHERE extension_id = $1 AND tenant_id = $2 
         AND (expires_at IS NULL OR expires_at > $3) 
         ${whereClause}`,
        params
      );
      
      // Strip namespace prefix if needed
      return result.rows.map(row => {
        const key = row.key;
        return this.namespace ? key.substring(this.namespace.length + 1) : key;
      });
    } catch (error) {
      this.logger.error('Failed to list keys', { 
        namespace: this.namespace, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new StorageError('Failed to list keys', { cause: error as Error });
    }
  }
  
  /**
   * Clear all keys in the current namespace
   */
  async clear(): Promise<void> {
    try {
      // Track metrics
      this.metrics.writeOperations++;
      this.metrics.dbQueries++;
      
      // Delete from database
      const queryPrefix = this.namespace ? `${this.namespace}:%` : '';
      const whereClause = this.namespace 
        ? 'AND key LIKE $3' 
        : ''; // Clear all when no namespace is specified
      
      const params = [this.extensionId, this.tenantId];
      
      if (this.namespace) {
        params.push(queryPrefix);
      }
      
      await this.db.query(
        `DELETE FROM extension_storage 
         WHERE extension_id = $1 AND tenant_id = $2 ${whereClause}`,
        params
      );
      
      // Clear from Redis cache (fire and forget)
      const pattern = this.namespace ? `${this.namespace}:*` : '*';
      this.redisCache.clear(pattern)
        .catch(error => {
          this.logger.warn('Failed to clear Redis cache', { 
            namespace: this.namespace, 
            error,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
    } catch (error) {
      this.logger.error('Failed to clear storage', { 
        namespace: this.namespace, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new StorageError('Failed to clear storage', { cause: error as Error });
    }
  }
  
  /**
   * Create a namespaced storage instance
   * This allows extensions to organize their data into logical groups
   */
  getNamespace(namespace: string): ExtensionStorage {
    if (!namespace) {
      throw new Error('Namespace cannot be empty');
    }
    
    return new ExtensionStorageService(
      this.extensionId, 
      this.tenantId, 
      { 
        namespace: this.namespace ? `${this.namespace}:${namespace}` : namespace,
        redis: this.redisCache['redis'], // Pass the same Redis client
        logger: this.logger,
        db: this.db
      }
    );
  }
  
  /**
   * Get cache statistics for monitoring
   */
  async getCacheStats(): Promise<{
    hitRate: number;
    keyCount: number;
    memoryUsage: string;
    circuitStatus: string;
  }> {
    const redisStats = await this.redisCache.getStats();
    
    return {
      hitRate: this.getCacheHitRate(),
      keyCount: redisStats.keyCount,
      memoryUsage: redisStats.memoryUsage,
      circuitStatus: redisStats.circuitStatus
    };
  }
  
  /**
   * Calculate cache hit rate as a percentage
   */
  private getCacheHitRate(): number {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    if (total === 0) return 0;
    return Math.round((this.metrics.cacheHits / total) * 100);
  }
  
  /**
   * Basic quota check for a single key
   */
  private async checkQuota(key: string, dataSize: number): Promise<void> {
    await this.checkQuotaBatch(dataSize);
  }
  
  /**
   * Quota check for batch operations
   */
  private async checkQuotaBatch(additionalSize: number): Promise<void> {
    const quotaLimit = await this.getExtensionQuota();
    const currentUsage = await this.getCurrentUsage();
    
    // Check if this update would exceed the quota
    if (currentUsage + additionalSize > quotaLimit) {
      throw new QuotaExceededError(
        `Storage quota exceeded for extension ${this.extensionId}. ` +
        `Current usage: ${formatSize(currentUsage)}, ` +
        `Additional requested: ${formatSize(additionalSize)}, ` +
        `Limit: ${formatSize(quotaLimit)}`
      );
    }
  }
  
  /**
   * Get the storage quota for this extension
   */
  private async getExtensionQuota(): Promise<number> {
    // Implementation would fetch from configuration or database
    // This is a simplified version
    return 10 * 1024 * 1024; // 10 MB default quota
  }
  
  /**
   * Calculate current storage usage for this extension
   */
  private async getCurrentUsage(): Promise<number> {
    try {
      const result = await this.db.query(
        `SELECT SUM(LENGTH(value)) AS total_size
         FROM extension_storage
         WHERE extension_id = $1 AND tenant_id = $2`,
        [this.extensionId, this.tenantId]
      );
      
      return result.rows[0]?.total_size || 0;
    } catch (error) {
      this.logger.error('Failed to calculate storage usage', { 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      // Return 0 on error to avoid blocking operations, but log the issue
      return 0;
    }
  }
}

/**
 * Helper function to format byte sizes into readable strings
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
```

**Practical Usage Examples:**

Here are practical examples of how extensions would use the storage service:

```typescript
// Extension example: Task management extension storing user preferences
async function saveUserPreferences(extensionContext, userId, preferences) {
  // Get storage with tenant isolation
  const storage = extensionContext.getStorage();
  
  // Use namespacing for organization
  const userStorage = storage.getNamespace('user-prefs');
  
  // Store with TTL of 30 days
  await userStorage.set(userId, preferences, { expiresIn: 30 * 24 * 60 * 60 });
}

// Extension example: Cache API results with TTL
async function getExternalApiData(extensionContext, apiEndpoint) {
  const storage = extensionContext.getStorage();
  const cacheStorage = storage.getNamespace('api-cache');
  
  // Generate a cache key from the endpoint
  const cacheKey = `endpoint:${md5(apiEndpoint)}`;
  
  // Try to get from cache first
  let data = await cacheStorage.get(cacheKey);
  if (data) {
    return data;
  }
  
  // Cache miss - fetch from API
  data = await fetchFromExternalApi(apiEndpoint);
  
  // Cache for 15 minutes
  await cacheStorage.set(cacheKey, data, { expiresIn: 15 * 60 });
  
  return data;
}

// Extension example: Batch operations for performance
async function batchUpdateUserSettings(extensionContext, updates) {
  const storage = extensionContext.getStorage();
  const settingsStorage = storage.getNamespace('settings');
  
  // Prepare batch entries
  const entries = {};
  for (const [userId, settings] of Object.entries(updates)) {
    entries[userId] = settings;
  }
  
  // Update all in one operation
  await settingsStorage.setBatch(entries);
}

// Extension example: Using different namespaces for different data types
function initializeStorage(extensionContext) {
  const storage = extensionContext.getStorage();
  
  // Create namespaces for different types of data
  return {
    settings: storage.getNamespace('settings'),
    cache: storage.getNamespace('cache'),
    userPreferences: storage.getNamespace('user-prefs'),
    temporaryData: storage.getNamespace('temp')
  };
}

// Extension example: Storing temporary data with TTL
async function storeTemporaryAuthToken(extensionContext, userId, token) {
  const storage = extensionContext.getStorage();
  const tempStorage = storage.getNamespace('temp');
  
  // Store auth token with 1 hour expiration
  await tempStorage.set(`auth:${userId}`, token, { expiresIn: 60 * 60 });
}
```

**Features Deferred for Future Phases:**

1. **Advanced Transactions**: Will implement simpler atomic operations first, add full transactions later
2. **Complex Caching Strategies**: Using Redis provides most benefits; advanced patterns can be added later
3. **Data Versioning**: Not needed for initial implementation
4. **Advanced Search**: Extensions can implement their own search logic initially
5. **Encryption at Rest**: Will be added when handling more sensitive data
6. **Advanced Prefetching**: Current caching provides most performance benefits

**Dependencies:**
- Extension registry for extension validation
- Database connection pool for persistent storage
- Simple caching implementation
- Basic job scheduler for cleanup tasks

#### 1.6 Core UI Extension Framework

**Key Concepts:**

1. **Extension Points (Slots)**: Pre-defined areas in the UI where extensions can render components
2. **Extension Components**: React components provided by extensions to render in slots
3. **Extension Context**: React context providing extension metadata and services
4. **Lazy Loading**: Dynamic loading of extension components only when needed
5. **Error Boundaries**: Isolated error handling to prevent extension failures from crashing the app
6. **Permissions**: RBAC-based control of which extensions can render where
7. **Metrics**: Performance tracking for extension rendering and errors

**Component Architecture:**

```
┌─────────────────────────────────────────┐
│ ExtensionProvider                       │
│  ┌─────────────────────────────────────┐│
│  │ Application                         ││
│  │  ┌────────────────────────────────┐ ││
│  │  │ ExtensionSlot (name: "nav")    │ ││
│  │  │  ┌─────────────────────────────┐│ ││
│  │  │  │ExtensionErrorBoundary       ││ ││
│  │  │  │ ┌───────────────────────────┐│ ││
│  │  │  │ │ExtensionRenderer          ││ ││
│  │  │  │ │ (loads & renders Extension││ ││
│  │  │  │ │  Components from multiple ││ ││
│  │  │  │ │  registered extensions)   ││ ││
│  │  │  │ └───────────────────────────┘│ ││
│  │  │  └─────────────────────────────┘│ ││
│  │  └────────────────────────────────┘ ││
│  │                                     ││
│  │  ┌────────────────────────────────┐ ││
│  │  │ ExtensionSlot (name: "widget") │ ││
│  │  │  ...                           │ ││
│  │  └────────────────────────────────┘ ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

**Tasks:**

- [ ] Design component architecture for extension rendering:
  - Create clear interfaces for extension components
  - Define a registry for extension points
  - Design a system for extension component discovery
  - Create a mechanism for passing props to extension components
  - Design sandbox restrictions for security

- [ ] Create `ExtensionSlot` component:
  - Implement slot registration in registry
  - Add support for slot-specific props
  - Allow configuration of ordering extensions within slots
  - Create filtering mechanism to select relevant extensions
  - Add slot-level error boundaries

- [ ] Implement `ExtensionRenderer`:
  - Create lazy loading mechanism using dynamic imports
  - Implement component caching to prevent redundant loads
  - Support asynchronous component loading with loading states
  - Design performance metrics collection during render
  - Add debugging options for development mode

- [ ] Add `ExtensionErrorBoundary`:
  - Implement React error boundary for extension components
  - Create fallback UI for failed extensions
  - Add error reporting to monitoring system
  - Prevent cascading failures between extensions
  - Allow recovery options for end users

- [ ] Create Extension Context Provider:
  - Expose extension metadata to components
  - Provide access to extension services (storage, API)
  - Create tenant isolation at the context level
  - Add session information for the current user
  - Implement context versioning for compatibility

- [ ] Implement dynamic component loading:
  - Create a module resolution system for extension components
  - Implement a caching mechanism to optimize performance
  - Support code splitting for extension modules
  - Add prefetching for common extension points
  - Create retry mechanism for failed loads

- [ ] Add permissions checking:
  - Integrate with RBAC system for extension components
  - Implement permission checks at render time
  - Add support for dynamic permission updates
  - Create permission-aware extension slots
  - Implement an extensible authorization hook

- [ ] Create extension component caching:
  - Implement in-memory cache for loaded components
  - Add cache invalidation on extension updates
  - Create a component registry for fast lookups
  - Support SSR-compatible component caching
  - Add cache metrics for monitoring

- [ ] Implement sandbox attributes:
  - Create restricted execution context for extensions
  - Add prop filtering for security-sensitive data
  - Implement iframe isolation for high-risk extensions
  - Create data access policies for extension components
  - Add runtime checks for dangerous operations

- [ ] Add performance monitoring:
  - Track rendering time for each extension
  - Monitor memory usage of extension components
  - Create warning system for slow-rendering extensions
  - Add custom events for extension lifecycle
  - Implement performance budgets for extensions

**Files to Create:**

- `/server/src/lib/extensions/ui/types.ts` - Type definitions for UI extensions
- `/server/src/lib/extensions/ui/ExtensionSlot.tsx` - Component for defining extension points
- `/server/src/lib/extensions/ui/ExtensionRenderer.tsx` - Component for rendering extension components
- `/server/src/lib/extensions/ui/ExtensionErrorBoundary.tsx` - Error handling for extension components
- `/server/src/lib/extensions/ui/ExtensionProvider.tsx` - Context provider for extensions
- `/server/src/lib/extensions/ui/ExtensionLoader.tsx` - Lazy loading for extension components
- `/server/src/lib/extensions/ui/ExtensionRegistry.ts` - Registry for extension points and components
- `/server/src/lib/extensions/ui/sandbox.ts` - Security sandbox for extension components
- `/server/src/lib/extensions/ui/hooks/useExtension.ts` - Hook for accessing extension context
- `/server/src/lib/extensions/ui/hooks/useExtensionPermission.ts` - Hook for checking permissions
- `/server/src/lib/extensions/ui/hooks/useExtensionMetrics.ts` - Hook for performance monitoring
- `/server/src/lib/extensions/ui/index.ts` - Main entry point for UI extension system

**Example Implementation:**

```typescript
// Extension slot types
interface ExtensionPointDefinition {
  id: string;
  name: string;
  description: string;
  allowMultiple: boolean;
  requiredPermission?: string;
}

// Extension component definition in manifest
interface ExtensionComponentDefinition {
  extensionId: string;
  slotName: string; // Which slot this component targets
  componentPath: string; // Path to the component module
  priority: number; // For ordering within the slot
  requiredPermissions: string[];
  props?: Record<string, any>; // Default props
}

// Extension slot registry
class ExtensionRegistry {
  private slots: Map<string, ExtensionPointDefinition> = new Map();
  private components: Map<string, ExtensionComponentDefinition[]> = new Map();
  
  registerSlot(slot: ExtensionPointDefinition): void {
    this.slots.set(slot.id, slot);
    if (!this.components.has(slot.id)) {
      this.components.set(slot.id, []);
    }
  }
  
  registerComponent(component: ExtensionComponentDefinition): void {
    const slotId = component.slotName;
    if (!this.slots.has(slotId)) {
      throw new Error(`Extension slot ${slotId} not registered`);
    }
    
    const components = this.components.get(slotId) || [];
    components.push(component);
    components.sort((a, b) => b.priority - a.priority);
    this.components.set(slotId, components);
  }
  
  getComponentsForSlot(slotId: string): ExtensionComponentDefinition[] {
    return this.components.get(slotId) || [];
  }
}

// ExtensionProvider component
const ExtensionContext = React.createContext<ExtensionContextValue>(null);

function ExtensionProvider({ children }: { children: React.ReactNode }) {
  const [registry] = useState(() => new ExtensionRegistry());
  const { user, tenant } = useAuth();
  const { checkPermission } = usePermissions();
  
  // Initialize registry with extensions from the server
  useEffect(() => {
    async function loadExtensions() {
      const extensions = await fetchEnabledExtensions(tenant.id);
      
      // Register components from extensions
      extensions.forEach(extension => {
        extension.components.forEach(component => {
          registry.registerComponent({
            extensionId: extension.id,
            slotName: component.slotName,
            componentPath: component.componentPath,
            priority: component.priority || 0,
            requiredPermissions: component.requiredPermissions || [],
            props: component.defaultProps
          });
        });
      });
    }
    
    loadExtensions();
  }, [tenant.id, registry]);
  
  const contextValue = {
    registry,
    user,
    tenant,
    checkPermission
  };
  
  return (
    <ExtensionContext.Provider value={contextValue}>
      {children}
    </ExtensionContext.Provider>
  );
}

// Extension Slot component
function ExtensionSlot({ 
  name, 
  props = {}, 
  filter 
}: { 
  name: string; 
  props?: Record<string, any>;
  filter?: (component: ExtensionComponentDefinition) => boolean;
}) {
  const { registry, checkPermission } = useContext(ExtensionContext);
  const [metrics, trackMetric] = useExtensionMetrics();
  
  // Get components for this slot
  const components = registry.getComponentsForSlot(name);
  
  // Filter components if needed
  const filteredComponents = useMemo(() => {
    return components
      .filter(component => {
        // Apply custom filter if provided
        if (filter && !filter(component)) {
          return false;
        }
        
        // Check permissions
        const hasPermission = component.requiredPermissions.every(
          permission => checkPermission(`extension:${component.extensionId}:${permission}`)
        );
        
        return hasPermission;
      });
  }, [components, filter, checkPermission]);
  
  return (
    <div className="extension-slot" data-slot-name={name}>
      {filteredComponents.map(component => (
        <ExtensionErrorBoundary
          key={`${component.extensionId}-${component.componentPath}`}
          extensionId={component.extensionId}
          onError={(error) => {
            trackMetric('error', {
              extensionId: component.extensionId,
              slotName: name,
              error: error.message
            });
          }}
        >
          <ExtensionRenderer
            extensionId={component.extensionId}
            componentPath={component.componentPath}
            slotProps={props}
            defaultProps={component.props || {}}
            onRender={(timing) => {
              trackMetric('render', {
                extensionId: component.extensionId,
                slotName: name,
                renderTime: timing
              });
            }}
          />
        </ExtensionErrorBoundary>
      ))}
    </div>
  );
}

// Extension Renderer with lazy loading
function ExtensionRenderer({
  extensionId,
  componentPath,
  slotProps,
  defaultProps,
  onRender
}: {
  extensionId: string;
  componentPath: string;
  slotProps: Record<string, any>;
  defaultProps: Record<string, any>;
  onRender: (timing: number) => void;
}) {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const startTime = useRef(Date.now());
  
  // Combine props
  const combinedProps = { ...defaultProps, ...slotProps };
  
  // Dynamically load the component
  useEffect(() => {
    let isMounted = true;
    
    async function loadComponent() {
      try {
        // Dynamic import to load the extension component
        const module = await import(
          /* webpackIgnore: true */
          `/extensions/${extensionId}/${componentPath}`
        );
        
        // Get the default export
        const Component = module.default;
        
        if (isMounted) {
          setComponent(() => Component);
          setLoading(false);
          
          // Track rendering performance
          const loadTime = Date.now() - startTime.current;
          onRender(loadTime);
        }
      } catch (err) {
        if (isMounted) {
          setError(err as Error);
          setLoading(false);
        }
      }
    }
    
    loadComponent();
    
    return () => {
      isMounted = false;
    };
  }, [extensionId, componentPath, onRender]);
  
  if (loading) {
    return <div className="extension-loading">Loading extension...</div>;
  }
  
  if (error || !Component) {
    return <div className="extension-error">Failed to load extension component</div>;
  }
  
  // Apply sandbox restrictions to the component
  const SandboxedComponent = applySandbox(Component, extensionId);
  
  return <SandboxedComponent {...combinedProps} />;
}

// Error boundary for extensions
class ExtensionErrorBoundary extends React.Component<{
  extensionId: string;
  children: React.ReactNode;
  onError: (error: Error) => void;
}> {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`Error in extension ${this.props.extensionId}:`, error, errorInfo);
    this.props.onError(error);
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="extension-error-boundary">
          <p>An error occurred in this extension</p>
          <button onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      );
    }
    
    return this.props.children;
  }
}

// Custom hook for extension metrics
function useExtensionMetrics() {
  const metricsRef = useRef<Record<string, any[]>>({
    render: [],
    error: []
  });
  
  const trackMetric = useCallback((type: string, data: any) => {
    if (!metricsRef.current[type]) {
      metricsRef.current[type] = [];
    }
    
    metricsRef.current[type].push({
      ...data,
      timestamp: Date.now()
    });
    
    // Report metrics to monitoring system
    reportExtensionMetric(type, data);
  }, []);
  
  return [metricsRef.current, trackMetric];
}

// Example usage in application
function App() {
  return (
    <ExtensionProvider>
      <div className="app">
        <header>
          <ExtensionSlot name="navigation" />
        </header>
        <main>
          <div className="dashboard">
            <ExtensionSlot 
              name="dashboard-widget" 
              props={{ location: 'main' }}
              filter={(component) => component.props?.widgetSize === 'large'}
            />
          </div>
          <div className="sidebar">
            <ExtensionSlot 
              name="dashboard-widget" 
              props={{ location: 'sidebar' }}
              filter={(component) => component.props?.widgetSize === 'small'} 
            />
          </div>
        </main>
      </div>
    </ExtensionProvider>
  );
}
```

**Security Considerations:**

1. **Sandbox Isolation**:
   - Component rendering within restricted contexts
   - Limiting access to global objects
   - Preventing access to sensitive APIs
   - Content Security Policy restrictions

2. **Permission Enforcement**:
   - Runtime checks for component rendering
   - Validating extension permissions before rendering
   - Tenant isolation in all extension code
   - Role-based access control integration

3. **Error Isolation**:
   - Preventing extension errors from affecting host application
   - Limiting cascading failures between extensions
   - Resource limits for extension rendering
   - Timeout mechanisms for long-running extensions

4. **Data Access Control**:
   - Filtering sensitive data from props
   - Scoping extension API access
   - Preventing cross-extension data access
   - Auditing data access patterns

**Performance Considerations:**

1. **Lazy Loading Strategy**:
   - Only load extensions when their slot is visible
   - Implement code splitting for extension components
   - Prioritize critical extension points
   - Use preloading for common extensions

2. **Caching Mechanisms**:
   - Cache loaded extension components
   - Implement intelligent cache invalidation
   - Use memory-efficient caching strategies
   - Support server-side rendering for extensions

3. **Rendering Optimizations**:
   - Monitor extension render performance
   - Implement render timeouts for slow extensions
   - Use React.memo for extension components
   - Add virtualization for lists of extensions

4. **Resource Management**:
   - Track memory usage of extensions
   - Implement resource quotas for extensions
   - Garbage collect unused extension components
   - Detect and mitigate memory leaks

**Dependencies:**
- Extension registry system
- React (v18+) for component rendering
- Dynamic import capability (webpack/vite)
- Performance monitoring tools
- Permission checking system

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

#### 2.1 Tab Extensions (80/20 Implementation)

**Overview:**
Tab extensions allow third-party extensions to add new tabs to existing Alga PSA pages (like Billing, Tickets, Projects, etc.), enabling seamless integration of custom functionality within the existing application structure.

**Core Tab Item Schema:**
```typescript
interface TabExtensionProps {
  id: string;             // Unique identifier
  parentPage: string;     // Parent page to attach to (e.g., "billing", "tickets")
  label: string;          // Display text for the tab
  icon?: string;          // Optional icon name
  priority?: number;      // Order in the tabs (higher = earlier)
  permissions?: string[]; // Required permissions
}
```

**Manifest Definition Example:**
```json
{
  "components": [
    {
      "type": "tab-extension",
      "slot": "page-tabs",
      "component": "./components/BillingReportTab",
      "props": {
        "id": "custom-billing-report",
        "parentPage": "billing",
        "label": "Custom Reports",
        "icon": "FileTextIcon",
        "priority": 50,
        "permissions": ["view:billing"]
      }
    }
  ]
}
```

**Minimal Tasks:**

- [ ] Identify common tab pattern in Alga PSA pages:
  - Analyze existing tab implementation in pages like Billing, Settings, etc.
  - Document tab switching mechanism and URL pattern

- [ ] Implement `TabExtensionRegistry` service:
  - Create registry for extension tabs with parent page association
  - Add methods to register and retrieve tabs for specific pages
  - Support permission filtering and priority sorting

- [ ] Create `TabExtensionSlot` component:
  - Implement reusable component to be added to each tabbed page
  - Render extension tabs alongside native tabs with consistent styling
  - Support URL-based tab activation matching Alga's pattern

- [ ] Create `TabExtensionRenderer` component:
  - Handle dynamic loading of tab content components
  - Implement error boundaries for tab content
  - Support tab-specific permissions

- [ ] Modify key page components:
  - Update Billing, Tickets, Projects, and other main pages to include extension tabs
  - Ensure tab state management works with dynamic tabs
  - Maintain proper URL synchronization

**Files to Create/Modify:**

- `/server/src/lib/extensions/ui/tabs/TabExtensionRegistry.ts` - Registry for tab extensions
- `/server/src/lib/extensions/ui/tabs/TabExtensionSlot.tsx` - Component for rendering extension tabs
- `/server/src/lib/extensions/ui/tabs/TabExtensionRenderer.tsx` - Component for rendering tab content
- `/server/src/components/billing-dashboard/Billing.tsx` - Update to include extension tabs
- `/server/src/components/tickets/Tickets.tsx` - Update to include extension tabs
- `/server/src/components/projects/Projects.tsx` - Update to include extension tabs
- `/server/src/components/settings/Settings.tsx` - Update to include extension tabs

**Example Implementation:**

```typescript
// TabExtensionSlot.tsx - Integrated with Alga's UI system
import React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useExtensionRegistry } from '../hooks/useExtensionRegistry';
import { TabExtensionRenderer } from './TabExtensionRenderer';
import { TabExtensionProps } from './TabExtensionTypes';
import { usePermissions } from '../../hooks/usePermissions';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';

interface TabExtensionSlotProps {
  parentPage: string;  // Which page these tabs belong to (e.g., "billing")
  currentTab: string;  // Currently active tab
  onTabChange: (tabId: string) => void; // Tab change handler
}

export function TabExtensionSlot({ parentPage, currentTab, onTabChange }: TabExtensionSlotProps) {
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `extension-tabs-${parentPage}`,
    type: 'container',
    label: `Extension Tabs for ${parentPage}`,
    variant: 'default'
  });

  const { getTabExtensions } = useExtensionRegistry();
  const { hasPermission } = usePermissions();
  
  // Get extension tabs for this parent page
  const tabExtensions = getTabExtensions(parentPage);
  
  // Filter tabs by permission and sort by priority
  const availableTabs = tabExtensions
    .filter(tab => {
      const permissions = tab.props?.permissions || [];
      return permissions.every(p => hasPermission(p));
    })
    .sort((a, b) => (b.props?.priority || 0) - (a.props?.priority || 0));
  
  if (availableTabs.length === 0) {
    return null; // No tabs to render
  }
  
  return (
    <ReflectionContainer id={`extension-tabs-${parentPage}`} label={`Extension Tabs for ${parentPage}`}>
      <div className="extension-tabs" {...automationIdProps}>
        {availableTabs.map(tab => (
          <button
            key={tab.props.id}
            className={`px-4 py-2 border-b-2 ${currentTab === tab.props.id 
              ? 'border-primary-500 text-primary-700 font-medium' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            onClick={() => onTabChange(tab.props.id)}
          >
            {tab.props.label}
          </button>
        ))}
      </div>
      
      {/* Render the content of the active tab */}
      {availableTabs.map(tab => (
        <div key={tab.props.id} style={{ display: currentTab === tab.props.id ? 'block' : 'none' }}>
          {currentTab === tab.props.id && (
            <TabExtensionRenderer
              extensionId={tab.extensionId}
              component={tab.component}
              {...tab.props}
            />
          )}
        </div>
      ))}
    </ReflectionContainer>
  );
}
```

**Integration Example:**

```typescript
// In Billing.tsx (example of integration in an existing page)
import { TabExtensionSlot } from '../../lib/extensions/ui/tabs/TabExtensionSlot';

export function Billing() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  
  // Get the current tab from URL query params
  const currentTab = searchParams.get('tab') || 'overview';
  
  // Native tabs definition
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'generate-invoices', label: 'Generate Invoices' },
    { id: 'invoices', label: 'Invoices' },
    // ... other native tabs
  ];
  
  // Handle tab change including extension tabs
  const handleTabChange = (tabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tabId);
    router.push(`${pathname}?${params.toString()}`);
  };
  
  return (
    <div className="billing-page">
      <h1 className="text-2xl font-bold mb-4">Billing</h1>
      
      <div className="tabs-container mb-4 border-b">
        {/* Native tabs */}
        <div className="flex">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`px-4 py-2 border-b-2 ${currentTab === tab.id 
                ? 'border-primary-500 text-primary-700 font-medium' 
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          
          {/* Extension tabs - will render after native tabs */}
          <TabExtensionSlot 
            parentPage="billing" 
            currentTab={currentTab} 
            onTabChange={handleTabChange} 
          />
        </div>
      </div>
      
      {/* Tab content - native tabs */}
      {currentTab === 'overview' && <BillingOverview />}
      {currentTab === 'generate-invoices' && <GenerateInvoices />}
      {currentTab === 'invoices' && <Invoices />}
      {/* ... other native tab contents */}
      
      {/* Extension tab content is handled by TabExtensionSlot */}
    </div>
  );
}
```

**Core Security Considerations:**
- Validate tab IDs to prevent collisions with native tabs
- Check user permissions before rendering tab content
- Ensure proper error isolation for extension tab content
- Apply route protection consistent with Alga's security model

**Dependencies:**
- Core extension system (1.6)
- Alga's routing system
- Permission checking system

#### 2.2 Navigation Extensions (80/20 Implementation)

**Overview:**
Navigation extensions allow third-party extensions to add their own items to the application's navigation menu, providing entry points to custom pages or functionality.

**Core Navigation Item Schema:**
```typescript
interface NavigationItemProps {
  id: string;             // Unique identifier
  label: string;          // Display text
  icon?: string;          // Icon name from IconRegistry
  path: string;           // Route path
  priority?: number;      // Order in the menu (higher = earlier)
  permissions?: string[]; // Required permissions
}
```

**Manifest Definition Example:**
```json
{
  "components": [
    {
      "type": "navigation-item",
      "slot": "main-navigation",
      "props": {
        "id": "tasks",
        "label": "Tasks",
        "icon": "ChecklistIcon",
        "path": "/extensions/task-manager",
        "priority": 80,
        "permissions": ["view:tasks"]
      }
    }
  ]
}
```

**Minimal Tasks:**

- [ ] Implement `NavigationSlot` component:
  - Add extension slot to Alga's `Sidebar` component defined in `/server/src/components/layout/Sidebar.tsx`
  - Sort navigation items by priority using the same approach as in `menuConfig.ts`
  - Integrate with Alga's `ReflectionContainer` for UI automation tracking
  - Check user permissions before rendering using existing permission hooks

- [ ] Create `NavItemRenderer` component:
  - Implement consistent styling matching `SidebarMenuItem` component
  - Support for icons from Radix and Lucide libraries used in Alga
  - Handle active state detection based on current route using `usePathname()` hook
  - Support collapsible sidebar behavior with tooltips in collapsed state

- [ ] Modify main navigation layout:
  - Add extension slot to `Sidebar.tsx` component between core and bottom menu items
  - Ensure proper UI reflection registration for extension navigation items

**Files to Create/Modify:**

- `/server/src/components/layout/Navigation.tsx` - Modify to include extension slot
- `/server/src/lib/extensions/ui/navigation/NavigationSlot.tsx` - Extension slot for navigation items
- `/server/src/lib/extensions/ui/navigation/NavItemRenderer.tsx` - Renderer for navigation items
- `/server/src/lib/extensions/ui/navigation/NavItemTypes.ts` - Type definitions for navigation items

**Simplified Example Implementation:**

```typescript
// NavigationSlot.tsx - Integrated with Alga's UI Reflection System
import React from 'react';
import { useExtensionComponents } from '../hooks/useExtensionComponents';
import { NavItemRenderer } from './NavItemRenderer';
import { NavigationItemProps } from './NavItemTypes';
import { usePermissions } from '../../hooks/usePermissions';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';

export function NavigationSlot() {
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `extension-navigation`,
    type: 'container',
    label: `Extension Navigation Items`,
    variant: 'default'
  });

  const { components } = useExtensionComponents('main-navigation');
  const { hasPermission } = usePermissions();
  
  // Filter components by permission and sort by priority
  const navigationItems = components
    .filter(comp => {
      const permissions = comp.props?.permissions || [];
      return permissions.every(p => hasPermission(p));
    })
    .sort((a, b) => (b.props?.priority || 0) - (a.props?.priority || 0));
  
  return (
    <ReflectionContainer id="extension-navigation" label="Extension Navigation Items">
      <ul className="space-y-1" {...automationIdProps}>
        {navigationItems.map(item => (
          <li key={`${item.extensionId}-${item.props.id}`}>
            <NavItemRenderer
              extensionId={item.extensionId}
              {...item.props}
            />
          </li>
        ))}
      </ul>
    </ReflectionContainer>
  );
}

// NavItemRenderer.tsx - Using Alga's sidebar item styling
import React from 'react';
import { usePathname } from 'next/navigation';
import * as RadixIcons from '@radix-ui/react-icons';
import * as Tooltip from '@radix-ui/react-tooltip';
import Link from 'next/link';
import { NavigationItemProps } from './NavItemTypes';

export function NavItemRenderer({ 
  id, 
  label, 
  icon, 
  path,
  extensionId
}: NavigationItemProps & { extensionId: string }) {
  const pathname = usePathname();
  const isActive = pathname === path;
  const { sidebarOpen } = useSidebar(); // Assuming there's a sidebar context
  
  // Get icon component - supports both Radix and Lucide icons
  let IconComponent = null;
  if (icon) {
    if (icon in RadixIcons) {
      IconComponent = RadixIcons[icon];
    } else if (typeof window !== 'undefined' && window.LucideIcons && icon in window.LucideIcons) {
      IconComponent = window.LucideIcons[icon];
    }
  }
  
  const navItemContent = (
    <Link
      href={path}
      className={`flex items-center py-2 px-3 rounded-md transition-colors ${isActive 
        ? 'bg-[#2a2b32] text-white' 
        : 'text-gray-300 hover:bg-[#2a2b32] hover:text-white'}`}
      id={`extension-menu-${id.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {IconComponent && (
        <span className="mr-3">
          <IconComponent className="h-5 w-5" />
        </span>
      )}
      {sidebarOpen && <span className="text-sm">{label}</span>}
    </Link>
  );

  // If sidebar is collapsed, wrap with tooltip like in Sidebar.tsx
  if (!sidebarOpen) {
    return (
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            {navItemContent}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="bg-subMenu-bg text-subMenu-text px-2 py-1 rounded-md text-sm"
              side="right"
              sideOffset={5}
            >
              {label}
              <Tooltip.Arrow style={{ fill: 'var(--color-submenu-bg)' }} />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  }

  return navItemContent;
}

// Integration with Sidebar.tsx
import { NavigationSlot } from '../lib/extensions/ui/navigation/NavigationSlot';

const Sidebar: React.FC<SidebarProps> = ({ sidebarOpen, setSidebarOpen }): JSX.Element => {
  // ... existing code
  
  return (
    <ReflectionContainer id="main-sidebar" label="Main Navigation">
      <aside className={`bg-[#1e1f25] text-white h-screen flex flex-col relative transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-64' : 'w-16'}`}>
        {/* ... Logo and search ... */}
        
        <nav className="mt-4 flex-grow overflow-y-auto">
          <ul className="space-y-1">
            {menuItems.map(renderMenuItem)}
          </ul>
          
          {/* Extension navigation items - added here */}
          <NavigationSlot />
        </nav>
        
        <div className="mt-auto">
          <ul className="space-y-1">
            {bottomMenuItems.map((item) => (
              // ... bottom menu items
            ))}
          </ul>
        </div>
        
        {/* ... Collapse button ... */}
      </aside>
    </ReflectionContainer>
  );
};
```

**Core Security Considerations:**
- Validate extension navigation paths to enforce extension namespace pattern
- Check user permissions before rendering navigation items
- Sanitize navigation labels to prevent XSS

**Dependencies:**
- Core extension system (1.6)
- Main navigation component
- Icon registry
- Permission checking system

#### 2.2 Dashboard Widget Extensions (80/20 Implementation)

**Overview:**
Dashboard widget extensions allow third-party extensions to contribute widgets to the application's dashboard, providing at-a-glance information and quick actions to users.

**Core Widget Schema:**
```typescript
interface DashboardWidgetProps {
  id: string;             // Unique identifier
  title: string;          // Widget title
  size: 'small' | 'medium' | 'large'; // Widget size
  refreshInterval?: number; // Refresh data interval in seconds
  permissions?: string[]; // Required permissions
}
```

**Manifest Definition Example:**
```json
{
  "components": [
    {
      "type": "dashboard-widget",
      "slot": "dashboard-widgets",
      "component": "./components/TaskSummaryWidget",
      "props": {
        "id": "task-summary",
        "title": "Task Summary",
        "size": "medium",
        "refreshInterval": 300,
        "permissions": ["view:tasks"]
      }
    }
  ]
}
```

**Minimal Tasks (Deprioritized for v2):**

- [ ] Implement `DashboardWidgetSlot` component:
  - Add extension slot to Alga's existing `Dashboard.tsx` component at `/server/src/components/dashboard/Dashboard.tsx`
  - Integrate with Alga's `ReflectionContainer` for UI automation tracking
  - Check user permissions before rendering widgets using existing permission hooks
  - Apply size-based styling to widgets matching Alga's existing `FeatureCard` component style

- [ ] Create `WidgetRenderer` component:
  - Implement consistent styling matching Alga's existing card designs using Tailwind CSS classes
  - Add header with title using the same styling as the existing cards
  - Handle loading and error states with the same visual design language
  - Add refresh capability consistent with Alga's UX patterns

- [ ] Add simple data fetching for widgets:
  - Create API endpoint for widget data at `/server/src/pages/api/extensions/[extensionId]/widget-data/[widgetId].ts`
  - Implement data fetching hook with refresh support that respects tenant isolation
  - Add error handling consistent with Alga's existing error patterns

**Files to Create/Modify:**

- `/server/src/components/dashboard/Dashboard.tsx` - Modify to include extension slot
- `/server/src/lib/extensions/ui/dashboard/DashboardWidgetSlot.tsx` - Extension slot for dashboard widgets
- `/server/src/lib/extensions/ui/dashboard/WidgetRenderer.tsx` - Renderer for dashboard widgets
- `/server/src/lib/extensions/ui/dashboard/WidgetTypes.ts` - Type definitions for dashboard widgets
- `/server/src/lib/extensions/ui/dashboard/useWidgetData.ts` - Hook for widget data fetching
- `/server/src/pages/api/extensions/[extensionId]/widget-data/[widgetId].ts` - API endpoint for widget data

**Simplified Example Implementation:**

```typescript
// DashboardWidgetSlot.tsx - Integrated with Alga's UI system
import React from 'react';
import { useExtensionComponents } from '../hooks/useExtensionComponents';
import { WidgetRenderer } from './WidgetRenderer';
import { DashboardWidgetProps } from './WidgetTypes';
import { usePermissions } from '../../hooks/usePermissions';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';

export function DashboardWidgetSlot() {
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `extension-dashboard-widgets`,
    type: 'container',
    label: `Extension Dashboard Widgets`,
    variant: 'default'
  });
  
  const { components } = useExtensionComponents('dashboard-widgets');
  const { hasPermission } = usePermissions();
  
  // Filter widgets by permission
  const widgets = components.filter(comp => {
    const permissions = comp.props?.permissions || [];
    return permissions.every(p => hasPermission(p));
  });
  
  return (
    <ReflectionContainer id="extension-dashboard-widgets" label="Extension Dashboard Widgets">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" {...automationIdProps}>
        {widgets.map(widget => (
          <WidgetRenderer
            key={`${widget.extensionId}-${widget.props.id}`}
            extensionId={widget.extensionId}
            component={widget.component}
            {...widget.props}
          />
        ))}
      </div>
    </ReflectionContainer>
  );
}

// WidgetRenderer.tsx - Using Alga's card and styling patterns
import React from 'react';
import { DashboardWidgetProps } from './WidgetTypes';
import { useWidgetData } from './useWidgetData';
import { ExtensionErrorBoundary } from '../ExtensionErrorBoundary';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ButtonComponent } from 'server/src/types/ui-reflection/types';
import { RefreshCw } from 'lucide-react'; // Using Lucide icons like in Alga

interface WidgetRendererProps extends DashboardWidgetProps {
  extensionId: string;
  component: React.ComponentType<any> | null;
}

export function WidgetRenderer({ 
  id,
  title,
  size,
  refreshInterval,
  extensionId, 
  component 
}: WidgetRendererProps) {
  // Register with Alga's UI automation system
  const { automationIdProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `widget-${extensionId}-${id}`,
    type: 'component',
    label: title,
    variant: 'default'
  });
  
  // Fetch widget data
  const { data, isLoading, error, refetch } = useWidgetData(
    extensionId, 
    id, 
    refreshInterval
  );
  
  // Determine size class based on size prop - match FeatureCard pattern
  const sizeClass = {
    'small': 'col-span-1',
    'medium': 'col-span-1 md:col-span-2',
    'large': 'col-span-1 md:col-span-2 lg:col-span-3',
  }[size] || 'col-span-1';
  
  return (
    <ReflectionContainer id={`widget-${extensionId}-${id}`} label={title}>
      <div 
        className={`${sizeClass} rounded-lg border border-[rgb(var(--color-border-200))] bg-white hover:shadow-lg transition-shadow p-4`}
        {...automationIdProps}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold" style={{ color: 'rgb(var(--color-text-900))' }}>{title}</h3>
          <button 
            onClick={refetch}
            aria-label="Refresh widget"
            className="p-1 rounded-full hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className="h-4 w-4" style={{ color: 'rgb(var(--color-primary-500))' }} />
          </button>
        </div>
        
        <div className="widget-content">
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-500"></div>
              <span className="ml-2 text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>Loading...</span>
            </div>
          )}
          
          {error && !isLoading && (
            <div className="py-4 text-center">
              <p className="text-sm text-red-500 mb-2">Failed to load widget data</p>
              <button 
                onClick={refetch}
                className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Retry
              </button>
            </div>
          )}
          
          {!isLoading && !error && component && (
            <ExtensionErrorBoundary extensionId={extensionId}>
              {React.createElement(component, { data })}
            </ExtensionErrorBoundary>
          )}
        </div>
      </div>
    </ReflectionContainer>
  );
}

// useWidgetData.ts - Hook for handling widget data fetching with tenant awareness
import { useState, useEffect, useCallback } from 'react';
import { useTenant } from '../../hooks/useTenant'; // Using Alga's tenant hook

function useWidgetData(extensionId, widgetId, refreshInterval) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const tenant = useTenant(); // Get current tenant for isolation
  
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Include tenant in request headers for proper isolation
      const response = await fetch(`/api/extensions/${extensionId}/widget-data/${widgetId}`, {
        headers: {
          'X-Tenant-ID': tenant.id
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to fetch widget data: ${response.status}`);
      }
      
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      console.error('Widget data fetch error:', err);
      setError(err.message || 'Failed to load widget data');
    } finally {
      setIsLoading(false);
    }
  }, [extensionId, widgetId, tenant.id]);
  
  // Fetch data on mount and set up refresh interval
  useEffect(() => {
    fetchData();
    
    if (refreshInterval) {
      const intervalId = setInterval(fetchData, refreshInterval * 1000);
      return () => clearInterval(intervalId);
    }
  }, [fetchData, refreshInterval]);
  
  return { data, isLoading, error, refetch: fetchData };
}

// Integration with Dashboard.tsx (Alga's existing dashboard component)
import { DashboardWidgetSlot } from '../lib/extensions/ui/dashboard/DashboardWidgetSlot';

const WelcomeDashboard = () => {
  return (
    <ReflectionContainer id="dashboard-main" label="MSP Dashboard">
      <div className="p-6 min-h-screen" style={{ background: 'rgb(var(--background))' }}>
        {/* Welcome Banner */}
        <div className="rounded-lg mb-6 p-6" 
             style={{ background: 'linear-gradient(to right, rgb(var(--color-primary-500)), rgb(var(--color-secondary-500)))' }}>
          <div className="max-w-3xl">
            <h1 className="text-3xl font-bold mb-2 text-white">Welcome to Your MSP Command Center</h1>
            <p className="text-lg text-white opacity-90">
              Your all-in-one platform for managing IT services, tracking assets, 
              and delivering exceptional support to your clients.
            </p>
          </div>
        </div>

        {/* Quick Start Section */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'rgb(var(--color-text-900))' }}>Quick Start Guide</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Quick start cards... */}
          </div>
        </div>

        {/* Features Grid - Core features */}
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'rgb(var(--color-text-900))' }}>Platform Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Core feature cards... */}
        </div>
        
        {/* Extension dashboard widgets - added here */}
        <h2 className="text-xl font-semibold my-4" style={{ color: 'rgb(var(--color-text-900))' }}>Extension Features</h2>
        <DashboardWidgetSlot />

        {/* Getting Started Footer */}
        <div className="mt-8 rounded-lg border border-dashed border-[rgb(var(--color-border-200))] bg-white p-4">
          {/* Footer content... */}
        </div>
      </div>
    </ReflectionContainer>
  );
};

export function Dashboard() {
  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
      </div>
      
      {/* Core dashboard widgets */}
      <div className="core-widgets">
        <CoreWidget1 />
        <CoreWidget2 />
      </div>
      
      {/* Extension dashboard widgets */}
      <DashboardWidgetSlot />
    </div>
  );
}
```

**Core Security Considerations:**
- Validate all data returned from extension API endpoints
- Check user permissions before rendering widget data
- Implement proper error boundaries for widgets
- Limit API request frequency for widget data

**Dependencies:**
- Core extension system (1.6)
- Dashboard component
- API endpoint framework

#### 2.3 Custom Page Extensions (Prioritized for v1)

**Integration with Alga's Next.js App Router:**

Alga PSA uses Next.js for routing, so we'll integrate our custom pages with the app router structure while maintaining Alga's UI patterns and authentication flow.

**Tasks:**
- [ ] Implement custom page extension points using Next.js App Router's dynamic routes
- [ ] Create dynamic route handling for extension pages that follows Alga's layout patterns
- [ ] Add permission checking using Alga's existing RBAC system
- [ ] Integrate with Alga's UI reflection system for consistent UI tracking
- [ ] Ensure tenant isolation is maintained for all extension pages

**Files to Create:**
- `/server/src/app/msp/extensions/[extensionId]/[...path]/page.tsx` - Follow Alga's path structure
- `/server/src/app/msp/extensions/[extensionId]/[...path]/layout.tsx` - Use Alga's layout components
- `/server/src/lib/extensions/ui/pages/PageRenderer.tsx` - Handle extension page rendering with proper UI reflection

**Dependencies:**
- Core extension system
- Alga's Next.js App Router configuration
- Alga's authentication middleware
- Alga's UI reflection system

### Phase 3: Basic API Extensions

#### 3.1 Simple Custom API Endpoints

**Integration with Alga's API Structure:**

Alga PSA has a well-defined API structure with proper tenant isolation, error handling, and authentication. We'll ensure our extension API endpoints follow these patterns.

**Tasks:**
- [ ] Implement custom endpoint registration that follows Alga's API patterns
- [ ] Create endpoint request handler with proper tenant isolation
- [ ] Add permission checking using Alga's existing RBAC system
- [ ] Ensure consistent error handling and response formatting
- [ ] Add proper logging and monitoring integration

**Files to Create:**
- `/server/src/pages/api/extensions/[extensionId]/[...path].ts` - Main API route
- `/server/src/lib/extensions/api/endpointHandler.ts` - Extension API handler
- `/server/src/middleware/extensionApiMiddleware.ts` - Middleware for tenant isolation and auth

**Dependencies:**
- Core extension system
- Alga's API structure and middleware
- Tenant isolation system
- RBAC permission system

#### 3.2 Essential Developer SDK

**Alga-Specific Developer SDK:**

We'll create an SDK that provides extension developers with access to Alga's UI components, styling, and API patterns to ensure a consistent experience.

**Tasks:**
- [ ] Define SDK interfaces and types that match Alga's type system
- [ ] Create API client wrapper that supports Alga's API patterns and tenant isolation
- [ ] Implement UI component library that uses Alga's existing components and styling
- [ ] Add helper functions for common Alga-specific operations
- [ ] Create proper TypeScript definitions for all SDK components

**Files to Create:**
- `/server/src/lib/extensions/sdk/index.ts` - Main SDK entry point
- `/server/src/lib/extensions/sdk/api-client.ts` - API client with tenant awareness
- `/server/src/lib/extensions/sdk/ui-components.ts` - UI components matching Alga's design
- `/server/src/lib/extensions/sdk/hooks.ts` - React hooks for Alga-specific features
- `/server/src/lib/extensions/sdk/types.ts` - TypeScript type definitions

**Dependencies:**
- Extension registry
- Alga's API client structure
- Alga's UI component library
- Alga's theming system

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
- Entity page extensions integrated with Alga's entity detail pages
- Action menu integrations for tickets, projects, and other entities
- Extension settings UI using Alga's settings page patterns
- Form field customizations integrated with Alga's form system

### Future Phase B: Advanced API Extensions
- API middleware system that enhances Alga's existing middleware
- Extension-specific API tokens with Alga's security model
- Resource usage monitoring integrated with Alga's monitoring
- API request sandboxing with proper tenant isolation

### Future Phase C: Data Extensions
- Custom fields framework integrated with Alga's existing entity models
- Custom reports that extend Alga's reporting capabilities
- Data exports integrated with Alga's existing export functionality

### Future Phase D: Workflow Extensions
- Custom workflow actions that integrate with Alga's workflow system
- Custom workflow triggers for Alga-specific events
- Custom workflow forms that use Alga's form components
- Integration with Alga's automation hub

### Future Phase E: Advanced Features
- Extension marketplace with Alga-specific extension categories
- Extension debugging tools integrated with Alga's development workflow
- Analytics and monitoring using Alga's existing monitoring infrastructure
- Advanced security features aligned with Alga's security model

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
   - 5 sample extensions available at launch, including:
     - At least 2 tab extensions for existing pages (e.g., Billing, Tickets)
     - At least 1 custom page extension
     - At least 1 navigation extension
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

After delivering the core extension system described above, we'll evaluate usage patterns and customer feedback to prioritize the next set of features from our deferred phases.

**Initial Priorities:**

1. Tab Extensions (v1 - highest priority)
   - Allow extending existing pages with new tabs
   - Focus on key pages like Billing, Tickets, Projects, and Settings

2. Custom Pages (v1)
   - Enable creation of entirely new pages with custom functionality
   - Integrate with Alga's navigation and layout system

3. Navigation Extensions (v1)
   - Add custom items to the main navigation menu
   - Support proper permissions and tenant isolation

4. Dashboard Widgets (v2)
   - Add custom widgets to the dashboard
   - Support data fetching and refresh capabilities

The long-term vision remains comprehensive, but we'll build incrementally based on real-world usage data from our initial release.