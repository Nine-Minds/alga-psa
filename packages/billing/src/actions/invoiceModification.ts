// @ts-nocheck
'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { Session } from 'next-auth';
import { Temporal } from '@js-temporal/polyfill';
import { createTenantKnex } from '@alga-psa/db';
import { toISODate } from '@alga-psa/core';
// import { auditLog } from '@alga-psa/db';
import ClientContractLine from '../models/clientContractLine';
import { applyCreditToInvoice } from './creditActions';
import { IInvoiceCharge, InvoiceViewModel, DiscountType } from '@alga-psa/types';
import { BillingEngine } from '../lib/billing/billingEngine';
import ProjectBillingCapUsage from '../models/projectBillingCapUsage';
import ProjectBillingScheduleEntry from '../models/projectBillingScheduleEntry';
import { persistInvoiceCharges, persistManualInvoiceCharges } from '../services/invoiceService'; // Import persistManualInvoiceCharges
import Invoice from '@alga-psa/billing/models/invoice';
import { v4 as uuidv4 } from 'uuid';
// import { getRedisStreamClient } from '@alga-psa/workflow-streams'; // No longer directly used here
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildCreditNoteCreatedPayload,
  buildCreditNoteVoidedPayload,
} from '@alga-psa/workflow-streams';

import { validateInvoiceFinalization } from './taxSourceActions';
import { enqueueInvoiceAutoExport } from '../services/accountingSync/syncProducers';
import { assertInvoiceNotExported } from '../services/accountingSync/invoiceExportGuards';
import { assertInvoiceExportReady, InvoiceExportReadinessError } from '../services/accountingSync/exportReadiness';
import { withAuth } from '@alga-psa/auth';
import { getSession } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import logger from '@alga-psa/core/logger';
import {
  ManualInvoiceError,
  type ManualInvoiceErrorCode,
  type ManualInvoiceFailure,
} from '../errors/manualInvoiceErrors';

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableExpression: string
) {
  return tenantDb(conn, tenant).table<Row>(tableExpression);
}

// Interface definitions specific to manual updates (might move to interfaces file later)
export interface ManualInvoiceUpdate {
  service_id?: string;
  description?: string;
  quantity?: number;
  rate?: number;
  item_id: string;
  is_discount?: boolean;
  discount_type?: DiscountType;
  discount_percentage?: number;
  applies_to_item_id?: string;
  is_taxable?: boolean; // Keep for purely manual items without service
}

interface ManualItemsUpdate {
  newItems: IInvoiceCharge[];
  updatedItems: ManualInvoiceUpdate[]; // This uses the interface above, but it's not used in the functions moved here? Recheck original file.
  removedItemIds: string[];
  invoice_number?: string; // Added based on usage in updateManualInvoiceItems
}

type InvoiceCreditHandlingKind = 'prepayment' | 'negative_total' | 'standard';

function classifyInvoiceCreditHandling(invoice: {
  is_prepayment?: boolean | null;
  total_amount?: number | null;
} | null | undefined): InvoiceCreditHandlingKind {
  if (invoice?.is_prepayment) {
    return 'prepayment';
  }

  if (Number(invoice?.total_amount ?? 0) < 0) {
    return 'negative_total';
  }

  return 'standard';
}

type ProjectCapRollbackDelta = {
  configId: string;
  billed: number;
  writtenDown: number;
  notifiedThresholds?: number[];
};

