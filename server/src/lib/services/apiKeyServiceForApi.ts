import { Knex } from 'knex';
import crypto from 'crypto';
import { getConnection } from '../db/db';

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

/**
 * API Key Service specifically for REST API usage
 * This version accepts tenant as a parameter to avoid circular dependencies
 */
export class ApiKeyServiceForApi {
  /**
   * Hash an API key using SHA-256
   */
  private static hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Validate an API key for a specific tenant
   * This version is designed for API middleware where tenant might come from headers
   */
  static async validateApiKeyForTenant(
    plaintextKey: string, 
    tenantId: string | null
  ): Promise<ApiKey | null> {
    if (!tenantId) {
      console.error('Tenant ID is required for API key validation');
      return null;
    }

    const hashedKey = this.hashApiKey(plaintextKey);
    
    try {
      // Get the connection for this tenant
      const knex = await getConnection(tenantId);
      
      // Find the API key record using the hashed value
      const record = await knex('api_keys')
        .where({
          api_key: hashedKey,
          active: true,
          tenant: tenantId
        })
        .where((builder) => {
          builder.whereNull('expires_at')
            .orWhere('expires_at', '>', knex.fn.now());
        })
        .first();
      
      if (!record) {
        // Mask key to avoid leaking secrets in logs
        const maskKey = (k: string) => {
          const len = k?.length || 0;
          const prefix = k?.slice(0, 4) || '';
          const suffix = k?.slice(Math.max(0, len - 2)) || '';
          return `${prefix}***${suffix} (len=${len})`;
        };
        console.log(`Invalid or expired API key attempt in tenant ${tenantId}; key=${maskKey(plaintextKey)}`);
        return null;
      }
      
      // Update last_used_at timestamp
      await knex('api_keys')
        .where({
          api_key_id: record.api_key_id,
          tenant: tenantId
        })
        .update({
          last_used_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      
      return record;
    } catch (error) {
      console.error(`Error validating API key in tenant ${tenantId}:`, error);
      return null;
    }
  }

  /**
   * Validate an API key without tenant context
   * This searches across all tenants (useful for initial validation)
   */
  static async validateApiKeyAnyTenant(plaintextKey: string): Promise<ApiKey | null> {
    const hashedKey = this.hashApiKey(plaintextKey);
    
    try {
      // Use the main connection to search across all tenants
      const knex = await getConnection(null);
      
      // Find the API key record in any tenant
      const record = await knex('api_keys')
        .where({
          api_key: hashedKey,
          active: true
        })
        .where((builder) => {
          builder.whereNull('expires_at')
            .orWhere('expires_at', '>', knex.fn.now());
        })
        .first();
      
      if (!record) {
        // Mask key to avoid leaking secrets in logs
        const maskKey = (k: string) => {
          const len = k?.length || 0;
          const prefix = k?.slice(0, 4) || '';
          const suffix = k?.slice(Math.max(0, len - 2)) || '';
          return `${prefix}***${suffix} (len=${len})`;
        };
        console.log(`Invalid or expired API key attempt; key=${maskKey(plaintextKey)}`);
        return null;
      }
      
      // Update last_used_at timestamp
      await knex('api_keys')
        .where({
          api_key_id: record.api_key_id,
          tenant: record.tenant
        })
        .update({
          last_used_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      
      return record;
    } catch (error) {
      console.error('Error validating API key:', error);
      return null;
    }
  }
}
