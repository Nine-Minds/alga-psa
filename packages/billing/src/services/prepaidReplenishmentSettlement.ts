import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { resolveCreditExpirationDate } from '../lib/creditExpirationDate';
import { computePrepaidBlockExpirationDate } from '../lib/prepaidBlockDates';
import { reconcileLineAllocations } from '@alga-psa/shared/billingClients/hourBlockService';
import {
  lockInvoiceBlocksWithLineSiblings,
  lockPrepaidBlockOwnersForInvoice,
  releaseAndVoidLinkedBlock,
  scheduleExpiryIssuanceForActivatedBlock,
} from './prepaidBlockLifecycleService';

/**
 * Payment-time settlement of prepaid replenishment invoices and finalize-time
 * activation of their hour blocks. Pure database logic with no server-action,
 * UI, or rendering dependencies, so worker processes (Temporal auto-pay via
 * recordExternalPayment) can import it without the invoice actions graph.
 */

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableExpression: string
) {
  return tenantDb(conn, tenant).table<Row>(tableExpression);
}

type PendingHourBlockRow = {
  tenant: string;
  source_invoice_id: string;
  status: string;
  block_id: string;
  service_id: string;
  source_invoice_charge_id: string | null;
};

type InvoiceChargeRow = {
  tenant: string;
  invoice_id: string;
  item_id: string;
  quantity: number | string | null;
  unit_price: number | string | null;
  total_price: number | string | null;
  service_id: string | null;
};

type ReplenishmentInvoiceRow = {
  invoice_id: string;
  status: string;
  client_id: string;
  subtotal: number | string | null;
  total_amount: number | null;
  is_prepayment: boolean | null;
  currency_code: string | null;
  credit_expiration_date: string | Date | null;
};

export type InvoiceCreditHandlingKind = 'prepayment' | 'negative_total' | 'standard';