function normalizeTransactionMetadata(value: unknown): Record<string, any> {
  if (value && typeof value === 'object') {
    return value as Record<string, any>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function releaseProjectBillingForDeletedInvoice(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<void> {
  const invoicedEntries = await tenantScopedTable(trx, tenant, 'project_billing_schedule_entries')
    .where({ invoice_id: invoiceId, status: 'invoiced' })
    .select('schedule_entry_id');

  for (const entry of invoicedEntries) {
    const transitioned = await ProjectBillingScheduleEntry.transitionStatus(
      entry.schedule_entry_id,
      'invoiced',
      'approved',
      {
        invoice_id: null,
        invoice_charge_id: null,
      },
      trx,
    );
    if (!transitioned) {
      throw new Error(
        `Project billing schedule entry ${entry.schedule_entry_id} could not be reverted`,
      );
    }
  }

  const invoiceTransactions = await tenantScopedTable(trx, tenant, 'transactions')
    .where({ invoice_id: invoiceId, type: 'invoice_generated' })
    .select('transaction_id', 'metadata');

  for (const invoiceTransaction of invoiceTransactions) {
    const metadata = normalizeTransactionMetadata(invoiceTransaction.metadata);
    if (metadata.project_billing_cap_rolled_back === true) {
      continue;
    }
    const deltas = Array.isArray(metadata.project_billing_cap_deltas)
      ? metadata.project_billing_cap_deltas as ProjectCapRollbackDelta[]
      : [];
    if (deltas.length === 0) {
      continue;
    }

    for (const delta of deltas) {
      await ProjectBillingCapUsage.ensureRow(delta.configId, trx);
      const usage = await ProjectBillingCapUsage.getForUpdate(delta.configId, trx);
      if (!usage) {
        throw new Error(`Project billing cap usage ${delta.configId} could not be locked`);
      }
      const billedRollback = Math.min(usage.billed_amount, Number(delta.billed) || 0);
      const writtenDownRollback = Math.min(
        usage.written_down_amount,
        Number(delta.writtenDown) || 0,
      );
      await ProjectBillingCapUsage.increment(
        delta.configId,
        { billed: -billedRollback, writtenDown: -writtenDownRollback },
        trx,
      );

      const notifiedThresholds = new Set(delta.notifiedThresholds ?? []);
      if (notifiedThresholds.size > 0) {
        await tenantScopedTable(trx, tenant, 'project_billing_cap_usage')
          .where({ config_id: delta.configId })
          .update({
            notified_thresholds: JSON.stringify(
              usage.notified_thresholds.filter(
                (threshold) => !notifiedThresholds.has(threshold),
              ),
            ),
            updated_at: new Date().toISOString(),
          });
      }
    }

    await tenantScopedTable(trx, tenant, 'transactions')
      .where({ transaction_id: invoiceTransaction.transaction_id })
      .update({
        metadata: {
          ...metadata,
          project_billing_cap_rolled_back: true,
        },
      });
  }
}

async function releaseMaterialsForDeletedInvoice(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<void> {
  const releasedAt = new Date().toISOString();
  for (const tableName of ['project_materials', 'ticket_materials']) {
    await tenantScopedTable(trx, tenant, tableName)
      .where({ billed_invoice_id: invoiceId, is_billed: true })
      .update({
        is_billed: false,
        billed_invoice_id: null,
        billed_at: null,
        updated_at: releasedAt,
      });
  }
}

type ProjectDepositCreditEvent = {
  creditNoteId: string;
  clientId: string;
  createdAt: string;
  createdByUserId: string;
  amount: number;
  currency: string;
  projectId: string;
};

async function issueProjectDepositCreditsForInvoice(
  knex: Knex,
  tenant: string,
  invoice: any,
  userId: string,
): Promise<ProjectDepositCreditEvent[]> {
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const projectDeposit = await tenantScopedTable(
      trx,
      tenant,
      'project_billing_schedule_entries',
    )
      .where({
        invoice_id: invoice.invoice_id,
        entry_type: 'deposit',
        status: 'invoiced',
      })
      .first('schedule_entry_id');
    if (!projectDeposit) {
      return [];
    }

    const db = tenantDb(trx, tenant);
    const depositsQuery = db.table('project_billing_schedule_entries as entry');
    db.tenantJoin(depositsQuery, 'project_billing_configs as config', 'entry.config_id', 'config.config_id');
    db.tenantJoin(depositsQuery, 'invoice_charges as charge', 'entry.invoice_charge_id', 'charge.item_id');
    const deposits = await depositsQuery
      .where({
        'entry.invoice_id': invoice.invoice_id,
        'entry.entry_type': 'deposit',
        'entry.status': 'invoiced',
        'config.deposit_treatment': 'credit',
      })
      .select('config.project_id')
      .sum({ amount: 'charge.net_amount' })
      .groupBy('config.project_id');

    if (deposits.length === 0) {
      return [];
    }

    const client = await tenantScopedTable(trx, tenant, 'clients')
      .where({ client_id: invoice.client_id })
      .forUpdate()
      .first('credit_balance');
    if (!client) {
      throw new Error(`Client ${invoice.client_id} not found`);
    }

    const clientSettings = await tenantScopedTable(trx, tenant, 'client_billing_settings')
      .where({ client_id: invoice.client_id })
      .first();
    const defaultSettings = await tenantScopedTable(trx, tenant, 'default_billing_settings')
      .first();
    const expirationDays = clientSettings?.credit_expiration_days
      ?? defaultSettings?.credit_expiration_days;
    const expirationEnabled = clientSettings?.enable_credit_expiration
      ?? defaultSettings?.enable_credit_expiration
      ?? true;
    const now = new Date().toISOString();
    let expirationDate: string | null = null;
    if (expirationEnabled && Number(expirationDays) > 0) {
      const expiresAt = new Date(now);
      expiresAt.setDate(expiresAt.getDate() + Number(expirationDays));
      expirationDate = expiresAt.toISOString();
    }

    let balance = Number(client.credit_balance ?? 0);
    const events: ProjectDepositCreditEvent[] = [];
    for (const deposit of deposits) {
      const projectId = String(deposit.project_id);
      const amount = Number(deposit.amount ?? 0);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        continue;
      }

      const existing = await tenantScopedTable(trx, tenant, 'transactions')
        .where({
          invoice_id: invoice.invoice_id,
          type: 'credit_issuance',
        })
        .whereRaw("metadata->>'project_billing_credit_kind' = ?", ['project_deposit'])
        .whereRaw("metadata->>'project_id' = ?", [projectId])
        .first('transaction_id');
      if (existing) {
        continue;
      }

      balance += amount;
      const transactionId = uuidv4();
      await tenantScopedTable(trx, tenant, 'transactions').insert({
        transaction_id: transactionId,
        client_id: invoice.client_id,
        invoice_id: invoice.invoice_id,
        amount,
        type: 'credit_issuance',
        status: 'completed',
        description: `Project deposit credit from invoice ${invoice.invoice_number}`,
        created_at: now,
        balance_after: balance,
        tenant,
        expiration_date: expirationDate,
        currency_code: invoice.currency_code ?? 'USD',
        metadata: {
          project_billing_credit_kind: 'project_deposit',
          project_id: projectId,
        },
      });

      const creditNoteId = uuidv4();
      await tenantScopedTable(trx, tenant, 'credit_tracking').insert({
        credit_id: creditNoteId,
        tenant,
        client_id: invoice.client_id,
        transaction_id: transactionId,
        amount,
        remaining_amount: amount,
        created_at: now,
        expiration_date: expirationDate,
        is_expired: false,
        updated_at: now,
        currency_code: invoice.currency_code ?? 'USD',
      });

      events.push({
        creditNoteId,
        clientId: invoice.client_id,
        createdAt: now,
        createdByUserId: userId,
        amount,
        currency: String(invoice.currency_code ?? 'USD'),
        projectId,
      });
    }

    if (events.length > 0) {
      await tenantScopedTable(trx, tenant, 'clients')
        .where({ client_id: invoice.client_id })
        .update({ credit_balance: balance, updated_at: now });
    }

    return events;
  });
}

async function rollbackProjectDepositCreditsForInvoice(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
  clientId: string,
): Promise<void> {
  const transactions = await tenantScopedTable(trx, tenant, 'transactions')
    .where({ invoice_id: invoiceId, type: 'credit_issuance' })
    .whereRaw("metadata->>'project_billing_credit_kind' = ?", ['project_deposit'])
    .select('transaction_id');

  let balanceRollback = 0;
  for (const transaction of transactions) {
    const credit = await tenantScopedTable(trx, tenant, 'credit_tracking')
      .where({ transaction_id: transaction.transaction_id })
      .first();
    if (credit && Number(credit.remaining_amount) !== Number(credit.amount)) {
      throw expectedInvoiceActionError(
        `Cannot reopen invoice ${invoiceId}: its project deposit credit has already been used.`,
      );
    }
    if (credit) {
      balanceRollback += Number(credit.remaining_amount ?? 0);
      await tenantScopedTable(trx, tenant, 'credit_tracking')
        .where({ credit_id: credit.credit_id })
        .delete();
    }
    await tenantScopedTable(trx, tenant, 'transactions')
      .where({ transaction_id: transaction.transaction_id })
      .delete();
  }

  if (balanceRollback > 0) {
    await tenantScopedTable(trx, tenant, 'clients')
      .where({ client_id: clientId })
      .decrement('credit_balance', balanceRollback)
      .update({ updated_at: new Date().toISOString() });
  }
}

async function hasCanonicalRecurringDetailPeriodsForInvoice(
  trx: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  const detailQuery = db.table('invoice_charge_details as iid');
  db.tenantJoin(detailQuery, 'invoice_charges as ic', 'iid.item_id', 'ic.item_id');
  const detailRow = await detailQuery
    .where('ic.invoice_id', invoiceId)
    .whereNotNull('iid.service_period_start')
    .whereNotNull('iid.service_period_end')
    .first('iid.item_detail_id');

  return Boolean(detailRow);
}

async function hasLinkedRecurringServicePeriodsForInvoice(
  trx: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<boolean> {
  const linkedRow = await tenantScopedTable(trx, tenant, 'recurring_service_periods')
    .where({
      tenant,
      invoice_id: invoiceId,
    })
    .first('record_id');

  return Boolean(linkedRow);
}

async function releaseRecurringServicePeriodInvoiceLinkageForInvoice(
  trx: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
  releasedAt: string,
) {
  return tenantScopedTable(trx, tenant, 'recurring_service_periods')
    .where({
      tenant,
      invoice_id: invoiceId,
    })
    .update({
      lifecycle_state: 'locked',
      invoice_id: null,
      invoice_charge_id: null,
      invoice_charge_detail_id: null,
      invoice_linked_at: null,
      updated_at: releasedAt,
    });
}

export interface DraftInvoicePropertiesUpdateInput {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
}

export interface DraftInvoicePropertiesUpdateResult {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
}

class ExpectedInvoiceActionError extends Error {}

type InvoiceActionError = ActionMessageError | ActionPermissionError;
type InvoiceActionSuccess = { success: true };

export type DraftInvoicePropertiesUpdateActionResult =
  | DraftInvoicePropertiesUpdateResult
  | InvoiceActionError;

export type InvoiceMutationActionResult = InvoiceActionSuccess | InvoiceActionError;
export type InvoiceManualItemsUpdateActionResult = InvoiceViewModel | InvoiceActionError | ManualInvoiceFailure;

function expectedInvoiceActionError(message: string): ExpectedInvoiceActionError {
  return new ExpectedInvoiceActionError(message);
}

function toInvoiceActionError(error: unknown): InvoiceActionError | null {
  if (error instanceof ExpectedInvoiceActionError) {
    return actionError(error.message);
  }

  return null;
}

function manualInvoiceUpdateFailure(
  code: Exclude<ManualInvoiceErrorCode, 'UNEXPECTED'>,
  message: string,
  context: Record<string, string>,
  params: Record<string, string> = {},
): ManualInvoiceFailure {
  logger.warn(`[updateInvoiceManualItems] ${code}`, {
    ...context,
    ...params,
  });

  return {
    success: false,
    code,
    params,
    message,
    error: message,
  };
}

function unexpectedManualInvoiceUpdateFailure(
  error: unknown,
  context: Record<string, string>,
): ManualInvoiceFailure {
  const ref = crypto.randomUUID().slice(0, 8);
  const message = 'Unexpected error updating invoice';
  logger.error('[updateInvoiceManualItems] UNEXPECTED', {
    ...context,
    ref,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return {
    success: false,
    code: 'UNEXPECTED',
    params: { ref },
    message,
    error: message,
    ref,
  };
}

function isManualInvoiceNumberConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const databaseError = error as { code?: string; constraint?: string };
  return databaseError.code === '23505' &&
    databaseError.constraint === 'unique_invoice_number_per_tenant';
}

export const updateDraftInvoiceProperties = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  input: DraftInvoicePropertiesUpdateInput
): Promise<DraftInvoicePropertiesUpdateActionResult> => {
  if (!await hasPermission(user, 'invoice', 'update')) {
    return permissionError('Permission denied: invoice update required');
  }
  const trimmedInvoiceNumber = input.invoiceNumber?.trim();

  if (!trimmedInvoiceNumber) {
    return actionError('Invoice number is required');
  }

  if (!input.invoiceDate) {
    return actionError('Invoice date is required');
  }

  let normalizedInvoiceDate: string;
  let normalizedDueDate: string | null = null;

  try {
    normalizedInvoiceDate = toISODate(Temporal.PlainDate.from(input.invoiceDate));
  } catch {
    return actionError('Invoice date is invalid');
  }

  if (input.dueDate) {
    try {
      normalizedDueDate = toISODate(Temporal.PlainDate.from(input.dueDate));
    } catch {
      return actionError('Due date is invalid');
    }
  }

  const currentDate = Temporal.Now.plainDateISO().toString();
  const { knex } = await createTenantKnex();
  let expectedError: InvoiceActionError | null = null;

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const invoice = await tenantScopedTable(trx, tenant, 'invoices')
      .where({
        invoice_id: invoiceId,
        tenant,
      })
      .first();

    if (!invoice) {
      expectedError = actionError('Invoice not found');
      return;
    }

    if (invoice.finalized_at || invoice.status !== 'draft') {
      expectedError = actionError('Only draft invoices can be edited');
      return;
    }

    const duplicateInvoice = await tenantScopedTable(trx, tenant, 'invoices')
      .where({
        tenant,
        invoice_number: trimmedInvoiceNumber,
      })
      .whereNot({ invoice_id: invoiceId })
      .first('invoice_id');

    if (duplicateInvoice) {
      expectedError = actionError('Invoice number already exists. Choose a different number.');
      return;
    }

    try {
      await tenantScopedTable(trx, tenant, 'invoices')
        .where({
          invoice_id: invoiceId,
          tenant,
        })
        .update({
          invoice_number: trimmedInvoiceNumber,
          invoice_date: normalizedInvoiceDate,
          due_date: normalizedDueDate,
          updated_at: currentDate,
        });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505' &&
        'constraint' in error &&
        error.constraint === 'unique_invoice_number_per_tenant'
      ) {
        expectedError = actionError('Invoice number already exists. Choose a different number.');
        return;
      }

      throw error;
    }
  });

  if (expectedError) {
    return expectedError;
  }

  return {
    invoiceId,
    invoiceNumber: trimmedInvoiceNumber,
    invoiceDate: normalizedInvoiceDate,
    dueDate: normalizedDueDate,
  };
});

