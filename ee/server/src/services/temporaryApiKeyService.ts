import { runWithTenant, createTenantKnex } from '@/lib/db';
import { ApiKeyService } from 'server/src/lib/services/apiKeyService';
import { withAdminTransaction } from '@alga-psa/shared/db';
import logger from '@shared/core/logger';

const PURPOSE_AI_SESSION = 'ai_session';
const DEFAULT_EXPIRY_MINUTES = 30;

export interface IssueAiSessionKeyOptions {
  tenantId: string;
  userId: string;
  issuedByUserId: string;
  chatId: string;
  functionCallId: string;
  approvalId: string;
  expiresInMinutes?: number;
  description?: string;
  extraMetadata?: Record<string, unknown>;
}

export interface IssuedTemporaryKey {
  apiKeyId: string;
  apiKey: string;
  expiresAt: Date | null;
  metadata: Record<string, unknown> | null;
}

export class TemporaryApiKeyService {
  /**
   * Issue a short-lived API key for AI chat session usage.
   */
  static async issueForAiSession(options: IssueAiSessionKeyOptions): Promise<IssuedTemporaryKey> {
    const {
      tenantId,
      userId,
      issuedByUserId,
      chatId,
      functionCallId,
      approvalId,
      expiresInMinutes = DEFAULT_EXPIRY_MINUTES,
      description,
      extraMetadata,
    } = options;

    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);
    const issuedAtIso = new Date().toISOString();

    return runWithTenant(tenantId, async () => {
      const { knex, tenant } = await createTenantKnex();

      if (!tenant || tenant !== tenantId) {
        throw new Error(`Tenant context mismatch while issuing AI session key for tenant ${tenantId}`);
      }

      // Deactivate any existing active keys for the same chat/function pair
      const existingKeys = await knex('api_keys')
        .select('api_key_id', 'metadata')
        .where({
          tenant: tenantId,
          user_id: userId,
          purpose: PURPOSE_AI_SESSION,
          active: true,
        })
        .andWhereRaw("metadata->>'chat_id' = ?", [chatId])
        .andWhereRaw("metadata->>'function_call_id' = ?", [functionCallId]);

      if (existingKeys.length > 0) {
        const existingIds = existingKeys.map((row) => row.api_key_id);
        await knex('api_keys')
          .whereIn('api_key_id', existingIds)
          .update({
            active: false,
            updated_at: knex.fn.now(),
            metadata: knex.raw(
              "coalesce(metadata, '{}'::jsonb) || ?::jsonb",
              JSON.stringify({
                revoked_at: issuedAtIso,
                revoked_reason: 'replaced',
              })
            ),
          });
      }

      const metadata: Record<string, unknown> = {
        chat_id: chatId,
        function_call_id: functionCallId,
        approval_id: approvalId,
        issued_by_user_id: issuedByUserId,
        issued_at: issuedAtIso,
        ...(extraMetadata ?? {}),
      };

      const apiKey = await ApiKeyService.createApiKey(
        userId,
        description ?? 'AI session key',
        expiresAt,
        {
          purpose: PURPOSE_AI_SESSION,
          metadata,
          usageLimit: 1,
          usageCount: 0,
        }
      );

      return {
        apiKeyId: apiKey.api_key_id,
        apiKey: apiKey.api_key,
        expiresAt: apiKey.expires_at,
        metadata: apiKey.metadata,
      };
    });
  }

  /**
   * Revoke a temporary API key.
   */
  static async revoke(
    tenantId: string,
    apiKeyId: string,
    reason: string,
    additionalMetadata?: Record<string, unknown>
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      const { knex, tenant } = await createTenantKnex();

      if (!tenant || tenant !== tenantId) {
        throw new Error(`Tenant context mismatch while revoking AI session key ${apiKeyId}`);
      }

      const record = await knex('api_keys')
        .select('metadata', 'active')
        .where({
          api_key_id: apiKeyId,
          tenant: tenantId,
        })
        .first();

      if (!record) {
        return false;
      }

      const baseMetadata =
        record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
          ? (record.metadata as Record<string, unknown>)
          : {};

      const metadata = {
        ...baseMetadata,
        revoked_at: new Date().toISOString(),
        revoked_reason: reason,
        ...(additionalMetadata ?? {}),
      };

      await knex('api_keys')
        .where({
          api_key_id: apiKeyId,
          tenant: tenantId,
        })
        .update({
          active: false,
          metadata,
          updated_at: knex.fn.now(),
        });

      return true;
    });
  }

  /**
   * Cleanup expired temporary keys across all tenants.
   */
  static async cleanupExpiredAiKeys(): Promise<number> {
    return withAdminTransaction(async (trx) => {
      const result = await trx('api_keys')
        .where({
          purpose: PURPOSE_AI_SESSION,
          active: true,
        })
        .andWhere('expires_at', '<', trx.fn.now())
        .update({
          active: false,
          updated_at: trx.fn.now(),
          metadata: trx.raw(
            "coalesce(metadata, '{}'::jsonb) || jsonb_build_object('revoked_at', ?, 'revoked_reason', 'expired')",
            new Date().toISOString()
          ),
        });

      if (result > 0) {
        logger.info(`[TemporaryApiKeyService] Deactivated ${result} expired AI session keys.`);
      }
      return result;
    });
  }
}
