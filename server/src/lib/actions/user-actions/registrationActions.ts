'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { getAdminConnection } from 'server/src/lib/db/admin';
import { hashPassword } from 'server/src/utils/encryption/encryption';
import { verifyContactEmail } from 'server/src/lib/actions/user-actions/userActions';
import User from 'server/src/lib/models/user';
import { verifyEmailSuffix, getCompanyByEmailSuffix } from 'server/src/lib/actions/company-settings/emailSettings';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { sendVerificationEmail } from 'server/src/lib/email/sendVerificationEmail';
import { 
  checkRegistrationLimit, 
  checkVerificationLimit, 
  checkEmailLimit,
  formatRateLimitError,
  logSecurityEvent 
} from 'server/src/lib/security/rateLimiting';

interface IRegistrationResult {
  success: boolean;
  error?: string;
  registrationId?: string;
}

interface IVerificationResult {
  success: boolean;
  error?: string;
  email?: string;
  registrationId?: string;
}

// Helper to generate secure random token
function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// Helper to get expiration timestamp
function getExpirationTime(hours: number = 24): Date {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date;
}

export async function initiateRegistration(
  email: string,
  password: string,
  firstName: string,
  lastName: string
): Promise<IRegistrationResult> {
  const adminDb = await getAdminConnection();
  
  try {
    // Check rate limits first
    const rateLimitResult = await checkRegistrationLimit(email);
    if (!rateLimitResult.success) {
      const errorMessage = await formatRateLimitError(rateLimitResult.msBeforeNext);
      return { 
        success: false, 
        error: errorMessage
      };
    }

    // First try contact-based registration
    const contactVerification = await verifyContactEmail(email);
    
    if (contactVerification.exists && !contactVerification.isActive) {
      return { success: false, error: "This contact is inactive" };
    }
    
    if (contactVerification.exists) {
      // Get contact's company and tenant
      const contact = await adminDb('contacts')
        .join('companies', 'contacts.company_id', 'companies.company_id')
        .where('contacts.email', email)
        .select('companies.company_id', 'companies.tenant')
        .first();
      
      if (!contact?.tenant) {
        return { success: false, error: "Contact company not found" };
      }
      
      const result = await registerContactUser(email, password);
      if (!result.success) {
        return result;
      }
      
      return { success: true };
    }
    
    // If not a contact, try email suffix registration
    const isValidSuffix = await verifyEmailSuffix(email);
    if (!isValidSuffix) {
      return { 
        success: false, 
        error: "This email domain is not authorized for registration" 
      };
    }

    const result = await getCompanyByEmailSuffix(email);
    if (!result) {
      return { 
        success: false, 
        error: "Could not determine company for email domain" 
      };
    }

    // Create pending registration
    const registrationId = uuid();
    const hashedPassword = await hashPassword(password);

    await adminDb('pending_registrations').insert({
      tenant: result.tenant,
      registration_id: registrationId,
      email: email.toLowerCase(),
      hashed_password: hashedPassword,
      first_name: firstName,
      last_name: lastName,
      company_id: result.companyId,
      status: 'PENDING_VERIFICATION',
      expires_at: getExpirationTime(),
      created_at: new Date().toISOString()
    });

    // Generate verification token
    const token = generateToken();
    const [verificationToken] = await adminDb('verification_tokens').insert({
      tenant: result.tenant,
      token_id: uuid(),
      registration_id: registrationId,
      company_id: result.companyId,
      token,
      expires_at: getExpirationTime(),
      created_at: new Date().toISOString()
    }).returning('*');

    // Check email sending rate limit
    const emailLimitResult = await checkEmailLimit(email);
    if (!emailLimitResult.success) {
      const errorMessage = await formatRateLimitError(emailLimitResult.msBeforeNext);
      return { 
        success: false, 
        error: errorMessage
      };
    }

    // Send verification email
    try {
      await sendVerificationEmail({
        email,
        token,
        registrationId,
        tenant: result.tenant
      });
    } catch (error) {
      // If email fails to send, clean up the registration and token
      await adminDb.transaction(async (trx) => {
      await trx('verification_tokens')
        .where({ token_id: verificationToken.token_id })
        .delete();
      await trx('pending_registrations')
        .where({ registration_id: registrationId })
        .delete();
      });
      return { 
        success: false, 
        error: 'Failed to send verification email' 
      };
    }

    return { 
      success: true,
      registrationId 
    };
  } catch (error) {
    console.error('Registration error:', error);
    return { 
      success: false, 
      error: 'An unexpected error occurred during registration' 
    };
  }
}

