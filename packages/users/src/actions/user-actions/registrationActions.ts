'use server'

import { getAdminConnection } from '@alga-psa/db/admin';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { hashPassword } from '@alga-psa/core/encryption';
import { verifyContactEmail } from '@alga-psa/users/actions';
import User from '@alga-psa/db/models/user';
import {
  checkRegistrationLimit,
  formatRateLimitError
} from '../../lib/rateLimiting';

const REGISTRATION_TENANT_DISCOVERY = 'tenant-discovery';

interface IRegistrationResult {
  success: boolean;
  error?: string;
  registrationId?: string;
}


export async function initiateRegistration(
  email: string,
  password: string
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
      // Get contact's client and tenant
      const discoveryDb = tenantDb(adminDb, REGISTRATION_TENANT_DISCOVERY);
      const contactQuery = discoveryDb.unscoped('contacts', 'tenant discovery for contact-based registration');
      discoveryDb.tenantJoin(contactQuery, 'clients', 'contacts.client_id', 'clients.client_id');

      const contact = await contactQuery
        .where('contacts.email', email)
        .select({
          client_id: 'clients.client_id',
          tenant: 'clients.tenant',
        })
        .first();
      
      if (!contact?.tenant) {
        return { success: false, error: "Contact client not found" };
      }
      
      const result = await registerContactUser(email, password);
      if (!result.success) {
        return result;
      }
      
      return { success: true };
    }
    
    // No email domain restrictions - registration not allowed for non-contacts
    return { 
      success: false, 
      error: "Registration is only available for existing contacts. Please contact your administrator." 
    };
  } catch (error) {
    console.error('Registration error:', error);
    return { 
      success: false, 
      error: 'An unexpected error occurred during registration' 
    };
  }
}

// Email suffix registration functions removed for security
// Only contact-based registration is now allowed

// Function for getting user client ID during registration (without tenant context)
export async function getUserClientIdForRegistration(userId: string): Promise<string | null> {
  try {
    const adminDb = await getAdminConnection();
    const user = await User.getForRegistration(userId);
    if (!user) return null;

    return await withTransaction(adminDb, async (trx: Knex.Transaction) => {
      // First try to get client ID from contact if user is contact-based
      if (user.contact_id) {
        const contact = await tenantDb(trx, REGISTRATION_TENANT_DISCOVERY)
          .unscoped('contacts', 'tenant discovery for registration client lookup')
          .where('contact_name_id', user.contact_id)
          .select('client_id')
          .first();

        if (contact?.client_id) {
          return contact.client_id;
        }
      }

      // Email suffix functionality removed for security
      return null;
    });
  } catch (error) {
    console.error('Error getting user client ID for registration:', error);
    throw error;
  }
}

// Helper function for contact-based registration
async function registerContactUser(
  email: string, 
  password: string
): Promise<IRegistrationResult> {
  const adminDb = await getAdminConnection();
  
  try {
    return await withTransaction(adminDb, async (trx: Knex.Transaction) => {
      // Get contact details and tenant
      const discoveryDb = tenantDb(trx, REGISTRATION_TENANT_DISCOVERY);
      const contactQuery = discoveryDb.unscoped('contacts', 'tenant discovery for contact-based registration');
      discoveryDb.tenantJoin(contactQuery, 'clients', 'contacts.client_id', 'clients.client_id');

      const contact = await contactQuery
        .where({ 'contacts.email': email })
        .select({
          contact_name_id: 'contacts.contact_name_id',
          client_id: 'contacts.client_id',
          is_inactive: 'contacts.is_inactive',
          full_name: 'contacts.full_name',
          tenant: 'clients.tenant',
        })
        .first();

      if (!contact) {
        return { success: false, error: 'Contact not found' };
      }

      if (contact.is_inactive) {
        return { success: false, error: 'Contact is inactive' };
      }

      // Check if user already exists
      const existingUser = await tenantDb(trx, contact.tenant).table('users')
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
      const [user] = await tenantDb(trx, contact.tenant).table('users')
        .insert({
          email: email.toLowerCase(),
          username: email.toLowerCase(),
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

      // Get User role
      const roles = await tenantDb(trx, contact.tenant).table('roles') as Array<{ role_id: string; role_name?: string | null }>;
      const userRole = roles.find(r => 
        r.role_name && r.role_name.toLowerCase() === 'user'
      );

      if (!userRole) {
        throw new Error('User role not found');
      }

      // Assign role
      await tenantDb(trx, contact.tenant).table('user_roles').insert({
        tenant: contact.tenant,
        user_id: user.user_id,
        role_id: userRole.role_id
      });

      return { success: true };
    });
  } catch (error) {
    console.error('Contact registration error:', error);
    return { 
      success: false, 
      error: 'An unexpected error occurred during registration' 
    };
  }
}
