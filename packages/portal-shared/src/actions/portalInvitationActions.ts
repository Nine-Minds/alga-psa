'use server'

import { createTenantKnex, tenantDb, runWithTenant } from '@alga-psa/db';
import { PortalInvitationService } from '../services/PortalInvitationService';
import { getTenantSlugForTenant } from '@alga-psa/db';
import { getPortalDomainStatusForTenant } from '@alga-psa/tenancy/server';
import { getSystemEmailService, TenantEmailService, sendPortalInvitationEmail } from '@alga-psa/email';
import { UserService } from '@alga-psa/users';
import { runAsSystem, createSystemContext } from '@alga-psa/db';
import { hasPermission, withAuth, type AuthContext } from '@alga-psa/auth';
import { isValidEmail } from '@alga-psa/core';
import type { IUserWithRoles, IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import type {
  SendInvitationResult,
  VerifyTokenResult,
  CompleteSetupResult,
  InvitationHistoryItem,
  CreateClientPortalUserParams,
  PortalInvitationErrorCode,
  ClientUserActionError,
} from '../types';

class PortalInvitationError extends Error {
  constructor(message: string, public readonly errorCode: PortalInvitationErrorCode) {
    super(message);
    this.name = 'PortalInvitationError';
  }
}

function normalizeCreateClientPortalUserError(
  error: unknown
): { message: string; errorCode: PortalInvitationErrorCode } {
  if (error instanceof PortalInvitationError) {
    return { message: error.message, errorCode: error.errorCode };
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23505') {
    return {
      message: 'A portal user already exists for this contact or email address',
      errorCode: 'PORTAL_USER_ALREADY_EXISTS'
    };
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message === 'Tenant is required') {
      return { message: 'Tenant context is required', errorCode: 'TENANT_CONTEXT_REQUIRED' };
    }
    if (message === 'Contact not found. Provide contact details to create a new contact.') {
      return { message, errorCode: 'CONTACT_NOT_FOUND' };
    }
    if (message === 'A user account already exists for this contact') {
      return { message, errorCode: 'USER_EXISTS_FOR_CONTACT' };
    }
    if (
      message === 'A user with this email already exists in this organization' ||
      message === 'A user with this username already exists in this organization'
    ) {
      return { message, errorCode: 'PORTAL_USER_ALREADY_EXISTS' };
    }
    if (
      message === 'A user with this email address already exists' ||
      message === 'A user with this username already exists for this user type' ||
      message === 'One or more invalid role IDs provided' ||
      message.startsWith('Password must be') ||
      message.startsWith('Username must be') ||
      message === 'Valid email is required'
    ) {
      return { message, errorCode: 'CREATE_USER_FAILED' };
    }
  }

  return { message: 'Failed to create client portal user', errorCode: 'CREATE_USER_FAILED' };
}

function normalizeSendPortalInvitationError(
  error: unknown
): { message?: string; errorCode: PortalInvitationErrorCode } {
  if (error instanceof PortalInvitationError) {
    return { message: error.message.trim() || undefined, errorCode: error.errorCode };
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message === 'Unauthorized') {
      return {
        message: 'Permission denied: Cannot invite users',
        errorCode: 'PERMISSION_DENIED_INVITE'
      };
    }
    if (message === 'Tenant is required') {
      return { message: 'Tenant context is required', errorCode: 'TENANT_CONTEXT_REQUIRED' };
    }
    if (message === 'Contact not found') {
      return { message, errorCode: 'CONTACT_NOT_FOUND' };
    }
    if (message.startsWith('Too many attempts.')) {
      return { message, errorCode: 'INVITATION_FAILED' };
    }
    if (message === 'Failed to create invitation') {
      return { errorCode: 'INVITATION_FAILED' };
    }
  }

  return { errorCode: 'INVITATION_FAILED' };
}

type DbConnection = Knex | Knex.Transaction;

interface PortalContactAuthContext {
  contact_name_id: string;
  client_id: string | null;
  is_client_admin?: boolean;
}

function isClientPortalUser(user: IUserWithRoles): boolean {
  return user.user_type === 'client';
}