export async function verifyRegistrationToken(token: string): Promise<IVerificationResult> {
  const adminDb = await getAdminConnection();
  
  try {
    // Check verification rate limit
    const rateLimitResult = await checkVerificationLimit(token);
    if (!rateLimitResult.success) {
      const errorMessage = await formatRateLimitError(rateLimitResult.msBeforeNext);
      return { 
        success: false, 
        error: errorMessage
      };
    }

    // Get token record
    const verificationToken = await adminDb('verification_tokens')
      .where({ 
        token,
        used_at: null 
      })
      .where('expires_at', '>', new Date().toISOString())
      .first();

    if (!verificationToken) {
      return { 
        success: false, 
        error: 'Invalid or expired verification token' 
      };
    }

    // Get registration record
    const registration = await adminDb('pending_registrations')
      .where({ 
        registration_id: verificationToken.registration_id,
        status: 'PENDING_VERIFICATION'
      })
      .first();

    if (!registration) {
      return { 
        success: false, 
        error: 'Registration not found or already verified' 
      };
    }

    // Update token and registration status
    await adminDb.transaction(async (trx) => {
      await trx('verification_tokens')
        .where({ token_id: verificationToken.token_id })
        .update({ 
          used_at: new Date().toISOString() 
        });

      await trx('pending_registrations')
        .where({ registration_id: registration.registration_id })
        .update({ 
          status: 'VERIFIED'
        });
    });

    // TODO: Re-enable audit logging once tenant context issue is resolved
    // await logSecurityEvent(registration.tenant, 'email_verification_success', {
    //   email: registration.email,
    //   registrationId: registration.registration_id
    // });

    return { 
      success: true,
      email: registration.email,
      registrationId: registration.registration_id
    };
  } catch (error) {
    console.error('Token verification error:', error);
    return { 
      success: false, 
      error: 'An unexpected error occurred during verification' 
    };
  }
}

export async function completeRegistration(registrationId: string): Promise<IRegistrationResult> {
  const adminDb = await getAdminConnection();
  
  try {
    // Get verified registration
    const registration = await adminDb('pending_registrations')
      .where({ 
        registration_id: registrationId,
        status: 'VERIFIED'
      })
      .first();

    if (!registration) {
      return { 
        success: false, 
        error: 'Registration not found or not verified' 
      };
    }

    // Wrap all operations in a transaction
    await adminDb.transaction(async (trx) => {
      // Create contact first
      const [contact] = await trx('contacts')
        .insert({
          tenant: registration.tenant,
          contact_name_id: uuid(),
          full_name: `${registration.first_name} ${registration.last_name}`.trim(),
          company_id: registration.company_id,
          email: registration.email,
          is_inactive: false,
          created_at: new Date().toISOString()
        })
        .returning('*');

      // Create user and link to contact
      const [user] = await trx('users')
        .insert({
          email: registration.email,
          username: registration.email,
          first_name: registration.first_name,
          last_name: registration.last_name,
          hashed_password: registration.hashed_password,
          tenant: registration.tenant,
          user_type: 'client',
          contact_id: contact.contact_name_id,
          is_inactive: false,
          created_at: new Date().toISOString()
        })
        .returning('*');

      // Always assign client role for portal registrations
      const role = await trx('roles')
        .where({ 
          tenant: registration.tenant,
          role_name: 'client' 
        })
        .first();

      if (!role) {
        throw new Error('Client role not found');
      }

      // Assign role
      await trx('user_roles').insert({
        tenant: registration.tenant,
        user_id: user.user_id,
        role_id: role.role_id
      });

      // Update registration status
      await trx('pending_registrations')
        .where({ registration_id: registration.registration_id })
        .update({ 
          status: 'COMPLETED',
          completed_at: new Date().toISOString()
        });
    });

    // TODO: Re-enable audit logging once tenant context issue is resolved
    // await logSecurityEvent(registration.tenant, 'registration_completed', {
    //   userId: user.user_id,
    //   email: registration.email,
    //   registrationId: registration.registration_id
    // });

    return { success: true };
  } catch (error) {
    console.error('Registration completion error:', error);
    return { 
      success: false, 
      error: 'An unexpected error occurred while completing registration' 
    };
  }
}

