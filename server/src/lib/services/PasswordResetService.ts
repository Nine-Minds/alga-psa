import { createTenantKnex } from '../db';
import { checkPasswordResetLimit, formatRateLimitError } from '../security/rateLimiting';
import crypto from 'crypto';
import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';

export interface PasswordResetToken {
  token_id: string;
  user_id: string;
  token_hash: string;  // Changed from token to token_hash
  email: string;
  user_type: 'internal' | 'client';
  expires_at: Date;
  created_at: Date;
  used_at?: Date;
  metadata: Record<string, any>;
}

export interface TokenVerificationResult {
  valid: boolean;
  tenant?: string;
  user?: {
    user_id: string;
    username: string;
    email: string;
    first_name: string;
    last_name?: string;
    user_type: 'internal' | 'client';
  };
  token?: PasswordResetToken;
  error?: string;
}

export class PasswordResetService {
  /**
   * Generate a cryptographically secure token
   */
  static generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash a token using SHA256
   */
  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Create a new password reset token with transaction support
   */
  static async createResetTokenWithTransaction(
    email: string,
    userType: 'internal' | 'client',
    trx: Knex.Transaction,
    tenant: string
  ): Promise<{
    success: boolean;
    tokenId?: string;
    token?: string;
    userId?: string;
    error?: string;
  }> {
    try {
      // Check rate limit
      const rateLimitResult = await checkPasswordResetLimit(email);
      if (!rateLimitResult.success) {
        const errorMessage = await formatRateLimitError(rateLimitResult.msBeforeNext);
        return { success: false, error: errorMessage };
      }

      // Clean up expired tokens for this tenant before creating a new one
      // This helps keep the table clean without relying on scheduled jobs
      await trx('password_reset_tokens')
        .where('tenant', tenant)
        .where('expires_at', '<', trx.fn.now())
        .del();

      // Find user by email and type (using transaction)
      const user = await trx('users')
        .where({ 
          tenant, 
          email: email.toLowerCase(),
          user_type: userType,
          is_inactive: false
        })
        .first();

      if (!user) {
        // Don't reveal if user exists or not for security
        return { success: true, tokenId: 'dummy', token: 'dummy', userId: 'dummy' };
      }

      // Generate secure token
      const token = this.generateSecureToken();
      const tokenHash = this.hashToken(token);

      // Invalidate any existing unused tokens for this user (using transaction)
      await trx('password_reset_tokens')
        .where({
          tenant,
          user_id: user.user_id,
          used_at: null
        })
        .update({
          used_at: trx.fn.now(),
          metadata: trx.raw('metadata || ?', [JSON.stringify({ 
            invalidated: true, 
            invalidated_at: new Date().toISOString(),
            reason: 'new_token_requested'
          })])
        });

      // Create new reset token (using transaction)
      const [resetToken] = await trx('password_reset_tokens')
        .insert({
          tenant,
          user_id: user.user_id,
          token_hash: tokenHash,  // Store the hash, not the plaintext
          email: user.email,
          user_type: userType,
          // Use DB time for expiration: now() + 1 hour
          expires_at: trx.raw("now() + interval '1 hour'"),
          metadata: {
            ip_address: null, // Will be set by the action layer if available
            user_agent: null, // Will be set by the action layer if available
            requested_by: user.user_id
          }
        })
        .returning(['token_id', 'user_id']);  // Don't return the hash

      return {
        success: true,
        tokenId: resetToken.token_id,
        token: token,  // Return the plaintext token (only time it's visible)
        userId: resetToken.user_id
      };

    } catch (error) {
      console.error('Error creating password reset token:', error);
      return { success: false, error: 'Failed to create reset token' };
    }
  }

  /**
   * Create a new password reset token (non-transactional version)
   */
  static async createResetToken(
    email: string,
    userType: 'internal' | 'client' = 'internal'
  ): Promise<{
    success: boolean;
    tokenId?: string;
    token?: string;
    userId?: string;
    error?: string;
  }> {
    try {
      const { knex, tenant } = await createTenantKnex();

      if (!tenant) {
        return { success: false, error: 'Tenant context is required' };
      }

      // Use withTransaction helper for proper connection management
      return await withTransaction(knex, async (trx) => {
        return await this.createResetTokenWithTransaction(email, userType, trx, tenant);
      });

    } catch (error) {
      console.error('Error creating password reset token:', error);
      return { success: false, error: 'Failed to create reset token' };
    }
  }