function isMspUser(user: IUserWithRoles): boolean {
  return user.user_type === 'internal';
}

async function getContactAuthContext(
  db: DbConnection,
  tenant: string,
  contactId: string
): Promise<PortalContactAuthContext | null> {
  const contact = await tenantDb(db, tenant).table('contacts')
    .select('contact_name_id', 'client_id', 'is_client_admin')
    .where({ contact_name_id: contactId })
    .first();

  return contact ?? null;
}

async function getClientPortalActorContact(
  user: IUserWithRoles,
  tenant: string,
  db: DbConnection
): Promise<PortalContactAuthContext | null> {
  if (!isClientPortalUser(user) || !user.contact_id) {
    return null;
  }

  return getContactAuthContext(db, tenant, user.contact_id);
}

async function canManageClientPortalTargetClient(
  user: IUserWithRoles,
  tenant: string,
  db: DbConnection,
  action: 'read' | 'create' | 'update' | 'invite',
  targetClientId: string | null
): Promise<boolean> {
  const canUseAction = await hasPermission(user, 'user', action, db);
  if (!canUseAction) {
    return false;
  }

  if (isMspUser(user)) {
    return true;
  }

  if (!isClientPortalUser(user) || !targetClientId) {
    return false;
  }

  const actorContact = await getClientPortalActorContact(user, tenant, db);
  return !!actorContact?.is_client_admin && actorContact.client_id === targetClientId;
}

async function canManageClientPortalTargetContact(
  user: IUserWithRoles,
  tenant: string,
  db: DbConnection,
  action: 'read' | 'create' | 'update' | 'invite',
  targetContactId: string
): Promise<boolean> {
  const targetContact = await getContactAuthContext(db, tenant, targetContactId);
  return canManageClientPortalTargetClient(
    user,
    tenant,
    db,
    action,
    targetContact?.client_id ?? null
  );
}

async function resolveInvitationTargetClientId(
  db: DbConnection,
  tenant: string,
  invitationId: string
): Promise<string | null | undefined> {
  const scopedDb = tenantDb(db, tenant);
  const invitationQuery = scopedDb.table('portal_invitations as pi')
    .where({
      'pi.invitation_id': invitationId
    })
    .select('c.client_id')
    .first();
  scopedDb.tenantJoin(invitationQuery, 'contacts as c', 'pi.contact_id', 'c.contact_name_id', { type: 'left' });
  const invitation = await invitationQuery as { client_id?: string | null } | undefined;

  if (!invitation) {
    return undefined;
  }

  return invitation.client_id ?? null;
}

async function resolveClientUserTargetClientId(
  db: DbConnection,
  tenant: string,
  userId: string
): Promise<string | null | undefined> {
  const scopedDb = tenantDb(db, tenant);
  const targetUserQuery = scopedDb.table('users as u')
    .where({
      'u.user_id': userId,
      'u.user_type': 'client'
    })
    .select('c.client_id')
    .first();
  scopedDb.tenantJoin(targetUserQuery, 'contacts as c', 'u.contact_id', 'c.contact_name_id', { type: 'left' });
  const targetUser = await targetUserQuery as { client_id?: string | null } | undefined;

  if (!targetUser) {
    return undefined;
  }

  return targetUser.client_id ?? null;
}

