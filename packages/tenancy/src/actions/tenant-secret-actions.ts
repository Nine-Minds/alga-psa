/**
 * Server Actions for Tenant Secrets Management
 *
 * These server actions provide CRUD operations for tenant-scoped secrets.
 * The actual secret values are never returned to clients - only metadata.
 */
'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import {
  TenantSecretMetadata,
  CreateTenantSecretInput,
  UpdateTenantSecretInput,
  createTenantSecretProvider,
  SECRET_PERMISSIONS
} from '@alga-psa/shared/workflow/secrets';

/**
 * List all secrets for the current tenant.
 * Returns metadata only - never includes actual secret values.
 * Requires secrets.view permission.
 */
export const listTenantSecrets = withAuth(async (user, { tenant }): Promise<TenantSecretMetadata[]> => {
  const { knex } = await createTenantKnex();

  // Secrets are an optional capability in some environments (e.g. local/dev stacks or older schemas).
  // If the backing tables don't exist, treat secrets as "not configured" and return no entries.
  if (!tenant) return [];
  if (!(await knex.schema.hasTable('tenant_secrets'))) return [];

  // Check for secrets.view permission
  const canView = await hasPermission(user, 'secrets', 'view', knex);
  if (!canView) return [];

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.list();
});

/**
 * Get metadata for a specific secret by name.
 * Returns metadata only - never includes actual secret value.
 */
export const getSecretMetadata = withAuth(async (user, { tenant }, name: string): Promise<TenantSecretMetadata | null> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.getMetadata(name);
});

/**
 * Check if a secret exists.
 */
export const secretExists = withAuth(async (user, { tenant }, name: string): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.exists(name);
});

/**
 * Create a new tenant secret.
 * Requires secrets.manage permission.
 *
 * @param input - Secret creation input (name, value, description)
 * @returns The created secret's metadata (never includes the value)
 */
export const createSecret = withAuth(async (user, { tenant }, input: CreateTenantSecretInput): Promise<TenantSecretMetadata> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Check for secrets.manage permission
  const canManage = await hasPermission(user, 'secrets', 'manage', knex);
  if (!canManage) {
    throw new Error('Permission denied: Cannot create secrets');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.create(input, user.user_id);
});

/**
 * Update an existing tenant secret.
 * Requires secrets.manage permission.
 *
 * @param name - Name of the secret to update
 * @param input - Update input (value and/or description)
 * @returns The updated secret's metadata (never includes the value)
 */
export const updateSecret = withAuth(async (
  user,
  { tenant },
  name: string,
  input: UpdateTenantSecretInput
): Promise<TenantSecretMetadata> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Check for secrets.manage permission
  const canManage = await hasPermission(user, 'secrets', 'manage', knex);
  if (!canManage) {
    throw new Error('Permission denied: Cannot update secrets');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.update(name, input, user.user_id);
});

/**
 * Delete a tenant secret.
 * Requires secrets.manage permission.
 *
 * @param name - Name of the secret to delete
 */
export const deleteSecret = withAuth(async (user, { tenant }, name: string): Promise<void> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Check for secrets.manage permission
  const canManage = await hasPermission(user, 'secrets', 'manage', knex);
  if (!canManage) {
    throw new Error('Permission denied: Cannot delete secrets');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  await provider.delete(name, user.user_id);
});

/**
 * Resolve a secret value for runtime use (internal only).
 * This should NEVER be exposed via API - only called by the workflow runtime.
 *
 * @param name - Name of the secret to resolve
 * @param workflowRunId - Optional workflow run ID for audit logging
 * @returns The decrypted secret value
 */
export const resolveSecretForRuntime = withAuth(async (
  user,
  { tenant },
  name: string,
  workflowRunId?: string
): Promise<string> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.getValue(name, workflowRunId);
});

/**
 * Get workflows that reference a specific secret.
 * Used to warn users before deleting a secret.
 */
export const getSecretUsage = withAuth(async (user, { tenant }): Promise<Map<string, string[]>> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.getSecretUsage();
});

/**
 * Validate that a secret name follows the required pattern.
 * Returns validation errors if any.
 */
export const validateSecretName = withAuth(async (user, { tenant }, name: string): Promise<{
  valid: boolean;
  errors: string[];
}> => {
  const errors: string[] = [];

  // Check pattern
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    errors.push('Secret name must start with an uppercase letter and contain only uppercase letters, numbers, and underscores');
  }

  // Check length
  if (name.length > 255) {
    errors.push('Secret name must be 255 characters or less');
  }

  // Check if already exists
  if (errors.length === 0) {
    const { knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    const provider = createTenantSecretProvider(knex, tenant);
    const exists = await provider.exists(name);
    if (exists) {
      errors.push(`Secret with name "${name}" already exists`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
});
