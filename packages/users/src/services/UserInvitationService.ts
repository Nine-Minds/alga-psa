import { createTenantKnex, tenantDb, requireTenantId, withTransaction } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { checkPortalInvitationLimit, formatRateLimitError } from '@alga-psa/auth';
import crypto from 'crypto';
import { Knex } from 'knex';

export interface UserInvitation {
  invitation_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role_id: string | null;
  token: string;
  expires_at: Date;
  created_at: Date;
  used_at?: Date;
  metadata: Record<string, any>;
}

interface UserInvitationVerificationRow extends UserInvitation {
  tenant: string;
  role_name?: string | null;
}

export interface UserTokenVerificationResult {
  valid: boolean;
  tenant?: string;
  invitee?: {
    email: string;
    first_name: string;
    last_name: string;
    role_id: string | null;
    role_name: string | null;
  };
  invitation?: UserInvitation;
  error?: string;
  errorCode?: 'INVALID_OR_EXPIRED_TOKEN' | 'VERIFICATION_FAILED';
}

const USER_INVITATION_TENANT_DISCOVERY = 'tenant-discovery';

/**
 * Email-invitation flow for internal (MSP) team members, mirroring
 * PortalInvitationService but targeting a not-yet-created `users` row
 * (email/first_name/last_name/role_id instead of a contact_id).
 */
