import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/users/actions';
import { checkPortalInvitationLimit, formatRateLimitError } from '@alga-psa/auth';
import crypto from 'crypto';
import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';

export interface PortalInvitation {
  invitation_id: string;
  contact_id: string;
  token: string;
  email: string;
  expires_at: Date;
  created_at: Date;
  used_at?: Date;
  metadata: Record<string, any>;
}

export interface TokenVerificationResult {
  valid: boolean;
  tenant?: string;
  contact?: {
    contact_name_id: string;
    full_name: string;
    email: string;
    client_name: string;
  };
  invitation?: PortalInvitation;
  error?: string;
}

export class PortalInvitationService {
  /**
   * Generate a cryptographically secure token
   */
  static generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new portal invitation for a contact with transaction support
   */
  static async createInvitationWithTransaction(
    contactId: string,
    trx: Knex.Transaction
  ): Promise<{
    success: boolean;
    invitationId?: string;
    token?: string;
    error?: string;
  }> {
    try {
      const user = await getCurrentUser();
      if (!user) {
        return { success: false, error: 'Unauthorized' };
      }

      const { tenant } = await createTenantKnex();

      // Check rate limit
      const rateLimitResult = await checkPortalInvitationLimit(contactId);
      if (!rateLimitResult.success) {
        const errorMessage = await formatRateLimitError(rateLimitResult.msBeforeNext);
        return { success: false, error: errorMessage };
      }

      // Verify contact exists and is a portal admin (using transaction)
      const contact = await trx('contacts')
        .where({ tenant, contact_name_id: contactId })
        .first();

      if (!contact) {
        return { success: false, error: 'Contact not found' };
      }

      // Allow inviting any contact (not limited to client admins)

      // Generate secure token
      const token = this.generateSecureToken();
      // Compute expiration in the database to avoid timezone/DST drift

      // Check if there's already an active invitation (using transaction)
      const existingInvitation = await trx('portal_invitations')
        .where({
          tenant,
          contact_id: contactId,
          used_at: null
        })
        .where('expires_at', '>', trx.fn.now())
        .first();

      if (existingInvitation) {
        // Reuse existing active invitation to allow resending without error
        return {
          success: true,
          invitationId: existingInvitation.invitation_id,
          token: existingInvitation.token
        };
      }

      // Create invitation record (using transaction)
      const [invitation] = await trx('portal_invitations')
        .insert({
          tenant,
          contact_id: contactId,
          token,
          email: contact.email,
          // Use DB time for expiration: now() + 24 hours
          expires_at: trx.raw("now() + interval '24 hours'"),
          metadata: {
            created_by: user.user_id,
            contact_name: contact.full_name
          }
        })
        .returning(['invitation_id', 'token']);

      return {
        success: true,
        invitationId: invitation.invitation_id,
        token: invitation.token
      };

    } catch (error) {
      console.error('Error creating portal invitation:', error);
      return { success: false, error: 'Failed to create invitation' };
    }
  }

  /**
   * Create a new portal invitation for a contact (non-transactional version)
   */
  static async createInvitation(contactId: string): Promise<{
    success: boolean;
    invitationId?: string;
    token?: string;
    error?: string;
  }> {
    try {
      const user = await getCurrentUser();
      if (!user) {
        return { success: false, error: 'Unauthorized' };
      }

      const { knex, tenant } = await createTenantKnex();

      // Check rate limit
      const rateLimitResult = await checkPortalInvitationLimit(contactId);
      if (!rateLimitResult.success) {
        const errorMessage = await formatRateLimitError(rateLimitResult.msBeforeNext);
        return { success: false, error: errorMessage };
      }

      // Verify contact exists and is a portal admin
      const contact = await knex('contacts')
        .where({ tenant, contact_name_id: contactId })
        .first();

      if (!contact) {
        return { success: false, error: 'Contact not found' };
      }

      // Allow inviting any contact (not limited to client admins)

      // Generate secure token
      const token = this.generateSecureToken();
      // Compute expiration in the database to avoid timezone/DST drift

      // Check if there's already an active invitation
      const existingInvitation = await knex('portal_invitations')
        .where({
          tenant,
          contact_id: contactId,
          used_at: null
        })
        .where('expires_at', '>', knex.fn.now())
        .first();

      if (existingInvitation) {
        // Reuse existing active invitation to allow resending without error
        return {
          success: true,
          invitationId: existingInvitation.invitation_id,
          token: existingInvitation.token
        };
      }

      // Create invitation record
      const [invitation] = await knex('portal_invitations')
        .insert({
          tenant,
          contact_id: contactId,
          token,
          email: contact.email,
          // Use DB time for expiration: now() + 24 hours
          expires_at: knex.raw("now() + interval '24 hours'"),
          metadata: {
            created_by: user.user_id,
            contact_name: contact.full_name
          }
        })
        .returning(['invitation_id', 'token']);

      return {
        success: true,
        invitationId: invitation.invitation_id,
        token: invitation.token
      };

    } catch (error) {
      console.error('Error creating portal invitation:', error);
      return { success: false, error: 'Failed to create invitation' };
    }
  }

