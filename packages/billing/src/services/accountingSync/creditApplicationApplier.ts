import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';
import type { AccountingSyncCycleStats } from './accountingSync.types';
import type { SyncOperationsRepository } from './syncOperationsRepository';
import type { SyncMappingLedger } from './syncMappingLedger';
import type { SyncExceptionService } from './syncExceptions.types';

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

interface ApplyCreditPayload {
  creditNoteInvoiceId: string;
  targetInvoiceId: string;
  amountCents: number;
}

/**
 * Drain pending apply_credit ops.
 *
 * Each op links a QBO CreditMemo to a QBO Invoice via a zero-dollar Payment,
 * mirroring the Alga credit application in QBO so both systems agree on
 * outstanding balances.
 *
 * An op stays PENDING (without incrementing its attempt count) when either
 * the CreditMemo or the Invoice has not yet been exported to QBO — the op
 * will drain naturally on the next cycle after the export drains complete.
 */
export async function drainApplyCreditOps(deps: DrainDeps): Promise<void> {
  const pending = await deps.ops.listPending(deps.tenantId, deps.adapterType, {
    operation: 'apply_credit',
    targetRealm: deps.targetRealm
  });

  if (pending.length === 0) {
    return;
  }

  let qboClient: QboClientService | null = null;
  try {
    qboClient = await QboClientService.create(deps.tenantId, deps.targetRealm);
  } catch (error) {
    // Auth / setup error — leave all ops pending; the export drain will have
    // already surfaced a connection exception.
    logger.warn('[creditApplicationApplier] Cannot create QBO client; leaving apply_credit ops pending', {
      tenantId: deps.tenantId,
      targetRealm: deps.targetRealm,
      error: error instanceof Error ? error.message : error
    });
    return;
  }

  for (const op of pending) {
    const payload = op.payload as ApplyCreditPayload | null;
    if (!payload?.creditNoteInvoiceId || !payload?.targetInvoiceId) {
      // Malformed op — skip to avoid blocking the drain.
      logger.warn('[creditApplicationApplier] apply_credit op missing payload fields', {
        opId: op.op_id,
        tenantId: deps.tenantId
      });
      await deps.ops.markFailed(deps.tenantId, op.op_id, 'Missing payload fields (creditNoteInvoiceId or targetInvoiceId)');
      deps.stats.opsFailed += 1;
      continue;
    }

    // ── Idempotency: skip if a credit_application mapping already exists ──
    const existingApplicationMapping = await deps.ledger.findByAlgaId(
      'credit_application',
      op.alga_entity_id
    );
    if (existingApplicationMapping) {
      logger.debug('[creditApplicationApplier] Credit application already mapped; marking done', {
        opId: op.op_id,
        allocationId: op.alga_entity_id
      });
      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;
      continue;
    }

    // ── Resolve both QBO entity IDs ────────────────────────────────────
    const creditMemoMapping = await deps.ledger.findByAlgaId('invoice', payload.creditNoteInvoiceId);
    const invoiceMapping = await deps.ledger.findByAlgaId('invoice', payload.targetInvoiceId);

    if (!creditMemoMapping || !invoiceMapping) {
      // One or both documents are not yet exported — leave pending without
      // incrementing attempt count so the op retries without burning retries.
      logger.debug('[creditApplicationApplier] Mappings not yet available; leaving apply_credit op pending', {
        opId: op.op_id,
        hasCreditMemoMapping: Boolean(creditMemoMapping),
        hasInvoiceMapping: Boolean(invoiceMapping)
      });
      // Do NOT call markFailed — just leave pending so attempt count stays stable.
      continue;
    }

    const qboCreditMemoId = creditMemoMapping.external_entity_id;
    const qboInvoiceId = invoiceMapping.external_entity_id;

    // ── Resolve the QBO customer ID from the target invoice mapping ────
    // The customer ref is stored in the invoice's QBO entity. We look it
    // up from the metadata; if unavailable we fetch from QBO directly.
    let qboCustomerId: string | null =
      (invoiceMapping.metadata as any)?.customer_ref ??
      (invoiceMapping.metadata as any)?.customerId ??
      null;

    if (!qboCustomerId) {
      // Fall back: read the invoice from QBO to get the CustomerRef.
      try {
        const qboInvoice = await qboClient.read<any>('Invoice', qboInvoiceId);
        qboCustomerId = qboInvoice?.CustomerRef?.value ?? null;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read QBO invoice for customer ref';
        logger.warn('[creditApplicationApplier] Could not resolve QBO customer ID', {
          opId: op.op_id,
          qboInvoiceId,
          error: message
        });
        const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
        deps.stats.opsFailed += 1;
        if (nextStatus === 'skipped') {
          await deps.exceptions.createOrUpdate({
            type: 'accounting_sync_export_error',
            entityType: 'credit_allocation',
            entityId: op.alga_entity_id,
            title: 'Credit application keeps failing in accounting',
            context: {
              alga_entity_id: op.alga_entity_id,
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
    }

    if (!qboCustomerId) {
      const message = 'Could not resolve QBO customer ID for credit application';
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;
      if (nextStatus === 'skipped') {
        await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'credit_allocation',
          entityId: op.alga_entity_id,
          title: 'Credit application keeps failing in accounting',
          context: {
            alga_entity_id: op.alga_entity_id,
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

    // ── Create the zero-dollar QBO Payment linking CreditMemo → Invoice ─
    const amountDollars = Math.round(payload.amountCents) / 100;
    const paymentPayload = {
      CustomerRef: { value: qboCustomerId },
      TotalAmt: 0,
      Line: [
        {
          Amount: amountDollars,
          LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: 'Invoice' }]
        },
        {
          Amount: amountDollars,
          LinkedTxn: [{ TxnId: qboCreditMemoId, TxnType: 'CreditMemo' }]
        }
      ],
      PrivateNote: 'Credit application from Alga'
    };

    try {
      await deps.ops.markInProgress(deps.tenantId, op.op_id);
      const createdPayment = await qboClient.create<any>('Payment', paymentPayload);
      const externalPaymentId: string = createdPayment?.Id ?? createdPayment?.payment?.Id;
      if (!externalPaymentId) {
        throw new Error('QBO Payment response missing Id');
      }

      // Store mapping for idempotency and echo suppression.
      await deps.ledger.insert({
        algaEntityType: 'credit_application',
        algaEntityId: op.alga_entity_id,
        externalEntityId: externalPaymentId,
        targetRealm: deps.targetRealm,
        syncStatus: 'synced',
        metadata: {
          credit_note_invoice_id: payload.creditNoteInvoiceId,
          target_invoice_id: payload.targetInvoiceId,
          amount_cents: payload.amountCents,
          qbo_credit_memo_id: qboCreditMemoId,
          qbo_invoice_id: qboInvoiceId
        }
      });

      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;

      logger.info('[creditApplicationApplier] Credit application synced to QBO', {
        tenantId: deps.tenantId,
        allocationId: op.alga_entity_id,
        externalPaymentId,
        qboCreditMemoId,
        qboInvoiceId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'QBO payment creation failed';
      logger.warn('[creditApplicationApplier] Failed to create QBO Payment for credit application', {
        opId: op.op_id,
        tenantId: deps.tenantId,
        error: message
      });
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;

      if (nextStatus === 'skipped') {
        await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'credit_allocation',
          entityId: op.alga_entity_id,
          title: 'Credit application keeps failing in accounting',
          context: {
            alga_entity_id: op.alga_entity_id,
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
