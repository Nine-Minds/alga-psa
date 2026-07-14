'use server'

import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import { generateInvoiceNumber } from './invoiceGeneration';
import { InvoiceViewModel, DiscountType } from '@alga-psa/types';
import { TaxService } from '../services/taxService';
import { BillingEngine } from '../lib/billing/billingEngine';
import * as invoiceService from '../services/invoiceService';
import Invoice from '../models/invoice';
import { withAuth } from '@alga-psa/auth';
import { getSession } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getAnalyticsAsync } from '../lib/authHelpers';

import { tenantDb } from '@alga-psa/db';
import { getInitialInvoiceTaxSource } from './taxSourceActions';
import { getDueDate } from './billingAndTax';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import logger from '@alga-psa/core/logger';
import {
  ManualInvoiceError,
  type ManualInvoiceErrorCode,
  type ManualInvoiceFailure,
} from '../errors/manualInvoiceErrors';

export interface ManualInvoiceItem { // Add export
  service_id: string;
  quantity: number;
  description: string;
  rate: number;
  is_discount?: boolean;
  discount_type?: DiscountType;
  applies_to_item_id?: string;
  applies_to_service_id?: string; // Reference a service instead of an item
  tenant?: string; // Make tenant optional to avoid breaking existing code
  /** Sales-order line this charge bills (reconciliation backlink — F047). */
  so_line_id?: string | null;
  /** Per-line tax override (SO lines carry their own tax_rate_id — F045). */
  tax_rate_id?: string | null;
}

interface ManualInvoiceRequest {
  clientId: string;
  items: ManualInvoiceItem[];
  expirationDate?: string; // Add expiration date for prepayments
  isPrepayment?: boolean;
  currency_code?: string;
}

export type ManualInvoiceResult =
  | { success: true; invoice: InvoiceViewModel }
  | ManualInvoiceFailure;

export type ManualInvoiceUpdateResult =
  | { success: true; invoice: InvoiceViewModel }
  | { success: false; error: string };

interface ManualInvoiceLogContext {
  tenant: string;
  clientId: string;
  userId: string;
}

function handledManualInvoiceFailure(
  code: Exclude<ManualInvoiceErrorCode, 'UNEXPECTED'>,
  message: string,
  context: ManualInvoiceLogContext,
  params: Record<string, string> = {},
): ManualInvoiceFailure {
  logger.warn(`[generateManualInvoice] ${code}`, {
    ...context,
    ...params,
  });

  return {
    success: false,
    code,
    params,
    message,
    error: message,
  };
}