export const createClientPortalUser = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  params: CreateClientPortalUserParams
): Promise<{ success: boolean; userId?: string; message?: string; error?: string; errorCode?: PortalInvitationErrorCode }> => {
  try {
    const { knex } = await createTenantKnex();

    const normalizedContactClientId = params.contact?.clientId && params.contact.clientId.trim() !== '' ? params.contact.clientId : null;
    const existingContactForAuth = params.contactId
      ? await getContactAuthContext(knex, tenant, params.contactId)
      : null;
    const targetClientIdForAuth = existingContactForAuth?.client_id ?? normalizedContactClientId;

    const canCreate = await canManageClientPortalTargetClient(
      user,
      tenant,
      knex,
      'create',
      targetClientIdForAuth
    );
    if (!canCreate) {
      return {
        success: false,
        error: 'Permission denied: Cannot create users',
        errorCode: 'PERMISSION_DENIED_CREATE'
      };
    }

    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Validate input
    if (!params?.password || params.password.length < 8) {
      return {
        success: false,
        error: 'Password must be at least 8 characters long',
        errorCode: 'PASSWORD_TOO_SHORT'
      };
    }

    // Create user and assign role
    const result = await knex.transaction(async (trx) => {
      const scopedDb = tenantDb(trx, tenant);

      // 1) Resolve or create contact
      let contact: any = null;

      if (params.contactId) {
        contact = await scopedDb.table('contacts')
          .where({ contact_name_id: params.contactId })
          .first();
        if (!contact && params.contact) {
          // Create new contact since provided ID not found and details are available
          const normalizedClientId = params.contact.clientId && params.contact.clientId.trim() !== '' ? params.contact.clientId : null
          const [createdContact] = await scopedDb.table('contacts')
            .insert({
              tenant,
              contact_name_id: trx.raw('gen_random_uuid()'),
              full_name: params.contact.fullName,
              email: params.contact.email.toLowerCase(),
              client_id: normalizedClientId,
              is_client_admin: !!params.contact.isClientAdmin,
              is_inactive: false,
              created_at: trx.raw('now()'),
              updated_at: trx.raw('now()')
            })
            .returning('*');
          contact = createdContact;
        }
      }

      if (!contact && params.contact) {
        // Try to find by email + client; else create
        const normalizedClientId = params.contact.clientId && params.contact.clientId.trim() !== '' ? params.contact.clientId : null;
        const q = scopedDb.table('contacts')
          .where({ email: params.contact.email.toLowerCase() });
        if (normalizedClientId) {
          q.andWhere('client_id', normalizedClientId);
        } else {
          q.whereNull('client_id');
        }
        contact = await q.first();
        if (!contact) {
          const [createdContact] = await scopedDb.table('contacts')
            .insert({
              tenant,
              contact_name_id: trx.raw('gen_random_uuid()'),
              full_name: params.contact.fullName,
              email: params.contact.email.toLowerCase(),
              client_id: normalizedClientId,
              is_client_admin: !!params.contact.isClientAdmin,
              is_inactive: false,
              created_at: trx.raw('now()'),
              updated_at: trx.raw('now()')
            })
            .returning('*');
          contact = createdContact;
        }
      }

      if (!contact) {
        // Could not resolve contact
        throw new Error('Contact not found. Provide contact details to create a new contact.');
      }

      // Validate the resolved contact's email before creating the user account.
      // Throwing here also rolls back a contact inserted above with a bad email.
      const contactEmail = typeof contact.email === 'string' ? contact.email.trim() : '';
      if (!contactEmail) {
        throw new PortalInvitationError(
          'Contact does not have an email address. Please add an email address to the contact before creating a portal user.',
          'CONTACT_MISSING_EMAIL'
        );
      }
      if (!isValidEmail(contactEmail)) {
        throw new PortalInvitationError(
          'Contact has an invalid email address. Please update the contact with a valid email address before creating a portal user.',
          'CONTACT_INVALID_EMAIL'
        );
      }

      // 2) Ensure no existing user for contact
      const existingUser = await scopedDb.table('users')
        .where({ contact_id: contact.contact_name_id })
        .first();
      if (existingUser) {
        throw new Error('A user account already exists for this contact');
      }

      // 3) Create user
      const nameParts = (contact.full_name || '').trim().split(' ');
      const firstName = nameParts[0] || contact.full_name || contact.email;
      const lastName = nameParts.slice(1).join(' ') || undefined;

      // Enforce uniqueness across tenant (regardless of user_type)
      const existingByEmailAnyType = await scopedDb.table('users')
        .where('email', contact.email.toLowerCase())
        .first();
      if (existingByEmailAnyType) {
        throw new Error('A user with this email already exists in this organization');
      }
      const existingByUsernameAnyType = await scopedDb.table('users')
        .where('username', contact.email)
        .first();
      if (existingByUsernameAnyType) {
        throw new Error('A user with this username already exists in this organization');
      }

      // 3a) Insert user within the same transaction to satisfy FK on (tenant, contact_id)
      const { hashPassword } = await import('@alga-psa/core/encryption');
      const hashedPassword = await hashPassword(params.password);
      const [created] = await scopedDb.table('users')
        .insert({
          tenant,
          user_id: trx.raw('gen_random_uuid()'),
          username: contact.email.toLowerCase(),
          email: contact.email.toLowerCase(),
          first_name: firstName,
          last_name: lastName,
          phone: null,
          timezone: null,
          hashed_password: hashedPassword,
          user_type: 'client',
          contact_id: contact.contact_name_id,
          is_inactive: false,
          two_factor_enabled: false,
          is_google_user: false,
          created_at: trx.raw('now()'),
          updated_at: trx.raw('now()')
        })
        .returning('*');

      // 4) Assign role (prefer UI-selected roleId; fallback to contact's admin flag)
      let targetRoleId: string | undefined = undefined;
      if (params.roleId) {
        const uiRole = await scopedDb.table('roles')
          .where({ role_id: params.roleId, client: true })
          .first();
        if (uiRole) {
          targetRoleId = uiRole.role_id;
        }
      }
      if (!targetRoleId) {
        // Use actual role names from seeds: "Admin" or "User"
        const roleName = contact?.is_client_admin ? 'Admin' : 'User';
        const fallbackRole = await scopedDb.table('roles')
          .where({ role_name: roleName, client: true })
          .first();
        if (fallbackRole) {
          targetRoleId = fallbackRole.role_id;
        } else {
          console.warn(`Failed to find client role with name '${roleName}' for tenant ${tenant}`);
        }
      }
      if (targetRoleId) {
        await scopedDb.table('user_roles').insert({ user_id: created.user_id, role_id: targetRoleId, tenant });
      }

      // 5) Set password-related preferences
      try {
        const UserPreferences = await import('@alga-psa/db').then(m => m.UserPreferences);
        if (params.requirePasswordChange) {
          // Force change on first login
          await UserPreferences.upsert(trx, {
            user_id: created.user_id,
            setting_name: 'must_change_password',
            setting_value: true,
            updated_at: new Date()
          });
          await UserPreferences.upsert(trx, {
            user_id: created.user_id,
            setting_name: 'has_reset_password',
            setting_value: false,
            updated_at: new Date()
          });
        } else {
          await UserPreferences.upsert(trx, {
            user_id: created.user_id,
            setting_name: 'has_reset_password',
            setting_value: true,
            updated_at: new Date()
          });
        }
      } catch {}

      return created as any;
    });

    return { success: true, userId: result.user_id, message: 'Client portal user created' };
  } catch (error) {
    console.error('Error creating client portal user:', error);
    const normalized = normalizeCreateClientPortalUserError(error);
    return { success: false, error: normalized.message, errorCode: normalized.errorCode };
  }
});

