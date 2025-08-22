'use server';

import { withTransaction } from '@alga-psa/shared/db';
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
  // Debug the invoice data, especially for the problematic invoice
  if (invoice.invoice_id === '758752dd-9aa4-43cb-945e-7232903f6615') {
    console.log('Processing problematic invoice:', {
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      total_amount: invoice.total_amount,
      total_amount_type: typeof invoice.total_amount,
      subtotal: invoice.subtotal,
      tax: invoice.tax
    });
  }
  
  // Ensure total_amount is properly converted to a number
  const totalAmount = Number(invoice.total_amount);
  
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
    subtotal: Number(invoice.subtotal),
    tax: Number(invoice.tax),
    total: totalAmount, // Ensure it's a number
    total_amount: totalAmount, // Ensure it's a number
    credit_applied: Number(invoice.credit_applied || 0),
    is_manual: invoice.is_manual,
    finalized_at: invoice.finalized_at ? (typeof invoice.finalized_at === 'string' ? toPlainDate(invoice.finalized_at) : invoice.finalized_at) : undefined,
    invoice_items: [] // Empty array initially
  };
}

export async function fetchAllInvoices(): Promise<InvoiceViewModel[]> {
  try {
    console.log('Fetching basic invoice info');
    const { knex, tenant } = await createTenantKnex();

    // Get invoices with company info and location data in a single query
    const invoices = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .join('companies', function () {
          this.on('invoices.company_id', '=', 'companies.company_id')
            .andOn('invoices.tenant', '=', 'companies.tenant');
        })
        .leftJoin('company_locations', function () {
          this.on('companies.company_id', '=', 'company_locations.company_id')
            .andOn('companies.tenant', '=', 'company_locations.tenant')
            .andOn(function() {
              this.on('company_locations.is_billing_address', '=', trx.raw('true'))
                  .orOn('company_locations.is_default', '=', trx.raw('true'));
            });
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
          trx.raw('CAST(invoices.subtotal AS BIGINT) as subtotal'),
          trx.raw('CAST(invoices.tax AS BIGINT) as tax'),
          trx.raw('CAST(invoices.total_amount AS BIGINT) as total_amount'),
          trx.raw('CAST(invoices.credit_applied AS BIGINT) as credit_applied'),
          'companies.company_name',
          'companies.properties',
          // Location fields
          'company_locations.address_line1',
          'company_locations.address_line2',
          'company_locations.city',
          'company_locations.state_province',
          'company_locations.postal_code',
          'company_locations.country_name',
          'company_locations.is_billing_address'
        )
        .orderBy([
          { column: 'invoices.invoice_id' },
          { column: 'company_locations.is_billing_address', order: 'desc', nulls: 'last' },
          { column: 'company_locations.is_default', order: 'desc', nulls: 'last' }
        ]);
    });

    console.log(`Got ${invoices.length} invoices`);

    // Map to view models without line items
    return Promise.all(invoices.map(invoice => {
      const companyProperties = invoice.properties as { logo?: string } || {};
      
      // Format location address
      const addressParts: string[] = [];
      if (invoice.address_line1) addressParts.push(invoice.address_line1);
      if (invoice.address_line2) addressParts.push(invoice.address_line2);
      if (invoice.city || invoice.state_province || invoice.postal_code) {
        const cityStateZip = [invoice.city, invoice.state_province, invoice.postal_code].filter(Boolean).join(', ');
        addressParts.push(cityStateZip);
      }
      if (invoice.country_name) addressParts.push(invoice.country_name);
      
      return getBasicInvoiceViewModel(invoice, {
        company_name: invoice.company_name,
        logo: companyProperties.logo || '',
        address: addressParts.join(', ') || ''
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
    
    // Get invoices with company info and location data in a single query, filtered by company_id
    const invoices = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .join('companies', function() {
          this.on('invoices.company_id', '=', 'companies.company_id')
              .andOn('invoices.tenant', '=', 'companies.tenant');
        })
        .leftJoin('company_locations', function () {
          this.on('companies.company_id', '=', 'company_locations.company_id')
            .andOn('companies.tenant', '=', 'company_locations.tenant')
            .andOn(function() {
              this.on('company_locations.is_billing_address', '=', trx.raw('true'))
                  .orOn('company_locations.is_default', '=', trx.raw('true'));
            });
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
          trx.raw('CAST(invoices.subtotal AS BIGINT) as subtotal'),
          trx.raw('CAST(invoices.tax AS BIGINT) as tax'),
          trx.raw('CAST(invoices.total_amount AS BIGINT) as total_amount'),
          trx.raw('CAST(invoices.credit_applied AS BIGINT) as credit_applied'),
          'companies.company_name',
          'companies.properties',
          // Location fields
          'company_locations.address_line1',
          'company_locations.address_line2',
          'company_locations.city',
          'company_locations.state_province',
          'company_locations.postal_code',
          'company_locations.country_name',
          'company_locations.is_billing_address'
        )
        .orderBy([
          { column: 'invoices.invoice_id' },
          { column: 'company_locations.is_billing_address', order: 'desc', nulls: 'last' },
          { column: 'company_locations.is_default', order: 'desc', nulls: 'last' }
        ]);
    });

    console.log(`Got ${invoices.length} invoices for company ${companyId}`);

    // Map to view models without line items
    return Promise.all(invoices.map(invoice => {
      const companyProperties = invoice.properties as { logo?: string } || {};
      
      // Format location address
      const addressParts: string[] = [];
      if (invoice.address_line1) addressParts.push(invoice.address_line1);
      if (invoice.address_line2) addressParts.push(invoice.address_line2);
      if (invoice.city || invoice.state_province || invoice.postal_code) {
        const cityStateZip = [invoice.city, invoice.state_province, invoice.postal_code].filter(Boolean).join(', ');
        addressParts.push(cityStateZip);
      }
      if (invoice.country_name) addressParts.push(invoice.country_name);
      
      return getBasicInvoiceViewModel(invoice, {
        company_name: invoice.company_name,
        logo: companyProperties.logo || '',
        address: addressParts.join(', ') || ''
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

    return Invoice.getFullInvoiceById(knex, invoiceId);
  } catch (error) {
    console.error('Error fetching invoice for rendering:', error);
    throw new Error('Error fetching invoice for rendering');
  }
}

// New function to get invoice items on demand
export async function getInvoiceLineItems(invoiceId: string): Promise<IInvoiceItem[]> {
  try {
    const { knex } = await createTenantKnex();
    console.log('Fetching line items for invoice:', invoiceId);
    const items = await Invoice.getInvoiceItems(knex, invoiceId);
    console.log(`Got ${items.length} line items`);
    return items;
  } catch (error) {
    console.error('Error fetching invoice items:', error);
    throw new Error('Error fetching invoice items');
  }
}
