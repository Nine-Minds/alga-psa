/**
 * Logger re-export for extension system
 *
 * This provides a consistent logger interface that works from both
 * EE and main server contexts without path resolution issues.
 *
 * For client components, use the client-safe logger to avoid
 * Node.js module resolution errors.
 */

// Re-export the client-safe logger as default for extension components
export { default } from './client-logger';
