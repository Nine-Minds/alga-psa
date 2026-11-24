import { createTenantKnex, tenantDb, requireTenantId } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { checkPortalInvitationLimit, formatRateLimitError } from '@alga-psa/auth';
import crypto from 'crypto';
import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import {
  invitationAddressBelongsToContact,
  invitationRefusedAtUseTime,
  normalizedInvitationAddressSql,
} from '../lib/portalInvitationStateQuery';

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

/**
 * A history row with the contact's own standing attached, so the reader can
 * apply the same refusals verifyToken applies to the link itself.
 */
export interface PortalInvitationHistoryRow extends PortalInvitation {
  contact_email: string | null;
  /** Every address the contact can receive at, its primary one first. */
  contact_emails: Array<string | null>;
  contact_inactive: boolean | null;
}

interface PortalInvitationVerificationRow extends PortalInvitation {
  tenant: string;
  full_name: string;
  contact_email: string;
  contact_inactive?: boolean | null;
  /**
   * The contact's additional address that the invitation was mailed to, or NULL
   * when none of them is. The join below narrows the contact's additional
   * addresses to the single one that could match, so the address set this row
   * carries is "primary, plus the one additional address that is the same
   * mailbox" — all `invitationAddressBelongsToContact` needs to decide.
   */
  matched_additional_email?: string | null;
  client_name?: string | null;
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
  errorCode?: 'INVALID_OR_EXPIRED_TOKEN' | 'VERIFICATION_FAILED';
}

const PORTAL_INVITATION_TENANT_DISCOVERY = 'tenant-discovery';

/**
 * How long an expired invitation is kept before it is deleted. Expiry is a
 * state the MSP has to be able to see ("who never used their invitation?"), so
 * rows are retained well past it instead of being swept the moment they lapse.
 */
const PORTAL_INVITATION_RETENTION_DAYS = 90;

/**
 * How many rows the per-contact history returns. Retaining lapsed invitations
 * means a contact can carry a run of them, and the tab that shows this asks for
 * "recent portal invitations", so the read is bounded rather than open-ended.
 */
const PORTAL_INVITATION_HISTORY_LIMIT = 50;

export class PortalInvitationService {
  /**
   * Generate a cryptographically secure token
   */
  static generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Every address this contact can receive at: its primary, then each of its
   * additional ones.
   *
   * "Whose address is this?" is answered product-wide by primary ∪ additional
   * (`ContactModel.getContactByEmail`, inbound email→contact matching, comment
   * recipients), so an invitation mailed to an address the MSP later kept as an
   * additional address is still this contact's own link. Scoped like every other
   * read here; the table is distributed by tenant.
   */
  static async resolveContactAddresses(
    db: Knex | Knex.Transaction,
    tenant: string,
    contactId: string,
    primaryEmail: string | null | undefined
  ): Promise<Array<string | null>> {
    const additional = await tenantDb(db, tenant).table('contact_additional_email_addresses')
      .where({ contact_name_id: contactId })
      .select('email_address') as Array<{ email_address: string | null }>;

    return [primaryEmail ?? null, ...additional.map((row) => row.email_address)];
  }

  /**
   * Create a portal invitation for a contact, or renew the one it already has.
   *
   * `validityDays` is the tenant's resolved setting, and the expiry is computed
   * in the database (`now() + make_interval`) to avoid timezone/DST drift. A
   * resend reuses the active invitation's token but resets its expiry to the
   * full period, so every link the contact was ever mailed stays valid and
   * agrees with the period the email states — as long as the address it was
   * mailed to is still the contact's. When it is not, the stale invitation is
   * revoked and a fresh token is issued instead.
   */
  static async createInvitationWithTransaction(
    contactId: string,
    trx: Knex.Transaction,
    validityDays: number
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

      // Check rate limit
      const rateLimitResult = await checkPortalInvitationLimit(contactId);
      if (!rateLimitResult.success) {
        const errorMessage = await formatRateLimitError(rateLimitResult.msBeforeNext);
        return { success: false, error: errorMessage };
      }

      // Verify contact exists and is a portal admin (using transaction)
      const contact = await tenantDb(trx, tenant).table('contacts')
        .where({ contact_name_id: contactId })
        .first();

      if (!contact) {
        return { success: false, error: 'Contact not found' };
      }

      // Allow inviting any contact (not limited to client admins)

      // Generate secure token
      const token = this.generateSecureToken();
      const expiresAt = trx.raw('now() + make_interval(days => ?)', [validityDays]);

      // Check if there's already an active invitation (using transaction)
      const existingInvitation = await tenantDb(trx, tenant).table('portal_invitations')
        .where({
          contact_id: contactId,
          used_at: null
        })
        .where('expires_at', '>', trx.fn.now())
        .first();

      if (existingInvitation) {
        const contactAddresses = await this.resolveContactAddresses(trx, tenant, contactId, contact.email);

        if (invitationAddressBelongsToContact(existingInvitation.email, contactAddresses)) {
          // Resending renews the link the contact already holds: without this a
          // resend on the last day would mail a link that dies within hours
          // while the email promises the full period. The resend is recorded on
          // the row it renews — otherwise the Portal tab's history would keep
          // showing only the original send date — and the stored address follows
          // the address this send is actually going to, which is the contact's
          // current primary one.
          const resendCount = Number(existingInvitation.metadata?.resend_count ?? 0) + 1;
          await tenantDb(trx, tenant).table('portal_invitations')
            .where({ invitation_id: existingInvitation.invitation_id, used_at: null })
            .update({
              expires_at: expiresAt,
              email: contact.email,
              metadata: trx.raw("coalesce(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify({
                last_sent_at: new Date().toISOString(),
                last_sent_by: user.user_id,
                resend_count: resendCount
              })])
            });

