/**
 * Tenant Secrets Management Module
 *
 * This module provides tenant-scoped secret management for workflows.
 * Secrets can be referenced in workflow input mappings using the
 * { $secret: "SECRET_NAME" } syntax.
 */

// Type exports
export type {
  TenantSecretMetadata,
  TenantSecretModel,
  TenantSecretAuditLogModel,
  TenantSecretAuditEventType,
  CreateTenantSecretInput,
  UpdateTenantSecretInput,
  SecretRef,
  SecretPermission
} from './types';

// Value exports (schemas, type guards, constants)
export {
  secretRefSchema,
  secretNameSchema,
  createSecretInputSchema,
  updateSecretInputSchema,
  isSecretRef,
  SECRET_PERMISSIONS
} from './types';

export {
  TenantSecretProvider,
  createTenantSecretProvider
} from './tenantSecretProvider';
