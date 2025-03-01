/**
 * Distributed coordination utilities for workflow engine
 */

// Export distributed lock utilities
export {
  DistributedLock,
  LockError,
  LockErrorType,
  getDistributedLock,
  acquireDistributedLock,
  releaseDistributedLock,
  extendDistributedLock,
  withLock
} from './distributedLock';
export type { LockOptions } from './distributedLock';

// Export distributed transaction utilities
export {
  DistributedTransactionManager,
  TransactionError,
  TransactionErrorType,
  executeDistributedTransaction
} from './distributedTransaction';
export type { DistributedTransactionOptions } from './distributedTransaction';

// Export error classification and recovery utilities
export {
  ErrorCategory,
  RecoveryStrategy,
  classifyError,
  calculateRetryDelay,
  withRetry
} from './errorClassification';
export type {
  RecoveryOptions,
  ErrorClassification
} from './errorClassification';