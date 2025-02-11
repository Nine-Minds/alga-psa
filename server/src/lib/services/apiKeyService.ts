import { createTenantKnex } from '@/lib/db';
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
  static async createApiKey(userId: string, tenant: string, description?: string, expiresAt?: Date): Promise<ApiKey> {
    const { knex } = await createTenantKnex();
    
    const plaintextKey = this.generateApiKey();
    const hashedKey = this.hashApiKey(plaintextKey);
    
    const [record] = await knex('api_keys')
      .insert({
        api_key: hashedKey, // Store the hash in the database
        user_id: userId,
        tenant,
        description,
        expires_at: expiresAt,
      })
      .returning('*');
    
    // Return the record with the plaintext key (only time it's available)
    return {
      ...record,
      api_key: plaintextKey
    };
  }

  /**
   * Validate an API key and return the associated user and tenant information
   */
  static async validateApiKey(plaintextKey: string): Promise<ApiKey | null> {
    const { knex } = await createTenantKnex();
    
    const hashedKey = this.hashApiKey(plaintextKey);
    
    // Find the API key record using the hashed value
    const record = await knex('api_keys')
      .where({
        api_key: hashedKey,
        active: true,
      })
      .whereRaw('(expires_at IS NULL OR expires_at > NOW())')
      .first();
    
    if (!record) {
      return null;
    }
    
    // Update last_used_at timestamp
    await knex('api_keys')
      .where('api_key_id', record.api_key_id)
      .update({
        last_used_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    
    return record;
  }

  /**
   * Deactivate an API key
   */
  static async deactivateApiKey(apiKeyId: string, tenant: string): Promise<void> {
    const { knex } = await createTenantKnex();
    
    await knex('api_keys')
      .where({
        api_key_id: apiKeyId,
        tenant,
      })
      .update({
        active: false,
        updated_at: knex.fn.now(),
      });
  }

  /**
   * List all API keys for a user
   */
  static async listUserApiKeys(userId: string, tenant: string): Promise<ApiKey[]> {
    const { knex } = await createTenantKnex();
    
    return knex('api_keys')
      .where({
        user_id: userId,
        tenant,
      })
      .orderBy('created_at', 'desc');
  }

  /**
   * List all API keys across users (admin only)
   */
  static async listAllApiKeys(tenant: string): Promise<(ApiKey & { username: string })[]> {
    const { knex } = await createTenantKnex();
    
    return knex('api_keys')
      .select('api_keys.*', 'users.username')
      .join('users', 'api_keys.user_id', 'users.user_id')
      .where('api_keys.tenant', tenant)
      .orderBy('api_keys.created_at', 'desc');
  }

  /**
   * Admin deactivate any API key
   */
  static async adminDeactivateApiKey(apiKeyId: string, tenant: string): Promise<void> {
    const { knex } = await createTenantKnex();
    
    await knex('api_keys')
      .where({
        api_key_id: apiKeyId,
        tenant,
      })
      .update({
        active: false,
        updated_at: knex.fn.now(),
      });
  }
}
