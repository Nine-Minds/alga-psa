'use server';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal billing actions intentionally compose billing feature APIs for end-user self-service flows. */

import { getConnection, createTenantKnex, withTransaction, tenantDb, resolveEffectiveTimeZone } from '@alga-psa/db';
import { toCalendarDateString, toCalendarDateStringInTimeZone } from '@alga-psa/core';
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
import { scheduleInvoiceEmailAction } from '@alga-psa/billing/actions/invoiceJobActions';
import { JobStatus } from '@alga-psa/types';
import { normalizeLiveRecurringStorage } from '@alga-psa/shared/billingClients/recurrenceStorageModel';
import { getAvailableCredit } from '@alga-psa/billing/lib/creditBalance';
import { onQuoteAccepted } from '@alga-psa/opportunities/lib/quoteLifecycleHooks';
import {
  getClientIdFromPortalUser as getClientIdFromUser,
  hasClientBillingReadPermission as hasBillingPermission,
} from './clientBillingPermissions';

export type ClientBillingActionError =
  | { readonly actionError: string }
  | { readonly permissionError: string };

export type ClientBillingActionResult<T> = T | ClientBillingActionError;

function actionError(message: string): ClientBillingActionError {
  return { actionError: message };
}

/**
 * Whole-day difference between two YYYY-MM-DD calendar dates (`to` minus
 * `from`). Computed via Date.UTC on the calendar components so it is host-
 * timezone independent (no local Date math), matching the tenant-calendar
 * invariant used for hour-block expiring-soon badges.
 */
function calendarDayDifference(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000);
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

export interface ClientPortalCredit {
  credit_id: string;
  description: string | null;
  amount: number;
  remaining_amount: number;
  created_at: string;
  expiration_date: string | null;
  is_expired: boolean;
  currency_code: string | null;
}

export interface ClientPortalCreditSummary {
  available_credit: number;
  credits: ClientPortalCredit[];
}

/**
 * The client's available credit (derived from non-expired credit_tracking
 * remainders) plus their credit history, for portal billing surfaces.
 */
export const getClientCreditSummary = withAuth(async (user, { tenant }): Promise<ClientBillingActionResult<ClientPortalCreditSummary>> => {
  const knex = await getConnection(tenant);

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await getClientIdFromUser(trx, user, tenant);
      if (!clientId) {
        return permissionError('Unauthorized');
      }

      const hasAccess = await hasBillingPermission(trx, user, tenant);
      if (!hasAccess) {
        return permissionError('Unauthorized to access billing data');
      }

      const db = tenantDb(trx, tenant);
      const [availableCredit, credits] = await Promise.all([
        getAvailableCredit(trx, tenant, clientId),
        db.table('credit_tracking')
          .where({ 'credit_tracking.client_id': clientId, 'credit_tracking.tenant': tenant })
          .modify((q: Knex.QueryBuilder) =>
            db.tenantJoin(q, 'transactions', 'credit_tracking.transaction_id', 'transactions.transaction_id', { type: 'left' })
          )
          .select(
            'credit_tracking.credit_id',
            'credit_tracking.amount',
            'credit_tracking.remaining_amount',
            'credit_tracking.created_at',
            'credit_tracking.expiration_date',
            'credit_tracking.is_expired',
            'credit_tracking.currency_code',
            { description: 'transactions.description' }
          )
          .orderBy('credit_tracking.created_at', 'desc')
          .limit(50),
      ]);

      return {
        available_credit: availableCredit,
        credits: credits.map((row: Record<string, unknown>) => ({
          credit_id: String(row.credit_id),
          description: (row.description as string) ?? null,
          amount: Number(row.amount ?? 0),
          remaining_amount: Number(row.remaining_amount ?? 0),
          created_at: String(row.created_at),
          // LEVERAGE: friction pg-date-stringify — same unsafe String(pg DATE) mapping as the hour-block surface (fixed on the branch); consolidate on toCalendarDateString.
          expiration_date: row.expiration_date ? String(row.expiration_date) : null,
          is_expired: Boolean(row.is_expired),
          currency_code: (row.currency_code as string) ?? null,
        })),
      };
    });
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching client credit summary:', error);
    throw error;
  }
});

