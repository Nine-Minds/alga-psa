'use server';

import { getConnection } from 'server/src/lib/db/db';
import { createTenantKnex } from 'server/src/lib/db';
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
import { getSession } from 'server/src/lib/auth/getSession';
import { scheduleInvoiceZipAction } from 'server/src/lib/actions/job-actions/scheduleInvoiceZipAction';
import { scheduleInvoiceEmailAction } from 'server/src/lib/actions/job-actions/scheduleInvoiceEmailAction';
import { JobService } from 'server/src/services/job.service';
import { JobStatus } from 'server/src/types/job';

export async function getClientContractLine(): Promise<IClientContractLine | null> {
  const session = await getSession();

  if (!session?.user?.tenant || !session.user.clientId) {
    throw new Error('Unauthorized');
  }

  const knex = await getConnection(session.user.tenant);

  try {
    const plan = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Query via client_contracts -> contracts -> contract_lines
      // (contracts are client-specific via client_contracts)
      return await trx('client_contracts as cc')
        .join('contracts as c', function() {
          this.on('cc.contract_id', '=', 'c.contract_id')
            .andOn('cc.tenant', '=', 'c.tenant');
        })
        .join('contract_lines as cl', function() {
          this.on('c.contract_id', '=', 'cl.contract_id')
            .andOn('c.tenant', '=', 'cl.tenant');
        })
        .leftJoin('service_categories as sc', function() {
          this.on('cl.service_category', '=', 'sc.category_id')
            .andOn('sc.tenant', '=', 'cl.tenant');
        })
        .where({
          'cc.client_id': session.user.clientId,
          'cc.tenant': session.user.tenant
        })
        .select(
          'cl.contract_line_id',
          'cl.contract_line_name',
          'cl.billing_frequency',
          'cl.service_category',
          'cl.custom_rate',
          'cl.contract_id',
          'cl.tenant',
          'cc.client_id',
          'cc.start_date',
          'cc.end_date',
          'sc.category_name as service_category_name'
        )
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
    const invoices = await fetchInvoicesByClient(session.user.clientId);
    // Filter out draft invoices - only finalized invoices should be visible in client portal
    // An invoice is finalized when finalized_at is set (not null)
    return invoices.filter(invoice => invoice.finalized_at != null);
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
    // Verify the invoice belongs to the client and is not a draft
    const invoiceCheck = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({
          invoice_id: invoiceId,
          client_id: session.user.clientId,
          tenant: session.user.tenant
        })
        .whereNot('status', 'draft')
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
    // Verify the invoice belongs to the client and is not a draft
    const invoiceCheck = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({
          invoice_id: invoiceId,
          client_id: session.user.clientId,
          tenant: session.user.tenant
        })
        .whereNot('status', 'draft')
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
 * Download invoice PDF response
 */
export interface DownloadPdfResult {
  success: boolean;
  fileId?: string;
  error?: string;
}

/**
 * Download invoice PDF - schedules job, waits for completion, returns file ID
 */
export async function downloadClientInvoicePdf(invoiceId: string): Promise<DownloadPdfResult> {
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
    // Verify the invoice belongs to the client and is not a draft
    const invoiceCheck = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({
          invoice_id: invoiceId,
          client_id: session.user.clientId,
          tenant: session.user.tenant
        })
        .whereNot('status', 'draft')
        .first();
    });

    if (!invoiceCheck) {
      throw new Error('Invoice not found or access denied');
    }

    // Schedule PDF generation
    const result = await scheduleInvoiceZipAction([invoiceId]);

    if (!result?.jobId) {
      return { success: false, error: 'Failed to start PDF generation' };
    }

    // Poll until job completes
    const status = await pollJobUntilComplete(result.jobId, session.user.tenant);

    if (status.status === 'completed' && status.fileId) {
      return { success: true, fileId: status.fileId };
    } else {
      return { success: false, error: status.error || 'PDF generation failed' };
    }
  } catch (error) {
    console.error('Error downloading invoice PDF:', error);
    throw new Error('Failed to download invoice PDF');
  }
}

/**
 * Send invoice email response
 */
export interface SendEmailResult {
  success: boolean;
  error?: string;
}

/**
 * Send invoice email - schedules job, waits for completion
 */
export async function sendClientInvoiceEmail(invoiceId: string): Promise<SendEmailResult> {
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
    // Verify the invoice belongs to the client and is not a draft
    const invoiceCheck = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({
          invoice_id: invoiceId,
          client_id: session.user.clientId,
          tenant: session.user.tenant
        })
        .whereNot('status', 'draft')
        .first();
    });

    if (!invoiceCheck) {
      throw new Error('Invoice not found or access denied');
    }

    // Schedule email sending
    const result = await scheduleInvoiceEmailAction([invoiceId]);

    if (!result?.jobId) {
      return { success: false, error: 'Failed to start email sending' };
    }

    // Poll until job completes
    const status = await pollJobUntilComplete(result.jobId, session.user.tenant);

    if (status.status === 'completed') {
      return { success: true };
    } else {
      return { success: false, error: status.error || 'Email sending failed' };
    }
  } catch (error) {
    console.error('Error sending invoice email:', error);
    throw new Error('Failed to send invoice email');
  }
}

/**
 * Job status response for client portal
 */
export interface ClientJobStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  fileId?: string;
  error?: string;
}

/**
 * Get job status - internal helper for polling
 */
async function getJobStatus(jobId: string, tenant: string): Promise<ClientJobStatus> {
  const jobService = await JobService.create();
  const { knex } = await createTenantKnex();

  // Get job record
  const job = await knex('jobs')
    .where({ job_id: jobId, tenant })
    .first();

  if (!job) {
    throw new Error('Job not found');
  }

  // Map job status
  let status: ClientJobStatus['status'] = 'pending';
  if (job.status === JobStatus.Processing || job.status === JobStatus.Active) {
    status = 'processing';
  } else if (job.status === JobStatus.Completed) {
    status = 'completed';
  } else if (job.status === JobStatus.Failed) {
    status = 'failed';
  }

  // If completed, get the file_id from job details
  let fileId: string | undefined;
  if (status === 'completed') {
    const details = await jobService.getJobDetails(jobId);
    // Look for file_id in the metadata of completed steps
    for (const detail of details) {
      const metadata = detail.metadata as Record<string, unknown> | undefined;
      if (metadata?.file_id && typeof metadata.file_id === 'string') {
        fileId = metadata.file_id;
        break;
      }
    }
  }

  // If failed, get error message
  let error: string | undefined;
  if (status === 'failed' && job.metadata?.error) {
    error = job.metadata.error;
  }

  return { status, fileId, error };
}

/**
 * Poll job until completion or failure
 * Returns the final status with fileId if successful
 */
async function pollJobUntilComplete(
  jobId: string,
  tenant: string,
  maxAttempts: number = 30,
  intervalMs: number = 2000
): Promise<ClientJobStatus> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getJobStatus(jobId, tenant);

    if (status.status === 'completed' || status.status === 'failed') {
      return status;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  // Timeout - job took too long
  return {
    status: 'failed',
    error: 'Job timed out. Please try again.'
  };
}

/**
 * Get job status for polling - used to check if PDF generation is complete
 */
export async function getClientJobStatus(jobId: string): Promise<ClientJobStatus> {
  const session = await getSession();

  if (!session?.user?.tenant) {
    throw new Error('Unauthorized');
  }

  try {
    return await getJobStatus(jobId, session.user.tenant);
  } catch (error) {
    console.error('Error getting job status:', error);
    throw new Error('Failed to get job status');
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