export const finalizeInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<InvoiceMutationActionResult> => {
  if (!await hasPermission(user, 'invoice', 'update')) {
    return permissionError('Permission denied: invoice update required');
  }
  const { knex } = await createTenantKnex();

  try {
    await finalizeInvoiceWithKnex(invoiceId, knex, tenant, user.user_id);
  } catch (error) {
    const expectedError = toInvoiceActionError(error);
    if (expectedError) {
      return expectedError;
    }

    throw error;
  }

  return { success: true };
});

export async function finalizeInvoiceWithKnex(
  invoiceId: string,
  knex: Knex,
  tenant: string,
  userId: string
): Promise<void> {
  let invoice: any;
  let projectDepositCreditEvents: ProjectDepositCreditEvent[] = [];
  let createdCreditNote: {
    creditNoteId: string;
    clientId: string;
    createdAt: string;
    createdByUserId: string;
    amount: number;
    currency: string;
    sourceDocumentKind: 'prepayment_invoice' | 'negative_invoice';
    sourceInvoiceId: string;
    sourceInvoiceNumber: string | null;
    sourceInvoiceStatus: string | null;
    sourceInvoiceDateBasis: 'financial_document_date' | 'canonical_recurring_service_period';
    sourceServicePeriodStart: string | null;
    sourceServicePeriodEnd: string | null;
  } | null = null;

  // Validate tax source before finalization
  const taxValidation = await validateInvoiceFinalization(invoiceId);
  if (isActionMessageError(taxValidation) || isActionPermissionError(taxValidation)) {
    throw expectedInvoiceActionError(getErrorMessage(taxValidation));
  }
  if (!taxValidation.canFinalize) {
    throw expectedInvoiceActionError(taxValidation.error || 'Invoice cannot be finalized');
  }

  // When this invoice will auto-export to QBO, block finalize on deterministic
  // export failures (line without a service, unmapped service) so the fix
  // happens here rather than in the sync exception inbox.
  try {
    await assertInvoiceExportReady(knex, tenant, invoiceId);
  } catch (error) {
    if (error instanceof InvoiceExportReadinessError) {
      throw expectedInvoiceActionError(error.message);
    }
    throw error;
  }

  // First transaction to update invoice status
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check if invoice exists and is not already finalized
    invoice = await tenantScopedTable(trx, tenant, 'invoices')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .first();

    if (!invoice) {
      throw expectedInvoiceActionError('Invoice not found');
    }

    if (invoice.finalized_at) {
      throw expectedInvoiceActionError('Invoice is already finalized');
    }

    // Financial-document identity is fixed at finalization: negative-total
    // invoices become credit notes (CM-numbered), prepayments are tagged so
    // downstream consumers (export validation, void guards) can rely on it.
    const handlingKind = classifyInvoiceCreditHandling(invoice);
    const identityUpdates: Record<string, unknown> = {};
    if (handlingKind === 'negative_total') {
      identityUpdates.invoice_type = 'credit_note';
      const { SharedNumberingService } = await import('@alga-psa/shared/services/numberingService');
      identityUpdates.invoice_number = await SharedNumberingService.getNextNumber('CREDIT_NOTE', {
        knex: trx,
        tenant
      });
    } else if (handlingKind === 'prepayment') {
      identityUpdates.invoice_type = 'prepayment';
    }

    await tenantScopedTable(trx, tenant, 'invoices')
      .where({ invoice_id: invoiceId })
      .update({
        status: 'sent',
        finalized_at: toISODate(Temporal.Now.plainDateISO()),
        updated_at: toISODate(Temporal.Now.plainDateISO()),
        ...identityUpdates
      });

    if (Object.keys(identityUpdates).length > 0) {
      invoice = { ...invoice, ...identityUpdates };
    }

    // Record audit log
    // await auditLog(
    //   trx,
    //   {
    //     userId: userId,
    //     operation: 'invoice_finalized',
    //     tableName: 'invoices',
    //     recordId: invoiceId,
    //     changedData: { finalized_at: toISODate(Temporal.Now.plainDateISO()) },
    //     details: {
    //       action: 'Invoice finalized',
    //       invoiceNumber: invoice.invoice_number
    //     }
    //   }
    // );
  });

  // Prepayments and negative invoices use explicit financial-document classification.
  const invoiceCreditHandlingKind = classifyInvoiceCreditHandling(invoice);

  if (invoice && invoiceCreditHandlingKind === 'prepayment') {
    // For prepayment invoices, update the client's credit balance
    await ClientContractLine.updateClientCredit(invoice.client_id, invoice.subtotal);

    // Log the credit update
    console.log(`Updated credit balance for client ${invoice.client_id} by ${invoice.subtotal} from prepayment invoice ${invoiceId}`);
  }
  // Handle regular invoices with negative totals
  else if (invoice && invoiceCreditHandlingKind === 'negative_total') {
    // Get absolute value of negative total
    const creditAmount = Math.abs(invoice.total_amount);

    // Update client credit balance and record transaction in a single transaction
    // We handle this directly without using ClientContractLine.updateClientCredit to avoid validation issues
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const now = new Date().toISOString();
      // Get current credit balance
      const client = await tenantScopedTable(trx, tenant, 'clients')
        .where({ client_id: invoice.client_id })
        .select('credit_balance')
        .first();

      if (!client) {
        throw new Error(`Client ${invoice.client_id} not found`);
      }

      // Get client's credit expiration settings or default settings
      const clientSettings = await tenantScopedTable(trx, tenant, 'client_billing_settings')
        .where({
          client_id: invoice.client_id
        })
        .first();

      const defaultSettings = await tenantScopedTable(trx, tenant, 'default_billing_settings')
        .first();

      // Determine expiration days - use client setting if available, otherwise use default
      let expirationDays: number | undefined;
      if (clientSettings?.credit_expiration_days != null) {
        expirationDays = clientSettings.credit_expiration_days;
      } else if (defaultSettings?.credit_expiration_days != null) {
        expirationDays = defaultSettings.credit_expiration_days;
      }

      // Calculate expiration date if applicable
      let expirationDate: string | undefined;
      if (expirationDays && expirationDays > 0) {
        const today = new Date();
        const expDate = new Date(today);
        expDate.setDate(today.getDate() + expirationDays);
        expirationDate = expDate.toISOString();
      }

      // Calculate new balance
      const newBalance = (client.credit_balance || 0) + creditAmount;

      // Update client credit balance within the transaction
      await tenantScopedTable(trx, tenant, 'clients')
        .where({ client_id: invoice.client_id })
        .update({
          credit_balance: newBalance,
          updated_at: new Date().toISOString()
        });

      // Record transaction with the correct balance and expiration date
      // Skip validation for negative invoices since we're creating credit
      const transactionId = uuidv4();
      await tenantScopedTable(trx, tenant, 'transactions').insert({
        transaction_id: transactionId,
        client_id: invoice.client_id,
        invoice_id: invoiceId,
        amount: creditAmount,
        type: 'credit_issuance_from_negative_invoice',
        status: 'completed',
        description: `Credit issued from negative invoice ${invoice.invoice_number}`,
        created_at: now,
        balance_after: newBalance,
        tenant,
        expiration_date: expirationDate
      });

      // Create credit tracking entry
      const creditNoteId = uuidv4();
      await tenantScopedTable(trx, tenant, 'credit_tracking').insert({
        credit_id: creditNoteId,
        tenant,
        client_id: invoice.client_id,
        transaction_id: transactionId,
        amount: creditAmount,
        remaining_amount: creditAmount, // Initially, remaining amount equals the full amount
        created_at: now,
        expiration_date: expirationDate,
        is_expired: false,
        updated_at: now
      });

      createdCreditNote = {
        creditNoteId,
        clientId: invoice.client_id,
        createdAt: now,
        createdByUserId: userId,
        amount: creditAmount,
        currency: String(invoice.currency_code ?? 'USD'),
        sourceDocumentKind: 'negative_invoice',
        sourceInvoiceId: invoiceId,
        sourceInvoiceNumber: invoice.invoice_number ?? null,
        sourceInvoiceStatus: invoice.status ?? null,
        sourceInvoiceDateBasis: 'financial_document_date',
        sourceServicePeriodStart: null,
        sourceServicePeriodEnd: null,
      };

      // Log audit
      // await auditLog(
      //   trx,
      //   {
      //     userId: userId,
      //     operation: 'credit_issuance_from_negative_invoice',
      //     tableName: 'clients',
      //     recordId: invoice.client_id,
      //     changedData: {
      //       credit_balance: newBalance,
      //       expiration_date: expirationDate
      //     },
      //     details: {
      //       action: 'Credit issued from negative invoice',
      //       invoiceId: invoiceId,
      //       amount: creditAmount,
      //       expiration_date: expirationDate
      //     }
      //   }
      // );
    });

    // Log the credit update
    console.log(`Created credit of ${creditAmount} from negative invoice ${invoiceId} (${invoice.invoice_number})`);
  }
  // For regular invoices, check if there's available credit to apply
  else if (invoice && invoice.client_id) {
    const availableCredit = await ClientContractLine.getClientCredit(invoice.client_id);

    if (availableCredit > 0) {
      // Get the current invoice with updated totals
      const updatedInvoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await tenantScopedTable(trx, tenant, 'invoices')
          .where({ invoice_id: invoiceId })
          .first();
      });

      if (updatedInvoice && updatedInvoice.total_amount > 0) {
        // Calculate how much credit to apply
        const creditToApply = Math.min(availableCredit, updatedInvoice.total_amount);

        if (creditToApply > 0) {
          // Apply credit to the invoice
          const creditResult = await applyCreditToInvoice(invoice.client_id, invoiceId, creditToApply);
          if (
            typeof creditResult === 'object' &&
            creditResult !== null &&
            (
              typeof (creditResult as { actionError?: unknown }).actionError === 'string' ||
              typeof (creditResult as { permissionError?: unknown }).permissionError === 'string'
            )
          ) {
            throw new Error(
              'permissionError' in creditResult
                ? creditResult.permissionError
                : creditResult.actionError
            );
          }
        }
      }
    }
  }

  if (invoice) {
    projectDepositCreditEvents = await issueProjectDepositCreditsForInvoice(
      knex,
      tenant,
      invoice,
      userId,
    );
  }

  if (createdCreditNote) {
    if (createdCreditNote.sourceDocumentKind === 'negative_invoice') {
      // Negative-invoice credit notes inherit date meaning from the source
      // invoice when canonical recurring detail rows exist; otherwise they
      // fall back to the source document date as a financial artifact.
      const sourceInvoice = await Invoice.getById(knex as any, tenant, createdCreditNote.sourceInvoiceId);
      const servicePeriodStarts = (sourceInvoice?.invoice_charges ?? [])
        .map((charge) => charge.service_period_start)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .sort();
      const servicePeriodEnds = (sourceInvoice?.invoice_charges ?? [])
        .map((charge) => charge.service_period_end)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .sort();

      createdCreditNote = {
        ...createdCreditNote,
        sourceInvoiceNumber: sourceInvoice?.invoice_number ?? createdCreditNote.sourceInvoiceNumber,
        sourceInvoiceStatus: sourceInvoice?.status ?? createdCreditNote.sourceInvoiceStatus,
        sourceInvoiceDateBasis:
          servicePeriodStarts.length > 0 || servicePeriodEnds.length > 0
            ? 'canonical_recurring_service_period'
            : 'financial_document_date',
        sourceServicePeriodStart: servicePeriodStarts[0] ?? null,
        sourceServicePeriodEnd: servicePeriodEnds[servicePeriodEnds.length - 1] ?? null,
      };
    }

    await publishWorkflowEvent({
      eventType: 'CREDIT_NOTE_CREATED',
      payload: buildCreditNoteCreatedPayload({
        creditNoteId: createdCreditNote.creditNoteId,
        clientId: createdCreditNote.clientId,
        createdByUserId: createdCreditNote.createdByUserId,
        createdAt: createdCreditNote.createdAt,
        amount: createdCreditNote.amount,
        currency: createdCreditNote.currency,
        status: 'issued',
        sourceDocumentKind: createdCreditNote.sourceDocumentKind,
        sourceInvoiceId: createdCreditNote.sourceInvoiceId,
        sourceInvoiceNumber: createdCreditNote.sourceInvoiceNumber,
        sourceInvoiceStatus: createdCreditNote.sourceInvoiceStatus,
        sourceInvoiceDateBasis: createdCreditNote.sourceInvoiceDateBasis,
        sourceServicePeriodStart: createdCreditNote.sourceServicePeriodStart,
        sourceServicePeriodEnd: createdCreditNote.sourceServicePeriodEnd,
      }),
      ctx: {
        tenantId: tenant,
        occurredAt: createdCreditNote.createdAt,
        actor: { actorType: 'USER', actorUserId: createdCreditNote.createdByUserId },
      },
      idempotencyKey: `credit_note_created:${createdCreditNote.creditNoteId}`,
    });
  }

  for (const event of projectDepositCreditEvents) {
    await publishWorkflowEvent({
      eventType: 'CREDIT_NOTE_CREATED',
      payload: buildCreditNoteCreatedPayload({
        creditNoteId: event.creditNoteId,
        clientId: event.clientId,
        createdByUserId: event.createdByUserId,
        createdAt: event.createdAt,
        amount: event.amount,
        currency: event.currency,
        status: 'issued',
        sourceInvoiceId: invoice.invoice_id,
        sourceInvoiceNumber: invoice.invoice_number ?? null,
        sourceInvoiceStatus: invoice.status ?? null,
        sourceInvoiceDateBasis: 'financial_document_date',
        sourceServicePeriodStart: null,
        sourceServicePeriodEnd: null,
      }),
      ctx: {
        tenantId: tenant,
        occurredAt: event.createdAt,
        actor: { actorType: 'USER', actorUserId: event.createdByUserId },
      },
      idempotencyKey: `credit_note_created:${event.creditNoteId}`,
    });
  }

  // Auto-export producer (accounting sync): fire-and-forget, never blocks finalize.
  await enqueueInvoiceAutoExport(knex, tenant, invoiceId);
}