/**
 * Send a portal invitation to a contact
 */
export const sendPortalInvitation = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  contactId: string
): Promise<SendInvitationResult> => {
  try {
    const { knex } = await createTenantKnex();

    const canInvite = await canManageClientPortalTargetContact(user, tenant, knex, 'invite', contactId);
    if (!canInvite) {
      return {
        success: false,
        error: 'Permission denied: Cannot invite users',
        errorCode: 'PERMISSION_DENIED_INVITE'
      };
    }

    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Ensure at least one email path is configured before proceeding
    const tenantEmailService = TenantEmailService.getInstance(tenant);
    let emailConfigured = await tenantEmailService.isConfigured();

    if (!emailConfigured) {
      const systemEmailService = await getSystemEmailService();
      emailConfigured = await systemEmailService.isConfigured();
      if (!emailConfigured) {
        // If a provider was configured but failed to initialize (e.g. an SMTP
        // auth/TLS error), report the real cause instead of "disabled".
        const initError = await tenantEmailService.getInitializationError();
        return {
          success: false,
          error: initError
            ? `Email provider not ready: ${initError}`
            : 'Email service is disabled or not configured',
          errorCode: 'EMAIL_NOT_CONFIGURED'
        };
      }
    }

    // Get contact details
    const contact = await tenantDb(knex, tenant).table('contacts')
      .where({ contact_name_id: contactId })
      .first();

    if (!contact) {
      return { success: false, error: 'Contact not found', errorCode: 'CONTACT_NOT_FOUND' };
    }

    // Validate contact has an email address
    if (!contact.email || contact.email.trim() === '') {
      return {
        success: false,
        error: 'Contact does not have an email address. Please add an email address to the contact before sending an invitation.',
        errorCode: 'CONTACT_MISSING_EMAIL'
      };
    }

    // Validate email format using shared validator
    if (!isValidEmail(contact.email.trim())) {
      return {
        success: false,
        error: 'Contact has an invalid email address. Please update the contact with a valid email address before sending an invitation.',
        errorCode: 'CONTACT_INVALID_EMAIL'
      };
    }

    // Do not send invitations for contacts that already have a portal user
    const existingUserForContact = await tenantDb(knex, tenant).table('users')
      .where({ contact_id: contactId })
      .first();

    if (existingUserForContact) {
      return {
        success: false,
        error: 'A user account already exists for this contact. Use password reset instead of sending an invitation.',
        errorCode: 'USER_EXISTS_FOR_CONTACT'
      };
    }

    // Use a transaction to ensure atomicity
    const result = await knex.transaction(async (trx) => {
      const scopedDb = tenantDb(trx, tenant);

      // Create invitation within transaction
      const invitationResult = await PortalInvitationService.createInvitationWithTransaction(contactId, trx);
      if (!invitationResult.success) {
        throw new PortalInvitationError(
          invitationResult.error || 'Portal invitation could not be created. Please try again.',
          'INVITATION_FAILED'
        );
      }

      // Get the tenant's default client (MSP client) for reply-to email
      const tenantDefaultClientQuery = scopedDb.table('tenant_companies')
        .where({ 
          'tenant_companies.is_default': true 
        })
        .select('clients.*')
        .first();
      scopedDb.tenantJoin(tenantDefaultClientQuery, 'clients', 'clients.client_id', 'tenant_companies.client_id');
      const tenantDefaultClient = await tenantDefaultClientQuery as any;
      
      if (!tenantDefaultClient) {
        throw new PortalInvitationError(
          'No default client configured for this tenant. Please set a default client in General Settings.',
          'NO_DEFAULT_CLIENT'
        );
      }
      
      // Get MSP client's default location for reply-to email
      const mspLocation = await scopedDb.table('client_locations')
        .where({ 
          client_id: tenantDefaultClient.client_id,
          is_default: true,
          is_active: true
        })
        .first();
      
      if (!mspLocation) {
        throw new PortalInvitationError(
          'Default client must have a default location configured to send portal invitations',
          'NO_DEFAULT_LOCATION'
        );
      }

      if (!mspLocation.email) {
        throw new PortalInvitationError(
          'Default client\'s location must have a contact email configured',
          'NO_LOCATION_EMAIL'
        );
      }
      
      // Get the client's client info for the email template
      const clientClient = contact.client_id ? await scopedDb.table('clients')
        .where({ client_id: contact.client_id })
        .first() as any : null;

      const tenantSlug = await getTenantSlugForTenant(tenant);

      // Prefer the tenant's active custom portal domain (vanity host) so the
      // invitation lands on the host the client portal is served from.
      let vanityBaseUrl = '';
      try {
        const portalDomain = await getPortalDomainStatusForTenant(tenant);
        if (portalDomain.status === 'active' && portalDomain.domain) {
          vanityBaseUrl = `https://${portalDomain.domain}`;
        }
      } catch (domainError) {
        console.warn('Failed to resolve custom portal domain for invitation link:', domainError);
      }

      // Generate portal setup URL with robust base URL fallback
      const baseUrl =
        vanityBaseUrl ||
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.NEXTAUTH_URL ||
        (process.env.HOST ? `https://${process.env.HOST}` : '');

      if (!baseUrl) {
        throw new PortalInvitationError(
          'Base URL is not configured for portal invitations',
          'BASE_URL_NOT_CONFIGURED'
        );
      }

      const setupUrl = new URL(
        '/auth/portal/setup',
        baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
      );
      setupUrl.searchParams.set('token', invitationResult.token || '');
      setupUrl.searchParams.set('tenant', tenantSlug);
      const portalSetupUrl = setupUrl.toString();

      // Calculate expiration time for display
      const expirationTime = '24 hours';

      // Send portal invitation email - if this fails, transaction will rollback
      await sendPortalInvitationEmail({
        email: contact.email,
        contactName: contact.full_name,
        clientName: clientClient?.client_name || tenantDefaultClient.client_name,  // Client's client name or MSP name
        portalLink: portalSetupUrl,
        expirationTime: expirationTime,
        tenant: tenant,
        clientLocationEmail: mspLocation.email,  // MSP's email for reply-to
        clientLocationPhone: mspLocation.phone || 'Not provided',  // MSP's phone
        fromName: `${tenantDefaultClient.client_name} Portal`,  // MSP's name for the portal
        clientId: contact.client_id  // Pass client ID (stored in company_id field) for locale resolution
      });

      return {
        success: true,
        invitationId: invitationResult.invitationId,
        message: `Portal invitation sent successfully to ${contact.email}`
      };
    }).catch((error) => {
      console.error('Transaction failed:', error);
      const normalized = normalizeSendPortalInvitationError(error);
      return {
        success: false,
        error: normalized.message,
        errorCode: normalized.errorCode
      };
    });

    return result;

  } catch (error) {
    console.error('Error sending portal invitation:', error);
    const normalized = normalizeSendPortalInvitationError(error);
    return { success: false, error: normalized.message, errorCode: normalized.errorCode };
  }
});

