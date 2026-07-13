'use server';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal billing actions intentionally compose billing feature APIs for end-user self-service flows. */

import { getConnection, createTenantKnex, withTransaction, tenantDb } from '@alga-psa/db';
import { Knex } from 'knex';
import {
  IClientContractLine,
  IBillingResult,
  IBucketUsage,
  IQuote,
  IQuoteItem,
  IService,
  IQuoteWithClient,
  IUserWithRoles
} from '@alga-psa/types';
import {
  fetchInvoicesByClient,
  getInvoiceLineItems,
  getInvoiceForRendering
} from '@alga-psa/billing/actions/invoiceQueries';
import { getInvoiceTemplates } from '@alga-psa/billing/actions/invoiceTemplates';
import { finalizeInvoice, unfinalizeInvoice } from '@alga-psa/billing/actions/invoiceModification';
import { InvoiceViewModel, IInvoiceTemplate } from '@alga-psa/types';
import Invoice from '@alga-psa/billing/models/invoice';
import Quote from '@alga-psa/billing/models/quote';
import QuoteActivity from '@alga-psa/billing/models/quoteActivity';
import { recalculateQuoteFinancials } from '@alga-psa/billing/services';
import { withAuth } from '@alga-psa/auth';
import { scheduleInvoiceEmailAction, scheduleInvoiceZipAction } from '@alga-psa/billing/actions/invoiceJobActions';
import { JobStatus } from '@alga-psa/types';
import { normalizeLiveRecurringStorage } from '@alga-psa/shared/billingClients/recurrenceStorageModel';
import { onQuoteAccepted } from '@alga-psa/opportunities/lib/quoteLifecycleHooks';

export type ClientBillingActionError =
  | { readonly actionError: string }
  | { readonly permissionError: string };

export type ClientBillingActionResult<T> = T | ClientBillingActionError;

function actionError(message: string): ClientBillingActionError {
  return { actionError: message };
}

function permissionError(message: string): ClientBillingActionError {
  return { permissionError: message };
}

function isClientBillingActionError(value: unknown): value is ClientBillingActionError {
  const candidate = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    (
      (typeof candidate.actionError === 'string') ||
      (typeof candidate.permissionError === 'string')
    )
  );
}

function permissionErrorFrom(error: unknown): ClientBillingActionError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (error.message.startsWith('Unauthorized') || error.message.includes('Permission denied')) {
    return permissionError(error.message);
  }

  return null;
}

function billingActionErrorFrom(error: unknown): ClientBillingActionError | null {
  if (isClientBillingActionError(error)) {
    return error;
  }

  const permission = permissionErrorFrom(error);
  if (permission) {
    return permission;
  }

  if (!(error instanceof Error)) {
    return null;
  }

  switch (error.message) {
    case 'Quote not found after marking viewed':
      return actionError('Quote not found or access denied');
    case 'Quote not found after updating selections':
      return actionError('Quote is no longer available. Refresh the quote and try again.');
    case 'Quote not found after acceptance':
      return actionError('Quote is no longer available. Refresh the quote before accepting it.');
    case 'Quote not found after rejection':
      return actionError('Quote is no longer available. Refresh the quote before rejecting it.');
    case 'Invoice not found after authorization':
      return actionError('Invoice not found or access denied');
    case 'Job not found':
      return actionError('Job not found');
    default:
      return null;
  }
}

class JobNotFoundError extends Error {
  constructor() {
    super('Job not found');
    this.name = 'JobNotFoundError';
  }
}

/**
 * Get clientId from user's contact - avoids nested withAuth calls
 */
async function getClientIdFromUser(
  trx: Knex.Transaction,
  user: IUserWithRoles,
  tenant: string
): Promise<string | null> {
  if (!user.contact_id) return null;

  const contact = await tenantDb(trx, tenant).table('contacts')
    .where({
      contact_name_id: user.contact_id,
    })
    .select('client_id')
    .first();

  return contact?.client_id || null;
}

/**
 * Check if user has billing read permission - avoids nested withAuth calls
 */
