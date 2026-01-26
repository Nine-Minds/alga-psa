import { getRedisStreamClient } from '../streams/redisStreamClient';
import { logger } from '@alga-psa/core';

/**
 * Error types for distributed lock operations
 */
export enum LockErrorType {
  ACQUISITION_FAILED = 'acquisition_failed',
  RELEASE_FAILED = 'release_failed',
  EXTENSION_FAILED = 'extension_failed',
  REDIS_ERROR = 'redis_error',
  TIMEOUT = 'timeout'
}

/**
 * Error class for distributed lock operations
 */
export class LockError extends Error {
  type: LockErrorType;
  
  constructor(message: string, type: LockErrorType) {
    super(message);
    this.name = 'LockError';
    this.type = type;
  }
}

/**
 * Options for acquiring a distributed lock
 */
export interface LockOptions {
  /**
   * Maximum time to wait for lock acquisition in milliseconds
   * Default: 10000 (10 seconds)
   */
  waitTimeMs?: number;
  
  /**
   * Time-to-live for the lock in milliseconds
   * Default: 30000 (30 seconds)
   */
  ttlMs?: number;
  
  /**
   * Retry interval in milliseconds when waiting for lock
   * Default: 100 (100 milliseconds)
   */
  retryIntervalMs?: number;
  
  /**
   * Whether to throw an error if lock acquisition fails
   * Default: true
   */
  throwOnFailure?: boolean;
}

/**
 * Default lock options
 */
const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = {
  waitTimeMs: 10000,
  ttlMs: 30000,
  retryIntervalMs: 100,
  throwOnFailure: true
};

/**
 * A Redis-based distributed lock implementation
 * 
 * This class provides methods for acquiring, releasing, and extending locks
 * using Redis commands. It ensures that only one process can acquire a lock
 * with a given key at a time, which is essential for distributed coordination.
 */
export class DistributedLock {
  private redisClient: ReturnType<typeof getRedisStreamClient>;
  
  /**
   * Create a new distributed lock
   */
  constructor() {
    this.redisClient = getRedisStreamClient();
  }
  
  /**
   * Acquire a distributed lock
   *
   * @param key Lock key
   * @param owner Identifier of the lock owner
   * @param options Lock options
   * @returns True if lock was acquired, false otherwise
   * @throws LockError if lock acquisition fails and throwOnFailure is true
   */
  async acquire(key: string, owner: string, options: LockOptions = {}): Promise<boolean> {
    const opts: Required<LockOptions> = { ...DEFAULT_LOCK_OPTIONS, ...options };
    const startTime = Date.now();
    
    try {
      // Initialize Redis client if needed
      await this.redisClient.initialize();
      
      // Try to acquire the lock
      while (true) {
        // Use Redis SET with NX option (only set if key doesn't exist)
        const result = await this.redisClient.acquireLock(key, owner, opts.ttlMs);
        
        if (result) {
          logger.debug(`[DistributedLock] Acquired lock ${key} for owner ${owner}`);
          return true;
        }
        
        // Check if we've waited too long
        if (Date.now() - startTime >= opts.waitTimeMs) {
          const errorMessage = `Failed to acquire lock ${key} after ${opts.waitTimeMs}ms`;
          logger.warn(`[DistributedLock] ${errorMessage}`);
          
          if (opts.throwOnFailure) {
            throw new LockError(errorMessage, LockErrorType.TIMEOUT);
          }
          
          return false;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, opts.retryIntervalMs));
      }
    } catch (error) {
      const errorMessage = `Error acquiring lock ${key}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[DistributedLock] ${errorMessage}`);
      
      if (opts.throwOnFailure) {
        throw new LockError(errorMessage, LockErrorType.ACQUISITION_FAILED);
      }
      
