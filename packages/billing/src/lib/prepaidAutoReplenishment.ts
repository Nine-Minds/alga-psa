import type { Knex } from 'knex';
import { SharedNumberingService } from '@alga-psa/shared/services/numberingService';
import { tenantDb } from '@alga-psa/db';
import { createPrepaymentInvoiceInternal } from '../actions/creditActions';
import { createHourBlockPurchaseInvoiceInternal } from '../actions/hourBlockActions';

export type PrepaidReplenishmentSubject = 'credit' | 'bucket';

export interface CreatePrepaidReplenishmentInvoiceInput {
  tenant: string;
  clientId: string;
  subject: PrepaidReplenishmentSubject;
  amount: number;
  currencyCode: string;
  serviceId?: string | null;
  serviceName?: string | null;
  hourlyRate?: number | null;
}

/**
 * Create the draft side of an automatic prepaid replenishment.
 *
 * This deliberately mirrors the existing hour-block purchase lifecycle:
 * invoice-backed blocks are inserted as pending and invoice finalization is
 * the only path that activates them. Credit-backed replenishment is similarly
 * an ordinary prepayment invoice, so its credit ledger is minted by the
 * canonical finalization hook. `null` is the system actor convention for the
 * nullable created_by columns used by these ledgers.
 */
export async function createPrepaidReplenishmentInvoice(
  trx: Knex.Transaction,
  input: CreatePrepaidReplenishmentInvoiceInput,
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const serviceId = input.serviceId;
  const hourlyRate = input.hourlyRate;
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error('Replenishment amount must be a positive integer');
  }
  if (input.subject === 'bucket' && (!serviceId || !Number.isFinite(hourlyRate ?? NaN))) {
    throw new Error('Bucket replenishment requires a service and hourly rate');
  }

  const db = tenantDb(trx, input.tenant);
  const client = await db.table('clients')
    .where({ client_id: input.clientId })
    .first();
  if (!client) throw new Error('Client not found');

  const invoiceNumber = await SharedNumberingService.getNextNumber('INVOICE', {
    knex: trx,
    tenant: input.tenant,
  });
  if (input.subject === 'credit') {
    const invoice = await createPrepaymentInvoiceInternal(
      trx,
      input.tenant,
      input.clientId,
      client,
      input.amount,
      invoiceNumber,
    );
    return { invoiceId: invoice.invoice_id, invoiceNumber };
  }

  if (!serviceId || hourlyRate == null) {
    throw new Error('Bucket replenishment requires a service and hourly rate');
  }
  const service = await db.table('service_catalog')
    .where({ service_id: serviceId })
    .first();
  if (!service) throw new Error('Bucket replenishment service not found');
  const created = await createHourBlockPurchaseInvoiceInternal({
    trx,
    tenant: input.tenant,
    clientId: input.clientId,
    serviceId,
    hours: input.amount / 60,
    hourlyRate,
    client,
    service,
    currencyCode: input.currencyCode,
    dueDate: new Date().toISOString(),
    taxSource: 'internal',
    invoiceNumber,
    createdBy: null,
    notes: 'Automatic prepaid balance replenishment',
  });
  return { invoiceId: created.invoiceId, invoiceNumber };
}
