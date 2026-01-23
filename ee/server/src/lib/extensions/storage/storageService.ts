/**
 * Extension Storage Service
 * 
 * Provides extension data storage with tenant isolation
 */
import { createTenantKnex } from '@/lib/db';
import logger from '@alga-psa/core/logger';
import { getRedisClient } from '@/config/redisConfig';
import { 
  ExtensionStorageService as IExtensionStorageService,
  StorageOptions
} from '../types';
import { 
  ExtensionStorageError,
  ExtensionStorageQuotaError
} from '../errors';

/**
 * Redis cache adapter for extension storage
 */
class RedisCacheAdapter {
  private redis: any;
  private prefix: string;
  private circuitBreaker: {
    failures: number;
    lastFailure: number;
    status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  };
  private readonly FAILURE_THRESHOLD = 5;
  private readonly RESET_TIMEOUT_MS = 30000; // 30 seconds
  
  constructor(extensionId: string, tenantId: string, namespace: string = '') {
    this.redis = null; // Will be initialized async
    this.prefix = `tenant:${tenantId}:ext:${extensionId}:${namespace ? namespace + ':' : ''}`;
    
    // Initialize circuit breaker
    this.circuitBreaker = {
      failures: 0,
      lastFailure: 0,
      status: 'CLOSED'
    };
    
    // Initialize Redis connection asynchronously
    this.initializeRedis();
  }
  
  /**
   * Initialize Redis connection
   */
  private async initializeRedis(): Promise<void> {
    try {
      this.redis = await getRedisClient();
      logger.debug('Redis connection initialized for extension storage', { 
        prefix: this.prefix 
      });
    } catch (error) {
      logger.error('Failed to initialize Redis connection for extension storage', { 
        prefix: this.prefix,
        error 
      });
      this.circuitBreaker.status = 'OPEN';
      this.circuitBreaker.failures = this.FAILURE_THRESHOLD;
      this.circuitBreaker.lastFailure = Date.now();
    }
  }

  /**
   * Get full Redis key
   */
  private getRedisKey(key: string): string {
    return `${this.prefix}${key}`;
  }
  
