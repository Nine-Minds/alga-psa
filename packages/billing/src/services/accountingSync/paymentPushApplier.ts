import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';
import type { AccountingSyncCycleStats } from './accountingSync.types';
import type { SyncOperationsRepository } from './syncOperationsRepository';
import type { SyncMappingLedger } from './syncMappingLedger';
import type { SyncExceptionService } from './syncExceptions.types';
import { getDepositAccountRef } from './accountingSyncSettings';

interface DrainDeps {
  knex: Knex;
  tenantId: string;
  adapterType: string;
  targetRealm: string;
  ops: SyncOperationsRepository;
  ledger: SyncMappingLedger;
  exceptions: SyncExceptionService;
  stats: AccountingSyncCycleStats;
}

interface RecordPaymentPayload {
  invoiceId: string;
  amountCents: number;
  referenceNumber: string;
  provider: string;
}

/** QBO PaymentRefNum is limited to 21 characters. */
const QBO_PAYMENT_REF_MAX = 21;

function truncateRef(ref: string): string {
  return ref.length > QBO_PAYMENT_REF_MAX ? ref.slice(0, QBO_PAYMENT_REF_MAX) : ref;
}

/**
 * Drain pending record_payment ops.
 *
 * Each op creates a QBO Payment object that links an Alga-originated payment
 * (e.g. Stripe) to the matching QBO Invoice and Customer. Writing the mapping
 * row at push time causes the next CDC poll's echo-suppression to treat the
 * returned payment as a known no-op (unchanged sync_token path in paymentApplier).
 */