export const unfinalizeInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<InvoiceMutationActionResult> => {
  if (!await hasPermission(user, 'invoice', 'update')) {
    return permissionError('Permission denied: invoice update required');
  }
  const { knex } = await createTenantKnex();

  // Guard: a document posted to an accounting system must stay posted. Reopening
  // it here would let a later re-finalize export into reconciled books.
  try {
    await assertInvoiceNotExported(knex, tenant, invoiceId, 'unfinalize');
  } catch (error) {
    return actionError(getErrorMessage(error));
  }

  let expectedError: InvoiceActionError | null = null;

  try {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Check if invoice exists and is finalized
      const invoice = await tenantScopedTable(trx, tenant, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();

    if (!invoice) {
      expectedError = actionError('Invoice not found');
      return;
    }

    const normalizedStatus = invoice.status ? invoice.status.toLowerCase() : null;
    const isFinalized = Boolean(invoice.finalized_at) || (normalizedStatus && normalizedStatus !== 'draft');

    if (!isFinalized) {
      expectedError = actionError('Invoice is not finalized');
      return;
    }

    await rollbackProjectDepositCreditsForInvoice(
      trx,
      tenant,
      invoiceId,
      invoice.client_id,
    );

    // When unfinalizing make sure the invoice returns to draft status even if some
    // environments only toggle the status flag without storing finalized_at.
    const updatedFields: Record<string, unknown> = {
      finalized_at: null,
      updated_at: toISODate(Temporal.Now.plainDateISO())
    };

    if (normalizedStatus && normalizedStatus !== 'draft') {
      updatedFields.status = 'draft';
    }

    await tenantScopedTable(trx, tenant, 'invoices')
      .where({
        invoice_id: invoiceId
      })
      .update(updatedFields);

    // Record audit log
    // await auditLog(
    //   trx,
    //   {
    //     userId: session.user.id,
    //     operation: 'invoice_unfinalized',
    //     tableName: 'invoices',
    //     recordId: invoiceId,
    //     changedData: { finalized_at: null },
    //     details: {
    //       action: 'Invoice unfinalized',
    //       invoiceNumber: invoice.invoice_number
    //     }
    //   }
    // );
    });
  } catch (error) {
    const expected = toInvoiceActionError(error);
    if (expected) return expected;
    logger.error('[unfinalizeInvoice] Unexpected failure', {
      invoiceId,
      tenant,
      error: error instanceof Error ? error.message : String(error),
    });
    return actionError('Invoice could not be unfinalized because an unexpected data error occurred. Please refresh and try again.');
  }

  if (expectedError) {
    return expectedError;
  }

  return { success: true };
});

