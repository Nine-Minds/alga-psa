'use server'

import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import { PortalInvitationService } from '../../services/PortalInvitationService';
import { sendPortalInvitationEmail } from '../../email/sendPortalInvitationEmail';
import { checkPortalInvitationLimit, formatRateLimitError } from '../../security/rateLimiting';
import { TenantEmailService } from '../../services/TenantEmailService';
import { UserService } from '../../api/services/UserService';
import { runAsSystem, createSystemContext } from '../../api/services/SystemContext';

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
 * Send a portal invitation to a contact
 */
export async function sendPortalInvitation(contactId: string): Promise<SendInvitationResult> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant is requried');
    }

    // Validate email settings are configured for this tenant
    // const emailValidation = await TenantEmailService.validateEmailSettings(tenant);
    
    // if (!emailValidation.valid) {
    //   return { 
    //     success: false, 
    //     error: emailValidation.error || 'Email settings are not properly configured.'
    //   };
    // }

    // Check rate limits first
    const rateLimitResult = await checkPortalInvitationLimit(contactId);
    if (!rateLimitResult.success) {
      const errorMessage = await formatRateLimitError(rateLimitResult.msBeforeNext);
      return { success: false, error: errorMessage };
    }

    // Validate contact is portal admin
    const contact = await knex('contacts')
      .where({ tenant, contact_name_id: contactId })
      .first();

    if (!contact) {
      return { success: false, error: 'Contact not found' };
    }

    if (!contact.is_client_admin) {
      return { 
        success: false, 
        error: 'Contact must be marked as a client admin to receive portal invitations' 
      };
    }

    // Use a transaction to ensure atomicity
    const result = await knex.transaction(async (trx) => {
      // Create invitation within transaction
      const invitationResult = await PortalInvitationService.createInvitationWithTransaction(contactId, trx);
      if (!invitationResult.success) {
        throw new Error(invitationResult.error || 'Failed to create invitation');
      }

      // Get company information for email template
      const company = await trx('companies')
        .where({ tenant, company_id: contact.company_id })
        .first();
      
      // Get company's default location for contact information
      const defaultLocation = await trx('company_locations')
        .where({ 
          tenant, 
          company_id: contact.company_id,
          is_default: true,
          is_active: true
        })
        .first();
      
      if (!defaultLocation) {
        throw new Error('Company must have a default location configured to send portal invitations');
      }
      
      if (!defaultLocation.email) {
        throw new Error('Company\'s default location must have a contact email configured');
      }

      // Generate portal setup URL
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
      const portalSetupUrl = `${baseUrl}/auth/portal/setup?token=${invitationResult.token}`;

      // Calculate expiration time for display
      const expirationTime = '24 hours';

      // Send portal invitation email - if this fails, transaction will rollback
      await sendPortalInvitationEmail({
        email: contact.email,
        contactName: contact.full_name,
        companyName: company?.company_name || 'Your Company',
        portalLink: portalSetupUrl,
        expirationTime: expirationTime,
        tenant: tenant,
        companyLocationEmail: defaultLocation.email,
        companyLocationPhone: defaultLocation.phone || 'Not provided',
        fromName: `${company?.company_name || 'Your Company'} Portal`
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

    // Verify token first
    const verificationResult = await PortalInvitationService.verifyToken(token);
    if (!verificationResult.valid || !verificationResult.contact) {
      return { success: false, error: 'Invalid or expired invitation token' };
    }

    const { knex, tenant } = await createTenantKnex();
    const contact = verificationResult.contact;

    if (!tenant) {
      return { success: false, error: 'Tenant context is required' };
    }

    // Check if user already exists
    const existingUser = await knex('users')
      .where({ 
        tenant, 
        contact_id: contact.contact_name_id 
      })
      .first();

    if (existingUser) {
      return { 
        success: false, 
        error: 'A user account already exists for this contact' 
      };
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
          username: contact.email,
          email: contact.email,
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
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create user account'
      };
    }

    // Mark invitation as used
    const tokenMarked = await PortalInvitationService.markTokenAsUsed(token);
    if (!tokenMarked) {
      console.warn('Failed to mark invitation token as used');
    }

    // Trigger token cleanup
    await PortalInvitationService.cleanupExpiredTokens();

    return {
      success: true,
      userId: newUser.user_id,
      message: 'Portal account created successfully'
    };

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