'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { v4 as uuid4 } from 'uuid';
import { ICompanyEmailSettings } from 'server/src/interfaces/company.interfaces';
import { getAdminConnection, withAdminTransaction } from 'server/src/lib/db/admin';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';

export async function verifyEmailSuffix(email: string): Promise<boolean> {
  try {
    const domain = email.split('@')[1];
    if (!domain) return false;

    const settings = await withAdminTransaction(async (trx: Knex.Transaction) => {
      return await trx('company_email_settings')
        .where({ 
          email_suffix: domain,
          self_registration_enabled: true 
        })
        .first();
    });

    return !!settings;
  } catch (error) {
    console.error('Error verifying email suffix:', error);
    throw new Error('Failed to verify email suffix');
  }
}

export async function getCompanyByEmailSuffix(email: string): Promise<{ companyId: string; tenant: string } | null> {
  try {
    const domain = email.split('@')[1];
    if (!domain) return null;

    return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const settings = await trx('company_email_settings')
        .where({ 
          email_suffix: domain,
          self_registration_enabled: true 
        })
        .first();

      if (!settings?.company_id) return null;

      // Get tenant for this company
      const company = await trx('companies')
        .where('company_id', settings.company_id)
        .select('tenant')
        .first();

      if (!company?.tenant) return null;

      return {
        companyId: settings.company_id,
        tenant: company.tenant
      };
    });
  } catch (error) {
    console.error('Error getting company by email suffix:', error);
    throw new Error('Failed to get company by email suffix');
  }
}

export async function getCompanyEmailSettings(companyId: string): Promise<ICompanyEmailSettings[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    const settings = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx<ICompanyEmailSettings>('company_email_settings')
        .where({ 
          tenant: tenant!,
          company_id: companyId 
        })
        .orderBy('created_at', 'desc');
    });

    return settings;
  } catch (error) {
    console.error('Error fetching company email settings:', error);
    throw new Error('Failed to fetch company email settings');
  }
}

export async function addCompanyEmailSetting(
  companyId: string,
  emailSuffix: string,
  selfRegistrationEnabled: boolean = false
): Promise<ICompanyEmailSettings> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check if suffix already exists
    const existing = await trx('company_email_settings')
      .where({ 
        tenant: tenant!,
        company_id: companyId,
        email_suffix: emailSuffix.toLowerCase()
      })
      .first();

    if (existing) {
      throw new Error('Email suffix already exists for this company');
    }

    // Insert new setting
    const [setting] = await trx<ICompanyEmailSettings>('company_email_settings')
      .insert({
        tenant: tenant!,
        company_id: companyId,
        email_suffix: emailSuffix.toLowerCase(),
        self_registration_enabled: selfRegistrationEnabled,
        user_id: user.user_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returning('*');

    return setting;
  });
}

export async function updateCompanyEmailSetting(
  companyId: string,
  emailSuffix: string,
  selfRegistrationEnabled: boolean
): Promise<ICompanyEmailSettings> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Update setting
    const [setting] = await trx<ICompanyEmailSettings>('company_email_settings')
      .where({ 
        tenant: tenant!,
        company_id: companyId,
        email_suffix: emailSuffix.toLowerCase()
      })
      .update({
        self_registration_enabled: selfRegistrationEnabled,
        user_id: user.user_id, // Track who made the change
        updated_at: new Date().toISOString()
      })
      .returning('*');

    if (!setting) {
      throw new Error('Email setting not found');
    }

    return setting;
  });
}

export async function deleteCompanyEmailSetting(
  companyId: string,
  emailSuffix: string
): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check if there are any pending registrations using this suffix
    const pendingCount = await trx('pending_registrations')
      .where({ 
        tenant: tenant!,
        company_id: companyId 
      })
      .whereILike('email', `%@${emailSuffix.toLowerCase()}`)
      .whereNotIn('status', ['COMPLETED', 'EXPIRED'])
      .count('registration_id as count')
      .first();

    if (pendingCount && Number(pendingCount.count) > 0) {
      throw new Error('Cannot delete email suffix with pending registrations');
    }

    // Delete setting
    const deleted = await trx('company_email_settings')
      .where({ 
        tenant: tenant!,
        company_id: companyId,
        email_suffix: emailSuffix.toLowerCase()
      })
      .delete();

    if (!deleted) {
      throw new Error('Email setting not found');
    }
  });
}