export interface ClientPortalCreditHistoryEntry {
  transaction_id: string;
  type: string;
  description: string | null;
  amount: number;
  balance_after: number | null;
  created_at: string;
  invoice_id: string | null;
  invoice_number: string | null;
  currency_code: string | null;
}

/**
 * Recent credit transactions for the portal client, newest first (limit 20).
 *
 * This mirrors the MSP `getCreditHistory` query shape but runs under portal
 * auth: the caller's client is resolved from the portal user and gated by the
 * client billing read permission. Only a whitelist of credit-bearing types is
 * returned, and the row shape deliberately excludes MSP-internal fields
 * (metadata, parent/related transaction ids) — the ledger only needs the
 * signed amount, the running balance, and an invoice reference when one exists.
 */
export const getClientCreditHistory = withAuth(async (user, { tenant }): Promise<ClientBillingActionResult<ClientPortalCreditHistoryEntry[]>> => {
  const knex = await getConnection(tenant);

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await getClientIdFromUser(trx, user, tenant);
      if (!clientId) {
        return permissionError('Unauthorized');
      }

      const hasAccess = await hasBillingPermission(trx, user, tenant);
      if (!hasAccess) {
        return permissionError('Unauthorized to access billing data');
      }

      const db = tenantDb(trx, tenant);
      const query = db.table('transactions as t')
        .where({
          't.client_id': clientId,
          't.tenant': tenant,
        })
        .whereIn('t.type', [
          'credit_issuance',
          'prepayment',
          'credit_application',
          'credit_adjustment',
          'credit_expiration',
          'credit_transfer',
          'credit_issuance_from_negative_invoice',
        ])
        .select(
          't.transaction_id',
          't.type',
          't.description',
          't.amount',
          't.balance_after',
          't.created_at',
          't.invoice_id',
          't.currency_code',
          { invoice_number: 'i.invoice_number' }
        )
        .orderBy('t.created_at', 'desc')
        .limit(20);
      db.tenantJoin(query, 'invoices as i', 't.invoice_id', 'i.invoice_id', { type: 'left' });

      const rows = await query;

      return rows.map((row: Record<string, unknown>) => ({
        transaction_id: String(row.transaction_id),
        type: String(row.type),
        description: row.description ? String(row.description) : null,
        amount: Number(row.amount ?? 0),
        balance_after: row.balance_after != null ? Number(row.balance_after) : null,
        created_at: String(row.created_at),
        invoice_id: row.invoice_id ? String(row.invoice_id) : null,
        invoice_number: row.invoice_number ? String(row.invoice_number) : null,
        currency_code: row.currency_code ? String(row.currency_code) : null,
      }));
    });
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching client credit history:', error);
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
  const knex = await getConnection(tenant);

  try {
    // Same client-context + billing read gate as the other client billing actions
    const accessError = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await getClientIdFromUser(trx, user, tenant);
      if (!clientId) {
        return permissionError('Unauthorized');
      }

      const hasAccess = await hasBillingPermission(trx, user, tenant);
      if (!hasAccess) {
        return permissionError('Unauthorized to access invoice data');
      }

      return null;
    });

    if (accessError) {
      return accessError;
    }

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
 * Download invoice PDF - returns the stored PDF when one exists, otherwise
 * schedules generation, waits for completion, and returns the file ID.
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

    // Serve the document that was issued rather than re-rendering it — the copy
    // published to the client first, so a later MSP-side re-render cannot change
    // what they download. Invoices generated before documents were filed fall
    // through to the job below.
    const scopedDb = tenantDb(knex, tenant);
    const docQuery = scopedDb.table('document_associations as da')
      .where({
        'da.entity_id': invoiceId,
        'da.entity_type': 'invoice',
      })
      .whereNotNull('d.file_id')
      // Only the published copy: an MSP-side render stays hidden until the
      // invoice is sent, and serving its file id would just 403 at download.
      .where('d.is_client_visible', true)
      .orderBy('da.created_at', 'desc')
      .select('d.file_id')
      .first<{ file_id: string } | undefined>();
    scopedDb.tenantJoin(docQuery, 'documents as d', 'da.document_id', 'd.document_id');
    const storedDoc = await docQuery;

    if (storedDoc?.file_id) {
      return { success: true, fileId: storedDoc.file_id };
    }

    // No stored PDF yet — generate and file one directly, same as the quote
    // path. The zip job exists for MSP bulk export and resolves its acting
    // user from the request session, which a background job does not have.
    const invoice = await tenantDb(knex, tenant).table('invoices')
      .where({ invoice_id: invoiceId })
      .first<{ invoice_number?: string | null } | undefined>('invoice_number');

    const { createPDFGenerationService } = await import('@alga-psa/billing/services');
    const pdfService = createPDFGenerationService(tenant);
    const fileRecord = await pdfService.generateAndStore({
      invoiceId,
      invoiceNumber: invoice?.invoice_number ?? undefined,
      version: 1,
      userId: user.user_id,
    });

    return { success: true, fileId: fileRecord.file_id };
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
  const knex = await getConnection(tenant);

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await getClientIdFromUser(trx, user, tenant);
      if (!clientId) {
        return permissionError('Unauthorized');
      }

      const hasAccess = await hasBillingPermission(trx, user, tenant);
      if (!hasAccess) {
        return permissionError('Unauthorized to access invoice data');
      }

      // Jobs carry no client context — restrict access to jobs the caller
      // created so a portal user cannot read other users' generated artifact
      // fileIds. Report foreign/missing jobs identically to avoid an oracle.
      const job = await tenantDb(trx, tenant).table('jobs')
        .where({ job_id: jobId })
        .first('user_id');
      if (!job || job.user_id !== user.user_id) {
        return actionError('Job not found');
      }

      return await getJobStatus(jobId, tenant);
    });
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