async function hasBillingPermission(
  trx: Knex.Transaction,
  user: IUserWithRoles,
  tenant: string
): Promise<boolean> {
  const scopedDb = tenantDb(trx, tenant);
  const permissionsQuery = scopedDb.table('role_permissions as rp')
    .where({
      'ur.user_id': user.user_id,
      'p.resource': 'billing',
      'p.action': 'read'
    })
    .first();
  scopedDb.tenantJoin(permissionsQuery, 'permissions as p', 'rp.permission_id', 'p.permission_id');
  scopedDb.tenantJoin(permissionsQuery, 'user_roles as ur', 'rp.role_id', 'ur.role_id');
  const permissions = await permissionsQuery;

  return !!permissions;
}

async function getAuthorizedClientQuote(
  trx: Knex.Transaction,
  user: IUserWithRoles,
  tenant: string,
  quoteId: string,
  allowedStatuses?: string[]
): Promise<ClientBillingActionResult<IQuote>> {
  const clientId = await getClientIdFromUser(trx, user, tenant);
  if (!clientId) {
    return permissionError('Unauthorized');
  }

  const hasAccess = await hasBillingPermission(trx, user, tenant);
  if (!hasAccess) {
    return permissionError('Unauthorized to access quote data');
  }

  const quote = await Quote.getById(trx, tenant, quoteId);
  if (!quote || quote.client_id !== clientId || quote.is_template || quote.status === 'draft') {
    return actionError('Quote not found or access denied');
  }

  if (allowedStatuses?.length && (!quote.status || !allowedStatuses.includes(quote.status))) {
    return actionError('Quote is not in a valid state for this action');
  }

  return quote;
}

async function validateClientInvoiceAccess(
  trx: Knex.Transaction,
  user: IUserWithRoles,
  tenant: string,
  invoiceId: string
): Promise<ClientBillingActionError | null> {
  const clientId = await getClientIdFromUser(trx, user, tenant);
  if (!clientId) {
    return permissionError('Unauthorized');
  }

  const hasAccess = await hasBillingPermission(trx, user, tenant);
  if (!hasAccess) {
    return permissionError('Unauthorized to access invoice data');
  }

  const invoiceCheck = await tenantDb(trx, tenant).table('invoices')
    .where({
      invoice_id: invoiceId,
      client_id: clientId,
    })
    .whereNot('status', 'draft')
    .first();

  if (!invoiceCheck) {
    return actionError('Invoice not found or access denied');
  }

  return null;
}

async function persistOptionalQuoteSelections(
  trx: Knex.Transaction,
  tenant: string,
  quoteId: string,
  quoteItems: IQuoteItem[],
  selectedOptionalQuoteItemIds: string[]
): Promise<{ selectedIds: string[]; deselectedIds: string[] }> {
  const optionalItems = quoteItems.filter((item) => item.is_optional);
  const optionalItemIds = new Set(optionalItems.map((item) => item.quote_item_id));
  const selectedIds = selectedOptionalQuoteItemIds.filter((itemId) => optionalItemIds.has(itemId));
  const selectedSet = new Set(selectedIds);

  for (const item of optionalItems) {
    await tenantDb(trx, tenant).table('quote_items')
      .where({ quote_item_id: item.quote_item_id })
      .update({
        is_selected: selectedSet.has(item.quote_item_id),
        updated_at: trx.fn.now(),
      });
  }

  await recalculateQuoteFinancials(trx, tenant, quoteId);

  return {
    selectedIds,
    deselectedIds: optionalItems
      .map((item) => item.quote_item_id)
      .filter((itemId) => !selectedSet.has(itemId)),
  };
}

export const getClientContractLine = withAuth(async (user, { tenant }): Promise<ClientBillingActionResult<IClientContractLine | null>> => {
  const knex = await getConnection(tenant);

  try {
    const plan = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await getClientIdFromUser(trx, user, tenant);
      if (!clientId) {
        return permissionError('Unauthorized');
      }

      // Query via client_contracts -> contracts -> contract_lines
      // (contracts are client-specific via client_contracts)
      const scopedDb = tenantDb(trx, tenant);
      const planQuery = scopedDb.table('client_contracts as cc')
        .where({
          'cc.client_id': clientId,
        })
        .select(
          'cl.contract_line_id',
          'cl.contract_line_name',
          'cl.billing_frequency',
          'cl.billing_timing',
          'cl.cadence_owner',
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
      scopedDb.tenantJoin(planQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');
      scopedDb.tenantJoin(planQuery, 'contract_lines as cl', 'c.contract_id', 'cl.contract_id');
      scopedDb.tenantJoin(planQuery, 'service_categories as sc', 'cl.service_category', 'sc.category_id', { type: 'left' });
      return await planQuery as any;
    });

    if (isClientBillingActionError(plan)) {
      return plan;
    }

    return plan ? normalizeLiveRecurringStorage(plan as any) as IClientContractLine : null;
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching client contract line:', error);
    throw error;
  }
});