export const updateInvoiceManualItems = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  changes: ManualItemsUpdate
): Promise<InvoiceManualItemsUpdateActionResult> => {
  const context = {
    tenant,
    invoiceId,
    clientId: '',
    userId: user.user_id,
  };

  if (!await hasPermission(user, 'invoice', 'update')) {
    return manualInvoiceUpdateFailure(
      'PERMISSION_DENIED',
      'Permission denied: invoice update required',
      context,
    );
  }

  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return manualInvoiceUpdateFailure(
        'PERMISSION_DENIED',
        'Unauthorized: No authenticated user found',
        context,
      );
    }
    context.userId = session.user.id;

    const { knex } = await createTenantKnex();
    const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantScopedTable(trx, tenant, 'invoices')
        .where({ invoice_id: invoiceId })
        .first();
    });

    if (!invoice) {
      return actionError('Invoice not found');
    }
    context.clientId = invoice.client_id;

    if (['paid', 'cancelled'].includes(invoice.status)) {
      return actionError('Cannot modify a paid or cancelled invoice');
    }

    const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantScopedTable(trx, tenant, 'clients')
        .where({ client_id: invoice.client_id })
        .first();
    });

    if (!client) {
      return manualInvoiceUpdateFailure(
        'CLIENT_NOT_FOUND',
        'Client not found',
        context,
      );
    }

    await updateManualInvoiceItemsInternal(invoiceId, changes, session!, tenant); // Renamed internal call
    return await Invoice.getFullInvoiceById(knex, tenant, invoiceId);
  } catch (error) {
    if (error instanceof ManualInvoiceError) {
      return manualInvoiceUpdateFailure(
        error.code,
        error.message,
        context,
        error.params,
      );
    }

    if (isManualInvoiceNumberConflict(error)) {
      return manualInvoiceUpdateFailure(
        'INVOICE_NUMBER_CONFLICT',
        'Invoice number must be unique',
        context,
      );
    }

    const expectedError = toInvoiceActionError(error);
    if (expectedError) {
      return expectedError;
    }

    return unexpectedManualInvoiceUpdateFailure(error, context);
  }
});