          return {
            success: true,
            invitationId: existingInvitation.invitation_id,
            token: existingInvitation.token
          };
        }

        // The address this invitation was mailed to is none of the contact's any
        // more, so the copy of the link sitting in that mailbox is not theirs to
        // open: a contact first entered as jon@acme.com and corrected to
        // john@acme.com would otherwise have the original token renewed for the
        // tenant's full validity on every resend, and whoever reads jon@ could
        // set the password and own John's portal account. Revoke the stale row
        // and issue a fresh token below, so only the new mail can be used.
        await tenantDb(trx, tenant).table('portal_invitations')
          .where({ invitation_id: existingInvitation.invitation_id, used_at: null })
          .update({
            used_at: trx.fn.now(),
            metadata: trx.raw("coalesce(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify({
              revoked: true,
              revoked_at: new Date().toISOString(),
              revoked_by: user.user_id,
              revoked_reason: 'email_changed'
            })])
          });
      }

      // Create invitation record (using transaction)
      const [invitation] = await tenantDb(trx, tenant).table('portal_invitations')
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
      const { knex } = await createTenantKnex();

      // Use withTransaction helper for proper connection management
      return await withTransaction(knex, async (trx) => {
        // First, find the invitation to get its tenant
        // This initial query needs to scan all shards, but it's necessary
        // to determine which tenant the token belongs to
        const tokenInfo = await tenantDb(trx, PORTAL_INVITATION_TENANT_DISCOVERY)
          .unscoped('portal_invitations', 'tenant discovery from portal invitation token')
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
            error: 'Invalid or expired invitation token',
            errorCode: 'INVALID_OR_EXPIRED_TOKEN'
          };
        }

        const tokenTenant = tokenInfo.tenant;

        // Clean up long-expired tokens for this tenant (single-shard query).
        // Only rows past the retention floor: a lapsed invitation is what the
        // MSP's "expired" view is made of.
        await tenantDb(trx, tokenTenant).table('portal_invitations')
          .where('expires_at', '<', trx.raw('now() - make_interval(days => ?)', [PORTAL_INVITATION_RETENTION_DAYS]))
          .del();
        
        // Now fetch the full invitation with joins (single-shard query)
        const scopedDb = tenantDb(trx, tokenTenant);
        const invitationQuery = scopedDb.table('portal_invitations as pi');
        scopedDb.tenantJoin(invitationQuery, 'contacts as c', 'pi.contact_id', 'c.contact_name_id');
        scopedDb.tenantJoin(invitationQuery, 'clients as comp', 'c.client_id', 'comp.client_id', { type: 'left' });
        // Whether the address this link was mailed to is still one of the
        // contact's own is decided below, and "the contact's own" is primary ∪
        // additional. The additional ones ride along on the row the token
        // already fetches — narrowed in the join to the single address that
        // could be the same mailbox — rather than in a second query: one
        // round trip on the setup page's hot path, and the contact's rows stay
        // reached the way this unauthenticated path has always reached them,
        // through the token's own invitation row.
        scopedDb.tenantJoin(
          invitationQuery,
          'contact_additional_email_addresses as cea',
          'cea.contact_name_id',
          'c.contact_name_id',
          {
            type: 'left',
            on: (join) => {
              join.andOn(trx.raw(
                `${normalizedInvitationAddressSql('cea.email_address')} = ${normalizedInvitationAddressSql('pi.email')}`
              ));
            }
          }
        );

        const invitation = await invitationQuery
          .where({
            'pi.token': token,
            'pi.used_at': null
          })
          .where('pi.expires_at', '>', trx.fn.now())
          .select(
            'pi.*',
            'c.full_name',
            'c.email as contact_email',
            // contacts.is_inactive is nullable, and a NULL row is an active
            // contact — comparing it to false would refuse it for ever.
            trx.raw('coalesce(c.is_inactive, false) as contact_inactive'),
            'cea.email_address as matched_additional_email',
            'comp.client_name'
          )
          .first() as PortalInvitationVerificationRow | undefined;

        if (!invitation) {
          return {
            valid: false,
            error: 'Invalid or expired invitation token',
            errorCode: 'INVALID_OR_EXPIRED_TOKEN'
          };
        }

        // An unused link outlives the contact it was written for: with a
        // multi-day validity it can still be in a mailbox after the contact was
        // deactivated or moved to another address. Both are refused at use time
        // rather than by rewriting stored rows, so the recipient sees the same
        // generic invalid-or-expired message. The address is judged against
        // every address the contact can receive at, exactly as the MSP's
        // "pending/expired" column judges it — one rule, so the contact list,
        // the Portal tab and this page cannot disagree about one link. The
        // verdict stays in `invitationRefusedAtUseTime`: the join above only
        // narrows the additional addresses to the one candidate, with the same
        // normalization this rule applies.
        const contactAddresses = [invitation.contact_email, invitation.matched_additional_email ?? null];
        if (invitationRefusedAtUseTime({
          contactInactive: invitation.contact_inactive,
          contactEmails: contactAddresses,
          invitationEmail: invitation.email
        })) {
          return {
            valid: false,
            error: 'Invalid or expired invitation token',
            errorCode: 'INVALID_OR_EXPIRED_TOKEN'
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
      return {
        valid: false,
        error: 'Failed to verify token',
        errorCode: 'VERIFICATION_FAILED'
      };
    }
  }

  /**
   * Mark a token as used
   */
  static async markTokenAsUsed(token: string): Promise<boolean> {
    try {
      const { knex } = await createTenantKnex();
      const tenant = await requireTenantId(knex);

      // Use withTransaction helper for proper connection management
      return await withTransaction(knex, async (trx) => {
        const updateCount = await tenantDb(trx, tenant).table('portal_invitations')
          .where({
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
   * Get invitation history for a contact.
   *
   * Carries the contact's current address and active flag alongside each row:
   * verifyToken refuses a link whose contact was deactivated or whose address
   * moved on, and the history is where the MSP decides whether a contact still
   * owes the portal a visit. Without these two columns the tab would count down
   * the expiry of a link the setup page already refuses.
   */
  static async getInvitationHistory(contactId: string): Promise<PortalInvitationHistoryRow[]> {
    try {
      const { knex } = await createTenantKnex();
      const tenant = await requireTenantId(knex);

      const scopedDb = tenantDb(knex, tenant);
      const query = scopedDb.table('portal_invitations as pi');
      scopedDb.tenantJoin(query, 'contacts as c', 'pi.contact_id', 'c.contact_name_id', { type: 'left' });

      const invitations = await query
        .where('pi.contact_id', contactId)
        .orderBy('pi.created_at', 'desc')
        .limit(PORTAL_INVITATION_HISTORY_LIMIT)
        .select('pi.*')
        .select('c.email as contact_email')
        // contacts.is_inactive is nullable, and a NULL row is an active contact.
        .select(knex.raw('coalesce(c.is_inactive, false) as contact_inactive')) as PortalInvitationHistoryRow[];

      if (invitations.length === 0) {
        return invitations;
      }

      // The reader asks "would this link still work?", and an address the
      // contact kept as an additional one still reaches them — so every row
      // carries the whole address set the verify path judges against, read once
      // for the contact rather than once per row.
      const contactAddresses = await this.resolveContactAddresses(
        knex,
        tenant,
        contactId,
        invitations[0].contact_email
      );

      return invitations.map((invitation) => ({ ...invitation, contact_emails: contactAddresses }));

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
      const { knex } = await createTenantKnex();
      const tenant = await requireTenantId(knex);

      const updateCount = await tenantDb(knex, tenant).table('portal_invitations')
        .where({
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
   * Delete invitations that expired longer ago than the retention floor.
   *
   * Everything between expiry and the floor is kept on purpose: the MSP's
   * contact list and the contact's Portal tab report an unused invitation as
   * expired, and that state has to survive the next portal setup in the tenant.
   * @param trx - Optional transaction to use for cleanup
   */
  static async cleanupExpiredTokens(trx?: Knex.Transaction): Promise<number> {
    try {
      const { knex } = await createTenantKnex();
      const tenant = await requireTenantId(trx ?? knex);

      // Use provided transaction or create a new one
      const cleanup = async (tx: Knex.Transaction) => {
        // Delete long-expired tokens for this tenant only (single-shard query)
        const deletedRows = await tenantDb(tx, tenant).table('portal_invitations')
          .where('expires_at', '<', tx.raw('now() - make_interval(days => ?)', [PORTAL_INVITATION_RETENTION_DAYS]))
          .del();
        
        const deletedCount = deletedRows || 0;
        
        if (deletedCount > 0) {
          console.log(`Cleaned up ${deletedCount} expired portal invitation tokens for tenant ${tenant}`);
          
          // Log to audit_logs if needed
          await tenantDb(tx, tenant).table('audit_logs').insert({
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