export class UserInvitationService {
  static generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new team invitation within a transaction.
   */
  static async createInvitationWithTransaction(
    params: { email: string; firstName: string; lastName: string; roleId: string | null },
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

      const tenant = await requireTenantId(trx);

      const rateLimitResult = await checkPortalInvitationLimit(`internal:${user.user_id}`);
      if (!rateLimitResult.success) {
        const errorMessage = await formatRateLimitError(rateLimitResult.msBeforeNext);
        return { success: false, error: errorMessage };
      }

      const token = this.generateSecureToken();
      const normalizedEmail = params.email.toLowerCase();

      // Reuse an existing active invitation for the same email to allow
      // resending without erroring.
      const existingInvitation = await tenantDb(trx, tenant).table('user_invitations')
        .where({ email: normalizedEmail, used_at: null })
        .where('expires_at', '>', trx.fn.now())
        .first();

      if (existingInvitation) {
        return {
          success: true,
          invitationId: existingInvitation.invitation_id,
          token: existingInvitation.token
        };
      }

      const [invitation] = await tenantDb(trx, tenant).table('user_invitations')
        .insert({
          tenant,
          email: normalizedEmail,
          first_name: params.firstName,
          last_name: params.lastName,
          role_id: params.roleId,
          token,
          // Use DB time for expiration: now() + 24 hours
          expires_at: trx.raw("now() + interval '24 hours'"),
          metadata: {
            created_by: user.user_id,
            invited_by_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username
          }
        })
        .returning(['invitation_id', 'token']);

      return {
        success: true,
        invitationId: invitation.invitation_id,
        token: invitation.token
      };
    } catch (error) {
      console.error('Error creating team invitation:', error);
      return { success: false, error: 'Failed to create invitation' };
    }
  }

  /**
   * Verify a team invitation token. Discovers the owning tenant from the
   * token itself, same as portal invitations.
   */
  static async verifyToken(token: string): Promise<UserTokenVerificationResult> {
    try {
      const { knex } = await createTenantKnex();

      return await withTransaction(knex, async (trx) => {
        const tokenInfo = await tenantDb(trx, USER_INVITATION_TENANT_DISCOVERY)
          .unscoped('user_invitations', 'tenant discovery from user invitation token')
          .where({ token, used_at: null })
          .where('expires_at', '>', trx.fn.now())
          .select('tenant')
          .first();

        if (!tokenInfo) {
          return {
            valid: false,
            error: 'Invalid or expired invitation token',
            errorCode: 'INVALID_OR_EXPIRED_TOKEN' as const
          };
        }

        const tokenTenant = tokenInfo.tenant;

        // Clean up expired tokens for this tenant (single-shard query)
        await tenantDb(trx, tokenTenant).table('user_invitations')
          .where('expires_at', '<', trx.fn.now())
          .del();

        const scopedDb = tenantDb(trx, tokenTenant);
        const invitationQuery = scopedDb.table('user_invitations as ui');
        scopedDb.tenantJoin(invitationQuery, 'roles as r', 'ui.role_id', 'r.role_id', { type: 'left' });

        const invitation = await invitationQuery
          .where({ 'ui.token': token, 'ui.used_at': null })
          .where('ui.expires_at', '>', trx.fn.now())
          .select('ui.*', 'r.role_name')
          .first() as UserInvitationVerificationRow | undefined;

        if (!invitation) {
          return {
            valid: false,
            error: 'Invalid or expired invitation token',
            errorCode: 'INVALID_OR_EXPIRED_TOKEN' as const
          };
        }

        return {
          valid: true,
          tenant: invitation.tenant,
          invitee: {
            email: invitation.email,
            first_name: invitation.first_name,
            last_name: invitation.last_name,
            role_id: invitation.role_id,
            role_name: invitation.role_name ?? null
          },
          invitation: {
            invitation_id: invitation.invitation_id,
            email: invitation.email,
            first_name: invitation.first_name,
            last_name: invitation.last_name,
            role_id: invitation.role_id,
            token: invitation.token,
            expires_at: invitation.expires_at,
            created_at: invitation.created_at,
            used_at: invitation.used_at,
            metadata: invitation.metadata
          }
        };
      });
    } catch (error) {
      console.error('Error verifying team invitation token:', error);
      return {
        valid: false,
        error: 'Failed to verify token',
        errorCode: 'VERIFICATION_FAILED'
      };
    }
  }

  static async markTokenAsUsed(token: string): Promise<boolean> {
    try {
      const { knex } = await createTenantKnex();
      const tenant = await requireTenantId(knex);

      return await withTransaction(knex, async (trx) => {
        const updateCount = await tenantDb(trx, tenant).table('user_invitations')
          .where({ token, used_at: null })
          .update({ used_at: trx.fn.now() });

        return updateCount > 0;
      });
    } catch (error) {
      console.error('Error marking team invitation token as used:', error);
      return false;
    }
  }

  static async getInvitationHistory(): Promise<UserInvitation[]> {
    try {
      const { knex } = await createTenantKnex();
      const tenant = await requireTenantId(knex);

      return await tenantDb(knex, tenant).table('user_invitations')
        .orderBy('created_at', 'desc')
        .select('*') as UserInvitation[];
    } catch (error) {
      console.error('Error fetching team invitation history:', error);
      return [];
    }
  }

  static async revokeInvitation(invitationId: string): Promise<boolean> {
    try {
      const { knex } = await createTenantKnex();
      const tenant = await requireTenantId(knex);

      const updateCount = await tenantDb(knex, tenant).table('user_invitations')
        .where({ invitation_id: invitationId, used_at: null })
        .update({
          used_at: knex.fn.now(),
          metadata: knex.raw('metadata || ?', [JSON.stringify({ revoked: true, revoked_at: new Date().toISOString() })])
        });

      return updateCount > 0;
    } catch (error) {
      console.error('Error revoking team invitation:', error);
      return false;
    }
  }

  static async cleanupExpiredTokens(trx?: Knex.Transaction): Promise<number> {
    try {
      const { knex } = await createTenantKnex();
      const tenant = await requireTenantId(trx ?? knex);

      const cleanup = async (tx: Knex.Transaction) => {
        const deletedRows = await tenantDb(tx, tenant).table('user_invitations')
          .where('expires_at', '<', tx.fn.now())
          .del();

        return deletedRows || 0;
      };

      return trx ? cleanup(trx) : withTransaction(knex, cleanup);
    } catch (error) {
      console.error('Error cleaning up expired team invitation tokens:', error);
      return 0;
    }
  }
}