  /**
   * Verify a password reset token
   */
  static async verifyToken(token: string): Promise<TokenVerificationResult> {
    try {
      const { knex } = await createTenantKnex();

      // Hash the provided token to compare with stored hash
      const tokenHash = this.hashToken(token);

      // Use withTransaction helper for proper connection management
      return await withTransaction(knex, async (trx) => {
        // First, find the token to get its tenant
        // This initial query needs to scan all shards, but it's necessary
        // to determine which tenant the token belongs to
        const tokenInfo = await trx('password_reset_tokens')
          .where({
            token_hash: tokenHash,  // Compare hashes
            used_at: null
          })
          .where('expires_at', '>', trx.fn.now())
          .select('tenant', 'user_id')
          .first();

        if (!tokenInfo) {
          return { 
            valid: false, 
            error: 'Invalid or expired reset token' 
          };
        }

        const tokenTenant = tokenInfo.tenant;

        // Clean up expired tokens for this tenant (single-shard query)
        await trx('password_reset_tokens')
          .where('tenant', tokenTenant)
          .where('expires_at', '<', trx.fn.now())
          .del();
        
        // Now fetch the full token with user info (single-shard query)
        const resetToken = await trx('password_reset_tokens as prt')
          .join('users as u', function() {
            this.on('prt.tenant', '=', 'u.tenant')
                .andOn('prt.user_id', '=', 'u.user_id');
          })
          .where('prt.tenant', tokenTenant)
          .where({
            'prt.token_hash': tokenHash,  // Compare hashes
            'prt.used_at': null
          })
          .where('prt.expires_at', '>', trx.fn.now())
          .select(
            'prt.*',
            'u.username',
            'u.email as user_email',
            'u.first_name',
            'u.last_name',
            'u.user_type'
          )
          .first();

        if (!resetToken) {
          return { 
            valid: false, 
            error: 'Invalid or expired reset token' 
          };
        }

        return {
          valid: true,
          tenant: (resetToken as any).tenant,
          user: {
            user_id: resetToken.user_id,
            username: resetToken.username,
            email: resetToken.user_email,
            first_name: resetToken.first_name,
            last_name: resetToken.last_name,
            user_type: resetToken.user_type
          },
          token: {
            token_id: resetToken.token_id,
            user_id: resetToken.user_id,
            token_hash: resetToken.token_hash,  // Return the hash, not plaintext
            email: resetToken.email,
            user_type: resetToken.user_type,
            expires_at: resetToken.expires_at,
            created_at: resetToken.created_at,
            used_at: resetToken.used_at,
            metadata: resetToken.metadata
          }
        };
      });

    } catch (error) {
      console.error('Error verifying password reset token:', error);
      return { valid: false, error: 'Failed to verify token' };
    }
  }

  /**
   * Mark a token as used
   */
  static async markTokenAsUsed(token: string): Promise<boolean> {
    try {
      const { knex } = await createTenantKnex();

      // Hash the token for comparison
      const tokenHash = this.hashToken(token);

      // Use withTransaction helper for proper connection management
      return await withTransaction(knex, async (trx) => {
        // First get the token info to find its tenant
        const tokenInfo = await trx('password_reset_tokens')
          .where({
            token_hash: tokenHash,  // Compare hashes
            used_at: null
          })
          .select('tenant')
          .first();

        if (!tokenInfo) {
          return false;
        }

        const updateCount = await trx('password_reset_tokens')
          .where({
            tenant: tokenInfo.tenant,
            token_hash: tokenHash,  // Compare hashes
            used_at: null
          })
          .update({
            used_at: trx.fn.now(),
            metadata: trx.raw('metadata || ?', [JSON.stringify({ 
              used: true, 
              used_at: new Date().toISOString() 
            })])
          });

        return updateCount > 0;
      });

    } catch (error) {
      console.error('Error marking token as used:', error);
      return false;
    }
  }

  /**
   * Get reset token history for a user
   */
  static async getResetHistory(userId: string): Promise<PasswordResetToken[]> {
    try {
      const { knex, tenant } = await createTenantKnex();

      const tokens = await knex('password_reset_tokens')
        .where({
          tenant,
          user_id: userId
        })
        .orderBy('created_at', 'desc')
        .limit(10)
        .select('*');

      return tokens;

    } catch (error) {
      console.error('Error fetching reset history:', error);
      return [];
    }
  }

  /**
   * Clean up expired tokens
   * @param trx - Optional transaction to use for cleanup
   */
  static async cleanupExpiredTokens(trx?: Knex.Transaction): Promise<number> {
    try {
      const { knex, tenant } = await createTenantKnex();

      if (!tenant) {
        return 0;
      }

      // Use provided transaction or create a new one
      const cleanup = async (tx: Knex.Transaction) => {
        // Delete expired tokens for this tenant only (single-shard query)
        const deletedRows = await tx('password_reset_tokens')
          .where('tenant', tenant)
          .where('expires_at', '<', tx.fn.now())
          .del();
        
        const deletedCount = deletedRows || 0;
        
        if (deletedCount > 0) {
          console.log(`Cleaned up ${deletedCount} expired password reset tokens for tenant ${tenant}`);
        }

        return deletedCount;
      };

      // If transaction provided, use it; otherwise create a new one with withTransaction
      return trx ? cleanup(trx) : withTransaction(knex, cleanup);

    } catch (error) {
      console.error('Error cleaning up expired tokens:', error);
      return 0;
    }
  }

  /**
   * Use constant-time comparison for token validation
   */
  static secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }
}