/**
 * Fetch all invoices for the current client
 */
export const getClientInvoices = withAuth(async (user, { tenant }): Promise<ClientBillingActionResult<InvoiceViewModel[]>> => {
  const knex = await getConnection(tenant);

  try {
    // Get clientId and check permissions in a single transaction
    const clientId = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const id = await getClientIdFromUser(trx, user, tenant);
      if (!id) {
        return permissionError('Unauthorized');
      }

      const hasAccess = await hasBillingPermission(trx, user, tenant);
      if (!hasAccess) {
        return permissionError('Unauthorized to access invoice data');
      }

      return id;
    });

    if (isClientBillingActionError(clientId)) {
      return clientId;
    }

    // Directly fetch only invoices for the current client
    const invoices = await fetchInvoicesByClient(clientId);
    if (isClientBillingActionError(invoices)) {
      return invoices;
    }
    // Filter out draft invoices - only finalized invoices should be visible in client portal
    // An invoice is finalized when finalized_at is set (not null)
    return invoices.filter(invoice => invoice.finalized_at != null);
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching client invoices:', error);
    throw error;
  }
});

export const getClientQuotes = withAuth(async (user, { tenant }): Promise<ClientBillingActionResult<IQuoteWithClient[]>> => {
  const knex = await getConnection(tenant);

  try {
    const clientId = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const id = await getClientIdFromUser(trx, user, tenant);
      if (!id) {
        return permissionError('Unauthorized');
      }

      const hasAccess = await hasBillingPermission(trx, user, tenant);
      if (!hasAccess) {
        return permissionError('Unauthorized to access quote data');
      }

      return id;
    });

    if (isClientBillingActionError(clientId)) {
      return clientId;
    }

    const quotes = await Quote.listByClient(knex, tenant, clientId);
    return quotes.filter((quote) => quote.status && quote.status !== 'draft');
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching client quotes:', error);
    throw error;
  }
});

export const getClientQuoteById = withAuth(async (user, { tenant }, quoteId: string): Promise<ClientBillingActionResult<IQuote>> => {
  const knex = await getConnection(tenant);

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const quote = await getAuthorizedClientQuote(trx, user, tenant, quoteId);
      if (isClientBillingActionError(quote)) {
        return quote;
      }

      if (!quote.viewed_at) {
        const viewedAt = new Date().toISOString();

        const markedViewed = await tenantDb(trx, tenant).table('quotes')
          .where({ quote_id: quoteId })
          .whereNull('viewed_at')
          .update({
            viewed_at: viewedAt,
            updated_at: trx.fn.now(),
            updated_by: user.user_id,
          });

        if (markedViewed) {
          await QuoteActivity.create(trx, tenant, {
            quote_id: quoteId,
            activity_type: 'viewed',
            description: 'Quote viewed by client in portal',
            performed_by: user.user_id,
            metadata: {
              viewed_at: viewedAt,
            },
          });
        }
      }

      const updatedQuote = await Quote.getById(trx, tenant, quoteId);
      if (!updatedQuote) {
        return actionError('Quote not found or access denied');
      }

      return updatedQuote;
    });
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching client quote details:', error);
    throw error;
  }
});

