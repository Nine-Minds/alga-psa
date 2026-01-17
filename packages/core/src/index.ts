/**
 * @alga-psa/core
 *
 * Shared infrastructure module for Alga PSA.
 * Contains logging, secrets management, event publishing, and encryption utilities.
 */

// Logger
export { default as logger } from './lib/logger';

// Secret Provider - full exports
export type { ISecretProvider } from './lib/secrets/ISecretProvider';
export { getSecretProviderInstance, getSecret } from './lib/secrets';
export { EnvSecretProvider, FileSystemSecretProvider, CompositeSecretProvider, VaultSecretProvider } from './lib/secrets';

// Event Publisher
export { publishEvent } from './lib/events';
export type { EventPayload } from './lib/events';

// Encryption Utilities
export { hashPassword, verifyPassword, generateSecurePassword } from './lib/encryption';

// Types barrel export
export * from './types';
