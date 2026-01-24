/**
 * Types for the tenant secrets management system.
 *
 * This module provides types for managing tenant-scoped secrets that can be
 * used in workflow input mappings and action configurations.
 */

import { z } from 'zod';

/**
 * Metadata about a tenant secret (excludes the actual value).
 */
export interface TenantSecretMetadata {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  lastAccessedAt?: string;
}

/**
 * Input for creating a new tenant secret.
 */
export interface CreateTenantSecretInput {
  name: string;
  value: string;
  description?: string;
}

/**
 * Input for updating an existing tenant secret.
 */
export interface UpdateTenantSecretInput {
  value?: string;
  description?: string;
}

/**
 * Database model for tenant_secrets table.
 */
export interface TenantSecretModel {
  id: string;
  tenant: string;
  name: string;
  description: string | null;
  secret_provider_key: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
}

/**
 * Audit log event types for tenant secrets.
 */
export type TenantSecretAuditEventType = 'created' | 'updated' | 'deleted' | 'accessed';

/**
 * Database model for tenant_secrets_audit_log table.
 */
export interface TenantSecretAuditLogModel {
  id: string;
  tenant: string;
  secret_id: string | null;
  secret_name: string;
  event_type: TenantSecretAuditEventType;
  user_id: string | null;
  workflow_run_id: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Secret reference type for use in workflow inputMapping.
 * This is how secrets are referenced in workflow definitions.
 */
export const secretRefSchema = z.object({
  $secret: z.string().min(1)
}).strict();

export type SecretRef = z.infer<typeof secretRefSchema>;

/**
 * Check if a value is a SecretRef.
 */
export function isSecretRef(value: unknown): value is SecretRef {
  return secretRefSchema.safeParse(value).success;
}

/**
 * Validation schema for secret names.
 * Names must be uppercase with underscores, like environment variables.
 */
export const secretNameSchema = z.string()
  .min(1)
  .max(255)
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    'Secret name must start with an uppercase letter and contain only uppercase letters, numbers, and underscores'
  );

/**
 * Validation schema for creating a secret.
 */
export const createSecretInputSchema = z.object({
  name: secretNameSchema,
  value: z.string().min(1).max(65536), // 64KB max
  description: z.string().max(1000).optional()
});

/**
 * Validation schema for updating a secret.
 */
export const updateSecretInputSchema = z.object({
  value: z.string().min(1).max(65536).optional(),
  description: z.string().max(1000).optional().nullable()
});

/**
 * Permission names for secret operations.
 */
export const SECRET_PERMISSIONS = {
  VIEW: 'secrets.view',
  MANAGE: 'secrets.manage',
  USE: 'secrets.use'
} as const;

export type SecretPermission = typeof SECRET_PERMISSIONS[keyof typeof SECRET_PERMISSIONS];
