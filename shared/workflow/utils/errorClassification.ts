import logger from './logger';
import { LockError, LockErrorType } from '.';
import { TransactionError, TransactionErrorType } from '.';

/**
 * Error categories for workflow processing
 */
export enum ErrorCategory {
  // Temporary errors that can be retried immediately
  TRANSIENT = 'transient',
  
  // Errors that can be retried after a delay
  RECOVERABLE = 'recoverable',
  
  // Errors that require manual intervention
  PERMANENT = 'permanent',
  
  // Errors related to resource contention
  CONTENTION = 'contention',
  
  // Errors related to data consistency
  CONSISTENCY = 'consistency',
  
  // Errors related to external systems
  EXTERNAL = 'external',
  
  // Errors that cannot be classified
  UNKNOWN = 'unknown'
}

/**
 * Recovery strategy for workflow errors
 */
export enum RecoveryStrategy {
  // Retry immediately
  RETRY_IMMEDIATE = 'retry_immediate',
  
  // Retry with exponential backoff
  RETRY_BACKOFF = 'retry_backoff',
  
  // Retry after a fixed delay
  RETRY_FIXED_DELAY = 'retry_fixed_delay',
  
  // Skip the failed operation
  SKIP = 'skip',
  
  // Compensate for the failed operation
  COMPENSATE = 'compensate',
  
  // Abort the workflow
  ABORT = 'abort',
  
  // Require manual intervention
  MANUAL = 'manual'
}

/**
 * Options for error recovery
 */
export interface RecoveryOptions {
  // Maximum number of retry attempts
  maxRetries?: number;
  
  // Initial delay in milliseconds for backoff strategy
  initialDelayMs?: number;
  
  // Maximum delay in milliseconds for backoff strategy
  maxDelayMs?: number;
  
  // Fixed delay in milliseconds for fixed delay strategy
  fixedDelayMs?: number;
  
  // Whether to apply jitter to delay times
  applyJitter?: boolean;
}

/**
 * Default recovery options
 */
const DEFAULT_RECOVERY_OPTIONS: Required<RecoveryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  fixedDelayMs: 5000,
  applyJitter: true
};

/**
 * Result of error classification
 */
export interface ErrorClassification {
  // Original error
  error: Error;
  
  // Error category
  category: ErrorCategory;
  
  // Recovery strategy
  strategy: RecoveryStrategy;
  
  // Whether the error is retryable
  isRetryable: boolean;
  
  // Human-readable description of the error
  description: string;
}

/**
 * Classify an error and determine the appropriate recovery strategy
 * 
 * @param error The error to classify
 * @param attemptCount Current attempt count
 * @param options Recovery options
 * @returns Error classification
 */