export function classifyInvoiceCreditHandling(invoice: {
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

/**
 * Finalize hook for ad-hoc prepaid hour blocks. A draft purchase invoice is
 * editable before finalization (line qty/rate/service edits, line removal), so
 * the pending block can hold stale mint-time values. The finalized invoice line
 * is the authority: inside one transaction each pending block is synchronized
 * to its source line (total/remaining minutes from quantity, hourly_rate from
 * unit_price, purchase_amount, service) and flipped to `active` with a
 * `purchase` audit row. A block whose line no longer survives as a positive
 * charge on the finalized invoice is voided instead — never activated with
 * values that drift from the invoice.
 *
 * Resolution is strictly linkage-based (source_invoice_charge_id). Removing a
 * draft line fires the FK's ON DELETE SET NULL, which erases the linkage —
 * indistinguishable from a block that never had one — so a NULL linkage at
 * finalization CANNOT be resolved by service/sole-charge matching: any
 * surviving line picked that way may belong to a different (re-added or
 * foreign) line, activating the block from data it cannot prove ownership of
 * (verified in review run b2b3038e). NULL or dangling linkage ⇒ void.
 *
 * The finalize flow passes its own transaction, which withTransaction joins
 * (a passed trx is reused, not nested), so invoice finalization and block
 * activation are one atomic unit — mirroring unfinalize/draft-delete, whose
 * hour-block hooks also run inside the caller's trx. The pending-block
 * selection itself runs INSIDE that transaction as SELECT ... FOR UPDATE in
 * canonical block_id order, and every status write re-checks `pending`:
 * a concurrent void/manual-expire/unfinalize that commits mid-flight
 * serialized on the same row lock, so activation can never resurrect a block
 * that left `pending` (29.8.18 mitigation round 3).
 */
export async function activateHourBlocksForFinalizedInvoice(
  invoiceId: string,
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string | null
): Promise<void> {
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Lock order (plan Risk 6): Prepaid Block config + issuance rows FIRST,
    // then every block of the affected lines plus the invoice-linked blocks in
    // one canonical block_id-ordered statement (the same order every other
    // hour_blocks check-then-act site locks in; see selectEligibleBlocks in
    // shared/billingClients/hourBlockService), all inside the transaction that
    // flips them. Pre-fix, this snapshot was an unlocked read outside the
    // transaction and the activation UPDATE did not re-check status, so a
    // void/expire committing in between resurrected the block to `active` on
    // top of the void audit.
    const { contractLineIds } = await lockPrepaidBlockOwnersForInvoice(trx, tenant, invoiceId);
    const linkedBlocks = await lockInvoiceBlocksWithLineSiblings(trx, tenant, invoiceId, contractLineIds);
    const pendingBlocks = linkedBlocks.filter((b) => b.status === 'pending');

    if (pendingBlocks.length === 0) {
      return;
    }

    const invoiceDate: string | Date | null = pendingBlocks.some((b) => b.contract_line_id)
      ? ((await tenantScopedTable(trx, tenant, 'invoices').where({ invoice_id: invoiceId }).first('invoice_date'))?.invoice_date ?? null) as string | Date | null
      : null;
    const linesToRedraw = new Set<string>();

    const now = new Date().toISOString();
    for (const block of pendingBlocks) {
      const line = await resolvePurchaseLineForBlock(trx, tenant, invoiceId, block);

      if (!line) {
        if (block.contract_line_id) {
          // Contract block: release its gap draws and restore its issuance too.
          const released = await releaseAndVoidLinkedBlock(trx, tenant, {
            blockId: block.block_id, status: 'pending', contractLineId: block.contract_line_id,
            issuanceId: block.issuance_id, invoiceId, userId, now,
            reason: 'Purchase line removed from the invoice before finalization',
          });
          if (released.voided) linesToRedraw.add(block.contract_line_id);
          continue;
        }
        await voidPendingBlockAtFinalization(
          trx,
          tenant,
          block.block_id,
          userId,
          now,
          'Purchase line removed from the invoice before finalization',
          { source_invoice_id: invoiceId, source_invoice_charge_id: block.source_invoice_charge_id ?? null },
        );
        continue;
      }

      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unit_price);
      const totalMinutes = Math.round(quantity * 60);
      if (!Number.isFinite(quantity) || quantity <= 0 || totalMinutes <= 0) {
        if (block.contract_line_id) {
          const released = await releaseAndVoidLinkedBlock(trx, tenant, {
            blockId: block.block_id, status: 'pending', contractLineId: block.contract_line_id,
            issuanceId: block.issuance_id, invoiceId, userId, now,
            reason: 'Purchase line no longer has a positive quantity at finalization',
          });
          if (released.voided) linesToRedraw.add(block.contract_line_id);
          continue;
        }
        await voidPendingBlockAtFinalization(
          trx,
          tenant,
          block.block_id,
          userId,
          now,
          'Purchase line no longer has a positive quantity at finalization',
          { source_invoice_id: invoiceId, item_id: line.item_id },
        );
        continue;
      }

      const isContractBlock = Boolean(block.contract_line_id);
      const isCadenceBlock = isContractBlock && block.service_period_record_id != null && block.issuance_id == null;
      let remainingMinutes = totalMinutes;
      let expirationUpdate: { expiration_date: string | null } | Record<string, never> = {};
      let purchaseAmount = Math.round(quantity * unitPrice);

      if (isContractBlock) {
        // The line's authoritative total is the price; quantity * unit_price is
        // only equal to it when the price divides evenly by the hours.
        if (line.total_price != null) purchaseAmount = Number(line.total_price);

        // Expiry clock starts at the FINAL invoice date (plan D6): the draft's
        // date may have been edited since generation. If the config was removed
        // since, keep the expiry stamped at generation.
        const config = await tenantScopedTable(trx, tenant, 'contract_line_prepaid_blocks')
          .where({ contract_line_id: block.contract_line_id })
          .first('expiry_months');
        // A cadence block's validity is a count of cadence periods fixed when it
        // was minted; it has no invoice-date expiry clock and no expiry follow-on.
        if (config && invoiceDate && !isCadenceBlock) {
          expirationUpdate = {
            expiration_date: computePrepaidBlockExpirationDate(invoiceDate, config.expiry_months as number | null),
          };
        }

        // A pending contract block may already hold gap draws; remaining is
        // total minus what is allocated, not total.
        const allocatedRow = await tenantScopedTable(trx, tenant, 'hour_block_time_allocations')
          .where({ block_id: block.block_id })
          .sum({ minutes: 'minutes' })
          .first();
        const allocated = Number(allocatedRow?.minutes ?? 0);
        if (allocated > totalMinutes) {
          // The draft line was edited below what the gap draw already holds:
          // drop this block's draws and let the line re-draw against the final
          // size once the status flips.
          await tenantScopedTable(trx, tenant, 'hour_block_time_allocations').where({ block_id: block.block_id }).delete();
          linesToRedraw.add(block.contract_line_id!);
        } else {
          remainingMinutes = totalMinutes - allocated;
        }
      }

      const activated = await tenantScopedTable(trx, tenant, 'hour_blocks')
        // Belt-and-suspenders alongside the row lock: only a still-pending row
        // may flip to active, so drift in the locked select can never
        // resurrect a voided/expired block.
        .where({ tenant, block_id: block.block_id, status: 'pending' })
        .update({
          status: 'active',
          purchased_at: now,
          updated_at: now,
          // Sync from the authoritative final line. An ad-hoc pending block has
          // never been burnable, so remaining resets with total.
          total_minutes: totalMinutes,
          remaining_minutes: remainingMinutes,
          hourly_rate: Math.round(unitPrice),
          purchase_amount: purchaseAmount,
          service_id: line.service_id ?? block.service_id,
          source_invoice_charge_id: line.item_id,
          ...expirationUpdate,
        });
      if (activated === 0) continue;
      await tenantScopedTable(trx, tenant, 'hour_block_audit').insert({
        tenant,
        block_id: block.block_id,
        type: 'purchase',
        minutes_delta: null,
        reason: null,
        created_by: userId,
        metadata: {
          source_invoice_id: invoiceId,
          source_invoice_charge_id: line.item_id,
          synced_from_line: { item_id: line.item_id, quantity, unit_price: unitPrice },
        },
      });

      if (isContractBlock && !isCadenceBlock) {
        await scheduleExpiryIssuanceForActivatedBlock(
          trx,
          tenant,
          {
            block_id: block.block_id,
            client_id: block.client_id,
            contract_line_id: block.contract_line_id!,
            client_contract_id: block.client_contract_id,
          },
          invoiceDate!,
        );
      }
    }
    for (const lineId of [...linesToRedraw].sort()) {
      await reconcileLineAllocations(trx, tenant, lineId);
    }
    console.log(`Activated ${pendingBlocks.length} pending hour block(s) from invoice ${invoiceId}`);
  });
}