/**
 * Verify a portal invitation token
 */
export async function verifyPortalToken(token: string): Promise<VerifyTokenResult> {
  try {
    if (!token) {
      return { success: false, error: 'Token is required', errorCode: 'TOKEN_REQUIRED' };
    }

    const verificationResult = await PortalInvitationService.verifyToken(token);

    if (!verificationResult.valid) {
      return {
        success: false,
        error: verificationResult.error || 'Invalid token',
        errorCode: verificationResult.errorCode || 'INVALID_OR_EXPIRED_TOKEN'
      };
    }

    return {
      success: true,
      contact: verificationResult.contact
    };

  } catch (error) {
    console.error('Error verifying portal token:', error);
    return { success: false, error: 'Failed to verify token', errorCode: 'VERIFICATION_FAILED' };
  }
}

/**
 * Complete portal setup by creating user account
 */
export async function completePortalSetup(
  token: string, 
  password: string
): Promise<CompleteSetupResult> {
  try {
    if (!token || !password) {
      return {
        success: false,
        error: 'Token and password are required',
        errorCode: 'TOKEN_AND_PASSWORD_REQUIRED'
      };
    }

    // Validate password strength
    if (password.length < 8) {
      return {
        success: false,
        error: 'Password must be at least 8 characters long',
        errorCode: 'PASSWORD_TOO_SHORT'
      };
    }

    // Verify token first and derive tenant from it
    const verificationResult = await PortalInvitationService.verifyToken(token);
    if (!verificationResult.valid || !verificationResult.contact || !verificationResult.tenant) {
      return {
        success: false,
        error: 'Invalid or expired invitation token',
        errorCode: 'INVALID_OR_EXPIRED_TOKEN'
      };
    }

    const tenantFromInvitation = verificationResult.tenant;
    const contact = verificationResult.contact;

    // Run the rest of the flow in the invitation's tenant context
    const result = await runWithTenant(tenantFromInvitation, async () => {
      const { knex, tenant } = await createTenantKnex();

      if (!tenant) {
        return {
          success: false,
          error: 'Tenant context is required',
          errorCode: 'TENANT_CONTEXT_REQUIRED'
        } as CompleteSetupResult;
      }

      const scopedDb = tenantDb(knex, tenant);

      // Check if user already exists
      const existingUser = await scopedDb.table('users')
        .where({ contact_id: contact.contact_name_id })
        .first();

      if (existingUser) {
        // Treat as a password reset for existing client user
        try {
          const { hashPassword } = await import('@alga-psa/core/encryption');
          const hashedPassword = await hashPassword(password);
          await scopedDb.table('users')
            .where({ user_id: existingUser.user_id })
            .update({ hashed_password: hashedPassword, is_inactive: false, updated_at: knex.raw('now()') });

          // Mark invitation as used
          const tokenMarked = await PortalInvitationService.markTokenAsUsed(token);
          if (!tokenMarked) {
            console.warn('Failed to mark invitation token as used for existing user');
          }

          // Ensure password reset preference is set
          try {
            const UserPreferences = await import('@alga-psa/db').then(m => m.UserPreferences);
            await UserPreferences.upsert(knex, {
              user_id: existingUser.user_id,
              setting_name: 'has_reset_password',
              setting_value: true,
              updated_at: new Date()
            });
          } catch (prefError) {
            console.warn('Failed to set password reset preference for existing user:', prefError);
          }

          // Return success; frontend can redirect to sign-in or auto-login if supported
          return { success: true, userId: existingUser.user_id, username: existingUser.username, message: 'Password updated. You can now sign in.' } as CompleteSetupResult;
        } catch (e) {
          console.error('Error resetting password for existing user:', e);
          return {
            success: false,
            error: 'Failed to reset password for existing account',
            errorCode: 'RESET_PASSWORD_FAILED'
          } as CompleteSetupResult;
        }
      }

      // Create user account using UserService within a system operation
      let newUser;
      try {
        newUser = await runAsSystem('portal-invitation-user-creation', async () => {
          const userService = new UserService();
          const systemContext = createSystemContext(tenant);

          // Extract first and last names from full_name
          const nameParts = contact.full_name.split(' ');
          const firstName = nameParts[0] || contact.full_name;
          const lastName = nameParts.slice(1).join(' ') || undefined;

          const user = await userService.create({
            username: contact.email.toLowerCase(),
            email: contact.email.toLowerCase(),
            password: password,
            first_name: firstName,
            last_name: lastName,
            contact_id: contact.contact_name_id,
            user_type: 'client',
            is_inactive: false,
            two_factor_enabled: false,
            is_google_user: false
          }, systemContext);

          if (!user || !user.user_id) {
            throw new PortalInvitationError(
              'Client portal user account could not be created. Please try again.',
              'CREATE_USER_FAILED'
            );
          }

          return user;
        });
      } catch (error) {
        console.error('Error creating user account:', error);
        const normalized = normalizeCreateClientPortalUserError(error);
        return {
          success: false,
          error: normalized.message,
          errorCode: normalized.errorCode
        } as CompleteSetupResult;
      }

      // Assign appropriate role based on contact's is_client_admin flag
      try {
        // Get the full contact details to check is_client_admin
        const fullContact = await scopedDb.table('contacts')
          .where({ contact_name_id: contact.contact_name_id })
          .first();
        
        // Find the appropriate role - use actual role names from seeds: "Admin" or "User"
        const roleName = fullContact?.is_client_admin ? 'Admin' : 'User';
        const role = await scopedDb.table('roles')
          .where({ role_name: roleName, client: true })
          .first();
        
        if (role) {
          // Assign the role to the user
          await scopedDb.table('user_roles').insert({
            user_id: newUser.user_id,
            role_id: role.role_id,
            tenant
          });
        } else {
          console.warn(`Failed to find client role with name '${roleName}' for tenant ${tenant}`);
        }
      } catch (roleError) {
        console.warn('Failed to assign role to user:', roleError);
        // Continue even if role assignment fails - user can still login
      }

      // Mark that the user has set their password (not using a temporary password)
      try {
        const UserPreferences = await import('@alga-psa/db').then(m => m.UserPreferences);
        await UserPreferences.upsert(knex, {
          user_id: newUser.user_id,
          setting_name: 'has_reset_password',
          setting_value: true,
          updated_at: new Date()
        });
      } catch (prefError) {
        console.warn('Failed to set password reset preference:', prefError);
      }

      // Mark invitation as used (tenant context is active)
      const tokenMarked = await PortalInvitationService.markTokenAsUsed(token);
      if (!tokenMarked) {
        console.warn('Failed to mark invitation token as used');
      }

      // Trigger token cleanup
      await PortalInvitationService.cleanupExpiredTokens();

      return { success: true, userId: newUser.user_id, username: contact.email.toLowerCase(), message: 'Portal account created successfully' } as CompleteSetupResult;
    });

    return result;

  } catch (error) {
    console.error('Error completing portal setup:', error);
    return { success: false, error: 'Failed to complete portal setup', errorCode: 'SETUP_FAILED' };
  }
}

