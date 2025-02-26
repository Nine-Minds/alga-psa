'use server'

import { createTenantKnex } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { options } from "@/app/api/auth/[...nextauth]/options";

export interface BillingSettings {
  zeroDollarInvoiceHandling: 'normal' | 'finalized';
  suppressZeroDollarInvoices: boolean;
  enableCreditExpiration?: boolean;
  creditExpirationDays?: number;
  creditExpirationNotificationDays?: number[];
}

export async function getDefaultBillingSettings(): Promise<BillingSettings> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("No tenant found");
  }

  const settings = await knex('default_billing_settings')
    .where({ tenant })
    .first();

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
}

export async function updateDefaultBillingSettings(data: BillingSettings): Promise<{ success: boolean }> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("No tenant found");
  }

  await knex.transaction(async (trx) => {
    const existingSettings = await trx('default_billing_settings')
      .where({ tenant })
      .first();

    if (existingSettings) {
      await trx('default_billing_settings')
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
      await trx('default_billing_settings').insert({
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
}

export async function getCompanyBillingSettings(companyId: string): Promise<BillingSettings | null> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("No tenant found");
  }

  const settings = await knex('company_billing_settings')
    .where({ 
      company_id: companyId,
      tenant 
    })
    .first();

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
}

export async function updateCompanyBillingSettings(
  companyId: string,
  data: BillingSettings | null // null to remove override
): Promise<{ success: boolean }> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error("No tenant found");
  }

  await knex.transaction(async (trx) => {
    // If data is null, remove the company override
    if (data === null) {
      await trx('company_billing_settings')
        .where({ 
          company_id: companyId,
          tenant 
        })
        .delete();
      return;
    }

    const existingSettings = await trx('company_billing_settings')
      .where({ 
        company_id: companyId,
        tenant 
      })
      .first();

    if (existingSettings) {
      await trx('company_billing_settings')
        .where({ 
          company_id: companyId,
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
      await trx('company_billing_settings').insert({
        company_id: companyId,
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
}