/**
 * Resolves the authoritative invoice charge for a pending block: exactly the
 * recorded source line, still present on the invoice being finalized. There is
 * deliberately NO fallback: line deletion nulls the linkage (FK ON DELETE SET
 * NULL), so a pending block without a resolvable linkage at finalization is a
 * block whose line was removed (or whose lineage cannot be proven), and any
 * surviving-line match could bind it to a line it was never minted against.
 */
async function resolvePurchaseLineForBlock(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
  block: { service_id: string; source_invoice_charge_id: string | null },
): Promise<InvoiceChargeRow | null> {
  if (!block.source_invoice_charge_id) {
    return null;
  }

  return await tenantScopedTable<InvoiceChargeRow>(trx, tenant, 'invoice_charges')
    .where({ tenant, item_id: block.source_invoice_charge_id, invoice_id: invoiceId })
    .first() ?? null;
}

async function voidPendingBlockAtFinalization(
  trx: Knex.Transaction,
  tenant: string,
  blockId: string,
  userId: string | null,
  now: string,
  reason: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await tenantScopedTable(trx, tenant, 'hour_blocks')
    // Belt-and-suspenders alongside the row lock: only a still-pending row may
    // be voided here, keeping the activation/void writes symmetric.
    .where({ tenant, block_id: blockId, status: 'pending' })
    .update({
      status: 'voided',
      voided_at: now,
      voided_by: userId,
      void_reason: reason,
      updated_at: now,
    });
  await tenantScopedTable(trx, tenant, 'hour_block_audit').insert({
    tenant,
    block_id: blockId,
    type: 'void',
    minutes_delta: null,
    reason,
    created_by: userId,
    metadata,
  });
}