// Function for getting user company ID during registration (without tenant context)
export async function getUserCompanyIdForRegistration(userId: string): Promise<string | null> {
  try {
    const adminDb = await getAdminConnection();
    const user = await User.getForRegistration(userId);
    if (!user) return null;

    // First try to get company ID from contact if user is contact-based
    if (user.contact_id) {
      const contact = await adminDb('contacts')
        .where('contact_name_id', user.contact_id)
        .select('company_id')
        .first();

      if (contact?.company_id) {
        return contact.company_id;
      }
    }

    // If no contact or no company found, try to get company from user's email domain
    const emailDomain = user.email.split('@')[1];
    if (!emailDomain) return null;

    const emailSetting = await adminDb('company_email_settings')
      .where('email_suffix', emailDomain)
      .select('company_id')
      .first();

    return emailSetting?.company_id || null;
  } catch (error) {
    console.error('Error getting user company ID for registration:', error);
    throw new Error('Failed to get user company ID for registration');
  }
}

// Helper function for contact-based registration
async function registerContactUser(
  email: string, 
  password: string
): Promise<IRegistrationResult> {
  const adminDb = await getAdminConnection();
  
  try {
    // Get contact details and tenant
    const contact = await adminDb('contacts')
      .join('companies', 'contacts.company_id', 'companies.company_id')
      .where({ email })
      .select('contacts.contact_name_id', 'contacts.company_id', 'contacts.is_inactive', 'contacts.full_name', 'companies.tenant')
      .first();

    if (!contact) {
      return { success: false, error: 'Contact not found' };
    }

    if (contact.is_inactive) {
      return { success: false, error: 'Contact is inactive' };
    }

    // Check if user already exists
    const existingUser = await adminDb('users')
      .where({ email })
      .first();

    if (existingUser) {
      return { success: false, error: 'User already exists' };
    }

    // Split full name
    const nameParts = contact.full_name.trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Create user
    const hashedPassword = await hashPassword(password);
    const [user] = await adminDb('users')
      .insert({
        email,
        username: email,
        first_name: firstName,
        last_name: lastName,
        hashed_password: hashedPassword,
        tenant: contact.tenant,
        user_type: 'client',
        contact_id: contact.contact_name_id,
        is_inactive: false,
        created_at: new Date().toISOString()
      })
      .returning('*');

    // Get client role
    const clientRole = await adminDb('roles')
      .where({ 
        tenant: contact.tenant,
        role_name: 'client' 
      })
      .first();

    if (!clientRole) {
      throw new Error('Client role not found');
    }

    // Assign role
    await adminDb('user_roles').insert({
      tenant: contact.tenant,
      user_id: user.user_id,
      role_id: clientRole.role_id
    });

    return { success: true };
  } catch (error) {
    console.error('Contact registration error:', error);
    return { 
      success: false, 
      error: 'An unexpected error occurred during registration' 
    };
  }
}
