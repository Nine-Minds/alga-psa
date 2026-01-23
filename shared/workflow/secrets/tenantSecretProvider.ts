/**
 * Tenant Secret Provider
 *
 * This module provides tenant-scoped secret management that integrates with
 * the existing ISecretProvider infrastructure (supporting Vault, filesystem, etc.).
 *
 * Secret metadata (name, description, audit info) is stored in the database,
 * while actual secret values are stored via ISecretProvider.
 */

import { Knex } from 'knex';
import { getSecretProviderInstance, type ISecretProvider } from '@alga-psa/core/secrets';
import {
  TenantSecretMetadata,
  TenantSecretModel,
  TenantSecretAuditLogModel,
  TenantSecretAuditEventType,
  CreateTenantSecretInput,
  UpdateTenantSecretInput,
  createSecretInputSchema,
  updateSecretInputSchema
} from './types';

/**
 * Convert database model to metadata (no secret value).
 */
function modelToMetadata(model: TenantSecretModel): TenantSecretMetadata {
  return {
    id: model.id,
    tenantId: model.tenant,
    name: model.name,
    description: model.description ?? undefined,
    createdAt: model.created_at,
    updatedAt: model.updated_at,
    createdBy: model.created_by,
    updatedBy: model.updated_by,
    lastAccessedAt: model.last_accessed_at ?? undefined
  };
}

/**
 * Generate the secret provider key for a tenant secret.
 * This key is used to store/retrieve the actual value via ISecretProvider.
 */
function generateSecretProviderKey(tenantId: string, secretName: string): string {
  // Format: tenant-secrets/{tenantId}/{secretName}
  // This creates a unique path in the secret provider (e.g., Vault)
  return `tenant-secrets/${tenantId}/${secretName}`;
}

/**
 * TenantSecretProvider class for managing tenant-scoped secrets.
 */
export class TenantSecretProvider {
  private knex: Knex;
  private tenantId: string;
  private secretProvider: ISecretProvider | undefined;

  constructor(knex: Knex, tenantId: string) {
    this.knex = knex;
    this.tenantId = tenantId;
  }

  /**
   * Get the underlying ISecretProvider instance.
   */
  private async getSecretProvider(): Promise<ISecretProvider> {
    if (!this.secretProvider) {
      this.secretProvider = await getSecretProviderInstance();
    }
    return this.secretProvider;
  }

  /**
   * Log an audit event for a secret operation.
   */
  private async logAuditEvent(
    trx: Knex.Transaction,
    secretId: string | null,
    secretName: string,
    eventType: TenantSecretAuditEventType,
    userId: string | null,
    workflowRunId?: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    const auditEntry: Partial<TenantSecretAuditLogModel> = {
      tenant: this.tenantId,
      secret_id: secretId,
      secret_name: secretName,
      event_type: eventType,
      user_id: userId,
      workflow_run_id: workflowRunId ?? null,
      context: context ?? null
    };

    await trx('tenant_secrets_audit_log').insert(auditEntry);
  }

  /**
   * List all secrets for the tenant (metadata only, no values).
   */
  async list(): Promise<TenantSecretMetadata[]> {
    const rows = await this.knex('tenant_secrets')
      .where({ tenant: this.tenantId })
      .orderBy('name', 'asc')
      .select<TenantSecretModel[]>('*');

    return rows.map(modelToMetadata);
  }

  /**
   * Get metadata for a specific secret by name.
   */
  async getMetadata(name: string): Promise<TenantSecretMetadata | null> {
    const row = await this.knex('tenant_secrets')
      .where({ tenant: this.tenantId, name })
      .first<TenantSecretModel>();

    return row ? modelToMetadata(row) : null;
  }

  /**
   * Check if a secret exists.
   */
  async exists(name: string): Promise<boolean> {
    const row = await this.knex('tenant_secrets')
      .where({ tenant: this.tenantId, name })
      .first<{ id: string }>('id');

    return !!row;
  }

  /**
   * Create a new secret.
   *
   * @param input - Secret creation input (name, value, description)
   * @param userId - ID of the user creating the secret
   * @returns The created secret's metadata
   * @throws Error if validation fails or secret already exists
   */
  async create(input: CreateTenantSecretInput, userId: string): Promise<TenantSecretMetadata> {
    // Validate input
    const validated = createSecretInputSchema.parse(input);

    // Check for existing secret with same name
    const existing = await this.exists(validated.name);
    if (existing) {
      throw new Error(`Secret with name "${validated.name}" already exists`);
    }

    const secretProviderKey = generateSecretProviderKey(this.tenantId, validated.name);

    return this.knex.transaction(async (trx) => {
      // Store the actual secret value via ISecretProvider
      const provider = await this.getSecretProvider();
      await provider.setTenantSecret(this.tenantId, validated.name, validated.value);

      // Store metadata in database
      const [row] = await trx('tenant_secrets')
        .insert({
          tenant: this.tenantId,
          name: validated.name,
          description: validated.description ?? null,
          secret_provider_key: secretProviderKey,
          created_by: userId,
          updated_by: userId
        })
        .returning<TenantSecretModel[]>('*');

      // Log audit event
      await this.logAuditEvent(trx, row.id, validated.name, 'created', userId);

      return modelToMetadata(row);
    });
  }

