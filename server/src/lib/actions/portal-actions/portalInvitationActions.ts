'use server'

import { createTenantKnex, runWithTenant } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import { PortalInvitationService } from '../../services/PortalInvitationService';
import { sendPortalInvitationEmail } from '../../email/sendPortalInvitationEmail';
import { getSystemEmailService } from '../../email';
import { TenantEmailService } from '../../services/TenantEmailService';
import { UserService } from '../../api/services/UserService';
import { runAsSystem, createSystemContext } from '../../api/services/SystemContext';
import { hasPermission } from '../../auth/rbac';

export interface SendInvitationResult {
  success: boolean;
  invitationId?: string;
  message?: string;
  error?: string;
}

export interface VerifyTokenResult {
  success: boolean;
  contact?: {
    contact_name_id: string;
    full_name: string;
    email: string;
    company_name: string;
  };
  error?: string;
}

export interface CompleteSetupResult {
  success: boolean;
  userId?: string;
  username?: string;
  message?: string;
  error?: string;
}

export interface InvitationHistoryItem {
  invitation_id: string;
  email: string;
  created_at: string;
  expires_at: string;
  used_at?: string;
  status: 'pending' | 'expired' | 'used' | 'revoked';
}

/**
 * Create a client portal user for a contact with an explicit password.
 * Skips sending an invitation and does not create a portal_invitations record.
 */
export interface CreateClientPortalUserParams {
  contactId?: string;
  password: string;
  roleId?: string;
  contact?: {
    email: string;
    fullName: string;
    companyId: string;
    isClientAdmin?: boolean;
  };
  requirePasswordChange?: boolean;
}