export interface ClientExternalCreditNotice {
  hasExternalCredit: boolean;
  note: string | null;
}

/**
 * Whether the signed-in client holds a credit balance in the MSP's accounting
 * system. Alga has no record of external credits, so between an invoice
 * finalizing and the bookkeeper applying the credit, the customer would
 * otherwise look unpaid in the portal. The MSP sets this flag per client.
 */
export const getClientExternalCreditNotice = withAuth(async (
  user,
  { tenant }
): Promise<ClientExternalCreditNotice> => {
  const knex = await getConnection(tenant);

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientId = await getClientIdFromUser(trx, user, tenant);
    if (!clientId) {
      throw new Error('Unauthorized');
    }

    const row = await trx('client_billing_settings')
      .where({ tenant, client_id: clientId })
      .select('has_external_credit', 'external_credit_note')
      .first();

    return {
      hasExternalCredit: Boolean(row?.has_external_credit),
      note: row?.external_credit_note ?? null
    };
  });
});

export interface ClientPortalHourBlock {
  block_id: string;
  service_name: string;
  total_minutes: number;
  remaining_minutes: number;
  hours_remaining: number;
  hours_total: number;
  expiration_date: string | null;
  status: string;
  currency_code: string | null;
  expiring_soon_days: number | null;
}

export interface ClientPortalHourBlockBurnEntry {
  allocation_id: string;
  minutes: number;
  hours: number;
  entry_date: string | null;
  work_item_title: string | null;
}

/**
 * The signed-in client's hour blocks (active or expiring), newest first. Rows
 * are scoped to the portal user's client and gated by the client billing read
 * permission. No cross-client or MSP-internal fields leak through.
 */