  /**
   * Update an existing secret.
   *
   * @param name - Name of the secret to update
   * @param input - Update input (value and/or description)
   * @param userId - ID of the user updating the secret
   * @returns The updated secret's metadata
   * @throws Error if secret doesn't exist
   */
  async update(name: string, input: UpdateTenantSecretInput, userId: string): Promise<TenantSecretMetadata> {
    // Validate input
    const validated = updateSecretInputSchema.parse(input);

    // Find existing secret
    const existing = await this.knex('tenant_secrets')
      .where({ tenant: this.tenantId, name })
      .first<TenantSecretModel>();

    if (!existing) {
      throw new Error(`Secret with name "${name}" not found`);
    }

    return this.knex.transaction(async (trx) => {
      // Update the actual secret value if provided
      if (validated.value !== undefined) {
        const provider = await this.getSecretProvider();
        await provider.setTenantSecret(this.tenantId, name, validated.value);
      }

      // Update metadata in database
      const updates: Partial<TenantSecretModel> = {
        updated_by: userId,
        updated_at: new Date().toISOString()
      };

      if (validated.description !== undefined) {
        updates.description = validated.description;
      }

      const [row] = await trx('tenant_secrets')
        .where({ tenant: this.tenantId, name })
        .update(updates)
        .returning<TenantSecretModel[]>('*');

      // Log audit event
      await this.logAuditEvent(trx, row.id, name, 'updated', userId, undefined, {
        valueUpdated: validated.value !== undefined,
        descriptionUpdated: validated.description !== undefined
      });

      return modelToMetadata(row);
    });
  }

  /**
   * Delete a secret.
   *
   * @param name - Name of the secret to delete
   * @param userId - ID of the user deleting the secret
   * @throws Error if secret doesn't exist
   */
  async delete(name: string, userId: string): Promise<void> {
    // Find existing secret
    const existing = await this.knex('tenant_secrets')
      .where({ tenant: this.tenantId, name })
      .first<TenantSecretModel>();

    if (!existing) {
      throw new Error(`Secret with name "${name}" not found`);
    }

    await this.knex.transaction(async (trx) => {
      // Delete from ISecretProvider
      const provider = await this.getSecretProvider();
      await provider.deleteTenantSecret(this.tenantId, name);

      // Log audit event (before deleting metadata)
      await this.logAuditEvent(trx, existing.id, name, 'deleted', userId);

      // Delete metadata from database
      await trx('tenant_secrets')
        .where({ tenant: this.tenantId, name })
        .delete();
    });
  }

  /**
   * Get the actual secret value (for runtime use only).
   * This should only be called during workflow execution, never exposed via API.
   *
   * @param name - Name of the secret to retrieve
   * @param workflowRunId - Optional workflow run ID for audit logging
   * @returns The decrypted secret value
   * @throws Error if secret doesn't exist
   */
  async getValue(name: string, workflowRunId?: string): Promise<string> {
    // Find existing secret
    const existing = await this.knex('tenant_secrets')
      .where({ tenant: this.tenantId, name })
      .first<TenantSecretModel>();

    if (!existing) {
      throw new Error(`Secret with name "${name}" not found`);
    }

    // Get the actual value from ISecretProvider
    const provider = await this.getSecretProvider();
    const value = await provider.getTenantSecret(this.tenantId, name);

    if (value === undefined) {
      throw new Error(`Secret value not found in provider for "${name}"`);
    }

    // Update last_accessed_at and log access
    await this.knex.transaction(async (trx) => {
      await trx('tenant_secrets')
        .where({ tenant: this.tenantId, name })
        .update({ last_accessed_at: new Date().toISOString() });

      await this.logAuditEvent(trx, existing.id, name, 'accessed', null, workflowRunId);
    });

    return value;
  }

  /**
   * Get secrets that are referenced by workflows.
   * Returns a map of secret names to the workflow IDs that reference them.
   */
  async getSecretUsage(): Promise<Map<string, string[]>> {
    // Query workflow definitions to find $secret references
    // This is a simplified implementation - in practice, you'd parse workflow JSON
    const workflows = await this.knex('workflow_definitions_v2')
      .where({ tenant: this.tenantId })
      .whereRaw("definition_json::text LIKE '%$secret%'")
      .select('workflow_id', 'definition_json');

    const usage = new Map<string, string[]>();

    for (const workflow of workflows) {
      const json = JSON.stringify(workflow.definition_json);
      // Find all $secret references
      const matches = json.matchAll(/"\$secret"\s*:\s*"([^"]+)"/g);
      for (const match of matches) {
        const secretName = match[1];
        if (!usage.has(secretName)) {
          usage.set(secretName, []);
        }
        usage.get(secretName)!.push(workflow.workflow_id);
      }
    }

    return usage;
  }
}

/**
 * Factory function to create a TenantSecretProvider for a given tenant.
 */
export function createTenantSecretProvider(knex: Knex, tenantId: string): TenantSecretProvider {
  return new TenantSecretProvider(knex, tenantId);
}
