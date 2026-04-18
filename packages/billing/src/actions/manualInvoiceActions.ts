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
import { getAnalyticsAsync } from '../lib/authHelpers';

import { getInitialInvoiceTaxSource } from './taxSourceActions';
import { getDueDate } from './billingAndTax';

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
  | { success: false; error: string };

export const generateManualInvoice = withAuth(async (
  user,
  { tenant },
  request: ManualInvoiceRequest
): Promise<ManualInvoiceResult> => {
  // Validate session and tenant context
  const { session, knex } = await invoiceService.validateSessionAndTenant();
  const { clientId, items, expirationDate, isPrepayment } = request;

  // Get client details
  const client = await invoiceService.getClientDetails(knex, tenant, clientId);

  // Validate that the client has a billing email (required for online payments)
  const emailValidation = await invoiceService.validateClientBillingEmail(knex, tenant, clientId, client.client_name);
  if (!emailValidation.valid) {
    return { success: false, error: emailValidation.error! };
  }

  const currentDate = Temporal.Now.plainDateISO().toString();
  const dueDate = await getDueDate(clientId, currentDate);

  // Generate invoice number and create invoice record
  const invoiceNumber = await generateInvoiceNumber();
  const invoiceId = uuidv4();

  // Determine tax source based on client settings
  const taxSource = await getInitialInvoiceTaxSource(clientId);

  // Set invoice type based on isPrepayment flag
  const invoice = {
    invoice_id: invoiceId,
    tenant,
    client_id: clientId,
    invoice_date: currentDate,
    due_date: dueDate,
    invoice_number: invoiceNumber,
    status: 'draft',
    currency_code: request.currency_code || client.default_currency_code || 'USD',
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    credit_applied: 0,
    is_manual: true,
    is_prepayment: isPrepayment || false,
    tax_source: taxSource
  };

  return await knex.transaction(async (trx) => {
    // Insert invoice
    await trx('invoices').insert(invoice);

    // Persist manual invoice items using the dedicated service function
    await invoiceService.persistManualInvoiceCharges(
      trx,
      invoiceId,
      items, // Assuming items match ManualInvoiceItemInput structure
      client,
      session,
      tenant
    );

    // Calculate and distribute tax
    const taxService = new TaxService();
    await invoiceService.calculateAndDistributeTax(
      trx,
      invoiceId,
      client,
      taxService,
      tenant // Removed subtotal argument
    );

    // Update invoice totals and record transaction (subtotal/tax recalculated internally)
    await invoiceService.updateInvoiceTotalsAndRecordTransaction(
      trx,
      invoiceId,
      client,
      tenant,
      invoiceNumber,
      isPrepayment ? expirationDate : undefined
    );

    const createdInvoice = await Invoice.getFullInvoiceById(trx, tenant, invoiceId);

    // Track analytics
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
      is_prepayment: isPrepayment || false
    }, session.user.id);

    return {
      success: true as const,
      invoice: createdInvoice
    };
  });
});

export const updateManualInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  request: ManualInvoiceRequest
): Promise<InvoiceViewModel> => {
  const { session, knex } = await invoiceService.validateSessionAndTenant();
  const { clientId, items } = request;

  // Verify invoice exists and is manual
  const existingInvoice = await knex('invoices')
    .where({
      invoice_id: invoiceId,
      is_manual: true,
      tenant
    })
    .first();

  if (!existingInvoice) {
    throw new Error('Manual invoice not found');
  }

  // Get client details
  const client = await invoiceService.getClientDetails(knex, tenant, clientId);
  const currentDate = Temporal.Now.plainDateISO().toString();
  const billingEngine = new BillingEngine();

  // Delete existing items and insert new ones
  await knex.transaction(async (trx) => {
    // Delete existing items
    await trx('invoice_charges')
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
    await trx('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        updated_at: currentDate,
        ...(request.currency_code ? { currency_code: request.currency_code } : {})
      });
  });

  // Recalculate the entire invoice
  await billingEngine.recalculateInvoice(invoiceId);

  return await Invoice.getFullInvoiceById(knex, tenant, invoiceId);
});