export const updateClientQuoteSelections = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  selectedOptionalQuoteItemIds: string[]
): Promise<ClientBillingActionResult<IQuote>> => {
  const knex = await getConnection(tenant);

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const quote = await getAuthorizedClientQuote(trx, user, tenant, quoteId, ['sent']);
      if (isClientBillingActionError(quote)) {
        return quote;
      }

      await persistOptionalQuoteSelections(
        trx,
        tenant,
        quoteId,
        quote.quote_items || [],
        selectedOptionalQuoteItemIds
      );

      const updatedQuote = await Quote.getById(trx, tenant, quoteId);
      if (!updatedQuote) {
        return actionError('Quote is no longer available. Refresh the quote and try again.');
      }

      return updatedQuote;
    });
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error updating client quote selections:', error);
    throw error;
  }
});

export const acceptClientQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  selectedOptionalQuoteItemIds: string[] = []
): Promise<ClientBillingActionResult<IQuote>> => {
  const knex = await getConnection(tenant);

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const quote = await getAuthorizedClientQuote(trx, user, tenant, quoteId, ['sent']);
      if (isClientBillingActionError(quote)) {
        return quote;
      }

      const { selectedIds, deselectedIds } = await persistOptionalQuoteSelections(
        trx,
        tenant,
        quoteId,
        quote.quote_items || [],
        selectedOptionalQuoteItemIds
      );

      const acceptedAt = new Date().toISOString();
      await Quote.update(trx, tenant, quoteId, {
        status: 'accepted',
        accepted_at: acceptedAt,
        accepted_by: user.user_id,
        updated_by: user.user_id,
      });

      await QuoteActivity.create(trx, tenant, {
        quote_id: quoteId,
        activity_type: 'accepted',
        description: 'Quote accepted by client for MSP review',
        performed_by: user.user_id,
        metadata: {
          selected_optional_quote_item_ids: selectedIds,
          deselected_optional_quote_item_ids: deselectedIds,
        },
      });

      const acceptedQuote = await Quote.getById(trx, tenant, quoteId);
      if (!acceptedQuote) {
        return actionError('Quote is no longer available. Refresh the quote before accepting it.');
      }

      await onQuoteAccepted(trx, acceptedQuote);

      return acceptedQuote;
    });
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error accepting client quote:', error);
    throw error;
  }
});

export const rejectClientQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  rejectionReason: string
): Promise<ClientBillingActionResult<IQuote>> => {
  const knex = await getConnection(tenant);
  const trimmedReason = rejectionReason.trim();

  if (!trimmedReason) {
    return actionError('A rejection comment is required');
  }

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const quote = await getAuthorizedClientQuote(trx, user, tenant, quoteId, ['sent']);
      if (isClientBillingActionError(quote)) {
        return quote;
      }

      const rejectedAt = new Date().toISOString();
      await Quote.update(trx, tenant, quoteId, {
        status: 'rejected',
        rejected_at: rejectedAt,
        rejection_reason: trimmedReason,
        updated_by: user.user_id,
      });

      await QuoteActivity.create(trx, tenant, {
        quote_id: quoteId,
        activity_type: 'rejected',
        description: 'Quote rejected by client',
        performed_by: user.user_id,
        metadata: {
          rejection_reason: trimmedReason,
        },
      });

      const rejectedQuote = await Quote.getById(trx, tenant, quoteId);
      if (!rejectedQuote) {
        return actionError('Quote is no longer available. Refresh the quote before rejecting it.');
      }

      return rejectedQuote;
    });
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error rejecting client quote:', error);
    throw error;
  }
});

/**
 * Get invoice details by ID
 */
export const getClientInvoiceById = withAuth(async (user, { tenant }, invoiceId: string): Promise<ClientBillingActionResult<InvoiceViewModel>> => {
  const knex = await getConnection(tenant);

  try {
    // Get clientId, check permissions, and verify invoice in a single transaction
    const accessError = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return validateClientInvoiceAccess(trx, user, tenant, invoiceId);
    });

    if (accessError) {
      return accessError;
    }

    // Get full invoice details
    const invoice = await getInvoiceForRendering(invoiceId);
    if (isClientBillingActionError(invoice)) {
      return invoice;
    }
    if (!invoice) {
      return actionError('Invoice not found or access denied');
    }
    return invoice;
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching client invoice details:', error);
    throw error;
  }
});

/**
 * Get invoice line items
 */