// Internal helper function to avoid recursive export/import loop
async function updateManualInvoiceItemsInternal(
  invoiceId: string,
  changes: ManualItemsUpdate,
  session: Session,
  tenant: string
): Promise<void> {
  const { knex } = await createTenantKnex(tenant);
  const billingEngine = new BillingEngine();
  const currentDate = Temporal.Now.plainDateISO().toString();

  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantScopedTable(trx, tenant, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
  });

  if (!invoice) {
    throw expectedInvoiceActionError('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw expectedInvoiceActionError('Cannot modify a paid or cancelled invoice');
  }

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantScopedTable(trx, tenant, 'clients')
      .where({ client_id: invoice.client_id })
      .first();
  });

  if (!client) {
    throw expectedInvoiceActionError('Client not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const targetedItemIds = Array.from(
      new Set([
        ...(changes.removedItemIds ?? []),
        ...((changes.updatedItems ?? []).map((item) => item.item_id).filter(Boolean)),
      ])
    );

    if (targetedItemIds.length > 0) {
      const db = tenantDb(trx, tenant);
      const nonManualTargetsQuery = db.table('invoice_charges as ic');
      db.tenantJoin(nonManualTargetsQuery, 'invoice_charge_details as iid', 'iid.item_id', 'ic.item_id', { type: 'left' });
      const nonManualTargets = await nonManualTargetsQuery
        .where('ic.invoice_id', invoiceId)
        .whereIn('ic.item_id', targetedItemIds)
        .where(function(this: Knex.QueryBuilder) {
          this.where('ic.is_manual', false).orWhereNull('ic.is_manual');
        })
        .select('ic.item_id', 'ic.description', 'iid.item_detail_id');

      if (nonManualTargets.length > 0) {
        const touchesRecurringDetailBackedCharge = nonManualTargets.some((row: any) => Boolean(row.item_detail_id));
        if (touchesRecurringDetailBackedCharge) {
          throw expectedInvoiceActionError(
            'Cannot manually edit recurring invoice charges once canonical detail periods exist. Add an adjustment as a manual item or cancel and regenerate the invoice instead.'
          );
        }

        throw expectedInvoiceActionError(
          'Cannot manually edit non-manual invoice charges. Add an adjustment as a manual item instead.'
        );
      }
    }

    // Process removals
    if (changes.removedItemIds && changes.removedItemIds.length > 0) {
      await tenantScopedTable(trx, tenant, 'invoice_charges')
        .whereIn('item_id', changes.removedItemIds)
        .andWhere({ is_manual: true }) // Ensure we only delete manual items intended for removal
        .delete();
    }

    // Process updates
    if (changes.updatedItems && changes.updatedItems.length > 0) {
      // First pass: Update all items with their new values
      for (const item of changes.updatedItems) {
        const updateData = {
          service_id: item.service_id,
          description: item.description,
          quantity: item.quantity,
          // Rate is already in cents from the frontend, no need to multiply by 100
          unit_price: item.rate !== undefined ? Math.round(item.rate) : undefined,
          is_discount: item.is_discount,
          discount_type: item.discount_type,
          discount_percentage: item.discount_percentage,
          applies_to_item_id: item.applies_to_item_id,
          is_taxable: item.is_taxable,
          updated_at: currentDate // Use the existing currentDate variable
        };
        // Filter out undefined values to avoid overwriting columns with null unnecessarily
        const filteredUpdateData = Object.fromEntries(Object.entries(updateData).filter(([_, v]) => v !== undefined));

        if (Object.keys(filteredUpdateData).length > 0) {
           await tenantScopedTable(trx, tenant, 'invoice_charges')
            .where({ item_id: item.item_id, is_manual: true }) // Ensure we only update manual items
            .update(filteredUpdateData);
        }
      }
      
      // Second pass: Recalculate net_amount for discount items
      for (const item of changes.updatedItems) {
        if (item.is_discount) {
          // Get the updated item from the database
          const updatedItem = await tenantScopedTable(trx, tenant, 'invoice_charges')
            .where({ item_id: item.item_id, is_manual: true })
            .first();
          
          if (updatedItem) {
            let applicableAmount;
            let subtotal = 0;
            
            // Calculate current subtotal of non-discount items for percentage discounts
            if (updatedItem.discount_type === 'percentage') {
              const nonDiscountItems = await tenantScopedTable(trx, tenant, 'invoice_charges')
                .where({ invoice_id: invoiceId })
                .whereNot('is_discount', true)
                .select('*');
              
              subtotal = nonDiscountItems.reduce((sum, item) => sum + Number(item.net_amount), 0);
              
              // If discount applies to a specific item, get that item's amount
              if (updatedItem.applies_to_item_id) {
                const applicableItem = await tenantScopedTable(trx, tenant, 'invoice_charges')
                  .where({ item_id: updatedItem.applies_to_item_id })
                  .first();
                applicableAmount = applicableItem?.net_amount;
              }
            }
            
            // Calculate new net_amount based on discount type
            let newNetAmount;
            if (updatedItem.discount_type === 'percentage' && updatedItem.discount_percentage !== null) {
              const baseAmount = updatedItem.applies_to_item_id
                ? (applicableAmount || 0)
                : subtotal;
              newNetAmount = -Math.round((baseAmount * updatedItem.discount_percentage) / 100);
            } else {
              // Fixed discount - use the unit_price
              newNetAmount = -Math.abs(Math.round(updatedItem.unit_price));
            }
            
            // Update the net_amount
            await tenantScopedTable(trx, tenant, 'invoice_charges')
              .where({ item_id: item.item_id, is_manual: true })
              .update({
                net_amount: newNetAmount,
                total_price: newNetAmount // Also update total_price since discounts have no tax
              });
          }
        }
      }
    }

    // Add new items
    if (changes.newItems && changes.newItems.length > 0) {
      // Use persistManualInvoiceCharges for adding new manual items during update
      await persistManualInvoiceCharges(
        trx,
        invoiceId,
        changes.newItems.map(item => ({ // Ensure mapping matches ManualInvoiceItemInput
          item_id: item.item_id,
          rate: item.rate,
          quantity: item.quantity,
          is_discount: item.is_discount,
          discount_type: item.discount_type,
          applies_to_item_id: item.applies_to_item_id,
          service_id: item.service_id || undefined,
          description: item.description,
          tax_region: item.tax_region || client.tax_region,
          is_taxable: item.is_taxable !== false,
          applies_to_service_id: item.applies_to_service_id,
          discount_percentage: item.discount_percentage,
        })),
        client,
        session,
        tenant
        // No 'isManual' boolean needed for persistManualInvoiceCharges
      );
    }

    // Update invoice number if provided
    if (changes.invoice_number && changes.invoice_number !== invoice.invoice_number) {
      try {
        await tenantScopedTable(trx, tenant, 'invoices')
          .where({ invoice_id: invoiceId })
          .update({
            invoice_number: changes.invoice_number,
            updated_at: currentDate
          });
      } catch (error: unknown) {
        if (error instanceof Error &&
          'code' in error &&
          error.code === '23505' &&
          'constraint' in error &&
              error.constraint === 'unique_invoice_number_per_tenant') {
          throw new ManualInvoiceError(
            'INVOICE_NUMBER_CONFLICT',
            'Invoice number must be unique',
          );
        }
        throw error;
      }
    } else {
       // Touch updated_at even if only items changed
       await tenantScopedTable(trx, tenant, 'invoices')
          .where({ invoice_id: invoiceId })
          .update({ updated_at: currentDate });
    }

    // Recalculate before commit so tax/totals failures roll back item mutations.
    await billingEngine.recalculateInvoice(invoiceId, trx, tenant);
  });

}


