'use server';

import { getServerSession } from 'next-auth';
import { options } from 'server/src/app/api/auth/[...nextauth]/options';
import { getConnection } from 'server/src/lib/db/db';
import { getUserRolesWithPermissions } from 'server/src/lib/actions/user-actions/userActions';
import {
  ICompanyBillingPlan,
  IBillingResult,
  IBucketUsage,
  IService
} from 'server/src/interfaces/billing.interfaces';
import {
  fetchInvoicesByCompany,
  getInvoiceLineItems,
  getInvoiceForRendering
} from 'server/src/lib/actions/invoiceQueries';
import { getInvoiceTemplates } from 'server/src/lib/actions/invoiceTemplates';
import { finalizeInvoice, unfinalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { InvoiceViewModel, IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
import Invoice from 'server/src/lib/models/invoice';
import { scheduleInvoiceZipAction } from 'server/src/lib/actions/job-actions/scheduleInvoiceZipAction';
import { scheduleInvoiceEmailAction } from 'server/src/lib/actions/job-actions/scheduleInvoiceEmailAction';

export async function getClientBillingPlan(): Promise<ICompanyBillingPlan | null> {
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    const plan = await knex('company_billing_plans')
      .select(
        'company_billing_plans.*',
        'billing_plans.plan_name',
        'billing_plans.billing_frequency',
        'service_categories.category_name as service_category_name'
      )
      .join('billing_plans', function() {
        this.on('company_billing_plans.plan_id', '=', 'billing_plans.plan_id')
          .andOn('billing_plans.tenant', '=', 'company_billing_plans.tenant')
      })
      .leftJoin('service_categories', function() {
        this.on('company_billing_plans.service_category', '=', 'service_categories.category_id')
          .andOn('service_categories.tenant', '=', 'company_billing_plans.tenant')
      })
      .where({
        'company_billing_plans.company_id': session.user.companyId,
        'company_billing_plans.is_active': true,
        'company_billing_plans.tenant': session.user.tenant
      })
      .first();

    return plan || null;
  } catch (error) {
    console.error('Error fetching client billing plan:', error);
    throw new Error('Failed to fetch billing plan');
  }
}

/**
 * Fetch all invoices for the current client
 */
export async function getClientInvoices(): Promise<InvoiceViewModel[]> {
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  // Check for client_billing permission
  const userRoles = await getUserRolesWithPermissions(session.user.id);
  const hasInvoiceAccess = userRoles.some(role =>
    role.permissions.some(p =>
      p.resource === 'client_billing' && p.action === 'read'
    )
  );

  if (!hasInvoiceAccess) {
    throw new Error('Unauthorized to access invoice data');
  }

  try {
    // Directly fetch only invoices for the current client
    return await fetchInvoicesByCompany(session.user.companyId);
  } catch (error) {
    console.error('Error fetching client invoices:', error);
    throw new Error('Failed to fetch invoices');
  }
}

/**
 * Get invoice details by ID
 */
export async function getClientInvoiceById(invoiceId: string): Promise<InvoiceViewModel> {
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  // Check for client_billing permission
  const userRoles = await getUserRolesWithPermissions(session.user.id);
  const hasInvoiceAccess = userRoles.some(role =>
    role.permissions.some(p =>
      p.resource === 'client_billing' && p.action === 'read'
    )
  );

  if (!hasInvoiceAccess) {
    throw new Error('Unauthorized to access invoice data');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    // Verify the invoice belongs to the client
    const invoiceCheck = await knex('invoices')
      .where({
        invoice_id: invoiceId,
        company_id: session.user.companyId,
        tenant: session.user.tenant
      })
      .first();
    
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
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  // Check for client_billing permission
  const userRoles = await getUserRolesWithPermissions(session.user.id);
  const hasInvoiceAccess = userRoles.some(role =>
    role.permissions.some(p =>
      p.resource === 'client_billing' && p.action === 'read'
    )
  );

  if (!hasInvoiceAccess) {
    throw new Error('Unauthorized to access invoice data');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    // Verify the invoice belongs to the client
    const invoiceCheck = await knex('invoices')
      .where({
        invoice_id: invoiceId,
        company_id: session.user.companyId,
        tenant: session.user.tenant
      })
      .first();
    
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
  const session = await getServerSession(options);
  
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
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  // Check for client_billing permission
  const userRoles = await getUserRolesWithPermissions(session.user.id);
  const hasInvoiceAccess = userRoles.some(role =>
    role.permissions.some(p =>
      p.resource === 'client_billing' && p.action === 'read'
    )
  );

  if (!hasInvoiceAccess) {
    throw new Error('Unauthorized to access invoice data');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    // Verify the invoice belongs to the client
    const invoiceCheck = await knex('invoices')
      .where({
        invoice_id: invoiceId,
        company_id: session.user.companyId,
        tenant: session.user.tenant
      })
      .first();
    
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
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  // Check for client_billing permission
  const userRoles = await getUserRolesWithPermissions(session.user.id);
  const hasInvoiceAccess = userRoles.some(role =>
    role.permissions.some(p =>
      p.resource === 'client_billing' && p.action === 'read'
    )
  );

  if (!hasInvoiceAccess) {
    throw new Error('Unauthorized to access invoice data');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    // Verify the invoice belongs to the client
    const invoiceCheck = await knex('invoices')
      .where({
        invoice_id: invoiceId,
        company_id: session.user.companyId,
        tenant: session.user.tenant
      })
      .first();
    
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
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    // Get current bucket usage if any
    const bucketUsage = await knex('bucket_usage')
      .select('*')
      .where({
        company_id: session.user.companyId,
        tenant: session.user.tenant
      })
      .whereRaw('? BETWEEN period_start AND period_end', [new Date()])
      .first();

    // Get all services associated with the company's plan
    const services = await knex('service_catalog')
      .select('service_catalog.*')
      .join('plan_services', function() {
        this.on('service_catalog.service_id', '=', 'plan_services.service_id')
          .andOn('service_catalog.tenant', '=', 'plan_services.tenant')
      })
      .join('company_billing_plans', function() {
        this.on('plan_services.plan_id', '=', 'company_billing_plans.plan_id')
          .andOn('plan_services.tenant', '=', 'company_billing_plans.tenant')
      })
      .where({
        'company_billing_plans.company_id': session.user.companyId,
        'company_billing_plans.is_active': true,
        'service_catalog.tenant': session.user.tenant,
        'plan_services.tenant': session.user.tenant,
        'company_billing_plans.tenant': session.user.tenant
      });

    return {
      bucketUsage,
      services
    };
  } catch (error) {
    console.error('Error fetching current usage:', error);
    throw new Error('Failed to fetch current usage');
  }
}