export const getClientInvoiceLineItems = withAuth(async (user, { tenant }, invoiceId: string) => {
  const knex = await getConnection(tenant);

  try {
    // Get clientId, check permissions, and verify invoice in a single transaction
    const accessError = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return validateClientInvoiceAccess(trx, user, tenant, invoiceId);
    });

    if (accessError) {
      return accessError;
    }

    // Get invoice items
    const lineItems = await getInvoiceLineItems(invoiceId);
    if (isClientBillingActionError(lineItems)) {
      return lineItems;
    }
    return lineItems;
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching client invoice line items:', error);
    throw error;
  }
});

/**
 * Get invoice templates
 */
export const getClientInvoiceTemplates = withAuth(async (user, { tenant }): Promise<ClientBillingActionResult<IInvoiceTemplate[]>> => {
  try {
    // Get all templates (both standard and tenant-specific)
    const templates = await getInvoiceTemplates();
    if (isClientBillingActionError(templates)) {
      return templates;
    }
    return templates;
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching invoice templates:', error);
    throw error;
  }
});

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
export const downloadClientInvoicePdf = withAuth(async (user, { tenant }, invoiceId: string): Promise<ClientBillingActionResult<DownloadPdfResult>> => {
  const knex = await getConnection(tenant);

  try {
    // Get clientId, check permissions, and verify invoice in a single transaction
    const accessError = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return validateClientInvoiceAccess(trx, user, tenant, invoiceId);
    });

    if (accessError) {
      return accessError;
    }

    // Schedule PDF generation
    const result = await scheduleInvoiceZipAction([invoiceId]);

    if (isClientBillingActionError(result)) {
      return result;
    }

    if (!result?.jobId) {
      return actionError('Failed to start PDF generation');
    }

    // Poll until job completes
    const status = await pollJobUntilComplete(result.jobId, tenant);

    if (status.status === 'completed' && status.fileId) {
      return { success: true, fileId: status.fileId };
    } else {
      return actionError(status.error || 'PDF generation failed');
    }
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error downloading invoice PDF:', error);
    throw error;
  }
});

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
export const sendClientInvoiceEmail = withAuth(async (user, { tenant }, invoiceId: string): Promise<ClientBillingActionResult<SendEmailResult>> => {
  const knex = await getConnection(tenant);

  try {
    // Get clientId, check permissions, and verify invoice in a single transaction
    const accessError = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return validateClientInvoiceAccess(trx, user, tenant, invoiceId);
    });

    if (accessError) {
      return accessError;
    }

    // Schedule email sending
    const result = await scheduleInvoiceEmailAction([invoiceId]);

    if (isClientBillingActionError(result)) {
      return result;
    }

    if (!result?.jobId) {
      return actionError('Failed to start email sending');
    }

    // Poll until job completes
    const status = await pollJobUntilComplete(result.jobId, tenant);

    if (status.status === 'completed') {
      return { success: true };
    } else {
      return actionError(status.error || 'Email sending failed');
    }
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error sending invoice email:', error);
    throw error;
  }
});

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
  const { knex } = await createTenantKnex(tenant);

  // Get job record
  const scopedDb = tenantDb(knex, tenant);

  const job = await scopedDb.table('jobs')
    .where({ job_id: jobId })
    .first();

  if (!job) {
    throw new JobNotFoundError();
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
    const details = await scopedDb.table('job_details')
      .where({ job_id: jobId })
      .select('metadata');
    // Look for file_id in the metadata of completed steps
    for (const detail of details) {
      const metadata = (typeof detail.metadata === 'string'
        ? JSON.parse(detail.metadata)
        : detail.metadata) as Record<string, unknown> | undefined;
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
export const getClientJobStatus = withAuth(async (user, { tenant }, jobId: string): Promise<ClientBillingActionResult<ClientJobStatus>> => {
  try {
    return await getJobStatus(jobId, tenant);
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error getting job status:', error);
    throw error;
  }
});

export const getCurrentUsage = withAuth(async (user, { tenant }): Promise<ClientBillingActionResult<{
  bucketUsage: IBucketUsage | null;
  services: IService[];
}>> => {
  const knex = await getConnection(tenant);

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await getClientIdFromUser(trx, user, tenant);
      if (!clientId) {
        return permissionError('Unauthorized');
      }

      const currentDate = new Date().toISOString().slice(0, 10);
      const scopedDb = tenantDb(trx, tenant);

      // Get current bucket usage if any
      const bucketUsage = await scopedDb.table('bucket_usage')
        .select('*')
        .where({
          client_id: clientId,
        })
        .andWhere('period_start', '<=', currentDate)
        .andWhere('period_end', '>', currentDate)
        .orderBy('period_start', 'desc')
        .first();

      // Get all services associated with the client's plan
      const servicesQuery = scopedDb.table('service_catalog')
        .select('service_catalog.*')
        .where({
          'cc.client_id': clientId,
          'cc.is_active': true,
        });
      scopedDb.tenantJoin(servicesQuery, 'contract_line_services', 'service_catalog.service_id', 'contract_line_services.service_id');
      scopedDb.tenantJoin(servicesQuery, 'contract_lines as cl', 'contract_line_services.contract_line_id', 'cl.contract_line_id');
      scopedDb.tenantJoin(servicesQuery, 'client_contracts as cc', 'cl.contract_id', 'cc.contract_id');
      const services = await servicesQuery;

      return {
        bucketUsage: (bucketUsage ?? null) as IBucketUsage | null,
        services: services as unknown as IService[]
      };
    });

    return result;
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching current usage:', error);
    throw error;
  }
});

