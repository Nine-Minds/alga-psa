/**
 * @alga-psa/core
 *
 * Shared infrastructure module for Alga PSA.
 * Contains client-safe utilities.
 */

// Universal Logger (safe for both)
export { default as logger } from './lib/logger-universal';

// Secret Provider Types only
export type { ISecretProvider } from './lib/secrets/ISecretProvider';

// Date/time utilities
export * from './lib/dateTimeUtils';

// Error utilities
export * from './lib/errors';

// Edition / feature gating
export * from './lib/features';

// Job enqueue DI seam (registerJobEnqueuer / enqueueImmediateJob)
export * from './lib/jobEnqueue';

// Version utilities
export * from './lib/version';

// Template utilities
export * from './lib/templateUtils';

// Formatting utilities
export * from './lib/formatters';
export * from './lib/projectBillingStatus';

// Barcode / GTIN utilities
export * from './lib/gtin';

// UUID utilities
export { generateUUID } from './lib/uuid';

// CSV utilities
export * from './lib/csvParser';

// Validation utilities
export * from './lib/validation';

// Constants
export * from './constants/currency';

// Types barrel export
export * from './types/index';