export function classifyError(
  error: unknown,
  attemptCount: number = 0,
  options: RecoveryOptions = {}
): ErrorClassification {
  const opts: Required<RecoveryOptions> = { ...DEFAULT_RECOVERY_OPTIONS, ...options };
  
  // Convert unknown error to Error object
  const err = error instanceof Error ? error : new Error(String(error));
  
  // Default classification
  let category = ErrorCategory.UNKNOWN;
  let strategy = RecoveryStrategy.RETRY_BACKOFF;
  let isRetryable = true;
  let description = err.message;
  
  // Check if we've exceeded the maximum retry attempts
  if (attemptCount >= opts.maxRetries) {
    isRetryable = false;
    strategy = RecoveryStrategy.MANUAL;
    description = `Maximum retry attempts (${opts.maxRetries}) exceeded: ${err.message}`;
  }
  
  // Classify based on error type
  if (error instanceof LockError) {
    // Distributed lock errors
    switch (error.type) {
      case LockErrorType.ACQUISITION_FAILED:
        category = ErrorCategory.CONTENTION;
        strategy = RecoveryStrategy.RETRY_BACKOFF;
        description = `Failed to acquire distributed lock: ${err.message}`;
        break;
      case LockErrorType.RELEASE_FAILED:
        category = ErrorCategory.RECOVERABLE;
        strategy = RecoveryStrategy.RETRY_IMMEDIATE;
        description = `Failed to release distributed lock: ${err.message}`;
        break;
      case LockErrorType.EXTENSION_FAILED:
        category = ErrorCategory.RECOVERABLE;
        strategy = RecoveryStrategy.RETRY_IMMEDIATE;
        description = `Failed to extend distributed lock: ${err.message}`;
        break;
      case LockErrorType.TIMEOUT:
        category = ErrorCategory.CONTENTION;
        strategy = RecoveryStrategy.RETRY_BACKOFF;
        description = `Distributed lock acquisition timed out: ${err.message}`;
        break;
      case LockErrorType.REDIS_ERROR:
        category = ErrorCategory.EXTERNAL;
        strategy = RecoveryStrategy.RETRY_BACKOFF;
        description = `Redis error in distributed lock: ${err.message}`;
        break;
      default:
        category = ErrorCategory.UNKNOWN;
        strategy = RecoveryStrategy.RETRY_BACKOFF;
        description = `Unknown distributed lock error: ${err.message}`;
    }
  } else if (error instanceof TransactionError) {
    // Distributed transaction errors
    switch (error.type) {
      case TransactionErrorType.LOCK_ACQUISITION_FAILED:
        category = ErrorCategory.CONTENTION;
        strategy = RecoveryStrategy.RETRY_BACKOFF;
        description = `Failed to acquire lock for transaction: ${err.message}`;
        break;
      case TransactionErrorType.TRANSACTION_FAILED:
        category = ErrorCategory.CONSISTENCY;
        strategy = RecoveryStrategy.RETRY_BACKOFF;
        description = `Transaction failed: ${err.message}`;
        break;
      case TransactionErrorType.TIMEOUT:
        category = ErrorCategory.CONTENTION;
        strategy = RecoveryStrategy.RETRY_BACKOFF;
        description = `Transaction timed out: ${err.message}`;
        break;
      case TransactionErrorType.INTERNAL_ERROR:
        category = ErrorCategory.PERMANENT;
        strategy = RecoveryStrategy.MANUAL;
        isRetryable = false;
        description = `Internal error in transaction: ${err.message}`;
        break;
      default:
        category = ErrorCategory.UNKNOWN;
        strategy = RecoveryStrategy.RETRY_BACKOFF;
        description = `Unknown transaction error: ${err.message}`;
    }
  } else if (err.name === 'TimeoutError' || err.message.includes('timeout') || err.message.includes('timed out')) {
    // Timeout errors
    category = ErrorCategory.TRANSIENT;
    strategy = RecoveryStrategy.RETRY_BACKOFF;
    description = `Operation timed out: ${err.message}`;
  } else if (err.name === 'ConnectionError' || err.message.includes('connection') || err.message.includes('ECONNREFUSED')) {
    // Connection errors
    category = ErrorCategory.EXTERNAL;
    strategy = RecoveryStrategy.RETRY_BACKOFF;
    description = `Connection error: ${err.message}`;
  } else if (err.message.includes('deadlock') || err.message.includes('lock wait timeout')) {
    // Database deadlock errors
    category = ErrorCategory.CONTENTION;
    strategy = RecoveryStrategy.RETRY_BACKOFF;
    description = `Database deadlock detected: ${err.message}`;
  } else if (err.message.includes('constraint') || err.message.includes('duplicate') || err.message.includes('unique')) {
    // Database constraint errors
    category = ErrorCategory.CONSISTENCY;
    strategy = RecoveryStrategy.MANUAL;
    isRetryable = false;
    description = `Database constraint violation: ${err.message}`;
  } else if (err.message.includes('permission') || err.message.includes('unauthorized') || err.message.includes('forbidden')) {
    // Permission errors
    category = ErrorCategory.PERMANENT;
    strategy = RecoveryStrategy.MANUAL;
    isRetryable = false;
    description = `Permission denied: ${err.message}`;
  }
  
  // Log the error classification
  logger.debug(`[ErrorClassification] Classified error: ${description}`, {
    category,
    strategy,
    isRetryable,
    attemptCount,
    errorName: err.name,
    errorMessage: err.message
  });
  
  return {
    error: err,
    category,
    strategy,
    isRetryable,
    description
  };
}

/**
 * Calculate the delay time for the next retry attempt
 * 
 * @param attemptCount Current attempt count (0-based)
 * @param strategy Recovery strategy
 * @param options Recovery options
 * @returns Delay time in milliseconds
 */
export function calculateRetryDelay(
  attemptCount: number,
  strategy: RecoveryStrategy,
  options: RecoveryOptions = {}
): number {
  const opts: Required<RecoveryOptions> = { ...DEFAULT_RECOVERY_OPTIONS, ...options };
  
  // No delay for immediate retry
  if (strategy === RecoveryStrategy.RETRY_IMMEDIATE) {
    return 0;
  }
  
  // Fixed delay
  if (strategy === RecoveryStrategy.RETRY_FIXED_DELAY) {
    return opts.fixedDelayMs;
  }
  
  // Exponential backoff
  if (strategy === RecoveryStrategy.RETRY_BACKOFF) {
    // Calculate exponential backoff: initialDelay * 2^attemptCount
    const delay = Math.min(
      opts.initialDelayMs * Math.pow(2, attemptCount),
      opts.maxDelayMs
    );
    
    // Apply jitter if enabled (±20%)
    if (opts.applyJitter) {
      const jitterFactor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
      return Math.floor(delay * jitterFactor);
    }
    
    return delay;
  }
  
  // Default to no delay
  return 0;
}

/**
 * Execute a function with automatic retry based on error classification
 * 
 * @param fn Function to execute
 * @param options Recovery options
 * @returns Result of the function
 * @throws Error if all retry attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RecoveryOptions = {}
): Promise<T> {
  const opts: Required<RecoveryOptions> = { ...DEFAULT_RECOVERY_OPTIONS, ...options };
  let attemptCount = 0;
  
  while (true) {
    try {
      return await fn();
    } catch (error) {
      // Classify the error
      const classification = classifyError(error, attemptCount, opts);
      
      // Increment attempt count
      attemptCount++;
      
      // Check if we should retry
      if (classification.isRetryable && attemptCount <= opts.maxRetries) {
        // Calculate delay time
        const delayMs = calculateRetryDelay(attemptCount - 1, classification.strategy, opts);
        
        logger.info(`[ErrorRecovery] Retrying operation (attempt ${attemptCount}/${opts.maxRetries}) after ${delayMs}ms delay: ${classification.description}`);
        
        // Wait for the delay
        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        
        // Continue to next attempt
        continue;
      }
      
      // If we get here, we've exhausted all retry attempts or the error is not retryable
      logger.error(`[ErrorRecovery] Failed after ${attemptCount} attempts: ${classification.description}`);
      throw error;
    }
  }
}