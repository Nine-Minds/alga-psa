import { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import {
  findLocalVoidBlocker,
  voidInvoiceLocally,
  type VoidableInvoiceRow
} from '../../lib/invoiceVoidCore';
import { findInvoiceExportInProgress } from './invoiceExportGuards';
import { notifyInvoiceTerminalStatus } from './invoiceTerminalStatusHandlers';
import { signalAutopayInvoiceSettled } from '../autopayBridge';
import { providerForAdapterType } from './normalizedChange';

/**
 * Inbound void: an exported invoice was voided or deleted in the accounting
 * provider, so Alga voids its copy too. The provider is the ledger of record
 * for the document, and leaving the Alga invoice open would keep phantom AR
 * (and a payable invoice in the client portal) for a document that no longer
 * exists in the books.
 *
 * The void is applied only when it is safe without a human: no recorded
 * payments, no consumed credit-note credit, no used hour blocks, no export in
 * flight. Anything else is reported as blocked and the drift detector files
 * the existing sync exception for manual handling.
 */

export type ExternalVoidOutcome =
  | { status: 'applied' }
  | { status: 'blocked'; reason: string };

export interface ApplyExternalVoidParams {
  knex: Knex;
  tenantId: string;
  invoiceId: string;
  adapterType: string;
  targetRealm: string;
}

function providerLabelFor(adapterType: string): string {
  return providerForAdapterType(adapterType) === 'xero' ? 'Xero' : 'QuickBooks';
}

export async function applyExternalVoidToInvoice(params: ApplyExternalVoidParams): Promise<ExternalVoidOutcome> {
  const { knex, tenantId, invoiceId, adapterType, targetRealm } = params;
  const providerLabel = providerLabelFor(adapterType);
  const now = new Date().toISOString();

  const invoice = await tenantDb(knex, tenantId).table('invoices')
    .where({ invoice_id: invoiceId })
    .first() as VoidableInvoiceRow | undefined;

  if (!invoice) {
    return { status: 'blocked', reason: 'Invoice not found in Alga.' };
  }
  // Already voided locally (our own void echoing back, or a manual void that
  // raced the poll) — nothing left to do.
  if (invoice.status === 'cancelled') {
    return { status: 'applied' };
  }
  if (!invoice.finalized_at) {
    return { status: 'blocked', reason: 'Invoice is still a draft in Alga; delete it instead.' };
  }

  const blocker = await findLocalVoidBlocker(knex, tenantId, invoice);
  if (blocker) {
    return { status: 'blocked', reason: blocker };
  }

  const reason = `Voided in ${providerLabel}`;

  const outcome = await withTransaction(knex, async (trx: Knex.Transaction): Promise<ExternalVoidOutcome> => {
    // Same lock-order contract as voidInvoiceActions: invoice row first.
    const lockedInvoice = await tenantDb(trx, tenantId).table('invoices')
      .where({ invoice_id: invoiceId })
      .forUpdate()
      .first('status', 'credit_applied');

    if (!lockedInvoice) {
      return { status: 'blocked', reason: 'Invoice not found in Alga.' };
    }
    if (lockedInvoice.status === 'cancelled') {
      return { status: 'applied' };
    }
    if (await findInvoiceExportInProgress(trx, tenantId, invoiceId)) {
      return { status: 'blocked', reason: 'An accounting export is being prepared for this invoice.' };
    }

    const result = await voidInvoiceLocally(trx, tenantId, {
      invoice,
      lockedInvoice,
      reason,
      actorUserId: null,
      now,
      transactionMetadata: {
        source: 'accounting_sync_external_void',
        provider: providerForAdapterType(adapterType),
        realm: targetRealm
      }
    });
    if (!result.ok) {
      return { status: 'blocked', reason: result.error };
    }
    return { status: 'applied' };
  });

  if (outcome.status !== 'applied') {
    return outcome;
  }

  logger.info('[accountingSync] Invoice voided in Alga after external void', {
    tenantId,
    invoiceId,
    adapterType,
    realm: targetRealm
  });

  void signalAutopayInvoiceSettled(tenantId, invoiceId);

  // A voided invoice must never be chargeable through an old payment link.
  await notifyInvoiceTerminalStatus({
    knex,
    tenantId,
    invoiceId,
    newStatus: 'cancelled'
  });

  return { status: 'applied' };
}
