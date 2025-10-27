import { createTenantKnex } from 'server/src/lib/db';
import crypto from 'crypto';

interface ApiKey {
  api_key_id: string;
  api_key: string;
  user_id: string;
  tenant: string;
  description: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  purpose: string;
  metadata: Record<string, unknown> | null;
  usage_limit: number | null;
  usage_count: number;
}

export class ApiKeyService {
  /**
   * Generate a new API key
   * @returns A cryptographically secure random string
   */
  /**
   * Generate a new API key
   * @returns A cryptographically secure random string
   */
  static generateApiKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash an API key using SHA-256
   * @param apiKey The API key to hash
   * @returns The hashed API key
   */
  private static hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Create a new API key for a user
   * @returns The record with the plaintext API key (only available at creation time)
   */
  static async createApiKey(
    userId: string,
    description?: string,
    expiresAt?: Date,
    options?: {
      purpose?: string;
      metadata?: Record<string, unknown> | null;
      usageLimit?: number | null;
      usageCount?: number;
    }
  ): Promise<ApiKey> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for API key creation');
    }

    try {
      const plaintextKey = this.generateApiKey();
      const hashedKey = this.hashApiKey(plaintextKey);
      
      const [record] = await knex('api_keys')
        .insert({
          api_key: hashedKey, // Store the hash in the database
          user_id: userId,
          tenant,
          description,
          purpose: options?.purpose ?? 'general',
          metadata: options?.metadata ?? null,
          usage_limit: options?.usageLimit ?? null,
          usage_count: options?.usageCount ?? 0,
          expires_at: expiresAt,
        })
        .returning('*');
      
      if (!record) {
        throw new Error(`Failed to create API key for user ${userId} in tenant ${tenant}`);
      }

      // Return the record with the plaintext key (only time it's available)
      return {
        ...record,
        api_key: plaintextKey
      };
    } catch (error) {
      console.error(`Error creating API key for user ${userId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to create API key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate an API key and return the associated user and tenant information
   */
  static async validateApiKey(plaintextKey: string): Promise<ApiKey | null> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      console.error('Tenant context is required for API key validation');
      return null;
    }
    
    const hashedKey = this.hashApiKey(plaintextKey);
    
    try {
      // Find the API key record using the hashed value
      const record = await knex('api_keys')
        .where({
          api_key: hashedKey,
          active: true,
          tenant
        })
        .where((builder) => {
          builder.whereNull('expires_at')
            .orWhere('expires_at', '>', knex.fn.now());
        })
        .first();
      
      if (!record) {
        console.log(`Invalid or expired API key attempt in tenant ${tenant}`);
        return null;
      }
      
      if (record.usage_limit !== null && record.usage_limit !== undefined && record.usage_count >= record.usage_limit) {
        // Deactivate keys that have reached their usage limit
        await knex('api_keys')
          .where({
            api_key_id: record.api_key_id,
            tenant
          })
          .update({
            active: false,
            updated_at: knex.fn.now(),
          });
        return null;
      }

      // Update last_used_at timestamp
      await knex('api_keys')
        .where({
          api_key_id: record.api_key_id,
          tenant
        })
        .update({
          last_used_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });

      return record;
    } catch (error) {
      console.error(`Error validating API key in tenant ${tenant}:`, error);
      return null;
    }
  }

  /**
   * Deactivate an API key
   */
  static async deactivateApiKey(apiKeyId: string): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for deactivating API key');
    }

    try {
      const result = await knex('api_keys')
        .where({
          api_key_id: apiKeyId,
          tenant,
        })
        .update({
          active: false,
          updated_at: knex.fn.now(),
        });

      if (result === 0) {
        throw new Error(`API key ${apiKeyId} not found in tenant ${tenant}`);
      }
    } catch (error) {
      console.error(`Error deactivating API key ${apiKeyId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to deactivate API key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all API keys for a user
   */
  static async listUserApiKeys(userId: string): Promise<ApiKey[]> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for listing user API keys');
    }

    try {
      return await knex('api_keys')
        .where({
          user_id: userId,
          tenant,
        })
        .orderBy('created_at', 'desc');
    } catch (error) {
      console.error(`Error listing API keys for user ${userId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to list user API keys: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all API keys across users (admin only)
   */
  static async listAllApiKeys(): Promise<(ApiKey & { username: string })[]> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for listing API keys');
    }

    try {
      return await knex('api_keys')
        .select('api_keys.*', 'users.username')
        .join('users', function() {
          this.on('api_keys.user_id', '=', 'users.user_id')
              .andOn('users.tenant', '=', 'api_keys.tenant');
        })
        .where('api_keys.tenant', tenant)
        .orderBy('api_keys.created_at', 'desc');
    } catch (error) {
      console.error(`Error listing API keys in tenant ${tenant}:`, error);
      throw new Error(`Failed to list API keys: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Admin deactivate any API key
   */
  static async adminDeactivateApiKey(apiKeyId: string): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for admin deactivating API key');
    }

    try {
      const result = await knex('api_keys')
        .where({
          api_key_id: apiKeyId,
          tenant,
        })
        .update({
          active: false,
          updated_at: knex.fn.now(),
        });

      if (result === 0) {
        throw new Error(`API key ${apiKeyId} not found in tenant ${tenant}`);
      }
    } catch (error) {
      console.error(`Error admin deactivating API key ${apiKeyId} in tenant ${tenant}:`, error);
      throw new Error(`Failed to admin deactivate API key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Increment usage count for an API key and optionally deactivate when exhausted.
   */
  static async consumeApiKey(
    apiKeyId: string,
    tenant: string,
    increment: number = 1
  ): Promise<{ active: boolean; usageCount: number; usageLimit: number | null }> {
    const { knex, tenant: currentTenant } = await createTenantKnex();

    if (!currentTenant || currentTenant !== tenant) {
      throw new Error(`Tenant context mismatch while consuming API key ${apiKeyId}`);
    }

    const updated = await knex('api_keys')
      .where({
        api_key_id: apiKeyId,
        tenant,
        active: true,
      })
      .increment('usage_count', increment)
      .returning(['usage_count', 'usage_limit']);

    if (!updated.length) {
      throw new Error(`API key ${apiKeyId} not found or inactive for tenant ${tenant}`);
    }

    const [{ usage_count: usageCount, usage_limit: usageLimit }] = updated;

    if (usageLimit !== null && usageLimit !== undefined && usageCount >= usageLimit) {
      await knex('api_keys')
        .where({
          api_key_id: apiKeyId,
          tenant,
        })
        .update({
          active: false,
          updated_at: knex.fn.now(),
        });
      return { active: false, usageCount, usageLimit };
    }

    return { active: true, usageCount, usageLimit };
  }
}
