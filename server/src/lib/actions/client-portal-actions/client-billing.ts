'use server';

import { getConnection } from 'server/src/lib/db/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getUserRolesWithPermissions } from 'server/src/lib/actions/user-actions/userActions';
import {
  IClientContractLine,
  IBillingResult,
  IBucketUsage,
  IService
} from 'server/src/interfaces/billing.interfaces';
import {
  fetchInvoicesByClient,
  getInvoiceLineItems,
  getInvoiceForRendering
} from 'server/src/lib/actions/invoiceQueries';
import { getInvoiceTemplates } from 'server/src/lib/actions/invoiceTemplates';
import { finalizeInvoice, unfinalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { InvoiceViewModel, IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
import Invoice from 'server/src/lib/models/invoice';
import { scheduleInvoiceZipAction } from 'server/src/lib/actions/job-actions/scheduleInvoiceZipAction';
import { scheduleInvoiceEmailAction } from 'server/src/lib/actions/job-actions/scheduleInvoiceEmailAction';
import { getSession } from 'server/src/lib/auth/getSession';

export async function getClientContractLine(): Promise<IClientContractLine | null> {
  const session = await getSession();
  
  if (!session?.user?.tenant || !session.user.clientId) {
    throw new Error('Unauthorized');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    const plan = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('client_contract_lines')
        .select(
          'client_contract_lines.*',
          'contract_lines.contract_line_name',
          'contract_lines.billing_frequency',
          'service_categories.category_name as service_category_name'
        )
        .join('contract_lines', function() {
          this.on('client_contract_lines.contract_line_id', '=', 'contract_lines.contract_line_id')
            .andOn('contract_lines.tenant', '=', 'client_contract_lines.tenant')
        })
        .leftJoin('service_categories', function() {
          this.on('client_contract_lines.service_category', '=', 'service_categories.category_id')
            .andOn('service_categories.tenant', '=', 'client_contract_lines.tenant')
        })
        .where({
          'client_contract_lines.client_id': session.user.clientId,
          'client_contract_lines.is_active': true,
          'client_contract_lines.tenant': session.user.tenant
        })
        .first();
    });

    return plan || null;
  } catch (error) {
    console.error('Error fetching client contract line:', error);
    throw new Error('Failed to fetch contract line');
  }
}

/**
 * Fetch all invoices for the current client
 */
export async function getClientInvoices(): Promise<InvoiceViewModel[]> {
  const session = await getSession();
  
  if (!session?.user?.tenant || !session.user.clientId) {
    throw new Error('Unauthorized');
  }

  // Check for billing permission (client portal uses 'billing' resource)
  const userRoles = await getUserRolesWithPermissions(session.user.id);
  const hasInvoiceAccess = userRoles.some(role =>
    role.permissions.some(p =>
      p.resource === 'billing' && p.action === 'read' && p.client === true
    )
  );

  if (!hasInvoiceAccess) {
    throw new Error('Unauthorized to access invoice data');
  }

  try {
    // Directly fetch only invoices for the current client
    return await fetchInvoicesByClient(session.user.clientId);
  } catch (error) {
    console.error('Error fetching client invoices:', error);
    throw new Error('Failed to fetch invoices');
  }
}

/**
 * Get invoice details by ID
 */
export async function getClientInvoiceById(invoiceId: string): Promise<InvoiceViewModel> {
  const session = await getSession();
  
  if (!session?.user?.tenant || !session.user.clientId) {
    throw new Error('Unauthorized');
  }

  // Check for billing permission (client portal uses 'billing' resource)
  const userRoles = await getUserRolesWithPermissions(session.user.id);
  const hasInvoiceAccess = userRoles.some(role =>
    role.permissions.some(p =>
      p.resource === 'billing' && p.action === 'read' && p.client === true
    )
  );

  if (!hasInvoiceAccess) {
    throw new Error('Unauthorized to access invoice data');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    // Verify the invoice belongs to the client
    const invoiceCheck = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({
          invoice_id: invoiceId,
          client_id: session.user.clientId,
          tenant: session.user.tenant
        })
        .first();
    });
    
    if (!invoiceCheck) {
      throw new Error('Invoice not found or access denied');
    }

    // Get full invoice details
    return await getInvoiceForRendering(invoiceId);
  } catch (error) {
    console.error('Error fetching client invoice details:', error);
    throw new Error('Failed to fetch invoice details');
  }
}

/**
 * Get invoice line items
 */
