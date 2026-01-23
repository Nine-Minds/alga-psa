/**
 * Server Actions for Tenant Secrets Management
 *
 * These server actions provide CRUD operations for tenant-scoped secrets.
 * The actual secret values are never returned to clients - only metadata.
 */
'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
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
export async function listTenantSecrets(): Promise<TenantSecretMetadata[]> {
  const { knex, tenant } = await createTenantKnex();

  // Secrets are an optional capability in some environments (e.g. local/dev stacks or older schemas).
  // If the backing tables don't exist, treat secrets as "not configured" and return no entries.
  if (!tenant) return [];
  if (!(await knex.schema.hasTable('tenant_secrets'))) return [];

  const user = await getCurrentUser();
  if (!user) return [];

  // Check for secrets.view permission
  const canView = await hasPermission(user, 'secrets', 'view', knex);
  if (!canView) return [];

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.list();
}

/**
 * Get metadata for a specific secret by name.
 * Returns metadata only - never includes actual secret value.
 */
export async function getSecretMetadata(name: string): Promise<TenantSecretMetadata | null> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.getMetadata(name);
}

/**
 * Check if a secret exists.
 */
export async function secretExists(name: string): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.exists(name);
}

/**
 * Create a new tenant secret.
 * Requires secrets.manage permission.
 *
 * @param input - Secret creation input (name, value, description)
 * @returns The created secret's metadata (never includes the value)
 */
export async function createSecret(input: CreateTenantSecretInput): Promise<TenantSecretMetadata> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Check for secrets.manage permission
  const canManage = await hasPermission(user, 'secrets', 'manage', knex);
  if (!canManage) {
    throw new Error('Permission denied: Cannot create secrets');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.create(input, user.user_id);
}

/**
 * Update an existing tenant secret.
 * Requires secrets.manage permission.
 *
 * @param name - Name of the secret to update
 * @param input - Update input (value and/or description)
 * @returns The updated secret's metadata (never includes the value)
 */
export async function updateSecret(
  name: string,
  input: UpdateTenantSecretInput
): Promise<TenantSecretMetadata> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Check for secrets.manage permission
  const canManage = await hasPermission(user, 'secrets', 'manage', knex);
  if (!canManage) {
    throw new Error('Permission denied: Cannot update secrets');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.update(name, input, user.user_id);
}

/**
 * Delete a tenant secret.
 * Requires secrets.manage permission.
 *
 * @param name - Name of the secret to delete
 */
export async function deleteSecret(name: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Check for secrets.manage permission
  const canManage = await hasPermission(user, 'secrets', 'manage', knex);
  if (!canManage) {
    throw new Error('Permission denied: Cannot delete secrets');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  await provider.delete(name, user.user_id);
}

/**
 * Resolve a secret value for runtime use (internal only).
 * This should NEVER be exposed via API - only called by the workflow runtime.
 *
 * @param name - Name of the secret to resolve
 * @param workflowRunId - Optional workflow run ID for audit logging
 * @returns The decrypted secret value
 */
export async function resolveSecretForRuntime(
  name: string,
  workflowRunId?: string
): Promise<string> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.getValue(name, workflowRunId);
}

/**
 * Get workflows that reference a specific secret.
 * Used to warn users before deleting a secret.
 */
export async function getSecretUsage(): Promise<Map<string, string[]>> {
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const provider = createTenantSecretProvider(knex, tenant);
  return provider.getSecretUsage();
}

/**
 * Validate that a secret name follows the required pattern.
 * Returns validation errors if any.
 */
export async function validateSecretName(name: string): Promise<{
  valid: boolean;
  errors: string[];
}> {
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
    const exists = await secretExists(name);
    if (exists) {
      errors.push(`Secret with name "${name}" already exists`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
