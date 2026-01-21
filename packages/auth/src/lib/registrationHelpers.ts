'use server'

// TODO: Consolidate with @alga-psa/users after circular dependency is resolved
// This is a temporary duplication to break the auth <-> users cycle

import { getAdminConnection } from '@alga-psa/db/admin';
import { withTransaction, withAdminTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { hashPassword } from '@alga-psa/core/encryption';
import User from '@alga-psa/db/models/user';
import logger from '@alga-psa/core/logger';
import { checkRegistrationLimit, formatRateLimitError } from './security/rateLimiting';

interface IRegistrationResult {
  success: boolean;
  error?: string;
  registrationId?: string;
}

export async function verifyContactEmail(email: string): Promise<{ exists: boolean; isActive: boolean; clientId?: string; tenant?: string }> {
  try {
    const contact = await withAdminTransaction(async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .join('clients', function() {
          this.on('clients.client_id', '=', 'contacts.client_id')
              .andOn('clients.tenant', '=', 'contacts.tenant');
        })
        .where({ 'contacts.email': email.toLowerCase() })
        .select('contacts.contact_name_id', 'contacts.client_id', 'contacts.is_inactive', 'contacts.tenant')
        .first();
    });

    if (!contact) {
      return { exists: false, isActive: false };
    }

    return {
      exists: true,
      isActive: !contact.is_inactive,
      clientId: contact.client_id,
      tenant: contact.tenant
    };
  } catch (error) {
    logger.error('Failed to verify contact email:', error);
    throw new Error('Failed to verify contact email');
  }
}

export async function initiateRegistration(
  email: string,
  password: string
): Promise<IRegistrationResult> {
  const adminDb = await getAdminConnection();

  try {
    const rateLimitResult = await checkRegistrationLimit(email);
    if (!rateLimitResult.success) {
      const errorMessage = await formatRateLimitError(rateLimitResult.msBeforeNext);
      return {
        success: false,
        error: errorMessage
      };
    }

    const contactVerification = await verifyContactEmail(email);

    if (contactVerification.exists && !contactVerification.isActive) {
      return { success: false, error: "This contact is inactive" };
    }

    if (contactVerification.exists) {
      const contact = await adminDb('contacts')
        .join('clients', 'contacts.client_id', 'clients.client_id')
        .where('contacts.email', email)
        .select('clients.client_id', 'clients.tenant')
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

async function registerContactUser(
  email: string,
  password: string
): Promise<IRegistrationResult> {
  const adminDb = await getAdminConnection();

  try {
    return await withTransaction(adminDb, async (trx: Knex.Transaction) => {
      const contact = await trx('contacts')
        .join('clients', 'contacts.client_id', 'clients.client_id')
        .where({ 'contacts.email': email })
        .select('contacts.contact_name_id', 'contacts.client_id', 'contacts.is_inactive', 'contacts.full_name', 'clients.tenant')
        .first();

      if (!contact) {
        return { success: false, error: 'Contact not found' };
      }

      if (contact.is_inactive) {
        return { success: false, error: 'Contact is inactive' };
      }

      const existingUser = await trx('users')
        .where({ email })
        .first();

      if (existingUser) {
        return { success: false, error: 'User already exists' };
      }

      const nameParts = contact.full_name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const hashedPassword = await hashPassword(password);
      const [user] = await trx('users')
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

      const roles = await trx('roles').where({ tenant: contact.tenant });
      const userRole = roles.find(r =>
        r.role_name && r.role_name.toLowerCase() === 'user'
      );

      if (!userRole) {
        throw new Error('User role not found');
      }

      await trx('user_roles').insert({
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