/**
 * Get invitation history for a contact
 */
export const getPortalInvitations = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  contactId: string
): Promise<InvitationHistoryItem[]> => {
  try {
    const { knex } = await createTenantKnex();
    if (!await canManageClientPortalTargetContact(user, tenant, knex, 'read', contactId)) {
      return [];
    }

    const invitations = await PortalInvitationService.getInvitationHistory(contactId);

    return invitations.map(invitation => {
      let status: 'pending' | 'expired' | 'used' | 'revoked' = 'pending';

      if (invitation.used_at) {
        status = invitation.metadata?.revoked ? 'revoked' : 'used';
      } else if (new Date(invitation.expires_at) < new Date()) {
        status = 'expired';
      }

      return {
        invitation_id: invitation.invitation_id,
        email: invitation.email,
        created_at: invitation.created_at.toISOString(),
        expires_at: invitation.expires_at.toISOString(),
        used_at: invitation.used_at?.toISOString(),
        status
      };
    });

  } catch (error) {
    console.error('Error fetching portal invitations:', error);
    return [];
  }
});

/**
 * Revoke a portal invitation
 */
export const revokePortalInvitation = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  invitationId: string
): Promise<{ success: boolean; error?: string; errorCode?: PortalInvitationErrorCode }> => {
  try {
    const { knex } = await createTenantKnex();
    const targetClientId = await resolveInvitationTargetClientId(knex, tenant, invitationId);
    if (targetClientId === undefined) {
      return {
        success: false,
        error: 'Invitation not found or already used',
        errorCode: 'INVITATION_NOT_FOUND'
      };
    }

    if (!await canManageClientPortalTargetClient(user, tenant, knex, 'invite', targetClientId)) {
      return {
        success: false,
        error: 'Permission denied: Cannot revoke portal invitations',
        errorCode: 'PERMISSION_DENIED_INVITE'
      };
    }

    const revoked = await PortalInvitationService.revokeInvitation(invitationId);

    if (!revoked) {
      return {
        success: false,
        error: 'Invitation not found or already used',
        errorCode: 'INVITATION_NOT_FOUND'
      };
    }

    return { success: true };

  } catch (error) {
    console.error('Error revoking portal invitation:', error);
    return { success: false, errorCode: 'REVOKE_FAILED' };
  }
});

/**
 * Update a client user.
 * Kept here to support MSP contact portal-management flows from a lower layer.
 */
export const updateClientUser = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  userId: string,
  userData: Partial<IUser>
): Promise<IUser | null | ClientUserActionError> => {
  try {
    const { knex } = await createTenantKnex();
    const targetClientId = await resolveClientUserTargetClientId(knex, tenant, userId);
    if (targetClientId === undefined) {
      return null;
    }

    if (!await canManageClientPortalTargetClient(user, tenant, knex, 'update', targetClientId)) {
      return { permissionError: 'Permission denied: Cannot update client users' };
    }

    const allowedUpdates: Partial<IUser> = {};
    if (Object.prototype.hasOwnProperty.call(userData, 'is_inactive')) {
      allowedUpdates.is_inactive = userData.is_inactive;
    }

    const [updatedUser] = await tenantDb(knex, tenant).table('users')
      .where({ user_id: userId, user_type: 'client' })
      .update({
        ...allowedUpdates,
        updated_at: new Date().toISOString()
      })
      .returning('*') as IUser[];

    return updatedUser || { actionError: 'Client user not found' };
  } catch (error) {
    console.error('Error updating client user:', error);
    throw error;
  }
});