export async function drainRecordPaymentOps(deps: DrainDeps): Promise<void> {
  const pending = await deps.ops.listPending(deps.tenantId, deps.adapterType, {
    operation: 'record_payment',
    targetRealm: deps.targetRealm
  });

  if (pending.length === 0) {
    return;
  }

  let qboClient: QboClientService | null = null;
  try {
    qboClient = await QboClientService.create(deps.tenantId, deps.targetRealm);
  } catch (error) {
    logger.warn('[paymentPushApplier] Cannot create QBO client; leaving record_payment ops pending', {
      tenantId: deps.tenantId,
      targetRealm: deps.targetRealm,
      error: error instanceof Error ? error.message : error
    });
    return;
  }

  const depositAccountRef = await getDepositAccountRef(deps.knex, deps.tenantId);

  for (const op of pending) {
    const payload = op.payload as RecordPaymentPayload | null;
    if (!payload?.invoiceId || !payload?.amountCents || !payload?.referenceNumber) {
      logger.warn('[paymentPushApplier] record_payment op missing payload fields', {
        opId: op.op_id,
        tenantId: deps.tenantId
      });
      await deps.ops.markFailed(deps.tenantId, op.op_id, 'Missing payload fields');
      deps.stats.opsFailed += 1;
      continue;
    }

    const paymentId = op.alga_entity_id;

    // ── Idempotency: skip if payment mapping already exists ──────────────
    // This covers both already-pushed payments and the pulled-payment case
    // (inbound applier wrote the mapping row before this drain ran).
    const existingMapping = await deps.ledger.findByAlgaId('invoice_payment', paymentId);
    if (existingMapping) {
      logger.debug('[paymentPushApplier] Payment already mapped; marking done', {
        opId: op.op_id,
        paymentId
      });
      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;
      continue;
    }

    // ── Resolve invoice mapping (QBO Invoice ID) ─────────────────────────
    const invoiceMapping = await deps.ledger.findByAlgaId('invoice', payload.invoiceId);
    if (!invoiceMapping) {
      const message = `No QBO invoice mapping found for invoice ${payload.invoiceId}`;
      logger.debug('[paymentPushApplier] Invoice mapping missing; marking failed', {
        opId: op.op_id,
        invoiceId: payload.invoiceId
      });
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;
      if (nextStatus === 'skipped') {
        await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'invoice_payment',
          entityId: paymentId,
          title: 'Payment push keeps failing — invoice not mapped in QBO',
          context: {
            alga_payment_id: paymentId,
            alga_invoice_id: payload.invoiceId,
            attempts: op.attempts + 1,
            message,
            details: message,
            realm: deps.targetRealm
          }
        });
        deps.stats.exceptionsCreated += 1;
      }
      continue;
    }

    // ── Resolve client/customer mapping (QBO Customer ID) ────────────────
    // The client_id lives on the invoice row; the customer mapping is keyed by it.
    const invoiceRow = await deps.knex('invoices')
      .where({ invoice_id: payload.invoiceId, tenant: deps.tenantId })
      .select('client_id')
      .first<{ client_id: string } | undefined>();

    const clientId = invoiceRow?.client_id;
    const customerMapping = clientId
      ? await deps.ledger.findByAlgaId('client', clientId)
      : undefined;

    if (!customerMapping) {
      const message = `No QBO customer mapping found for client ${clientId ?? '(unknown)'} on invoice ${payload.invoiceId}`;
      logger.debug('[paymentPushApplier] Customer mapping missing; marking failed', {
        opId: op.op_id,
        invoiceId: payload.invoiceId,
        clientId
      });
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;
      if (nextStatus === 'skipped') {
        await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'invoice_payment',
          entityId: paymentId,
          title: 'Payment push keeps failing — customer not mapped in QBO',
          context: {
            alga_payment_id: paymentId,
            alga_invoice_id: payload.invoiceId,
            alga_client_id: clientId,
            attempts: op.attempts + 1,
            message,
            details: message,
            realm: deps.targetRealm
          }
        });
        deps.stats.exceptionsCreated += 1;
      }
      continue;
    }

    // ── Build and push QBO Payment ───────────────────────────────────────
    const invoiceExternalId = invoiceMapping.external_entity_id;
    const customerId = customerMapping.external_entity_id;
    const amountDollars = Math.round(payload.amountCents) / 100;
    const paymentRefNum = truncateRef(payload.referenceNumber);

    const qboPaymentPayload: Record<string, unknown> = {
      CustomerRef: { value: customerId },
      TotalAmt: amountDollars,
      PaymentRefNum: paymentRefNum,
      PrivateNote: `Alga payment ${payload.referenceNumber}`,
      Line: [
        {
          Amount: amountDollars,
          LinkedTxn: [{ TxnId: invoiceExternalId, TxnType: 'Invoice' }]
        }
      ]
    };

    if (depositAccountRef) {
      qboPaymentPayload.DepositToAccountRef = { value: depositAccountRef.value };
    }

    try {
      await deps.ops.markInProgress(deps.tenantId, op.op_id);
      const createdPayment = await qboClient.create<any>('Payment', qboPaymentPayload);

      const externalPaymentId: string = createdPayment?.Id ?? createdPayment?.payment?.Id;
      if (!externalPaymentId) {
        throw new Error('QBO Payment response missing Id');
      }
      const syncToken: string = String(createdPayment?.SyncToken ?? createdPayment?.payment?.SyncToken ?? '0');

      // Write mapping row. The sync_token stored here is what paymentApplier
      // compares against the CDC change's syncToken — an exact match = echo → no-op.
      await deps.ledger.insert({
        algaEntityType: 'invoice_payment',
        algaEntityId: paymentId,
        externalEntityId: externalPaymentId,
        targetRealm: deps.targetRealm,
        syncStatus: 'synced',
        metadata: {
          sync_token: syncToken,
          allocations: [
            {
              invoiceId: payload.invoiceId,
              externalInvoiceId: invoiceExternalId,
              amountCents: payload.amountCents,
              algaPaymentId: paymentId
            }
          ],
          pushed: true,
          reference: payload.referenceNumber
        }
      });

      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;

      logger.info('[paymentPushApplier] Payment pushed to QBO', {
        tenantId: deps.tenantId,
        paymentId,
        externalPaymentId,
        invoiceId: payload.invoiceId,
        amountDollars
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'QBO payment creation failed';
      logger.warn('[paymentPushApplier] Failed to create QBO Payment', {
        opId: op.op_id,
        tenantId: deps.tenantId,
        error: message
      });
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;

      if (nextStatus === 'skipped') {
        await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'invoice_payment',
          entityId: paymentId,
          title: 'Payment push keeps failing in accounting',
          context: {
            alga_payment_id: paymentId,
            alga_invoice_id: payload.invoiceId,
            attempts: op.attempts + 1,
            message,
            details: message,
            realm: deps.targetRealm
          }
        });
        deps.stats.exceptionsCreated += 1;
      }
    }
  }
}
