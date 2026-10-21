'use server'

import { TenantEmailService } from './index';
import { DatabaseTemplateProcessor } from './templateProcessors';
import { getConnection, runWithTenant } from '@alga-psa/db';
import { resolveEmailLocale } from './emailLocaleResolver';
import logger from '@alga-psa/core/logger';

export interface SendPaymentReceiptEmailParams {
  tenant: string;
  /** Client billing email the receipt is sent to. */
  email: string;
  /** Used for locale resolution (client > tenant hierarchy). */
  clientId?: string;
  clientName: string;
  invoiceNumber: string;
  /** Amount in minor units (cents), as carried on payment webhook events. */
  amountMinor: number;
  currency: string;
  paymentDate: Date;
  paymentMethod: string;
  /** Link to view the invoice. */
  invoiceUrl: string;
}

/** Signature PaymentService depends on, so tests can inject a fake sender. */
export type PaymentReceiptSender = (params: SendPaymentReceiptEmailParams) => Promise<boolean>;

function formatMinorAmount(amountMinor: number, currency: string, locale: string): string {
  const code = (currency || 'USD').toUpperCase();
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: code });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / Math.pow(10, digits));
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${code}`;
  }
}

/**
 * Emails a payment receipt using the existing `payment-received` template
 * (variables: invoice.number, invoice.clientName, invoice.amountPaid,
 * invoice.paymentDate, invoice.paymentMethod, invoice.url) via the tenant's
 * email provider. Throws when sending fails; callers decide whether that matters.
 */
export async function sendPaymentReceiptEmail(params: SendPaymentReceiptEmailParams): Promise<boolean> {
  const { tenant, email } = params;
  return runWithTenant(tenant, async () => {
    const knex = await getConnection(tenant);
    const locale = await resolveEmailLocale(tenant, {
      email,
      ...(params.clientId && { clientId: params.clientId }),
    });

    const templateData = {
      invoice: {
        number: params.invoiceNumber,
        clientName: params.clientName,
        amountPaid: formatMinorAmount(params.amountMinor, params.currency, locale),
        paymentDate: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(params.paymentDate),
        paymentMethod: params.paymentMethod,
        url: params.invoiceUrl,
      },
    };

    const result = await TenantEmailService.getInstance(tenant).sendEmail({
      tenantId: tenant,
      mailClass: 'billing',
      to: email,
      templateProcessor: new DatabaseTemplateProcessor(knex, 'payment-received'),
      templateData,
      locale,
    });

    if (!result.success) {
      logger.warn('[SendPaymentReceiptEmail] Tenant email provider failed', {
        tenant,
        error: result.error || 'unknown_error',
      });
      throw new Error(result.error || 'Failed to send payment receipt email');
    }
    return true;
  });
}