      return false;
    }
  }
  
  /**
   * Release a distributed lock
   *
   * @param key Lock key
   * @param owner Identifier of the lock owner
   * @param throwOnFailure Whether to throw an error if release fails
   * @returns True if lock was released, false if lock doesn't exist or is owned by someone else
   * @throws LockError if lock release fails and throwOnFailure is true
   */
  async release(key: string, owner: string, throwOnFailure: boolean = true): Promise<boolean> {
    try {
      // Initialize Redis client if needed
      await this.redisClient.initialize();
      
      // Use the releaseLock method from RedisStreamClient
      const released = await this.redisClient.releaseLock(key, owner);
      
      if (released) {
        logger.debug(`[DistributedLock] Released lock ${key} for owner ${owner}`);
      } else {
        logger.warn(`[DistributedLock] Failed to release lock ${key} for owner ${owner} (not owner or lock doesn't exist)`);
      }
      
      return released;
    } catch (error) {
      const errorMessage = `Error releasing lock ${key}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[DistributedLock] ${errorMessage}`);
      
      if (throwOnFailure) {
        throw new LockError(errorMessage, LockErrorType.RELEASE_FAILED);
      }
      
      return false;
    }
  }
  
  /**
   * Extend a lock's TTL
   *
   * @param key Lock key
   * @param owner Identifier of the lock owner
   * @param ttlMs New time-to-live in milliseconds
   * @param throwOnFailure Whether to throw an error if extension fails
   * @returns True if lock was extended, false if lock doesn't exist or is owned by someone else
   * @throws LockError if lock extension fails and throwOnFailure is true
   */
  async extend(key: string, owner: string, ttlMs: number, throwOnFailure: boolean = true): Promise<boolean> {
    try {
      // Initialize Redis client if needed
      await this.redisClient.initialize();
      
      // Use the extendLock method from RedisStreamClient
      const extended = await this.redisClient.extendLock(key, owner, ttlMs);
      
      if (extended) {
        logger.debug(`[DistributedLock] Extended lock ${key} for owner ${owner} with TTL ${ttlMs}ms`);
      } else {
        logger.warn(`[DistributedLock] Failed to extend lock ${key} for owner ${owner} (not owner or lock doesn't exist)`);
      }
      
      return extended;
    } catch (error) {
      const errorMessage = `Error extending lock ${key}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[DistributedLock] ${errorMessage}`);
      
      if (throwOnFailure) {
        throw new LockError(errorMessage, LockErrorType.EXTENSION_FAILED);
      }
      
      return false;
    }
  }
}

// Singleton instance
let distributedLockInstance: DistributedLock | null = null;

/**
 * Get the distributed lock instance
 * @returns The distributed lock instance
 */
export function getDistributedLock(): DistributedLock {
  if (!distributedLockInstance) {
    distributedLockInstance = new DistributedLock();
  }
  return distributedLockInstance;
}

/**
 * Helper function to acquire a distributed lock
 * @param key Lock key
 * @param owner Owner identifier
 * @param options Lock options
 * @returns True if lock was acquired, false otherwise
 */
export async function acquireDistributedLock(
  key: string,
  owner: string,
  options: LockOptions = {}
): Promise<boolean> {
  return getDistributedLock().acquire(key, owner, options);
}

/**
 * Helper function to release a distributed lock
 * @param key Lock key
 * @param owner Owner identifier
 * @param throwOnFailure Whether to throw an error if release fails
 * @returns True if lock was released, false otherwise
 */
export async function releaseDistributedLock(
  key: string,
  owner: string,
  throwOnFailure: boolean = true
): Promise<boolean> {
  return getDistributedLock().release(key, owner, throwOnFailure);
}

/**
 * Helper function to extend a distributed lock
 * @param key Lock key
 * @param owner Owner identifier
 * @param ttlMs New time-to-live in milliseconds
 * @param throwOnFailure Whether to throw an error if extension fails
 * @returns True if lock was extended, false otherwise
 */
export async function extendDistributedLock(
  key: string,
  owner: string,
  ttlMs: number,
  throwOnFailure: boolean = true
): Promise<boolean> {
  return getDistributedLock().extend(key, owner, ttlMs, throwOnFailure);
}

/**
 * Execute a function with a distributed lock
 * 
 * @param key Lock key
 * @param owner Owner identifier
 * @param fn Function to execute with the lock
 * @param options Lock options
 * @returns Result of the function
 * @throws LockError if lock acquisition fails
 */
export async function withLock<T>(
  key: string,
  owner: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const acquired = await acquireDistributedLock(key, owner, options);
  
  if (!acquired) {
    throw new LockError(`Failed to acquire lock ${key}`, LockErrorType.ACQUISITION_FAILED);
  }
  
  try {
    return await fn();
  } finally {
    await releaseDistributedLock(key, owner, false);
  }
}
