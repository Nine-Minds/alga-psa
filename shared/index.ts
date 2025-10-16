// Re-export core functionality
export * from './core/index';

// Re-export db functionality
export * from './db/index';

// Re-export workflow functionality
export * from './workflow/index';

// Re-export types
export * from './types/index';

// Re-export canonical interfaces
export * from './interfaces/client.interfaces';
export * from './interfaces/contact.interfaces';
export * from './interfaces/tag.interfaces';
export * from './interfaces/validation.interfaces';
export * from './interfaces/subscription.interfaces';

export { default as logger } from '@alga-psa/shared/core/logger';

// Re-export extension utilities
export * from './extension-utils/index';
