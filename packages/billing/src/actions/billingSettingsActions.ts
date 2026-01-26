'use server'

import { createTenantKnex } from "@alga-psa/db";
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';


export interface BillingSettings {
  zeroDollarInvoiceHandling: 'normal' | 'finalized';
  suppressZeroDollarInvoices: boolean;
  enableCreditExpiration?: boolean;
  creditExpirationDays?: number;
  creditExpirationNotificationDays?: number[];
}

export const getDefaultBillingSettings = withAuth(async (
  user,
  { tenant }
): Promise<BillingSettings> => {
  const { knex } = await createTenantKnex();

  const settings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('default_billing_settings')
      .where({ tenant })
      .first();
  });

  if (!settings) {
    // Return default settings if none exist
    return {
      zeroDollarInvoiceHandling: 'normal',
      suppressZeroDollarInvoices: false,
      enableCreditExpiration: true,
      creditExpirationDays: 365,
      creditExpirationNotificationDays: [30, 7, 1],
    };
  }

  return {
    zeroDollarInvoiceHandling: settings.zero_dollar_invoice_handling,
    suppressZeroDollarInvoices: settings.suppress_zero_dollar_invoices,
    enableCreditExpiration: settings.enable_credit_expiration ?? true,
    creditExpirationDays: settings.credit_expiration_days ?? 365,
    creditExpirationNotificationDays: settings.credit_expiration_notification_days ?? [30, 7, 1],
  };
});

export const updateDefaultBillingSettings = withAuth(async (
  user,
  { tenant },
  data: BillingSettings
): Promise<{ success: boolean }> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const existingSettings = await trx('default_billing_settings')
      .where({ tenant })
      .first();

    if (existingSettings) {
      return await trx('default_billing_settings')
        .where({ tenant })
        .update({
          zero_dollar_invoice_handling: data.zeroDollarInvoiceHandling,
          suppress_zero_dollar_invoices: data.suppressZeroDollarInvoices,
          enable_credit_expiration: data.enableCreditExpiration,
          credit_expiration_days: data.creditExpirationDays,
          credit_expiration_notification_days: data.creditExpirationNotificationDays,
          updated_at: trx.fn.now()
        });
    } else {
      return await trx('default_billing_settings').insert({
        tenant,
        zero_dollar_invoice_handling: data.zeroDollarInvoiceHandling,
        suppress_zero_dollar_invoices: data.suppressZeroDollarInvoices,
        enable_credit_expiration: data.enableCreditExpiration ?? true,
        credit_expiration_days: data.creditExpirationDays ?? 365,
        credit_expiration_notification_days: data.creditExpirationNotificationDays ?? [30, 7, 1]
        // created_at and updated_at will be set by default values
      });
    }
  });

  return { success: true };
});

export const getClientContractLineSettings = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<BillingSettings | null> => {
  const { knex } = await createTenantKnex();

  const settings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_billing_settings')
      .where({
        client_id: clientId,
        tenant
      })
      .first();
  });

  if (!settings) {
    return null;
  }

  return {
    zeroDollarInvoiceHandling: settings.zero_dollar_invoice_handling,
    suppressZeroDollarInvoices: settings.suppress_zero_dollar_invoices,
    enableCreditExpiration: settings.enable_credit_expiration,
    creditExpirationDays: settings.credit_expiration_days,
    creditExpirationNotificationDays: settings.credit_expiration_notification_days,
  };
});

export const updateClientContractLineSettings = withAuth(async (
  user,
  { tenant },
  clientId: string,
  data: BillingSettings | null // null to remove override
): Promise<{ success: boolean }> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // If data is null, remove the client override
    if (data === null) {
      return await trx('client_billing_settings')
        .where({
          client_id: clientId,
          tenant
        })
        .delete();
    }

    const existingSettings = await trx('client_billing_settings')
      .where({
        client_id: clientId,
        tenant
      })
      .first();

    if (existingSettings) {
      return await trx('client_billing_settings')
        .where({
          client_id: clientId,
          tenant
        })
        .update({
          zero_dollar_invoice_handling: data.zeroDollarInvoiceHandling,
          suppress_zero_dollar_invoices: data.suppressZeroDollarInvoices,
          enable_credit_expiration: data.enableCreditExpiration,
          credit_expiration_days: data.creditExpirationDays,
          credit_expiration_notification_days: data.creditExpirationNotificationDays,
          updated_at: trx.fn.now()
        });
    } else {
      return await trx('client_billing_settings').insert({
        client_id: clientId,
        tenant,
        zero_dollar_invoice_handling: data.zeroDollarInvoiceHandling,
        suppress_zero_dollar_invoices: data.suppressZeroDollarInvoices,
        enable_credit_expiration: data.enableCreditExpiration,
        credit_expiration_days: data.creditExpirationDays,
        credit_expiration_notification_days: data.creditExpirationNotificationDays
        // created_at and updated_at will be set by default values
      });
    }
  });

  return { success: true };
});
