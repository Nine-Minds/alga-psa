import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- sync-engine applier intentionally bridges billing to the QuickBooks client (same bridge as the accounting export adapter)
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
    const payload = op.payload as unknown as RecordPaymentPayload | null;
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
    const existingMapping = await deps.ledger.findByAlgaId('invoice_payment', paymentId, deps.targetRealm);
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
    // Exact tenant + provider + type + realm match — a mapping in another
    // company or a tombstone never satisfies the lookup.
    const invoiceMapping = await deps.ledger.findByAlgaId('invoice', payload.invoiceId, deps.targetRealm);
    if (!invoiceMapping) {
      const blocked = await deps.ledger.findNonConsumable('invoice', payload.invoiceId, deps.targetRealm);
      const message = blocked
        ? `Cannot push payment: ${blocked.deleted_at
            ? 'invoice was unlinked from QuickBooks'
            : 'invoice maps to a different QuickBooks company'}. Relink the invoice mapping to this company first.`
        : `No QBO invoice mapping found for invoice ${payload.invoiceId}`;
      logger.warn('[paymentPushApplier] Invoice mapping missing or non-consumable; marking failed', {
        opId: op.op_id,
        invoiceId: payload.invoiceId,
        blocked: Boolean(blocked)
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
    const invoiceRow = await tenantDb(deps.knex, deps.tenantId).table('invoices')
      .where({ invoice_id: payload.invoiceId })
      .select('client_id')
      .first<{ client_id: string } | undefined>();

    const clientId = invoiceRow?.client_id;
    const customerMapping = clientId
      ? await deps.ledger.findByAlgaId('client', clientId, deps.targetRealm)
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

    // ── Revalidate the remote invoice immediately before acting ──────────
    // The mapping is realm-exact, but the remote record itself may be stale
    // (deleted in QBO, or the id retargeted by an out-of-band edit). A payment
    // pushed against a ghost invoice would land as unapplied credit or fail
    // mid-create, so read the invoice first and abort without writing.
    let remoteInvoice: any = null;
    try {
      remoteInvoice = await qboClient.read<any>('Invoice', invoiceExternalId);
    } catch (error) {
      const readMessage = error instanceof Error ? error.message : 'Failed to read QBO invoice';
      logger.warn('[paymentPushApplier] Failed to revalidate QBO invoice before payment push', {
        opId: op.op_id,
        invoiceId: payload.invoiceId,
        externalInvoiceId: invoiceExternalId,
        error: readMessage
      });
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, readMessage);
      deps.stats.opsFailed += 1;
      if (nextStatus === 'skipped') {
        await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'invoice_payment',
          entityId: paymentId,
          title: 'Payment push keeps failing — QBO invoice could not be verified',
          context: {
            alga_payment_id: paymentId,
            alga_invoice_id: payload.invoiceId,
            external_invoice_id: invoiceExternalId,
            attempts: op.attempts + 1,
            message: readMessage,
            details: readMessage,
            realm: deps.targetRealm
          }
        });
        deps.stats.exceptionsCreated += 1;
      }
      continue;
    }

    if (!remoteInvoice) {
      const message = `QBO Invoice ${invoiceExternalId} no longer exists in this company — the payment was not pushed`;
      logger.warn('[paymentPushApplier] QBO invoice missing at push time; marking failed', {
        opId: op.op_id,
        invoiceId: payload.invoiceId,
        externalInvoiceId: invoiceExternalId
      });
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;
      if (nextStatus === 'skipped') {
        await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'invoice_payment',
          entityId: paymentId,
          title: 'Payment push blocked — QuickBooks invoice is missing',
          context: {
            alga_payment_id: paymentId,
            alga_invoice_id: payload.invoiceId,
            external_invoice_id: invoiceExternalId,
            attempts: op.attempts + 1,
            message,
            details:
              `${message}. Re-link the invoice in the accounting mapping screen, then retry the payment push.`,
            realm: deps.targetRealm
          }
        });
        deps.stats.exceptionsCreated += 1;
      }
      continue;
    }

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

      // ── Detect a silently-unapplied payment ────────────────────────────
      // When the linked invoice has no open balance on the QBO side, QBO
      // accepts the create but drops the application line and books the full
      // amount as unapplied customer credit. The money landed (op stays
      // done), but a bookkeeper has to reapply it in QBO — surface that.
      const entity = createdPayment?.Id ? createdPayment : createdPayment?.payment;
      // UnappliedAmt is the authoritative signal — QBO always computes it on
      // Payment responses, while Line can be sparse in mocks/partial reads.
      const unappliedAmt = Number(entity?.UnappliedAmt ?? 0);
      const responseLines = Array.isArray(entity?.Line) ? entity.Line : [];
      if (unappliedAmt > 0) {
        const result = await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_unmapped_payment',
          entityType: 'invoice_payment',
          entityId: paymentId,
          title: 'Pushed payment was not applied to its invoice in QuickBooks',
          context: {
            reason: 'pushed_payment_unapplied',
            alga_payment_id: paymentId,
            alga_invoice_id: payload.invoiceId,
            external_payment_id: externalPaymentId,
            external_invoice_id: invoiceExternalId,
            amount_cents: payload.amountCents,
            unapplied_amount: unappliedAmt,
            message:
              'QuickBooks accepted the payment but recorded it as unapplied customer credit — ' +
              'the linked invoice had no open balance. Apply or refund the credit in QuickBooks.',
            details:
              `QBO Payment ${externalPaymentId} for invoice ${invoiceExternalId}: ` +
              `UnappliedAmt=${unappliedAmt}, applicationLines=${responseLines.length}`,
            realm: deps.targetRealm
          }
        });
        if (result.created) {
          deps.stats.exceptionsCreated += 1;
        }
        logger.warn('[paymentPushApplier] Pushed payment landed unapplied in QBO', {
          tenantId: deps.tenantId,
          paymentId,
          externalPaymentId,
          invoiceId: payload.invoiceId,
          unappliedAmt
        });
      }
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