/**
 * Download quote PDF - looks up the stored PDF file_id for the quote.
 * If no PDF exists yet (quote was created before PDF storage was added),
 * generates and stores one on the fly.
 */
export const downloadClientQuotePdf = withAuth(async (
  user,
  { tenant },
  quoteId: string
): Promise<ClientBillingActionResult<DownloadPdfResult>> => {
  const knex = await getConnection(tenant);

  try {
    const quote = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return getAuthorizedClientQuote(trx, user, tenant, quoteId);
    });
    if (isClientBillingActionError(quote)) {
      return quote;
    }

    // Look for an existing stored PDF document
    const scopedDb = tenantDb(knex, tenant);
    const docQuery = scopedDb.table('document_associations as da')
      .where({
        'da.entity_id': quoteId,
        'da.entity_type': 'quote',
      })
      .whereNotNull('d.file_id')
      .orderBy('da.created_at', 'desc')
      .select('d.file_id')
      .first<{ file_id: string } | undefined>();
    scopedDb.tenantJoin(docQuery, 'documents as d', 'da.document_id', 'd.document_id');
    const doc = await docQuery;

    if (doc?.file_id) {
      return { success: true, fileId: doc.file_id };
    }

    // No stored PDF yet — generate one on the fly
    const { createPDFGenerationService } = await import('@alga-psa/billing/services');
    const pdfService = createPDFGenerationService(tenant);
    const fileRecord = await pdfService.generateAndStore({
      quoteId: quote.quote_id,
      quoteNumber: quote.quote_number ?? undefined,
      userId: user.user_id,
    });

    return { success: true, fileId: fileRecord.file_id };
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error downloading quote PDF:', error);
    throw error;
  }
});

/**
 * Client-portal location summary used for rendering location-grouped
 * quote/invoice detail pages. Returns only the locations referenced by the
 * given quote, scoped to the authenticated client user's own client_id.
 */
export interface ClientPortalLocationSummary {
  location_id: string;
  location_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_line3?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  country_name?: string | null;
  region_code?: string | null;
}

export const getLocationsForClientQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string,
): Promise<ClientBillingActionResult<ClientPortalLocationSummary[]>> => {
  const knex = await getConnection(tenant);

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // Authorizes + confirms the quote belongs to this portal user's client.
    const quote = await getAuthorizedClientQuote(trx, user, tenant, quoteId);
    if (isClientBillingActionError(quote)) {
      return quote;
    }
    if (!quote.client_id) return [];

    return tenantDb(trx, tenant).table('client_locations')
      .select<ClientPortalLocationSummary[]>(
        'location_id',
        'location_name',
        'address_line1',
        'address_line2',
        'address_line3',
        'city',
        'state_province',
        'postal_code',
        'country_code',
        'country_name',
        'region_code',
      )
      .where({ client_id: quote.client_id, is_active: true })
      .orderBy('is_default', 'desc')
      .orderBy('location_name', 'asc');
  });
});