/**
 * Settle a replenishment invoice exactly once. Replenishment invoices may be
 * issued/sent while their entitlements remain pending; payment is the only
 * event that activates the linked credit or hour block. The invoice row is
 * locked before the entitlement rows and the alert lock is cleared in the
 * same transaction, so concurrent payment/status callbacks cannot mint twice.
 */
export async function settlePrepaidReplenishmentInvoice(
  knex: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
  userId: string | null = null,
): Promise<void> {
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const invoice = await tenantScopedTable<ReplenishmentInvoiceRow>(trx, tenant, 'invoices')
      .where({ invoice_id: invoiceId })
      .forUpdate()
      .first();
    if (!invoice || invoice.status !== 'paid') return;

    // Always acquire invoice before alert. Payment callers commonly already
    // hold the invoice lock; reversing this order creates an invoice/alert
    // deadlock against finalization and other status transitions.
    const alert = await tenantScopedTable(trx, tenant, 'prepaid_balance_alerts')
      .where({ replenishment_invoice_id: invoiceId })
      .forUpdate()
      .first();
    if (!alert) return;

    const handlingKind = classifyInvoiceCreditHandling(invoice);
    if (handlingKind === 'prepayment') {
      const alreadyIssued = await tenantScopedTable(trx, tenant, 'transactions')
        .where({ invoice_id: invoiceId, type: 'credit_issuance' })
        .first('transaction_id');
      if (!alreadyIssued) {
        const now = new Date().toISOString();
        const creditAmount = Number(invoice.subtotal);
        const currencyCode = String(invoice.currency_code ?? 'USD');
        const expirationDate = invoice.credit_expiration_date
          ? new Date(invoice.credit_expiration_date).toISOString()
          : await resolveCreditExpirationDate(trx, tenant, invoice.client_id);
        const lastTransaction = await tenantScopedTable(trx, tenant, 'transactions')
          .where({ client_id: invoice.client_id })
          .orderBy('created_at', 'desc')
          .first();
        const transactionId = uuidv4();
        await tenantScopedTable(trx, tenant, 'transactions').insert({
          transaction_id: transactionId,
          client_id: invoice.client_id,
          invoice_id: invoiceId,
          amount: creditAmount,
          type: 'credit_issuance',
          status: 'completed',
          description: 'Credit issued from paid replenishment invoice',
          created_at: now,
          balance_after: (Number(lastTransaction?.balance_after) || 0) + creditAmount,
          tenant,
          expiration_date: expirationDate,
          currency_code: currencyCode,
        });
        await tenantScopedTable(trx, tenant, 'credit_tracking').insert({
          credit_id: uuidv4(),
          tenant,
          client_id: invoice.client_id,
          transaction_id: transactionId,
          amount: creditAmount,
          remaining_amount: creditAmount,
          created_at: now,
          expiration_date: expirationDate,
          is_expired: false,
          updated_at: now,
          currency_code: currencyCode,
        });
      }
    }

    await activateHourBlocksForFinalizedInvoice(invoiceId, trx, tenant, userId);
    await tenantScopedTable(trx, tenant, 'prepaid_balance_alerts')
      .where({ alert_id: alert.alert_id, replenishment_invoice_id: invoiceId })
      .update({
        replenishment_status: null,
        replenishment_invoice_id: null,
        replenishment_credit_amount: null,
        replenishment_bucket_minutes: null,
        replenishment_attempted_at: null,
        replenishment_error: null,
        updated_at: trx.fn.now(),
      });
  });
}
