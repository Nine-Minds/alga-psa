// Re-export core functionality
export * from './core';

// Re-export db functionality
export * from './db';

// Re-export workflow functionality
export * from './workflow';

// Re-export types
export * from './types';

// Re-export canonical interfaces
export * from './interfaces/company.interfaces';
export * from './interfaces/contact.interfaces';
export * from './interfaces/tag.interfaces';
export * from './interfaces/validation.interfaces';

export { default as logger } from '@alga-psa/shared/core/logger';

// Re-export extension utilities
export * from './extension-utils';