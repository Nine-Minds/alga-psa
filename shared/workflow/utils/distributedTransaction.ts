import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';
import { logger } from '@alga-psa/core';
import { acquireDistributedLock, releaseDistributedLock, LockError, LockErrorType } from './distributedLock';

/**
 * Error types for distributed transaction operations
 */
export enum TransactionErrorType {
  LOCK_ACQUISITION_FAILED = 'lock_acquisition_failed',
  TRANSACTION_FAILED = 'transaction_failed',
  TIMEOUT = 'timeout',
  INTERNAL_ERROR = 'internal_error'
}

/**
 * Error class for distributed transaction operations
 */
export class TransactionError extends Error {
  type: TransactionErrorType;
  cause?: Error;
  
  constructor(message: string, type: TransactionErrorType, cause?: Error) {
    super(message);
    this.name = 'TransactionError';
    this.type = type;
    this.cause = cause;
  }
}

/**
 * Options for executing a distributed transaction
 */
export interface DistributedTransactionOptions {
  /**
   * Maximum time to wait for lock acquisition in milliseconds
   * Default: 10000 (10 seconds)
   */
  lockWaitTimeMs?: number;
  
  /**
   * Time-to-live for the lock in milliseconds
   * Default: 30000 (30 seconds)
   */
  lockTtlMs?: number;
  
  /**
   * Transaction isolation level
   * Default: 'repeatable read'
   */
  isolationLevel?: Knex.IsolationLevels;
  
  /**
   * Whether to throw an error if lock acquisition fails
   * Default: true
   */
  throwOnLockFailure?: boolean;
}

/**
 * Default transaction options
 */
const DEFAULT_TRANSACTION_OPTIONS: Required<DistributedTransactionOptions> = {
  lockWaitTimeMs: 10000,
  lockTtlMs: 30000,
  isolationLevel: 'repeatable read',
  throwOnLockFailure: true
};

/**
 * A distributed transaction manager that uses distributed locks to ensure
 * that only one process can execute a transaction on a specific resource at a time.
 * 
 * This is useful for cross-process coordination in a distributed system.
 */
export class DistributedTransactionManager {
  /**
   * Execute a function within a distributed transaction
   * 
   * @param knex Knex instance
   * @param resourceKey Key identifying the resource being accessed
   * @param fn Function to execute within the transaction
   * @param options Transaction options
   * @returns Result of the function
   * @throws TransactionError if the transaction fails
   */
  static async executeTransaction<T>(
    knex: Knex,
    resourceKey: string,
    fn: (trx: Knex.Transaction) => Promise<T>,
    options: DistributedTransactionOptions = {}
  ): Promise<T> {
    const opts: Required<DistributedTransactionOptions> = {
      ...DEFAULT_TRANSACTION_OPTIONS,
      ...options
    };
    
    // Generate a unique owner ID for this transaction
    const ownerId = `transaction-${uuidv4()}`;
    
    // Format the lock key to include the resource key
    const lockKey = `transaction:${resourceKey}`;
    
    try {
      // Acquire a distributed lock for the resource
      const lockAcquired = await acquireDistributedLock(lockKey, ownerId, {
        waitTimeMs: opts.lockWaitTimeMs,
        ttlMs: opts.lockTtlMs,
        throwOnFailure: opts.throwOnLockFailure
      });
      
      if (!lockAcquired) {
        const errorMessage = `Failed to acquire lock for resource ${resourceKey}`;
        logger.warn(`[DistributedTransactionManager] ${errorMessage}`);
        
        if (opts.throwOnLockFailure) {
          throw new TransactionError(errorMessage, TransactionErrorType.LOCK_ACQUISITION_FAILED);
        }
        
        // Return a default value if we don't throw
        return undefined as unknown as T;
      }
      
      logger.debug(`[DistributedTransactionManager] Acquired lock for resource ${resourceKey}`);
      
      try {
        // Execute the function within a database transaction
        return await knex.transaction(async (trx) => {
          return await fn(trx);
        }, {
          isolationLevel: opts.isolationLevel
        });
      } catch (error) {
        const errorMessage = `Transaction failed for resource ${resourceKey}: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(`[DistributedTransactionManager] ${errorMessage}`);
        
        throw new TransactionError(
          errorMessage,
          TransactionErrorType.TRANSACTION_FAILED,
          error instanceof Error ? error : undefined
        );
      } finally {
        // Release the distributed lock
        try {
          await releaseDistributedLock(lockKey, ownerId, false);
          logger.debug(`[DistributedTransactionManager] Released lock for resource ${resourceKey}`);
        } catch (error) {
          // Just log the error, don't throw
          logger.warn(`[DistributedTransactionManager] Failed to release lock for resource ${resourceKey}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      // Handle lock errors
      if (error instanceof LockError) {
        const errorType = error.type === LockErrorType.TIMEOUT
          ? TransactionErrorType.TIMEOUT
          : TransactionErrorType.LOCK_ACQUISITION_FAILED;
        
        throw new TransactionError(error.message, errorType, error);
      }
      
      // Handle other errors
      const errorMessage = `Error in distributed transaction for resource ${resourceKey}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[DistributedTransactionManager] ${errorMessage}`);
      
      throw new TransactionError(errorMessage, TransactionErrorType.INTERNAL_ERROR, error instanceof Error ? error : undefined);
    }
  }
}

/**
 * Execute a function within a distributed transaction
 * 
 * @param knex Knex instance
 * @param resourceKey Key identifying the resource being accessed
 * @param fn Function to execute within the transaction
 * @param options Transaction options
 * @returns Result of the function
 * @throws TransactionError if the transaction fails
 */
export async function executeDistributedTransaction<T>(
  knex: Knex,
  resourceKey: string,
  fn: (trx: Knex.Transaction) => Promise<T>,
  options: DistributedTransactionOptions = {}
): Promise<T> {
  return DistributedTransactionManager.executeTransaction(knex, resourceKey, fn, options);
}