export const addManualItemsToInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  items: IInvoiceCharge[]
): Promise<InvoiceManualItemsUpdateActionResult> => {
  if (!await hasPermission(user, 'invoice', 'update')) {
    return permissionError('Permission denied: invoice update required');
  }
  const session = await getSession();

  if (!session?.user?.id) {
    return permissionError('Unauthorized: No authenticated user found');
  }

  const { knex } = await createTenantKnex();

  // Load and validate invoice
  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantScopedTable(trx, tenant, 'invoices')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .first();
  });

  if (!invoice) {
    return actionError('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    return actionError('Cannot modify a paid or cancelled invoice');
  }

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantScopedTable(trx, tenant, 'clients')
      .where({
        client_id: invoice.client_id,
        tenant
      })
      .first();
  });

  if (!client) {
    return actionError('Client not found');
  }

  try {
    await addManualInvoiceItemsInternal(invoiceId, items, session!, tenant); // Renamed internal call
  } catch (error) {
    const expectedError = toInvoiceActionError(error);
    if (expectedError) {
      return expectedError;
    }
    throw error;
  }
  return await Invoice.getFullInvoiceById(knex, tenant, invoiceId);
});

// Internal helper function
async function addManualInvoiceItemsInternal(
  invoiceId: string,
  items: IInvoiceCharge[],
  session: Session,
  tenant: string
): Promise<void> {
  const { knex } = await createTenantKnex(tenant);

  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantScopedTable(trx, tenant, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
  });

  if (!invoice) {
    throw expectedInvoiceActionError('Invoice not found');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw expectedInvoiceActionError('Cannot modify a paid or cancelled invoice');
  }

  const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantScopedTable(trx, tenant, 'clients')
      .where({ client_id: invoice.client_id })
      .first();
  });

  if (!client) {
    throw expectedInvoiceActionError('Client not found');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Use persistManualInvoiceCharges for adding manual items
    await persistManualInvoiceCharges(
      trx,
      invoiceId,
      items.map(item => ({ // Ensure mapping matches ManualInvoiceItemInput
          item_id: item.item_id,
          rate: item.rate,
          quantity: item.quantity,
          is_discount: item.is_discount,
          discount_type: item.discount_type,
          applies_to_item_id: item.applies_to_item_id,
          service_id: item.service_id || undefined,
          description: item.description,
          tax_region: item.tax_region || client.tax_region,
          is_taxable: item.is_taxable !== false,
          applies_to_service_id: item.applies_to_service_id,
          discount_percentage: item.discount_percentage,
      })),
      client,
      session,
      tenant
      // No 'isManual' boolean needed for persistManualInvoiceCharges
    );
     // Touch updated_at when items are added
     await tenantScopedTable(trx, tenant, 'invoices')
        .where({ invoice_id: invoiceId })
        .update({ updated_at: Temporal.Now.plainDateISO().toString() });
  });

  const billingEngine = new BillingEngine();
  await billingEngine.recalculateInvoice(invoiceId);
}


