'use server';

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import {
  IInvoice,
  InvoiceViewModel,
  IInvoiceItem
} from 'server/src/interfaces/invoice.interfaces';
import { createTenantKnex } from '@server/lib/db';
import { toPlainDate } from '@server/lib/utils/dateTimeUtils';
import Invoice from '@server/lib/models/invoice';

// Helper function to create basic invoice view model
async function getBasicInvoiceViewModel(invoice: IInvoice, client: any): Promise<InvoiceViewModel> {
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
    client_id: invoice.client_id,
    client: {
      name: client.client_name,
      logo: client.logo || '',
      address: client.address || ''
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

    // Get invoices with client info and location data in a single query
    const invoices = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .join('clients', function () {
          this.on('invoices.client_id', '=', 'clients.client_id')
            .andOn('invoices.tenant', '=', 'clients.tenant');
        })
        .leftJoin('client_locations', function () {
          this.on('clients.client_id', '=', 'client_locations.client_id')
            .andOn('clients.tenant', '=', 'client_locations.tenant')
            .andOn(function() {
              this.on('client_locations.is_billing_address', '=', trx.raw('true'))
                  .orOn('client_locations.is_default', '=', trx.raw('true'));
            });
        })
        .where('invoices.tenant', tenant)
        .select(
          'invoices.invoice_id',
          'invoices.client_id',
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
          'clients.client_name',
          'clients.properties',
          // Location fields
          'client_locations.address_line1',
          'client_locations.address_line2',
          'client_locations.city',
          'client_locations.state_province',
          'client_locations.postal_code',
          'client_locations.country_name',
          'client_locations.is_billing_address'
        )
        .orderBy([
          { column: 'invoices.invoice_id' },
          { column: 'client_locations.is_billing_address', order: 'desc', nulls: 'last' },
          { column: 'client_locations.is_default', order: 'desc', nulls: 'last' }
        ]);
    });

    console.log(`Got ${invoices.length} invoices`);

    // Map to view models without line items
    return Promise.all(invoices.map(invoice => {
      const clientProperties = invoice.properties as { logo?: string } || {};
      
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
        client_name: invoice.client_name,
        logo: clientProperties.logo || '',
        address: addressParts.join(', ') || ''
      });
    }));
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw new Error('Error fetching invoices');
  }
}

/**
 * Fetch invoices for a specific client
 * @param clientId The ID of the client to fetch invoices for
 * @returns Array of invoice view models
 */
export async function fetchInvoicesByClient(clientId: string): Promise<InvoiceViewModel[]> {
  try {
    console.log(`Fetching invoices for client: ${clientId}`);
    const { knex, tenant } = await createTenantKnex();
    
    // Get invoices with client info and location data in a single query, filtered by client_id
    const invoices = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .join('clients', function() {
          this.on('invoices.client_id', '=', 'clients.client_id')
              .andOn('invoices.tenant', '=', 'clients.tenant');
        })
        .leftJoin('client_locations', function () {
          this.on('clients.client_id', '=', 'client_locations.client_id')
            .andOn('clients.tenant', '=', 'client_locations.tenant')
            .andOn(function() {
              this.on('client_locations.is_billing_address', '=', trx.raw('true'))
                  .orOn('client_locations.is_default', '=', trx.raw('true'));
            });
        })
        .where({
          'invoices.client_id': clientId,
          'invoices.tenant': tenant
        })
        .select(
          'invoices.invoice_id',
          'invoices.client_id',
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
          'clients.client_name',
          'clients.properties',
          // Location fields
          'client_locations.address_line1',
          'client_locations.address_line2',
          'client_locations.city',
          'client_locations.state_province',
          'client_locations.postal_code',
          'client_locations.country_name',
          'client_locations.is_billing_address'
        )
        .orderBy([
          { column: 'invoices.invoice_id' },
          { column: 'client_locations.is_billing_address', order: 'desc', nulls: 'last' },
          { column: 'client_locations.is_default', order: 'desc', nulls: 'last' }
        ]);
    });

    console.log(`Got ${invoices.length} invoices for client ${clientId}`);

    // Map to view models without line items
    return Promise.all(invoices.map(invoice => {
      const clientProperties = invoice.properties as { logo?: string } || {};
      
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
        client_name: invoice.client_name,
        logo: clientProperties.logo || '',
        address: addressParts.join(', ') || ''
      });
    }));
  } catch (error) {
    console.error(`Error fetching invoices for client ${clientId}:`, error);
    throw new Error('Error fetching client invoices');
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
