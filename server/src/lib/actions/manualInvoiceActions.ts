'use server'

import { createTenantKnex } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { generateInvoiceNumber } from './invoiceActions';
import { IInvoiceItem, InvoiceViewModel } from '@/interfaces/invoice.interfaces';
import { TaxService } from '@/lib/services/taxService';

interface ManualInvoiceItem {
  service_id: string;
  quantity: number;
  description: string;
  rate: number;
}

interface ManualInvoiceRequest {
  companyId: string;
  items: ManualInvoiceItem[];
}

export async function generateManualInvoice(request: ManualInvoiceRequest): Promise<InvoiceViewModel> {
  const { knex, tenant } = await createTenantKnex();
  const { companyId, items } = request;

  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Get company details
  const company = await knex('companies')
    .where({ company_id: companyId })
    .first();

  if (!company) {
    throw new Error('Company not found');
  }

  const taxService = new TaxService();
  const currentDate = new Date().toISOString();
  
  // Calculate totals
  let subtotal = 0;
  let totalTax = 0;

  // Create invoice record
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
    credit_applied: 0
  };

  await knex.transaction(async (trx) => {
    // Insert invoice
    await trx('invoices').insert(invoice);

    // Process each line item
    for (const item of items) {
      // Get service details for tax info
      const service = await trx('service_catalog')
        .where({ service_id: item.service_id })
        .first();

      const netAmount = Math.ceil(item.quantity * item.rate);
      const taxCalculationResult = await taxService.calculateTax(
        companyId,
        netAmount,
        currentDate
      );

      // Create invoice item
      const invoiceItem = {
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: item.service_id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.rate,
        net_amount: netAmount,
        tax_amount: taxCalculationResult.taxAmount,
        tax_region: service?.tax_region || company.tax_region,
        tax_rate: taxCalculationResult.taxRate,
        total_price: netAmount + taxCalculationResult.taxAmount,
        tenant
      };

      await trx('invoice_items').insert(invoiceItem);

      subtotal += netAmount;
      totalTax += taxCalculationResult.taxAmount;
    }

    // Update invoice with totals
    await trx('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        subtotal: Math.ceil(subtotal),
        tax: Math.ceil(totalTax),
        total_amount: Math.ceil(subtotal + totalTax)
      });

    // Record transaction
    await trx('transactions').insert({
      transaction_id: uuidv4(),
      company_id: companyId,
      invoice_id: invoiceId,
      amount: Math.ceil(subtotal + totalTax),
      type: 'invoice_generated',
      status: 'completed',
      description: `Generated manual invoice ${invoiceNumber}`,
      created_at: currentDate,
      tenant,
      balance_after: Math.ceil(subtotal + totalTax)
    });
  });

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
    invoice_date: new Date(currentDate),
    due_date: new Date(currentDate),
    status: 'draft',
    subtotal: Math.ceil(subtotal),
    tax: Math.ceil(totalTax),
    total: Math.ceil(subtotal + totalTax),
    total_amount: Math.ceil(subtotal + totalTax),
    invoice_items: items.map((item): IInvoiceItem => ({
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: item.service_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.rate,
      total_price: Math.ceil(item.quantity * item.rate),
      tax_amount: 0, // This should be calculated properly
      net_amount: Math.ceil(item.quantity * item.rate),
      tenant
    })),
    credit_applied: 0
  };
}
