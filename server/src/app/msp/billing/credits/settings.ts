'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { ICreditExpirationSettings } from 'server/src/interfaces/billing.interfaces';

/**
 * Get credit expiration settings for a client
 * @param clientId The ID of the client
 * @returns Credit expiration settings
 */
export async function getCreditExpirationSettings(clientId: string): Promise<ICreditExpirationSettings> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('No tenant found');

  // Get client's credit expiration settings or default settings
  const clientSettings = await knex('client_billing_settings')
    .where({
      client_id: clientId,
      tenant
    })
    .first();
  
  const defaultSettings = await knex('default_billing_settings')
    .where({ tenant })
    .first();
  
  // Determine if credit expiration is enabled
  // Client setting overrides default, if not specified use default
  let enableCreditExpiration = true; // Default to true if no settings found
  if (clientSettings?.enable_credit_expiration !== undefined) {
    enableCreditExpiration = clientSettings.enable_credit_expiration;
  } else if (defaultSettings?.enable_credit_expiration !== undefined) {
    enableCreditExpiration = defaultSettings.enable_credit_expiration;
  }
  
  // Determine expiration days - use client setting if available, otherwise use default
  let creditExpirationDays: number | undefined;
  if (clientSettings?.credit_expiration_days !== undefined) {
    creditExpirationDays = clientSettings.credit_expiration_days;
  } else if (defaultSettings?.credit_expiration_days !== undefined) {
    creditExpirationDays = defaultSettings.credit_expiration_days;
  }
  
  // Determine notification days - use client setting if available, otherwise use default
  let creditExpirationNotificationDays: number[] | undefined;
  if (clientSettings?.credit_expiration_notification_days !== undefined) {
    creditExpirationNotificationDays = clientSettings.credit_expiration_notification_days;
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
 * Update credit expiration settings for a client
 * @param clientId The ID of the client
 * @param settings The new credit expiration settings
 * @returns Success status
 */
export async function updateCreditExpirationSettings(
  clientId: string,
  settings: ICreditExpirationSettings
): Promise<{ success: boolean; error?: string }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('No tenant found');

    await knex.transaction(async (trx) => {
      // Check if client billing settings exist
      const existingSettings = await trx('client_billing_settings')
        .where({
          client_id: clientId,
          tenant
        })
        .first();
      
      const now = new Date().toISOString();
      
      if (existingSettings) {
        // Update existing settings
        await trx('client_billing_settings')
          .where({
            client_id: clientId,
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
        await trx('client_billing_settings')
          .insert({
            client_id: clientId,
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