export async function getClientInvoiceLineItems(invoiceId: string) {
  const session = await getSession();
  
  if (!session?.user?.tenant || !session.user.clientId) {
    throw new Error('Unauthorized');
  }

  // Check for billing permission (client portal uses 'billing' resource)
  const userRoles = await getUserRolesWithPermissions(session.user.id);
  const hasInvoiceAccess = userRoles.some(role =>
    role.permissions.some(p =>
      p.resource === 'billing' && p.action === 'read' && p.client === true
    )
  );

  if (!hasInvoiceAccess) {
    throw new Error('Unauthorized to access invoice data');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    // Verify the invoice belongs to the client
    const invoiceCheck = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({
          invoice_id: invoiceId,
          client_id: session.user.clientId,
          tenant: session.user.tenant
        })
        .first();
    });
    
    if (!invoiceCheck) {
      throw new Error('Invoice not found or access denied');
    }

    // Get invoice items
    return await getInvoiceLineItems(invoiceId);
  } catch (error) {
    console.error('Error fetching client invoice line items:', error);
    throw new Error('Failed to fetch invoice line items');
  }
}

/**
 * Get invoice templates
 */
export async function getClientInvoiceTemplates(): Promise<IInvoiceTemplate[]> {
  const session = await getSession();
  
  if (!session?.user?.tenant) {
    throw new Error('Unauthorized');
  }

  try {
    // Get all templates (both standard and tenant-specific)
    return await getInvoiceTemplates();
  } catch (error) {
    console.error('Error fetching invoice templates:', error);
    throw new Error('Failed to fetch invoice templates');
  }
}

/**
 * Download invoice PDF
 */
export async function downloadClientInvoicePdf(invoiceId: string) {
  const session = await getSession();
  
  if (!session?.user?.tenant || !session.user.clientId) {
    throw new Error('Unauthorized');
  }

  // Check for billing permission (client portal uses 'billing' resource)
  const userRoles = await getUserRolesWithPermissions(session.user.id);
  const hasInvoiceAccess = userRoles.some(role =>
    role.permissions.some(p =>
      p.resource === 'billing' && p.action === 'read' && p.client === true
    )
  );

  if (!hasInvoiceAccess) {
    throw new Error('Unauthorized to access invoice data');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    // Verify the invoice belongs to the client
    const invoiceCheck = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({
          invoice_id: invoiceId,
          client_id: session.user.clientId,
          tenant: session.user.tenant
        })
        .first();
    });
    
    if (!invoiceCheck) {
      throw new Error('Invoice not found or access denied');
    }

    // Schedule PDF generation
    return await scheduleInvoiceZipAction([invoiceId]);
  } catch (error) {
    console.error('Error downloading invoice PDF:', error);
    throw new Error('Failed to download invoice PDF');
  }
}

/**
 * Send invoice email
 */
export async function sendClientInvoiceEmail(invoiceId: string) {
  const session = await getSession();
  
  if (!session?.user?.tenant || !session.user.clientId) {
    throw new Error('Unauthorized');
  }

  // Check for billing permission (client portal uses 'billing' resource)
  const userRoles = await getUserRolesWithPermissions(session.user.id);
  const hasInvoiceAccess = userRoles.some(role =>
    role.permissions.some(p =>
      p.resource === 'billing' && p.action === 'read' && p.client === true
    )
  );

  if (!hasInvoiceAccess) {
    throw new Error('Unauthorized to access invoice data');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    // Verify the invoice belongs to the client
    const invoiceCheck = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({
          invoice_id: invoiceId,
          client_id: session.user.clientId,
          tenant: session.user.tenant
        })
        .first();
    });
    
    if (!invoiceCheck) {
      throw new Error('Invoice not found or access denied');
    }

    // Schedule email sending
    return await scheduleInvoiceEmailAction([invoiceId]);
  } catch (error) {
    console.error('Error sending invoice email:', error);
    throw new Error('Failed to send invoice email');
  }
}

export async function getCurrentUsage(): Promise<{
  bucketUsage: IBucketUsage | null;
  services: IService[];
}> {
  const session = await getSession();
  
  if (!session?.user?.tenant || !session.user.clientId) {
    throw new Error('Unauthorized');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get current bucket usage if any
      const bucketUsage = await trx('bucket_usage')
        .select('*')
        .where({
          client_id: session.user.clientId,
          tenant: session.user.tenant
        })
        .whereRaw('? BETWEEN period_start AND period_end', [new Date()])
        .first();

      // Get all services associated with the client's plan
      const services = await trx('service_catalog')
        .select('service_catalog.*')
        .join('contract_line_services', function() {
          this.on('service_catalog.service_id', '=', 'contract_line_services.service_id')
            .andOn('service_catalog.tenant', '=', 'contract_line_services.tenant')
        })
        .join('client_contract_lines', function() {
          this.on('contract_line_services.contract_line_id', '=', 'client_contract_lines.contract_line_id')
            .andOn('contract_line_services.tenant', '=', 'client_contract_lines.tenant')
        })
        .where({
          'client_contract_lines.client_id': session.user.clientId,
          'client_contract_lines.is_active': true,
          'service_catalog.tenant': session.user.tenant,
          'contract_line_services.tenant': session.user.tenant,
          'client_contract_lines.tenant': session.user.tenant
        });

      return {
        bucketUsage,
        services
      };
    });

    return result;
  } catch (error) {
    console.error('Error fetching current usage:', error);
    throw new Error('Failed to fetch current usage');
  }
}
