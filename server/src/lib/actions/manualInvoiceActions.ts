'use server'

import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import { generateInvoiceNumber } from './invoiceGeneration';
import { IInvoiceCharge, InvoiceViewModel, DiscountType } from 'server/src/interfaces/invoice.interfaces';
import { TaxService } from 'server/src/lib/services/taxService';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import * as invoiceService from 'server/src/lib/services/invoiceService';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { analytics } from '../analytics/posthog';
import { AnalyticsEvents } from '../analytics/events';

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
}

export async function generateManualInvoice(request: ManualInvoiceRequest): Promise<InvoiceViewModel> {
  // Validate session and tenant context
  const { session, knex, tenant } = await invoiceService.validateSessionAndTenant();
  const { clientId, items, expirationDate, isPrepayment } = request;

  // Get client details
  const client = await invoiceService.getClientDetails(knex, tenant, clientId);
  const currentDate = Temporal.Now.plainDateISO().toString();

  // Generate invoice number and create invoice record
  const invoiceNumber = await generateInvoiceNumber();
  const invoiceId = uuidv4();

  // Set invoice type based on isPrepayment flag
  const invoice = {
    invoice_id: invoiceId,
    tenant,
    client_id: clientId,
    invoice_date: currentDate,
    due_date: currentDate, // You may want to calculate this based on payment terms
    invoice_number: invoiceNumber,
    status: 'draft',
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    credit_applied: 0,
    is_manual: true,
    is_prepayment: isPrepayment || false
  };

  return await knex.transaction(async (trx) => {
    // Insert invoice
    await trx('invoices').insert(invoice);

    // Persist manual invoice items using the dedicated service function
    const subtotal = await invoiceService.persistManualInvoiceCharges(
      trx,
      invoiceId,
      items, // Assuming items match ManualInvoiceItemInput structure
      client,
      session,
      tenant
    );

    // Calculate and distribute tax
    const taxService = new TaxService();
    const computedTotalTax = await invoiceService.calculateAndDistributeTax(
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

    // Get updated invoice items with tax
    const updatedItems = await trx('invoice_charges')
      .where({ invoice_id: invoiceId, tenant })
      .orderBy('created_at', 'asc');

    // Track analytics
    analytics.capture(AnalyticsEvents.INVOICE_GENERATED, {
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      client_id: clientId,
      subtotal: Math.ceil(subtotal),
      tax: Math.ceil(computedTotalTax),
      total_amount: Math.ceil(subtotal + computedTotalTax),
      item_count: updatedItems.length,
      is_manual: true,
      is_prepayment: isPrepayment || false
    }, session.user.id);

    // Return invoice view model
    return {
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      client_id: clientId,
      client: {
        name: client.client_name,
        logo: client.logoUrl || '',
        address: client.location_address || ''
      },
      contact: {
        name: '',
        address: ''
      },
      invoice_date: Temporal.PlainDate.from(currentDate),
      due_date: Temporal.PlainDate.from(currentDate),
      status: 'draft',
      subtotal: Math.ceil(subtotal),
      tax: Math.ceil(computedTotalTax),
      total: Math.ceil(subtotal + computedTotalTax),
      total_amount: Math.ceil(subtotal + computedTotalTax),
      invoice_charges: updatedItems.map((item: any): IInvoiceCharge => ({
        item_id: item.item_id,
        invoice_id: invoiceId,
        service_id: item.service_id,
        description: item.description,
        quantity: item.quantity,
        unit_price: parseInt(item.unit_price.toString()),
        total_price: parseInt(item.total_price.toString()),
        tax_amount: parseInt(item.tax_amount.toString()),
        net_amount: parseInt(item.net_amount.toString()),
        tenant,
        is_manual: true,
        is_discount: item.is_discount || false,
        discount_type: item.discount_type,
        applies_to_item_id: item.applies_to_item_id,
        applies_to_service_id: item.applies_to_service_id, // Add the new field
        created_by: session.user.id,
        created_at: item.created_at,
        rate: parseInt(item.unit_price.toString()) // Use unit_price as rate
      })),
      credit_applied: 0,
      is_manual: true
    };
  });
}

export async function updateManualInvoice(
  invoiceId: string,
  request: ManualInvoiceRequest
): Promise<InvoiceViewModel> {
  const { session, knex, tenant } = await invoiceService.validateSessionAndTenant();
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

    // Update invoice updated_at timestamp
    await trx('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        updated_at: currentDate
      });
  });

  // Recalculate the entire invoice
  await billingEngine.recalculateInvoice(invoiceId);

  // Fetch the updated invoice with new totals
  const updatedInvoice = await knex('invoices')
    .where({
      invoice_id: invoiceId,
      tenant
    })
    .first();

  if (!updatedInvoice) {
    throw new Error(`Invoice ${invoiceId} not found for tenant ${tenant}`);
  }

  const updatedItems = await knex('invoice_charges')
    .where({
      invoice_id: invoiceId,
      tenant
    })
    .orderBy('created_at', 'asc');

  // Return updated invoice view model
  return {
    invoice_id: invoiceId,
    invoice_number: existingInvoice.invoice_number,
    client_id: clientId,
    client: {
      name: client.client_name,
      logo: client.logoUrl || '',
      address: client.location_address || ''
    },
    contact: {
      name: '',
      address: ''
    },
    invoice_date: toPlainDate(existingInvoice.invoice_date),
    due_date: toPlainDate(existingInvoice.due_date),
    status: existingInvoice.status,
    subtotal: updatedInvoice.subtotal,
    tax: updatedInvoice.tax,
    total: updatedInvoice.total_amount,
    total_amount: parseInt(updatedInvoice.total_amount.toString()),
    invoice_charges: updatedItems.map((item): IInvoiceCharge => ({
      item_id: item.item_id,
      invoice_id: invoiceId,
      service_id: item.service_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: parseInt(item.unit_price.toString()),
      total_price: parseInt(item.total_price.toString()),
      tax_amount: parseInt(item.tax_amount.toString()),
      net_amount: item.net_amount,
      tenant,
      is_manual: true,
      is_discount: item.is_discount || false,
      discount_type: item.discount_type,
      applies_to_item_id: item.applies_to_item_id,
      applies_to_service_id: item.applies_to_service_id, // Add the new field
      created_by: session.user.id,
      created_at: item.created_at,
      rate: parseInt(item.unit_price.toString()) // Use unit_price as rate
    })),
    credit_applied: existingInvoice.credit_applied,
    is_manual: true
  };
}
