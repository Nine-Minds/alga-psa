import { createTenantKnex } from '../db';
import { getCurrentUser } from '../actions/user-actions/userActions';
import { checkPortalInvitationLimit, formatRateLimitError } from '../security/rateLimiting';
import crypto from 'crypto';
import { Knex } from 'knex';

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
  contact?: {
    contact_name_id: string;
    full_name: string;
    email: string;
    company_name: string;
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

      if (!contact.is_client_admin) {
        return { success: false, error: 'Contact must be marked as a client admin to receive portal invitations' };
      }

      // Generate secure token
      const token = this.generateSecureToken();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours from now

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
        return { 
          success: false, 
          error: 'An active invitation already exists for this contact. Please wait for it to expire or be used before sending another.' 
        };
      }

      // Create invitation record (using transaction)
      const [invitation] = await trx('portal_invitations')
        .insert({
          tenant,
          contact_id: contactId,
          token,
          email: contact.email,
          expires_at: expiresAt,
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

      if (!contact.is_client_admin) {
        return { success: false, error: 'Contact must be marked as a client admin to receive portal invitations' };
      }

      // Generate secure token
      const token = this.generateSecureToken();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours from now

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
        return { 
          success: false, 
          error: 'An active invitation already exists for this contact. Please wait for it to expire or be used before sending another.' 
        };
      }

      // Create invitation record
      const [invitation] = await knex('portal_invitations')
        .insert({
          tenant,
          contact_id: contactId,
          token,
          email: contact.email,
          expires_at: expiresAt,
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
      const { knex, tenant } = await createTenantKnex();

      // Clean up expired tokens first
      await this.cleanupExpiredTokens();

      // Find the invitation
      const invitation = await knex('portal_invitations as pi')
        .join('contacts as c', function() {
          this.on('pi.tenant', '=', 'c.tenant')
              .andOn('pi.contact_id', '=', 'c.contact_id');
        })
        .join('companies as comp', function() {
          this.on('c.tenant', '=', 'comp.tenant')
              .andOn('c.company_id', '=', 'comp.company_id');
        })
        .where({
          'pi.tenant': tenant,
          'pi.token': token,
          'pi.used_at': null
        })
        .where('pi.expires_at', '>', knex.fn.now())
        .select(
          'pi.*',
          'c.full_name',
          'c.email as contact_email',
          'comp.company_name'
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
        contact: {
          contact_name_id: invitation.contact_id,
          full_name: invitation.full_name,
          email: invitation.contact_email,
          company_name: invitation.company_name
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

      const updateCount = await knex('portal_invitations')
        .where({
          tenant,
          token,
          used_at: null
        })
        .update({
          used_at: knex.fn.now()
        });

      return updateCount > 0;

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
   */
  static async cleanupExpiredTokens(): Promise<number> {
    try {
      const { knex } = await createTenantKnex();

      // Call the cleanup function created in the migration
      const result = await knex.raw('SELECT cleanup_expired_portal_invitations() as deleted_count');
      
      const deletedCount = result.rows[0]?.deleted_count || 0;
      
      if (deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount} expired portal invitation tokens`);
      }

      return deletedCount;

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