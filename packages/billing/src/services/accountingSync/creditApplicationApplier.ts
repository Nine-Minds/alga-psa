import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- sync-engine applier intentionally bridges billing to the QuickBooks client (same bridge as the accounting export adapter)
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

/** How long an apply_credit op may wait on missing mappings before we surface it. */
export const STALLED_APPLY_CREDIT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type NonCreditMemoSource = 'prepayment' | 'project_deposit';

/**
 * Credits backed by these positive invoices never produce a QBO CreditMemo.
 * Treating their invoice mapping as one would submit an invalid linked payment.
 */
async function resolveNonCreditMemoSource(
  deps: DrainDeps,
  creditNoteInvoiceId: string
): Promise<NonCreditMemoSource | null> {
  try {
    const sourceInvoice = await deps.knex('invoices')
      .where({ invoice_id: creditNoteInvoiceId, tenant: deps.tenantId })
      .select('invoice_type', 'is_prepayment')
      .first();
    if (sourceInvoice && (sourceInvoice.invoice_type === 'prepayment' || sourceInvoice.is_prepayment)) {
      return 'prepayment';
    }

    const projectDepositCredit = await deps.knex('transactions')
      .where({
        invoice_id: creditNoteInvoiceId,
        tenant: deps.tenantId,
        type: 'credit_issuance',
      })
      .whereRaw("metadata->>'project_billing_credit_kind' = ?", ['project_deposit'])
      .first('transaction_id');
    return projectDepositCredit ? 'project_deposit' : null;
  } catch {
    // Infra failure: treat as a normal credit-note source so the op stays pending rather
    // than terminally failing on a lookup error.
    return null;
  }
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
    const payload = op.payload as unknown as ApplyCreditPayload | null;
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

    const nonCreditMemoSource = await resolveNonCreditMemoSource(
      deps,
      payload.creditNoteInvoiceId
    );
    if (nonCreditMemoSource) {
      const isProjectDeposit = nonCreditMemoSource === 'project_deposit';
      const message = isProjectDeposit
        ? 'Credit drawn from a project deposit cannot sync as a QuickBooks CreditMemo because its source document exports as a positive invoice.'
        : 'Credit drawn from a prepayment cannot sync because prepayment invoices are not exported to QuickBooks.';
      const result = await deps.exceptions.createOrUpdate({
        type: 'accounting_sync_export_error',
        entityType: 'credit_allocation',
        entityId: op.alga_entity_id,
        title: isProjectDeposit
          ? 'Project deposit credit applied to a synced invoice — QuickBooks not updated'
          : 'Prepayment credit applied to a synced invoice — QuickBooks not updated',
        context: {
          reason: isProjectDeposit
            ? 'project_deposit_credit_not_syncable'
            : 'prepayment_credit_not_syncable',
          alga_entity_id: op.alga_entity_id,
          alga_credit_note_invoice_id: payload.creditNoteInvoiceId,
          alga_target_invoice_id: payload.targetInvoiceId,
          requested_amount_cents: payload.amountCents,
          message,
          details:
            `${message} Settle the invoice inside QuickBooks (apply the customer's credit or record the ` +
            'payment there) so both systems agree, then resolve this exception.',
          realm: deps.targetRealm
        }
      });
      if (result.created) {
        deps.stats.exceptionsCreated += 1;
      }
      await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;
      continue;
    }

    // ── Resolve both QBO entity IDs ────────────────────────────────────
    const creditMemoMapping = await deps.ledger.findByAlgaId('invoice', payload.creditNoteInvoiceId);
    const invoiceMapping = await deps.ledger.findByAlgaId('invoice', payload.targetInvoiceId);

    if (!creditMemoMapping || !invoiceMapping) {
      // Otherwise an export simply hasn't drained yet — leave pending without
      // burning attempts. But waiting is only healthy for so long: past the
      // stall window, surface an exception instead of hiding behind the
      // pending-ops counter (it auto-resolves when the application lands).
      const ageMs = Date.now() - Date.parse(String(op.created_at));
      if (Number.isFinite(ageMs) && ageMs > STALLED_APPLY_CREDIT_AGE_MS) {
        const result = await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'credit_allocation',
          entityId: op.alga_entity_id,
          title: 'Credit application has been waiting on an invoice export for over a week',
          context: {
            reason: 'apply_credit_stalled',
            alga_entity_id: op.alga_entity_id,
            alga_credit_note_invoice_id: payload.creditNoteInvoiceId,
            alga_target_invoice_id: payload.targetInvoiceId,
            has_credit_memo_mapping: Boolean(creditMemoMapping),
            has_invoice_mapping: Boolean(invoiceMapping),
            op_created_at: op.created_at,
            details:
              'This credit application is waiting for a document that has not exported to QuickBooks. ' +
              'Check why the credit note or target invoice has not synced (export exceptions, go-live cutoff, ' +
              'auto-sync toggle); the application pushes automatically once both documents are mapped.',
            realm: deps.targetRealm
          }
        });
        if (result.created) {
          deps.stats.exceptionsCreated += 1;
        }
      }

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

    // ── Defensive: confirm the CreditMemo still carries this credit ────
    // QBO's company setting 'Automatically apply credits' (ON by default)
    // may have already applied the exported CreditMemo to the customer's
    // oldest open invoice — possibly a different one than Alga chose. A
    // bookkeeper applying it by hand has the same effect. Pushing the
    // linking Payment blindly would double-apply the credit, so check the
    // CM's remaining balance first and surface a conflict instead.
    try {
      const qboCreditMemo = await qboClient.read<any>('CreditMemo', qboCreditMemoId);
      const remainingDollars = Number(qboCreditMemo?.Balance);
      const remainingCents = Number.isFinite(remainingDollars) ? Math.round(remainingDollars * 100) : null;

      if (!qboCreditMemo || (remainingCents !== null && remainingCents < payload.amountCents)) {
        const message = !qboCreditMemo
          ? `QBO CreditMemo ${qboCreditMemoId} no longer exists`
          : `QBO CreditMemo ${qboCreditMemoId} has only ${remainingCents} cents of credit remaining; ` +
            `Alga applied ${payload.amountCents} cents — QBO likely auto-applied the credit to another invoice`;

        logger.warn('[creditApplicationApplier] Credit memo conflict; not pushing application', {
          opId: op.op_id,
          qboCreditMemoId,
          remainingCents,
          requestedCents: payload.amountCents
        });

        const result = await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'credit_allocation',
          entityId: op.alga_entity_id,
          title: 'Credit was already applied in QuickBooks — Alga application not synced',
          context: {
            reason: 'qbo_credit_already_consumed',
            alga_entity_id: op.alga_entity_id,
            alga_credit_note_invoice_id: payload.creditNoteInvoiceId,
            alga_target_invoice_id: payload.targetInvoiceId,
            qbo_credit_memo_id: qboCreditMemoId,
            qbo_invoice_id: qboInvoiceId,
            requested_amount_cents: payload.amountCents,
            remaining_credit_cents: remainingCents,
            message,
            details:
              `${message}. Check QuickBooks Account and Settings → Advanced → Automation → ` +
              `'Automatically apply credits' and reconcile which invoice should carry the credit. ` +
              `Once the credit is freed in QuickBooks, the application retries automatically.`,
            realm: deps.targetRealm
          }
        });
        if (result.created) {
          deps.stats.exceptionsCreated += 1;
        }

        await deps.ops.markFailed(deps.tenantId, op.op_id, message);
        deps.stats.opsFailed += 1;
        continue;
      }
    } catch (error) {
      // Read failure is transient — retry next cycle rather than push blind.
      const message = error instanceof Error ? error.message : 'Failed to read QBO credit memo';
      logger.warn('[creditApplicationApplier] Could not verify credit memo balance; retrying later', {
        opId: op.op_id,
        qboCreditMemoId,
        error: message
      });
      await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;
      continue;
    }

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

      // The application landed, so any earlier conflict exception is moot.
      await deps.exceptions.resolve('accounting_sync_export_error', 'credit_allocation', op.alga_entity_id);

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
