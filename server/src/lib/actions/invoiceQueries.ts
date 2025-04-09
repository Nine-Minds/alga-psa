'use server';

import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import {
  IInvoice,
  InvoiceViewModel,
  IInvoiceItem
} from 'server/src/interfaces/invoice.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import Invoice from 'server/src/lib/models/invoice';

// Helper function to create basic invoice view model
async function getBasicInvoiceViewModel(invoice: IInvoice, company: any): Promise<InvoiceViewModel> {
  return {
    invoice_id: invoice.invoice_id,
    invoice_number: invoice.invoice_number,
    company_id: invoice.company_id,
    company: {
      name: company.company_name,
      logo: company.logo || '',
      address: company.address || ''
    },
    contact: {
      name: '',  // Contact info not stored in invoice
      address: ''
    },
    invoice_date: typeof invoice.invoice_date === 'string' ? toPlainDate(invoice.invoice_date) : invoice.invoice_date,
    due_date: typeof invoice.due_date === 'string' ? toPlainDate(invoice.due_date) : invoice.due_date,
    status: invoice.status,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total_amount,
    total_amount: invoice.total_amount,
    credit_applied: (invoice.credit_applied || 0),
    is_manual: invoice.is_manual,
    finalized_at: invoice.finalized_at ? (typeof invoice.finalized_at === 'string' ? toPlainDate(invoice.finalized_at) : invoice.finalized_at) : undefined,
    invoice_items: [] // Empty array initially
  };
}

export async function fetchAllInvoices(): Promise<InvoiceViewModel[]> {
  try {
    console.log('Fetching basic invoice info');
    const { knex, tenant } = await createTenantKnex();

    // Get invoices with company info in a single query
    const invoices = await knex('invoices')
      .join('companies', function () {
        this.on('invoices.company_id', '=', 'companies.company_id')
          .andOn('invoices.tenant', '=', 'companies.tenant');
      })
      .where('invoices.tenant', tenant)
      .select(
        'invoices.invoice_id',
        'invoices.company_id',
        'invoices.invoice_number',
        'invoices.invoice_date',
        'invoices.due_date',
        'invoices.status',
        'invoices.is_manual',
        'invoices.finalized_at',
        'invoices.billing_cycle_id',
        knex.raw('CAST(invoices.subtotal AS INTEGER) as subtotal'),
        knex.raw('CAST(invoices.tax AS INTEGER) as tax'),
        knex.raw('CAST(invoices.total_amount AS INTEGER) as total_amount'),
        knex.raw('CAST(invoices.credit_applied AS INTEGER) as credit_applied'),
        'companies.company_name',
        'companies.address',
        'companies.properties'
      );

    console.log(`Got ${invoices.length} invoices`);

    // Map to view models without line items
    return Promise.all(invoices.map(invoice => {
      const companyProperties = invoice.properties as { logo?: string } || {};
      return getBasicInvoiceViewModel(invoice, {
        company_name: invoice.company_name,
        logo: companyProperties.logo || '',
        address: invoice.address || ''
      });
    }));
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw new Error('Error fetching invoices');
  }
}

/**
 * Fetch invoices for a specific company
 * @param companyId The ID of the company to fetch invoices for
 * @returns Array of invoice view models
 */
export async function fetchInvoicesByCompany(companyId: string): Promise<InvoiceViewModel[]> {
  try {
    console.log(`Fetching invoices for company: ${companyId}`);
    const { knex, tenant } = await createTenantKnex();
    
    // Get invoices with company info in a single query, filtered by company_id
    const invoices = await knex('invoices')
      .join('companies', function() {
        this.on('invoices.company_id', '=', 'companies.company_id')
            .andOn('invoices.tenant', '=', 'companies.tenant');
      })
      .where({
        'invoices.company_id': companyId,
        'invoices.tenant': tenant
      })
      .select(
        'invoices.invoice_id',
        'invoices.company_id',
        'invoices.invoice_number',
        'invoices.invoice_date',
        'invoices.due_date',
        'invoices.status',
        'invoices.is_manual',
        'invoices.finalized_at',
        'invoices.billing_cycle_id',
        knex.raw('CAST(invoices.subtotal AS INTEGER) as subtotal'),
        knex.raw('CAST(invoices.tax AS INTEGER) as tax'),
        knex.raw('CAST(invoices.total_amount AS INTEGER) as total_amount'),
        knex.raw('CAST(invoices.credit_applied AS INTEGER) as credit_applied'),
        'companies.company_name',
        'companies.address',
        'companies.properties'
      );

    console.log(`Got ${invoices.length} invoices for company ${companyId}`);

    // Map to view models without line items
    return Promise.all(invoices.map(invoice => {
      const companyProperties = invoice.properties as { logo?: string } || {};
      return getBasicInvoiceViewModel(invoice, {
        company_name: invoice.company_name,
        logo: companyProperties.logo || '',
        address: invoice.address || ''
      });
    }));
  } catch (error) {
    console.error(`Error fetching invoices for company ${companyId}:`, error);
    throw new Error('Error fetching company invoices');
  }
}

export async function getInvoiceForRendering(invoiceId: string): Promise<InvoiceViewModel> {
  try {
    console.log('Fetching full invoice details for rendering:', invoiceId);
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return Invoice.getFullInvoiceById(invoiceId);
  } catch (error) {
    console.error('Error fetching invoice for rendering:', error);
    throw new Error('Error fetching invoice for rendering');
  }
}

// New function to get invoice items on demand
export async function getInvoiceLineItems(invoiceId: string): Promise<IInvoiceItem[]> {
  try {
    console.log('Fetching line items for invoice:', invoiceId);
    const items = await Invoice.getInvoiceItems(invoiceId);
    console.log(`Got ${items.length} line items`);
    return items;
  } catch (error) {
    console.error('Error fetching invoice items:', error);
    throw new Error('Error fetching invoice items');
  }
}