export const hardDeleteInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<InvoiceMutationActionResult> => {
  if (!await hasPermission(user, 'invoice', 'delete')) {
    return permissionError('Permission denied: invoice delete required');
  }
  const { knex } = await createTenantKnex();

  try {
    // Guard: block deletion if invoice is already exported to an accounting system
    const existingMapping = await tenantScopedTable(knex, tenant, 'tenant_external_entity_mappings')
      .where({
        tenant: tenant,
        integration_type: 'quickbooks_online',
        alga_entity_type: 'invoice',
        alga_entity_id: invoiceId
      })
      .first('id');
    if (existingMapping) {
      return actionError('This invoice is synced to an accounting system — void it instead of deleting.');
    }

  let voidedCreditNotes: Array<{
    creditNoteId: string;
    voidedAt: string;
    voidedByUserId: string;
    reason: string;
  }> = [];
  let deletedInvoice = false;
  let deletedClientId: string | undefined;
  let deletedItemIds: string[] = [];
  let deletedAnnotationIds: string[] = [];

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const now = new Date().toISOString();
    // 1. Get invoice details
    const invoice = await tenantScopedTable(trx, tenant, 'invoices')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .first();

    if (!invoice) {
        console.warn(`Invoice ${invoiceId} not found for deletion.`);
        return; // Exit if invoice doesn't exist
    }
    deletedClientId = invoice.client_id ?? undefined;

    const hasLinkedRecurringServicePeriods = await hasLinkedRecurringServicePeriodsForInvoice(
      trx,
      tenant,
      invoiceId,
    );

    // Canonical recurring detail rows are authoritative historical coverage metadata.
    // Preserve them by cancelling the invoice through the regular lifecycle instead of hard deletion.
    if (
      await hasCanonicalRecurringDetailPeriodsForInvoice(trx, tenant, invoiceId)
      && !hasLinkedRecurringServicePeriods
    ) {
      throw expectedInvoiceActionError(
        `Cannot delete invoice ${invoiceId}: canonical recurring detail periods already exist. Cancel the invoice instead of deleting it.`
      );
    }

    await rollbackProjectDepositCreditsForInvoice(
      trx,
      tenant,
      invoiceId,
      invoice.client_id,
    );

    // 2. Handle payments
    const payments = await tenantScopedTable(trx, tenant, 'transactions')
      .where({
        invoice_id: invoiceId,
        type: 'payment',
        tenant
      });

    if (payments.length > 0) {
      // Insert reversal transactions
      await tenantScopedTable(trx, tenant, 'transactions').insert(
        payments.map((p): any => ({ // Use 'any' for flexibility, ensure required fields are present
          transaction_id: uuidv4(),
          client_id: p.client_id, // Ensure client_id is included
          invoice_id: p.invoice_id,
          amount: -p.amount,
          type: 'payment_reversal',
          status: 'completed', // Assuming reversal is completed
          description: `Reversal of payment ${p.transaction_id}`,
          created_at: new Date().toISOString(), // Use current time for reversal
          balance_after: null, // Balance needs recalculation or specific handling
          tenant: p.tenant,
          // Copy other relevant fields if necessary
        }))
      );
       // TODO: Recalculate client balance after reversals
    }

    // 3. Handle credit applied to this invoice
    if (invoice.credit_applied > 0) {
        // Find the credit application transaction
        const creditAppTransaction = await tenantScopedTable(trx, tenant, 'transactions')
            .where({
                invoice_id: invoiceId,
                type: 'credit_application',
                tenant: tenant
            })
            .first();

        // Find related credit tracking entries that were used
        const creditTrackingUsed = await tenantScopedTable(trx, tenant, 'credit_tracking_usage')
            .where({ transaction_id: creditAppTransaction?.transaction_id })
            .select('credit_id', 'amount_used');

        // Restore the used amounts back to the original credit_tracking entries
        for (const usage of creditTrackingUsed) {
            await tenantScopedTable(trx, tenant, 'credit_tracking')
                .where({ credit_id: usage.credit_id })
                .increment('remaining_amount', usage.amount_used)
                .update({ updated_at: new Date().toISOString() }); // Update timestamp
        }

        // Delete the credit tracking usage records
        await tenantScopedTable(trx, tenant, 'credit_tracking_usage')
            .where({ transaction_id: creditAppTransaction?.transaction_id })
            .delete();

        // Delete the credit application transaction itself
        await tenantScopedTable(trx, tenant, 'transactions')
            .where({ transaction_id: creditAppTransaction?.transaction_id })
            .delete();

        // Update the client's credit balance
        await ClientContractLine.updateClientCredit(
            invoice.client_id,
            invoice.credit_applied // Add the credit back
        );
    }

    // Handle credit issued *from* this invoice (if it was negative)
    const creditIssuanceTransaction = await tenantScopedTable(trx, tenant, 'transactions')
        .where({
            invoice_id: invoiceId,
            type: 'credit_issuance_from_negative_invoice',
            tenant: tenant
        })
        .first();

    if (creditIssuanceTransaction) {
        // Find the corresponding credit_tracking entry
        const creditTrackingEntry = await tenantScopedTable(trx, tenant, 'credit_tracking')
            .where({ transaction_id: creditIssuanceTransaction.transaction_id })
            .first();

        if (creditTrackingEntry) {
            // Check if any of this credit was used
            const usageAmount = creditTrackingEntry.amount - creditTrackingEntry.remaining_amount;
            if (usageAmount > 0) {
                // This scenario is complex: credit issued by the invoice being deleted was already used.
                // Option 1: Throw error - prevent deletion if issued credit was used.
                // Option 2: Allow deletion but log a warning/create adjustment.
                // Option 3: Attempt to reverse the usage (very complex).
                throw expectedInvoiceActionError(`Cannot delete invoice ${invoiceId}: Credit issued by this invoice has already been used.`);
            } else {
                // Credit was issued but not used, safe to delete tracking and transaction
                voidedCreditNotes.push({
                  creditNoteId: creditTrackingEntry.credit_id,
                  voidedAt: now,
                  voidedByUserId: user.user_id,
                  reason: 'invoice_deleted',
                });
                await tenantScopedTable(trx, tenant, 'credit_tracking')
                    .where({ credit_id: creditTrackingEntry.credit_id })
                    .delete();
                // Also update client balance back
                 await ClientContractLine.updateClientCredit(
                    invoice.client_id,
                    -creditTrackingEntry.amount // Subtract the credit that was issued
                );
            }
        }
        // Delete the credit issuance transaction
        await tenantScopedTable(trx, tenant, 'transactions')
            .where({ transaction_id: creditIssuanceTransaction.transaction_id })
            .delete();
    }


    await releaseProjectBillingForDeletedInvoice(trx, tenant, invoiceId);
    await releaseMaterialsForDeletedInvoice(trx, tenant, invoiceId);

    // 4. Unmark time entries
    await tenantScopedTable(trx, tenant, 'time_entries')
      .whereIn('entry_id',
        tenantScopedTable(trx, tenant, 'invoice_time_entries')
          .select('entry_id')
          .where({
            invoice_id: invoiceId,
            tenant
          })
      )
      .update({ invoiced: false });

    // 5. Unmark usage records
    await tenantScopedTable(trx, tenant, 'usage_tracking')
      .whereIn('usage_id',
        tenantScopedTable(trx, tenant, 'invoice_usage_records')
          .select('usage_id')
          .where({
            invoice_id: invoiceId,
            tenant
          })
      )
      .update({ invoiced: false });

    // 6. Delete other transactions related to the invoice (e.g., invoice_generated, price_adjustment)
    await tenantScopedTable(trx, tenant, 'transactions')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      // Exclude types already handled (payment, payment_reversal, credit_application, credit_issuance...)
      .whereNotIn('type', ['payment', 'payment_reversal', 'credit_application', 'credit_issuance_from_negative_invoice'])
      .delete();

    // 7. Delete join records
    await tenantScopedTable(trx, tenant, 'invoice_time_entries')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    await tenantScopedTable(trx, tenant, 'invoice_usage_records')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    if (hasLinkedRecurringServicePeriods) {
      await releaseRecurringServicePeriodInvoiceLinkageForInvoice(
        trx,
        tenant,
        invoiceId,
        now,
      );
    }

    // 8. Delete invoice items
    deletedItemIds = await tenantScopedTable(trx, tenant, 'invoice_charges')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .pluck('item_id');

    await tenantScopedTable(trx, tenant, 'invoice_charges')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    // 9. Delete invoice annotations (internal/external notes)
    deletedAnnotationIds = await tenantScopedTable(trx, tenant, 'invoice_annotations')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .pluck('annotation_id');

    await tenantScopedTable(trx, tenant, 'invoice_annotations')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();

    // 10. Nullify invoice_id in payment_webhook_events
    const hasPaymentWebhookEvents = await trx.schema.hasTable('payment_webhook_events');
    if (hasPaymentWebhookEvents) {
      await tenantScopedTable(trx, tenant, 'payment_webhook_events')
        .where({ invoice_id: invoiceId })
        .update({ invoice_id: null });
    }

    // 11. Delete invoice record
    await tenantScopedTable(trx, tenant, 'invoices')
      .where({
        invoice_id: invoiceId,
        tenant
      })
      .delete();
    deletedInvoice = true;

     // TODO: Recalculate client balance after all deletions/reversals
  });

  for (const event of voidedCreditNotes) {
    await publishWorkflowEvent({
      eventType: 'CREDIT_NOTE_VOIDED',
      payload: buildCreditNoteVoidedPayload({
        creditNoteId: event.creditNoteId,
        voidedByUserId: event.voidedByUserId,
        voidedAt: event.voidedAt,
        reason: event.reason,
      }),
      ctx: {
        tenantId: tenant,
        occurredAt: event.voidedAt,
        actor: { actorType: 'USER', actorUserId: event.voidedByUserId },
      },
      idempotencyKey: `credit_note_voided:${event.creditNoteId}:${invoiceId}`,
    });
  }

  if (deletedInvoice) {
    const occurredAt = new Date().toISOString();
    const ctx = {
      tenantId: tenant,
      occurredAt,
      actor: { actorType: 'USER', actorUserId: user.user_id },
    };

    for (const itemId of deletedItemIds) {
      await publishWorkflowEvent({
        eventType: 'INVOICE_ITEM_DELETED',
        payload: {
          invoiceId,
          itemId,
          userId: user.user_id,
          timestamp: occurredAt,
        },
        ctx,
        idempotencyKey: `invoice_item_deleted:${itemId}:${occurredAt}`,
      });
    }

    for (const annotationId of deletedAnnotationIds) {
      await publishWorkflowEvent({
        eventType: 'INVOICE_ANNOTATION_DELETED',
        payload: {
          invoiceId,
          annotationId,
          userId: user.user_id,
          timestamp: occurredAt,
        },
        ctx,
        idempotencyKey: `invoice_annotation_deleted:${annotationId}:${occurredAt}`,
      });
    }

    await publishWorkflowEvent({
      eventType: 'INVOICE_DELETED',
      payload: {
        invoiceId,
        clientId: deletedClientId,
        userId: user.user_id,
        timestamp: occurredAt,
      },
      ctx,
      idempotencyKey: `invoice_deleted:${invoiceId}:${occurredAt}`,
    });
  }

  } catch (error) {
    const expectedError = toInvoiceActionError(error);
    if (expectedError) {
      return expectedError;
    }

    throw error;
  }

  return { success: true };
});