export async function createClientPortalUser(
  params: CreateClientPortalUserParams
): Promise<{ success: boolean; userId?: string; message?: string; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { knex, tenant } = await createTenantKnex();

    // RBAC: ensure user has permission to create users
    const canCreate = await hasPermission(user, 'user', 'create', knex);
    if (!canCreate) {
      return { success: false, error: 'Permission denied: Cannot create users' };
    }

    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Validate input
    if (!params?.password || params.password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long' };
    }

    // Create user and assign role
    const result = await knex.transaction(async (trx) => {
      // 1) Resolve or create contact
      let contact: any = null;

      if (params.contactId) {
        contact = await trx('contacts')
          .where({ tenant, contact_name_id: params.contactId })
          .first();
        if (!contact && params.contact) {
          // Create new contact since provided ID not found and details are available
          const normalizedCompanyId = params.contact.companyId && params.contact.companyId.trim() !== '' ? params.contact.companyId : null
          const [createdContact] = await trx('contacts')
            .insert({
              tenant,
              contact_name_id: trx.raw('gen_random_uuid()'),
              full_name: params.contact.fullName,
              email: params.contact.email.toLowerCase(),
              company_id: normalizedCompanyId,
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
        // Try to find by email + company; else create
        const normalizedCompanyId = params.contact.companyId && params.contact.companyId.trim() !== '' ? params.contact.companyId : null;
        const q = trx('contacts')
          .where({ tenant, email: params.contact.email.toLowerCase() });
        if (normalizedCompanyId) {
          q.andWhere('company_id', normalizedCompanyId);
        } else {
          q.whereNull('company_id');
        }
        contact = await q.first();
        if (!contact) {
          const [createdContact] = await trx('contacts')
            .insert({
              tenant,
              contact_name_id: trx.raw('gen_random_uuid()'),
              full_name: params.contact.fullName,
              email: params.contact.email.toLowerCase(),
              company_id: normalizedCompanyId,
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

      // 2) Ensure no existing user for contact
      const existingUser = await trx('users')
        .where({ tenant, contact_id: contact.contact_name_id })
        .first();
      if (existingUser) {
        throw new Error('A user account already exists for this contact');
      }

      // 3) Create user
      const nameParts = (contact.full_name || '').trim().split(' ');
      const firstName = nameParts[0] || contact.full_name || contact.email;
      const lastName = nameParts.slice(1).join(' ') || undefined;

      // Enforce uniqueness across tenant (regardless of user_type)
      const existingByEmailAnyType = await trx('users')
        .where({ tenant })
        .andWhere('email', contact.email.toLowerCase())
        .first();
      if (existingByEmailAnyType) {
        throw new Error('A user with this email already exists in this organization');
      }
      const existingByUsernameAnyType = await trx('users')
        .where({ tenant })
        .andWhere('username', contact.email)
        .first();
      if (existingByUsernameAnyType) {
        throw new Error('A user with this username already exists in this organization');
      }

      // 3a) Insert user within the same transaction to satisfy FK on (tenant, contact_id)
      const { hashPassword } = await import('server/src/utils/encryption/encryption');
      const hashedPassword = await hashPassword(params.password);
      const [created] = await trx('users')
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
        const uiRole = await trx('roles')
          .where({ tenant, role_id: params.roleId })
          .first();
        if (uiRole) {
          targetRoleId = uiRole.role_id;
        }
      }
      if (!targetRoleId) {
        const roleName = contact?.is_client_admin ? 'Client Admin' : 'Client User';
        const fallbackRole = await trx('roles')
          .where({ tenant, role_name: roleName, client: true })
          .first();
        if (fallbackRole) targetRoleId = fallbackRole.role_id;
      }
      if (targetRoleId) {
        await trx('user_roles').insert({ user_id: created.user_id, role_id: targetRoleId, tenant });
      }

      // 5) Set password-related preferences
      try {
        const UserPreferences = await import('../../models/userPreferences').then(m => m.default);
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
    return { success: false, error: 'Failed to create client portal user' };
  }
}

/**
 * Send a portal invitation to a contact
 */
export async function sendPortalInvitation(contactId: string): Promise<SendInvitationResult> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { knex, tenant } = await createTenantKnex();

    // RBAC: ensure user has permission to invite users
    const canInvite = await hasPermission(user, 'user', 'invite', knex);
    if (!canInvite) {
      return { success: false, error: 'Permission denied: Cannot invite users' };
    }

    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Ensure system email is configured before proceeding (avoid burning rate limits when misconfigured)
    const systemEmailService = await getSystemEmailService();
    const emailConfigured = await systemEmailService.isConfigured();
    if (!emailConfigured) {
      return { success: false, error: 'Email service is disabled or not configured' };
    }

    // Get contact details
    const contact = await knex('contacts')
      .where({ tenant, contact_name_id: contactId })
      .first();

    if (!contact) {
      return { success: false, error: 'Contact not found' };
    }

    // Do not send invitations for contacts that already have a portal user
    const existingUserForContact = await knex('users')
      .where({ tenant, contact_id: contactId })
      .first();

    if (existingUserForContact) {
      return { success: false, error: 'A user account already exists for this contact. Use password reset instead of sending an invitation.' };
    }

    // Use a transaction to ensure atomicity
    const result = await knex.transaction(async (trx) => {
      // Create invitation within transaction
      const invitationResult = await PortalInvitationService.createInvitationWithTransaction(contactId, trx);
      if (!invitationResult.success) {
        throw new Error(invitationResult.error || 'Failed to create invitation');
      }

      // Get the tenant's default company (MSP company) for reply-to email
      const tenantDefaultCompany = await trx('tenant_companies')
        .join('companies', 'companies.company_id', 'tenant_companies.company_id')
        .where({ 
          'tenant_companies.tenant': tenant,
          'tenant_companies.is_default': true 
        })
        .select('companies.*')
        .first();
      
      if (!tenantDefaultCompany) {
        throw new Error('No default company configured for this tenant. Please set a default company in General Settings.');
      }
      
      // Get MSP company's default location for reply-to email
      const mspLocation = await trx('company_locations')
        .where({ 
          tenant, 
          company_id: tenantDefaultCompany.company_id,
          is_default: true,
          is_active: true
        })
        .first();
      
      if (!mspLocation) {
        throw new Error('Default company must have a default location configured to send portal invitations');
      }
      
      if (!mspLocation.email) {
        throw new Error('Default company\'s location must have a contact email configured');
      }
      
      // Get the client's company info for the email template
      const clientCompany = contact.company_id ? await trx('companies')
        .where({ tenant, company_id: contact.company_id })
        .first() : null;

      // Generate portal setup URL with robust base URL fallback
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || (process.env.HOST ? `https://${process.env.HOST}` : '');
      const portalSetupUrl = `${baseUrl}/auth/portal/setup?token=${encodeURIComponent(invitationResult.token || '')}`;

      // Calculate expiration time for display
      const expirationTime = '24 hours';

      // Send portal invitation email - if this fails, transaction will rollback
      await sendPortalInvitationEmail({
        email: contact.email,
        contactName: contact.full_name,
        companyName: clientCompany?.company_name || tenantDefaultCompany.company_name,  // Client's company name or MSP name
        portalLink: portalSetupUrl,
        expirationTime: expirationTime,
        tenant: tenant,
        companyLocationEmail: mspLocation.email,  // MSP's email for reply-to
        companyLocationPhone: mspLocation.phone || 'Not provided',  // MSP's phone
        fromName: `${tenantDefaultCompany.company_name} Portal`  // MSP's name for the portal
      });

      return {
        success: true,
        invitationId: invitationResult.invitationId,
        message: `Portal invitation sent successfully to ${contact.email}`
      };
    }).catch((error) => {
      console.error('Transaction failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send invitation'
      };
    });

    return result;

  } catch (error) {
    console.error('Error sending portal invitation:', error);
    return { success: false, error: 'Failed to send invitation' };
  }
}

/**
 * Verify a portal invitation token
 */
export async function verifyPortalToken(token: string): Promise<VerifyTokenResult> {
  try {
    if (!token) {
      return { success: false, error: 'Token is required' };
    }

    const verificationResult = await PortalInvitationService.verifyToken(token);
    
    if (!verificationResult.valid) {
      return { success: false, error: verificationResult.error || 'Invalid token' };
    }

    return {
      success: true,
      contact: verificationResult.contact
    };

  } catch (error) {
    console.error('Error verifying portal token:', error);
    return { success: false, error: 'Failed to verify token' };
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
      return { success: false, error: 'Token and password are required' };
    }

    // Validate password strength
    if (password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long' };
    }

    // Verify token first and derive tenant from it
    const verificationResult = await PortalInvitationService.verifyToken(token);
    if (!verificationResult.valid || !verificationResult.contact || !verificationResult.tenant) {
      return { success: false, error: 'Invalid or expired invitation token' };
    }

    const tenantFromInvitation = verificationResult.tenant;
    const contact = verificationResult.contact;

    // Run the rest of the flow in the invitation's tenant context
    const result = await runWithTenant(tenantFromInvitation, async () => {
      const { knex, tenant } = await createTenantKnex();

      if (!tenant) {
        return { success: false, error: 'Tenant context is required' } as CompleteSetupResult;
      }

      // Check if user already exists
      const existingUser = await knex('users')
        .where({ tenant, contact_id: contact.contact_name_id })
        .first();

      if (existingUser) {
        // Treat as a password reset for existing client user
        try {
          const { hashPassword } = await import('server/src/utils/encryption/encryption');
          const hashedPassword = await hashPassword(password);
          await knex('users')
            .where({ user_id: existingUser.user_id, tenant })
            .update({ hashed_password: hashedPassword, is_inactive: false, updated_at: knex.raw('now()') });

          // Mark invitation as used
          const tokenMarked = await PortalInvitationService.markTokenAsUsed(token);
          if (!tokenMarked) {
            console.warn('Failed to mark invitation token as used for existing user');
          }

          // Ensure password reset preference is set
          try {
            const UserPreferences = await import('../../models/userPreferences').then(m => m.default);
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
          return { success: false, error: 'Failed to reset password for existing account' } as CompleteSetupResult;
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
            throw new Error('Failed to create user account');
          }

          return user;
        });
      } catch (error) {
        console.error('Error creating user account:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to create user account' } as CompleteSetupResult;
      }

      // Assign appropriate role based on contact's is_client_admin flag
      try {
        // Get the full contact details to check is_client_admin
        const fullContact = await knex('contacts')
          .where({ tenant, contact_name_id: contact.contact_name_id })
          .first();
        
        // Find the appropriate role
        const roleName = fullContact?.is_client_admin ? 'Client Admin' : 'Client User';
        const role = await knex('roles')
          .where({ tenant, role_name: roleName, client: true })
          .first();
        
        if (role) {
          // Assign the role to the user
          await knex('user_roles').insert({
            user_id: newUser.user_id,
            role_id: role.role_id,
            tenant
          });
        }
      } catch (roleError) {
        console.warn('Failed to assign role to user:', roleError);
        // Continue even if role assignment fails - user can still login
      }

      // Mark that the user has set their password (not using a temporary password)
      try {
        const UserPreferences = await import('../../models/userPreferences').then(m => m.default);
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
    return { success: false, error: 'Failed to complete portal setup' };
  }
}

/**
 * Get invitation history for a contact
 */
export async function getPortalInvitations(contactId: string): Promise<InvitationHistoryItem[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
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
}

/**
 * Revoke a portal invitation
 */
export async function revokePortalInvitation(invitationId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const revoked = await PortalInvitationService.revokeInvitation(invitationId);
    
    if (!revoked) {
      return { success: false, error: 'Invitation not found or already used' };
    }

    return { success: true };

  } catch (error) {
    console.error('Error revoking portal invitation:', error);
    return { success: false, error: 'Failed to revoke invitation' };
  }
}