export const getClientHourBlocks = withAuth(async (user, { tenant }): Promise<ClientBillingActionResult<ClientPortalHourBlock[]>> => {
  const knex = await getConnection(tenant);

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await getClientIdFromUser(trx, user, tenant);
      if (!clientId) {
        return permissionError('Unauthorized');
      }

      const hasAccess = await hasBillingPermission(trx, user, tenant);
      if (!hasAccess) {
        return permissionError('Unauthorized to access billing data');
      }

      const db = tenantDb(trx, tenant);
      // "Today" for the expiring-soon badge is the TENANT's calendar date (same
      // invariant as auto-expiration / the burn engine): the badge must be
      // worker-independent, so a UTC server cannot shift a Berlin tenant's
      // "expires in N days". resolveEffectiveTimeZone falls back to UTC.
      const timeZone = await resolveEffectiveTimeZone(trx, tenant);
      const today = toCalendarDateStringInTimeZone(new Date(), timeZone);
      const query = db.table('hour_blocks as hb');
      db.tenantJoin(query, 'service_catalog as sc', 'hb.service_id', 'sc.service_id', { type: 'left' });
      const rows = await query
        .where({ 'hb.client_id': clientId, 'hb.status': 'active' })
        .where('hb.remaining_minutes', '>', 0)
        .select(
          'hb.block_id',
          'hb.total_minutes',
          'hb.remaining_minutes',
          'hb.expiration_date',
          'hb.status',
          'hb.currency_code',
          { service_name: 'sc.service_name' },
        )
        .orderBy('hb.purchased_at', 'asc')
        .orderBy('hb.created_at', 'asc');

      return rows.map((row: Record<string, unknown>) => {
        const remaining = Number(row.remaining_minutes ?? 0);
        const total = Number(row.total_minutes ?? 0);
        let expiringSoonDays: number | null = null;
        // Normalize the pg DATE column to a plain YYYY-MM-DD string (node-postgres
        // materializes DATE as a local-midnight Date, so String() would emit a
        // locale/timezone-dependent blob). The same value also drives the badge.
        let expirationDate: string | null = null;
        if (row.expiration_date) {
          const expDate = toCalendarDateString(row.expiration_date as string | Date | null);
          if (expDate) {
            expirationDate = expDate;
            const days = calendarDayDifference(today, expDate);
            if (days <= 7 && days >= 0) {
              expiringSoonDays = days;
            }
          }
        }
        return {
          block_id: String(row.block_id),
          service_name: (row.service_name as string) ?? 'Prepaid hours',
          total_minutes: total,
          remaining_minutes: remaining,
          hours_remaining: Math.round((remaining / 60) * 10) / 10,
          hours_total: Math.round((total / 60) * 10) / 10,
          expiration_date: expirationDate,
          status: String(row.status),
          currency_code: (row.currency_code as string) ?? null,
          expiring_soon_days: expiringSoonDays,
        };
      });
    });
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching client hour blocks:', error);
    throw error;
  }
});

/**
 * Recent hour-block burn history for the signed-in client (newest first,
 * limit 20). Scoped and permission-gated like getClientHourBlocks.
 */
export const getClientHourBlockBurnHistory = withAuth(async (user, { tenant }): Promise<ClientBillingActionResult<ClientPortalHourBlockBurnEntry[]>> => {
  const knex = await getConnection(tenant);

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await getClientIdFromUser(trx, user, tenant);
      if (!clientId) {
        return permissionError('Unauthorized');
      }

      const hasAccess = await hasBillingPermission(trx, user, tenant);
      if (!hasAccess) {
        return permissionError('Unauthorized to access billing data');
      }

      const db = tenantDb(trx, tenant);
      const query = db.table('hour_block_time_allocations as hba');
      db.tenantJoin(query, 'hour_blocks as hb', 'hba.block_id', 'hb.block_id');
      db.tenantJoin(query, 'time_entries as te', 'hba.time_entry_id', 'te.entry_id', { type: 'left' });
      db.tenantJoin(query, 'tickets as tk', 'te.work_item_id', 'tk.ticket_id', { type: 'left' });
      db.tenantJoin(query, 'project_tasks as pt', 'te.work_item_id', 'pt.task_id', { type: 'left' });
      const rows = await query
        .where({ 'hb.client_id': clientId })
        .select(
          'hba.allocation_id',
          'hba.minutes',
          'hba.created_at',
          'te.work_date',
          'tk.title as ticket_title',
          'pt.task_name as task_title',
        )
        .orderBy('hba.created_at', 'desc')
        .limit(20);

      return rows.map((row: Record<string, unknown>) => ({
        allocation_id: String(row.allocation_id),
        minutes: Number(row.minutes ?? 0),
        hours: Math.round((Number(row.minutes ?? 0) / 60) * 10) / 10,
        entry_date: toCalendarDateString(row.work_date as string | Date | null),
        work_item_title: (row.ticket_title as string) ?? (row.task_title as string) ?? null,
      }));
    });
  } catch (error) {
    const expected = billingActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error fetching client hour block burn history:', error);
    throw error;
  }
});
