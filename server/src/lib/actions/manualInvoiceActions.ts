'use server'

import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import { generateInvoiceNumber } from './invoiceActions';
import { IInvoiceItem, InvoiceViewModel, DiscountType } from '@/interfaces/invoice.interfaces';
import { TaxService } from '@/lib/services/taxService';
import { BillingEngine } from '@/lib/billing/billingEngine';
import * as invoiceService from '@/lib/services/invoiceService';

interface ManualInvoiceItem {
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
  companyId: string;
  items: ManualInvoiceItem[];
}

export async function generateManualInvoice(request: ManualInvoiceRequest): Promise<InvoiceViewModel> {
  // Validate session and tenant context
  const { session, knex, tenant } = await invoiceService.validateSessionAndTenant();
  const { companyId, items } = request;

  // Get company details
  const company = await invoiceService.getCompanyDetails(knex, tenant, companyId);
  const currentDate = Temporal.Now.plainDateISO().toString();

  // Generate invoice number and create invoice record
  const invoiceNumber = await generateInvoiceNumber();
  const invoiceId = uuidv4();

  const invoice = {
    invoice_id: invoiceId,
    tenant,
    company_id: companyId,
    invoice_date: currentDate,
    due_date: currentDate, // You may want to calculate this based on payment terms
    invoice_number: invoiceNumber,
    status: 'draft',
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    credit_applied: 0,
    is_manual: true
  };

  return await knex.transaction(async (trx) => {
    // Insert invoice
    await trx('invoices').insert(invoice);

    // Persist invoice items using shared service
    const subtotal = await invoiceService.persistInvoiceItems(
      trx,
      invoiceId,
      items,
      company,
      session,
      tenant,
      true // isManual
    );

    // Calculate and distribute tax
    const taxService = new TaxService();
    const computedTotalTax = await invoiceService.calculateAndDistributeTax(
      trx,
      invoiceId,
      company,
      subtotal,
      taxService
    );

    // Update invoice totals and record transaction
    await invoiceService.updateInvoiceTotalsAndRecordTransaction(
      trx,
      invoiceId,
      company,
      subtotal,
      computedTotalTax,
      tenant,
      invoiceNumber
    );

    // Get updated invoice items with tax
    const updatedItems = await trx('invoice_items')
      .where({ invoice_id: invoiceId })
      .orderBy('created_at', 'asc');

    // Return invoice view model
    return {
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      company_id: companyId,
      company: {
        name: company.company_name,
        logo: company.logo || '',
        address: company.address || ''
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
      invoice_items: updatedItems.map((item: any): IInvoiceItem => ({
        item_id: item.item_id,
        invoice_id: invoiceId,
        service_id: item.service_id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        tax_amount: item.tax_amount,
        net_amount: item.net_amount,
        tenant,
        is_manual: true,
        is_discount: item.is_discount || false,
        discount_type: item.discount_type,
        applies_to_item_id: item.applies_to_item_id,
        applies_to_service_id: item.applies_to_service_id, // Add the new field
        created_by: session.user.id,
        created_at: item.created_at,
        rate: item.unit_price // Use unit_price as rate
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
  const { companyId, items } = request;

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

  // Get company details
  const company = await invoiceService.getCompanyDetails(knex, tenant, companyId);
  const currentDate = Temporal.Now.plainDateISO().toString();
  const billingEngine = new BillingEngine();

  // Delete existing items and insert new ones
  await knex.transaction(async (trx) => {
    // Delete existing items
    await trx('invoice_items')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    // Insert new items using shared service
    await invoiceService.persistInvoiceItems(
      trx,
      invoiceId,
      items,
      company,
      session,
      tenant,
      true // isManual
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

  const updatedItems = await knex('invoice_items')
    .where({
      invoice_id: invoiceId,
      tenant
    })
    .orderBy('created_at', 'asc');

  // Return updated invoice view model
  return {
    invoice_id: invoiceId,
    invoice_number: existingInvoice.invoice_number,
    company_id: companyId,
    company: {
      name: company.company_name,
      logo: company.logo || '',
      address: company.address || ''
    },
    contact: {
      name: '',
      address: ''
    },
    invoice_date: Temporal.PlainDate.from(existingInvoice.invoice_date),
    due_date: Temporal.PlainDate.from(existingInvoice.due_date),
    status: existingInvoice.status,
    subtotal: updatedInvoice.subtotal,
    tax: updatedInvoice.tax,
    total: updatedInvoice.total_amount,
    total_amount: updatedInvoice.total_amount,
    invoice_items: updatedItems.map((item): IInvoiceItem => ({
      item_id: item.item_id,
      invoice_id: invoiceId,
      service_id: item.service_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      tax_amount: item.tax_amount,
      net_amount: item.net_amount,
      tenant,
      is_manual: true,
      is_discount: item.is_discount || false,
      discount_type: item.discount_type,
      applies_to_item_id: item.applies_to_item_id,
      applies_to_service_id: item.applies_to_service_id, // Add the new field
      created_by: session.user.id,
      created_at: item.created_at,
      rate: item.unit_price // Use unit_price as rate
    })),
    credit_applied: existingInvoice.credit_applied,
    is_manual: true
  };
}
