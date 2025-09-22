// Re-export core functionality
export * from './core/index.js';

// Re-export db functionality
export * from './db/index.js';

// Re-export workflow functionality
export * from './workflow/index.js';

// Re-export types
export * from './types/index.js';

// Re-export canonical interfaces
export * from './interfaces/company.interfaces.js';
export * from './interfaces/contact.interfaces.js';
export * from './interfaces/tag.interfaces.js';
export * from './interfaces/validation.interfaces.js';

export { default as logger } from '@alga-psa/shared/core/logger.js';

// Re-export extension utilities
export * from './extension-utils/index.js';