  /**
   * Check if circuit breaker should allow operations
   */
  private async checkCircuitBreaker(): Promise<boolean> {
    const now = Date.now();
    
    // If circuit is open, check if we should attempt to close it
    if (this.circuitBreaker.status === 'OPEN') {
      const timeElapsedSinceFailure = now - this.circuitBreaker.lastFailure;
      
      // If we've waited long enough, try half-open state
      if (timeElapsedSinceFailure >= this.RESET_TIMEOUT_MS) {
        this.circuitBreaker.status = 'HALF_OPEN';
        logger.info('Circuit breaker entering half-open state', { prefix: this.prefix });
      } else {
        return false; // Still open, don't allow operation
      }
    }
    
    // Check Redis connection by pinging
    if (this.circuitBreaker.status === 'HALF_OPEN') {
      try {
        if (!this.redis) {
          throw new Error('Redis client not initialized');
        }
        await this.redis.ping();
        // Success! Close the circuit
        this.circuitBreaker.status = 'CLOSED';
        this.circuitBreaker.failures = 0;
        logger.info('Circuit breaker closed, Redis connection restored', { prefix: this.prefix });
        return true;
      } catch (error) {
        // Still failing, open the circuit again
        this.circuitBreaker.status = 'OPEN';
        this.circuitBreaker.lastFailure = now;
        logger.warn('Circuit breaker remains open, Redis still unavailable', { prefix: this.prefix });
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
    
    logger.warn(`Redis cache ${operation} failed`, { 
      prefix: this.prefix,
      error,
      failures: this.circuitBreaker.failures
    });
    
    // Open circuit if we exceed failure threshold
    if (this.circuitBreaker.failures >= this.FAILURE_THRESHOLD) {
      this.circuitBreaker.status = 'OPEN';
      logger.error('Circuit breaker opened due to multiple Redis failures', { 
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
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }
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
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }
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
   * Delete a value from the cache
   */
  async delete(key: string): Promise<void> {
    // Skip operation if circuit breaker is open
    if (!(await this.checkCircuitBreaker())) {
      return;
    }
    
    const redisKey = this.getRedisKey(key);
    try {
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }
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
      
      logger.debug('Cache cleared', { pattern, keysRemoved: keys.length });
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
        const memory = info.split('\n').find((line: string) => line.startsWith('used_memory_human:'))?.split(':')[1]?.trim() || 'unknown';
        
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

/**
 * Extension Storage Service Implementation
 */
export class ExtensionStorageService implements IExtensionStorageService {
  private extensionId: string;
  private tenantId: string;
  private redisCache: RedisCacheAdapter;
  private namespace: string = '';
  private knex: any;
  private metrics: {
    cacheHits: number;
    cacheMisses: number;
    dbQueries: number;
    writeOperations: number;
  };
  
  constructor(
    extensionId: string, 
    tenantId: string, 
    knexInstance: any,
    namespace: string = ''
  ) {
    this.extensionId = extensionId;
    this.tenantId = tenantId;
    this.namespace = namespace;
    this.knex = knexInstance;
    
    // Initialize Redis cache
    this.redisCache = new RedisCacheAdapter(extensionId, tenantId, namespace);
    
    // Initialize metrics for monitoring
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      dbQueries: 0,
      writeOperations: 0
    };
  }
  
  /**
   * Build the database key for queries
   */
  private getDbKey(key: string): string {
    return this.namespace ? `${this.namespace}:${key}` : key;
  }
  
  /**
   * Get a value from storage
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      // Try Redis cache first for performance
      const cachedValue = await this.redisCache.get<T>(key);
      
      if (cachedValue !== null) {
        // Cache hit - record metric and return value
        this.metrics.cacheHits++;
        logger.debug('Cache hit', { 
          key, 
          extension: this.extensionId,
          tenant: this.tenantId,
          hitRate: this.getCacheHitRate()
        });
        return cachedValue;
      }
      
      // Cache miss - need to query database
      this.metrics.cacheMisses++;
      this.metrics.dbQueries++;
      logger.debug('Cache miss', { 
        key, 
        extension: this.extensionId,
        tenant: this.tenantId,
        hitRate: this.getCacheHitRate()
      });
      
      // Get from database with tenant isolation
      const result = await this.knex('extension_storage')
        .where({
          extension_id: this.extensionId,
          tenant_id: this.tenantId,
          key: this.getDbKey(key)
        })
        .first();
      
      if (!result) {
        return null;
      }
      
      // Check if the data has expired
      if (result.expires_at && new Date(result.expires_at) < new Date()) {
        // Data has expired, delete it asynchronously and return null
        this.delete(key).catch(err => {
          logger.error('Failed to delete expired key', { 
            key, 
            error: err,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
        return null;
      }
      
      // Calculate TTL for Redis if expires_at is set
      let ttlSeconds: number | undefined;
      if (result.expires_at) {
        const expiryDate = new Date(result.expires_at);
        const ttlMs = expiryDate.getTime() - Date.now();
        if (ttlMs > 0) {
          ttlSeconds = Math.floor(ttlMs / 1000);
        }
      }
      
      // Cache the result in Redis for future queries (don't await - fire and forget)
      this.redisCache.set(key, result.value, ttlSeconds)
        .catch(error => {
          // Just log and continue - cache errors shouldn't impact the main flow
          logger.warn('Failed to set Redis cache', { 
            key, 
            error,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
      
      return result.value as T;
    } catch (error) {
      logger.error('Failed to get key', { 
        key, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new ExtensionStorageError(this.extensionId, `Failed to get key ${key}`);
    }
  }
  
  /**
   * Set a value in storage
   */
  async set<T>(key: string, value: T, options: StorageOptions = {}): Promise<void> {
    try {
      // Serialize the value to check size
      const serializedValue = JSON.stringify(value);
      
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
      await this.knex('extension_storage')
        .insert({
          extension_id: this.extensionId,
          tenant_id: this.tenantId,
          key: this.getDbKey(key),
          value: serializedValue,
          expires_at: expiresAt
        })
        .onConflict(['extension_id', 'tenant_id', 'key'])
        .merge({
          value: serializedValue,
          expires_at: expiresAt,
          updated_at: new Date()
        });
      
      // Update Redis cache with the same TTL (fire and forget)
      this.redisCache.set(key, value, options.expiresIn)
        .catch(error => {
          // Just log and continue - cache errors shouldn't impact the main flow
          logger.warn('Failed to set Redis cache', { 
            key, 
            error,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
      
    } catch (error) {
      if (error instanceof ExtensionStorageQuotaError) {
        throw error;
      }
      
      logger.error('Failed to set key', { 
        key, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new ExtensionStorageError(this.extensionId, `Failed to set key ${key}`);
    }
  }
  
  /**
   * Delete a value from storage
   */
  async delete(key: string): Promise<boolean> {
    try {
      // Track metrics
      this.metrics.writeOperations++;
      this.metrics.dbQueries++;
      
      // Delete from database
      const result = await this.knex('extension_storage')
        .where({
          extension_id: this.extensionId,
          tenant_id: this.tenantId,
          key: this.getDbKey(key)
        })
        .delete();
      
      const deleted = result > 0;
      
      // Delete from Redis cache regardless of database result (fire and forget)
      this.redisCache.delete(key)
        .catch(error => {
          logger.warn('Failed to delete from Redis cache', { 
            key, 
            error,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
      
      return deleted;
    } catch (error) {
      logger.error('Failed to delete key', { 
        key, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new ExtensionStorageError(this.extensionId, `Failed to delete key ${key}`);
    }
  }
  
  /**
   * Check if a key exists in storage
   */
  async has(key: string): Promise<boolean> {
    try {
      // Try Redis cache first for performance
      const cachedValue = await this.redisCache.get(key);
      if (cachedValue !== null) {
        // Cache hit
        this.metrics.cacheHits++;
        return true;
      }
      
      // Cache miss - check database
      this.metrics.cacheMisses++;
      this.metrics.dbQueries++;
      
      const result = await this.knex('extension_storage')
        .where({
          extension_id: this.extensionId,
          tenant_id: this.tenantId,
          key: this.getDbKey(key)
        })
        .whereRaw('(expires_at IS NULL OR expires_at > NOW())')
        .first();
      
      return !!result;
    } catch (error) {
      logger.error('Failed to check key existence', { 
        key, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new ExtensionStorageError(this.extensionId, `Failed to check if key ${key} exists`);
    }
  }
  
  /**
   * Get multiple values at once
   */
  async getBatch<T>(keys: string[]): Promise<Map<string, T>> {
    if (keys.length === 0) {
      return new Map();
    }
    
    const result = new Map<string, T>();
    
    try {
      // Get keys from database
      this.metrics.dbQueries++;
      
      const dbKeys = keys.map(k => this.getDbKey(k));
      
      const dbResults = await this.knex('extension_storage')
        .where({
          extension_id: this.extensionId,
          tenant_id: this.tenantId
        })
        .whereIn('key', dbKeys)
        .whereRaw('(expires_at IS NULL OR expires_at > NOW())');
      
      // Process results
      for (const row of dbResults) {
        const key = this.namespace && row.key.startsWith(this.namespace + ':')
          ? row.key.substring(this.namespace.length + 1)
          : row.key;
          
        result.set(key, row.value);
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to get batch keys', { 
        keys, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new ExtensionStorageError(this.extensionId, `Failed to get batch keys`);
    }
  }
  
  /**
   * Set multiple values at once
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
        const serialized = JSON.stringify(entries[key]);
        serializedEntries[key] = serialized;
        totalSize += serialized.length;
      }
      
      // Check total quota
      await this.checkQuotaBatch(totalSize);
      
      // Calculate expiration time if TTL is provided
      const expiresAt = options.expiresIn 
        ? new Date(Date.now() + options.expiresIn * 1000) 
        : null;
      
      // Use a transaction for all database operations
      await this.knex.transaction(async (trx: any) => {
        for (const key of keysToStore) {
          await trx('extension_storage')
            .insert({
              extension_id: this.extensionId,
              tenant_id: this.tenantId,
              key: this.getDbKey(key),
              value: serializedEntries[key],
              expires_at: expiresAt
            })
            .onConflict(['extension_id', 'tenant_id', 'key'])
            .merge({
              value: serializedEntries[key],
              expires_at: expiresAt,
              updated_at: new Date()
            });
        }
      });
      
      // Update Redis cache with all values (fire and forget)
      for (const key of keysToStore) {
        this.redisCache.set(key, entries[key], options.expiresIn)
          .catch(error => {
            logger.warn('Failed to update Redis cache in batch', { 
              key, 
              error,
              extension: this.extensionId,
              tenant: this.tenantId
            });
          });
      }
      
    } catch (error) {
      if (error instanceof ExtensionStorageQuotaError) {
        throw error;
      }
      
      logger.error('Failed to set batch entries', { 
        keys: Object.keys(entries), 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new ExtensionStorageError(this.extensionId, `Failed to set batch entries`);
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
        ? 'AND key LIKE ?' 
        : this.namespace === '' 
          ? 'AND key NOT LIKE \'%:%\'' // Exclude namespaced keys when at root
          : '';
      
      const params = [
        this.extensionId, 
        this.tenantId,
      ];
      
      if (this.namespace) {
        params.push(queryPrefix);
      }
      
      const query = this.knex('extension_storage')
        .where({
          extension_id: this.extensionId,
          tenant_id: this.tenantId
        })
        .whereRaw('(expires_at IS NULL OR expires_at > NOW())')
        .select('key');
      
      if (this.namespace) {
        query.whereRaw('key LIKE ?', [queryPrefix]);
      } else {
        query.whereRaw('key NOT LIKE \'%:%\'');
      }
      
      const result = await query;
      
      // Strip namespace prefix if needed
      return result.map((row: any) => {
        const key = row.key;
        return this.namespace && key.startsWith(this.namespace + ':')
          ? key.substring(this.namespace.length + 1)
          : key;
      });
    } catch (error) {
      logger.error('Failed to list keys', { 
        namespace: this.namespace, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new ExtensionStorageError(this.extensionId, 'Failed to list keys');
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
      const query = this.knex('extension_storage')
        .where({
          extension_id: this.extensionId,
          tenant_id: this.tenantId
        });
      
      if (this.namespace) {
        query.whereRaw('key LIKE ?', [`${this.namespace}:%`]);
      }
      
      await query.delete();
      
      // Clear from Redis cache (fire and forget)
      const pattern = this.namespace ? `${this.namespace}:*` : '*';
      this.redisCache.clear(pattern)
        .catch(error => {
          logger.warn('Failed to clear Redis cache', { 
            namespace: this.namespace, 
            error,
            extension: this.extensionId,
            tenant: this.tenantId
          });
        });
    } catch (error) {
      logger.error('Failed to clear storage', { 
        namespace: this.namespace, 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      throw new ExtensionStorageError(this.extensionId, 'Failed to clear storage');
    }
  }
  
  /**
   * Create a namespaced storage instance
   */
  getNamespace(namespace: string): IExtensionStorageService {
    if (!namespace) {
      throw new Error('Namespace cannot be empty');
    }
    
    return new ExtensionStorageService(
      this.extensionId, 
      this.tenantId, 
      this.namespace ? `${this.namespace}:${namespace}` : namespace
    );
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
      throw new ExtensionStorageQuotaError(
        this.extensionId,
        quotaLimit,
        currentUsage + additionalSize
      );
    }
  }
  
  /**
   * Get the storage quota for this extension
   */
  private async getExtensionQuota(): Promise<number> {
    // Implementation would fetch from configuration or database
    // This is a simplified version - 10MB default quota
    return 10 * 1024 * 1024;
  }
  
  /**
   * Calculate current storage usage for this extension
   */
  private async getCurrentUsage(): Promise<number> {
    try {
      const result = await this.knex('extension_storage')
        .where({
          extension_id: this.extensionId,
          tenant_id: this.tenantId
        })
        .sum('LENGTH(value::text) as total_size')
        .first();
      
      return result?.total_size || 0;
    } catch (error) {
      logger.error('Failed to calculate storage usage', { 
        error,
        extension: this.extensionId,
        tenant: this.tenantId
      });
      // Return 0 on error to avoid blocking operations, but log the issue
      return 0;
    }
  }
}
