'use server'

import { createTenantKnex } from '@/lib/db';
import { ICreditExpirationSettings } from '@/interfaces/billing.interfaces';

/**
 * Get credit expiration settings for a company
 * @param companyId The ID of the company
 * @returns Credit expiration settings
 */
export async function getCreditExpirationSettings(companyId: string): Promise<ICreditExpirationSettings> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('No tenant found');

  // Get company's credit expiration settings or default settings
  const companySettings = await knex('company_billing_settings')
    .where({
      company_id: companyId,
      tenant
    })
    .first();
  
  const defaultSettings = await knex('default_billing_settings')
    .where({ tenant })
    .first();
  
  // Determine if credit expiration is enabled
  // Company setting overrides default, if not specified use default
  let enableCreditExpiration = true; // Default to true if no settings found
  if (companySettings?.enable_credit_expiration !== undefined) {
    enableCreditExpiration = companySettings.enable_credit_expiration;
  } else if (defaultSettings?.enable_credit_expiration !== undefined) {
    enableCreditExpiration = defaultSettings.enable_credit_expiration;
  }
  
  // Determine expiration days - use company setting if available, otherwise use default
  let creditExpirationDays: number | undefined;
  if (companySettings?.credit_expiration_days !== undefined) {
    creditExpirationDays = companySettings.credit_expiration_days;
  } else if (defaultSettings?.credit_expiration_days !== undefined) {
    creditExpirationDays = defaultSettings.credit_expiration_days;
  }
  
  // Determine notification days - use company setting if available, otherwise use default
  let creditExpirationNotificationDays: number[] | undefined;
  if (companySettings?.credit_expiration_notification_days !== undefined) {
    creditExpirationNotificationDays = companySettings.credit_expiration_notification_days;
  } else if (defaultSettings?.credit_expiration_notification_days !== undefined) {
    creditExpirationNotificationDays = defaultSettings.credit_expiration_notification_days;
  }
  
  return {
    enable_credit_expiration: enableCreditExpiration,
    credit_expiration_days: creditExpirationDays,
    credit_expiration_notification_days: creditExpirationNotificationDays
  };
}

/**
 * Update credit expiration settings for a company
 * @param companyId The ID of the company
 * @param settings The new credit expiration settings
 * @returns Success status
 */
export async function updateCreditExpirationSettings(
  companyId: string,
  settings: ICreditExpirationSettings
): Promise<{ success: boolean; error?: string }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    await knex.transaction(async (trx) => {
      // Check if company billing settings exist
      const existingSettings = await trx('company_billing_settings')
        .where({
          company_id: companyId,
          tenant
        })
        .first();
      
      const now = new Date().toISOString();
      
      if (existingSettings) {
        // Update existing settings
        await trx('company_billing_settings')
          .where({
            company_id: companyId,
            tenant
          })
          .update({
            enable_credit_expiration: settings.enable_credit_expiration,
            credit_expiration_days: settings.credit_expiration_days,
            credit_expiration_notification_days: settings.credit_expiration_notification_days,
            updated_at: now
          });
      } else {
        // Create new settings
        await trx('company_billing_settings')
          .insert({
            company_id: companyId,
            tenant,
            enable_credit_expiration: settings.enable_credit_expiration,
            credit_expiration_days: settings.credit_expiration_days,
            credit_expiration_notification_days: settings.credit_expiration_notification_days,
            created_at: now,
            updated_at: now,
            // Set default values for other required fields
            zero_dollar_invoice_handling: 'normal',
            suppress_zero_dollar_invoices: false
          });
      }
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error updating credit expiration settings:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
}