function unexpectedManualInvoiceFailure(
  error: unknown,
  context: ManualInvoiceLogContext,
): ManualInvoiceFailure {
  const ref = crypto.randomUUID().slice(0, 8);
  const message = 'Unexpected error generating invoice';
  logger.error('[generateManualInvoice] UNEXPECTED', {
    ...context,
    ref,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return {
    success: false,
    code: 'UNEXPECTED',
    params: { ref },
    message,
    error: message,
    ref,
  };
}

function isInvoiceNumberConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const databaseError = error as { code?: string; constraint?: string };
  return databaseError.code === '23505' &&
    databaseError.constraint === 'unique_invoice_number_per_tenant';
}

export const getClientBillingEmailStatus = withAuth(async (
  _user,
  { tenant },
  clientId: string,
): Promise<{ hasBillingEmail: boolean }> => {
  const { knex } = await invoiceService.validateSessionAndTenant();
  const billingEmail = await invoiceService.getClientBillingEmail(knex, tenant, clientId);
  return { hasBillingEmail: Boolean(billingEmail) };
});

export const generateManualInvoice = withAuth(async (
  user,
  { tenant },
  request: ManualInvoiceRequest
): Promise<ManualInvoiceResult> => {
  const { clientId, items, expirationDate, isPrepayment } = request;
  const context: ManualInvoiceLogContext = {
    tenant,
    clientId,
    userId: user.user_id,
  };

  try {
    if (!await hasPermission(user, 'billing', 'create')) {
      return handledManualInvoiceFailure(
        'PERMISSION_DENIED',
        'Permission denied: billing create required',
        context,
      );
    }

    const { session, knex } = await invoiceService.validateSessionAndTenant();
    context.userId = session.user.id;
    const client = await invoiceService.getClientDetails(knex, tenant, clientId);
    const emailValidation = await invoiceService.validateClientBillingEmail(
      knex,
      tenant,
      clientId,
      client.client_name,
    );
    if (!emailValidation.valid) {
      return handledManualInvoiceFailure(
        emailValidation.code ?? 'NO_BILLING_EMAIL',
        emailValidation.error ?? 'Client billing email is required',
        context,
        emailValidation.params ?? { clientName: client.client_name },
      );
    }

    let currencyCode = request.currency_code || client.default_currency_code;
    if (!currencyCode) {
      const billingSettings = await tenantDb(knex, tenant).table('default_billing_settings')
        .select('default_currency_code')
        .first();
      currencyCode = billingSettings?.default_currency_code || 'USD';
    }

    const currentDate = Temporal.Now.plainDateISO().toString();
    const dueDate = await getDueDate(clientId, currentDate);
    if (isActionMessageError(dueDate) || isActionPermissionError(dueDate)) {
      throw new Error(getErrorMessage(dueDate));
    }

    const invoiceNumber = await generateInvoiceNumber();
    const invoiceId = uuidv4();
    const taxSource = await getInitialInvoiceTaxSource(clientId);
    if (isActionMessageError(taxSource) || isActionPermissionError(taxSource)) {
      throw new Error(getErrorMessage(taxSource));
    }

    const invoice = {
      invoice_id: invoiceId,
      tenant,
      client_id: clientId,
      invoice_date: currentDate,
      due_date: dueDate,
      invoice_number: invoiceNumber,
      status: 'draft',
      currency_code: currencyCode,
      subtotal: 0,
      tax: 0,
      total_amount: 0,
      credit_applied: 0,
      is_manual: true,
      is_prepayment: isPrepayment || false,
      tax_source: taxSource,
    };

    return await knex.transaction(async (trx) => {
      await tenantDb(trx, tenant).table('invoices').insert(invoice);
      await invoiceService.persistManualInvoiceCharges(
        trx,
        invoiceId,
        items,
        client,
        session,
        tenant,
      );

      const taxService = new TaxService();
      await invoiceService.calculateAndDistributeTax(
        trx,
        invoiceId,
        client,
        taxService,
        tenant,
      );
      await invoiceService.updateInvoiceTotalsAndRecordTransaction(
        trx,
        invoiceId,
        client,
        tenant,
        invoiceNumber,
        isPrepayment ? expirationDate : undefined,
      );

      const createdInvoice = await Invoice.getFullInvoiceById(trx, tenant, invoiceId);
      const { analytics, AnalyticsEvents } = await getAnalyticsAsync();
      analytics.capture(AnalyticsEvents.INVOICE_GENERATED, {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        client_id: clientId,
        subtotal: createdInvoice.subtotal,
        tax: createdInvoice.tax,
        total_amount: createdInvoice.total_amount,
        item_count: createdInvoice.invoice_charges.length,
        is_manual: true,
        is_prepayment: isPrepayment || false,
      }, session.user.id);

      return {
        success: true as const,
        invoice: createdInvoice,
      };
    });
  } catch (error) {
    if (error instanceof ManualInvoiceError) {
      return handledManualInvoiceFailure(
        error.code,
        error.message,
        context,
        error.params,
      );
    }

    if (isInvoiceNumberConflict(error)) {
      return handledManualInvoiceFailure(
        'INVOICE_NUMBER_CONFLICT',
        'Invoice number must be unique',
        context,
      );
    }

    return unexpectedManualInvoiceFailure(error, context);
  }
});

export const updateManualInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  request: ManualInvoiceRequest
): Promise<ManualInvoiceUpdateResult> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    return { success: false, error: 'Permission denied: billing update required' };
  }

  const { session, knex } = await invoiceService.validateSessionAndTenant();
  const { clientId, items } = request;

  // Verify invoice exists and is manual
  const existingInvoice = await tenantDb(knex, tenant).table('invoices')
    .where({
      invoice_id: invoiceId,
      is_manual: true,
      tenant
    })
    .first();

  if (!existingInvoice) {
    return { success: false, error: 'Manual invoice not found. It may have been updated or deleted. Please refresh and try again.' };
  }

  // Get client details
  const client = await invoiceService.getClientDetails(knex, tenant, clientId);
  const currentDate = Temporal.Now.plainDateISO().toString();
  const billingEngine = new BillingEngine();

  // Delete existing items and insert new ones
  await knex.transaction(async (trx) => {
    // Delete existing items
    await tenantDb(trx, tenant).table('invoice_charges')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    // Insert new items using the dedicated manual service function
    await invoiceService.persistManualInvoiceCharges(
      trx,
      invoiceId,
      items, // Assuming items match ManualInvoiceItemInput structure
      client,
      session,
      tenant
    );

    // Update invoice updated_at timestamp and currency if provided
    await tenantDb(trx, tenant).table('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        updated_at: currentDate,
        ...(request.currency_code ? { currency_code: request.currency_code } : {})
      });
  });

  // Recalculate the entire invoice
  await billingEngine.recalculateInvoice(invoiceId);

  return {
    success: true,
    invoice: await Invoice.getFullInvoiceById(knex, tenant, invoiceId),
  };
});