  /**
   * Verify a portal invitation token
   */
  static async verifyToken(token: string): Promise<TokenVerificationResult> {
    try {
      const { knex } = await createTenantKnex();

      // Use withTransaction helper for proper connection management
      return await withTransaction(knex, async (trx) => {
        // First, find the invitation to get its tenant
        // This initial query needs to scan all shards, but it's necessary
        // to determine which tenant the token belongs to
        const tokenInfo = await trx('portal_invitations')
          .where({
            token,
            used_at: null
          })
          .where('expires_at', '>', trx.fn.now())
          .select('tenant', 'contact_id')
          .first();

        if (!tokenInfo) {
          return { 
            valid: false, 
            error: 'Invalid or expired invitation token' 
          };
        }

        const tokenTenant = tokenInfo.tenant;

        // Clean up expired tokens for this tenant (single-shard query)
        await trx('portal_invitations')
          .where('tenant', tokenTenant)
          .where('expires_at', '<', trx.fn.now())
          .del();
        
        // Now fetch the full invitation with joins (single-shard query)
        const invitation = await trx('portal_invitations as pi')
          .join('contacts as c', function() {
            this.on('pi.tenant', '=', 'c.tenant')
                .andOn('pi.contact_id', '=', 'c.contact_name_id');
          })
          .leftJoin('clients as comp', function() {
            this.on('c.tenant', '=', 'comp.tenant')
                .andOn('c.client_id', '=', 'comp.client_id');
          })
          .where('pi.tenant', tokenTenant)
          .where({
            'pi.token': token,
            'pi.used_at': null
          })
          .where('pi.expires_at', '>', trx.fn.now())
          .select(
            'pi.*',
            'c.full_name',
            'c.email as contact_email',
            'comp.client_name'
          )
          .first();

        if (!invitation) {
          return { 
            valid: false, 
            error: 'Invalid or expired invitation token' 
          };
        }

        return {
          valid: true,
          tenant: (invitation as any).tenant,
          contact: {
            contact_name_id: invitation.contact_id,
            full_name: invitation.full_name,
            email: invitation.contact_email,
            client_name: invitation.client_name || 'No Client'
          },
          invitation: {
            invitation_id: invitation.invitation_id,
            contact_id: invitation.contact_id,
            token: invitation.token,
            email: invitation.email,
            expires_at: invitation.expires_at,
            created_at: invitation.created_at,
            used_at: invitation.used_at,
            metadata: invitation.metadata
          }
        };
      });

    } catch (error) {
      console.error('Error verifying portal invitation token:', error);
      return { valid: false, error: 'Failed to verify token' };
    }
  }

  /**
   * Mark a token as used
   */
  static async markTokenAsUsed(token: string): Promise<boolean> {
    try {
      const { knex, tenant } = await createTenantKnex();

      // Use withTransaction helper for proper connection management
      return await withTransaction(knex, async (trx) => {
        const updateCount = await trx('portal_invitations')
          .where({
            tenant,
            token,
            used_at: null
          })
          .update({
            used_at: trx.fn.now()
          });

        return updateCount > 0;
      });

    } catch (error) {
      console.error('Error marking token as used:', error);
      return false;
    }
  }

  /**
   * Get invitation history for a contact
   */
  static async getInvitationHistory(contactId: string): Promise<PortalInvitation[]> {
    try {
      const { knex, tenant } = await createTenantKnex();

      const invitations = await knex('portal_invitations')
        .where({
          tenant,
          contact_id: contactId
        })
        .orderBy('created_at', 'desc')
        .select('*');

      return invitations;

    } catch (error) {
      console.error('Error fetching invitation history:', error);
      return [];
    }
  }

  /**
   * Revoke an invitation
   */
  static async revokeInvitation(invitationId: string): Promise<boolean> {
    try {
      const { knex, tenant } = await createTenantKnex();

      const updateCount = await knex('portal_invitations')
        .where({
          tenant,
          invitation_id: invitationId,
          used_at: null
        })
        .update({
          used_at: knex.fn.now(),
          metadata: knex.raw('metadata || ?', [JSON.stringify({ revoked: true, revoked_at: new Date().toISOString() })])
        });

      return updateCount > 0;

    } catch (error) {
      console.error('Error revoking invitation:', error);
      return false;
    }
  }

  /**
   * Clean up expired tokens
   * @param trx - Optional transaction to use for cleanup
   */
  static async cleanupExpiredTokens(trx?: Knex.Transaction): Promise<number> {
    try {
      const { knex, tenant } = await createTenantKnex();

      // Use provided transaction or create a new one
      const cleanup = async (tx: Knex.Transaction) => {
        // Delete expired tokens for this tenant only (single-shard query)
        const deletedRows = await tx('portal_invitations')
          .where('tenant', tenant)
          .where('expires_at', '<', tx.fn.now())
          .del();
        
        const deletedCount = deletedRows || 0;
        
        if (deletedCount > 0) {
          console.log(`Cleaned up ${deletedCount} expired portal invitation tokens for tenant ${tenant}`);
          
          // Log to audit_logs if needed
          await tx('audit_logs').insert({
            audit_id: tx.raw('gen_random_uuid()'),
            tenant: tenant || '00000000-0000-0000-0000-000000000000',
            table_name: 'portal_invitations',
            operation: 'CLEANUP',
            record_id: '00000000-0000-0000-0000-000000000000',
            changed_data: { deleted_count: deletedCount },
            details: { operation: 'automated_cleanup', deleted_count: deletedCount },
            user_id: '00000000-0000-0000-0000-000000000000',
            timestamp: tx.fn.now()
          });
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
