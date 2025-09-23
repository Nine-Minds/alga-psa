/**
 * Extension utilities
 *
 * Centralized exports for extension system utilities
 * This allows clean imports from both EE and main server contexts
 */

export { default as logger } from './logger';
export { clientLogger } from './client-logger';
export * from './types';
