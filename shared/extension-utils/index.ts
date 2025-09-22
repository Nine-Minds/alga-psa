/**
 * Extension utilities
 * 
 * Centralized exports for extension system utilities
 * This allows clean imports from both EE and main server contexts
 */

export { default as logger } from './logger.js';
export { clientLogger } from './client-logger.js';
export * from './types.js';