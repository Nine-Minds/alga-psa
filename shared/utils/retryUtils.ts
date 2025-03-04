/**
 * Utility functions for retry logic and error handling
 */

export enum ErrorCategory {
  TRANSIENT = 'TRANSIENT',
  RECOVERABLE = 'RECOVERABLE',
  PERMANENT = 'PERMANENT'
}

export enum RecoveryStrategy {
  RETRY_IMMEDIATE = 'RETRY_IMMEDIATE',
  RETRY_WITH_BACKOFF = 'RETRY_WITH_BACKOFF',
  MANUAL_INTERVENTION = 'MANUAL_INTERVENTION'
}

export interface ErrorClassification {
  category: ErrorCategory;
  strategy: RecoveryStrategy;
  description: string;
  isRetryable: boolean;
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  retryableErrors?: Array<string | RegExp>;
}

/**
 * Execute a function with retry logic
 * 
 * @param fn Function to execute
 * @param options Retry options
 * @returns Promise that resolves with the function result
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    maxDelayMs = 10000,
    backoffFactor = 2,
  } = options;

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if we've reached max retries
      if (attempt >= maxRetries) {
        break;
      }
      
      // Classify the error to determine if we should retry
      const classification = classifyError(error, attempt, options);
      
      if (!classification.isRetryable) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        initialDelayMs * Math.pow(backoffFactor, attempt),
        maxDelayMs
      );
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // If we get here, we've exhausted all retries
  throw lastError || new Error('Operation failed after retries');
}

/**
 * Classify an error to determine retry strategy
 * 
 * @param error The error to classify
 * @param attempts Number of attempts so far
 * @param options Retry options
 * @returns Error classification
 */
export function classifyError(
  error: any,
  attempts: number = 0,
  options: RetryOptions = {}
): ErrorClassification {
  const { maxRetries = 3 } = options;
  
  // Default classification
  const defaultClassification: ErrorClassification = {
    category: ErrorCategory.TRANSIENT,
    strategy: RecoveryStrategy.RETRY_IMMEDIATE,
    description: error instanceof Error ? error.message : String(error),
    isRetryable: true
  };
  
  // If we've reached max retries, don't retry
  if (attempts >= maxRetries) {
    return {
      ...defaultClassification,
      category: ErrorCategory.PERMANENT,
      strategy: RecoveryStrategy.MANUAL_INTERVENTION,
      isRetryable: false,
      description: `Max retries (${maxRetries}) exceeded: ${defaultClassification.description}`
    };
  }
  
  // Check for specific error types
  if (error instanceof Error) {
    // Network errors are usually transient
    if (
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('network') ||
      error.message.includes('connection')
    ) {
      return {
        category: ErrorCategory.TRANSIENT,
        strategy: RecoveryStrategy.RETRY_WITH_BACKOFF,
        description: `Network error: ${error.message}`,
        isRetryable: true
      };
    }
    
    // Database errors may be recoverable
    if (
      error.message.includes('database') ||
      error.message.includes('sql') ||
      error.message.includes('deadlock') ||
      error.message.includes('lock')
    ) {
      return {
        category: ErrorCategory.RECOVERABLE,
        strategy: RecoveryStrategy.RETRY_WITH_BACKOFF,
        description: `Database error: ${error.message}`,
        isRetryable: true
      };
    }
    
    // Validation errors are permanent
    if (
      error.message.includes('validation') ||
      error.message.includes('invalid') ||
      error.message.includes('not found')
    ) {
      return {
        category: ErrorCategory.PERMANENT,
        strategy: RecoveryStrategy.MANUAL_INTERVENTION,
        description: `Validation error: ${error.message}`,
        isRetryable: false
      };
    }
  }
  
  // Default to transient error
  return defaultClassification;
}
