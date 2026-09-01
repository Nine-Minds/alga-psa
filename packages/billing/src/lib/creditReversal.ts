import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

/**
 * Canonical reversal of the credits applied to an invoice — the single
 * primitive behind void, unfinalize, and hard-delete. The ledger is the
 * source of truth: `credit_application` transactions carry
 * `metadata.applied_credits` provenance, and a reversal restores those exact
 * amounts to `credit_tracking` and writes one auditable `credit_adjustment`
 * per application with `metadata.reversal_of` linking back.
 *
 * Contract:
 * - The caller must already be inside a transaction and must have locked the
 *   invoice row (`SELECT … FOR UPDATE` on `invoices`) before calling. The
 *   primitive then locks the referenced `credit_tracking` rows in stable
 *   `credit_id` order — the shared invoice-row-then-credit-rows lock order
 *   that every writer of these tables follows to avoid deadlocks.
 * - Repeat-safe: applications already reversed (a completed
 *   `credit_adjustment` whose `metadata.reversal_of` names the application
 *   transaction) are skipped, so unfinalize → re-finalize → unfinalize cycles
 *   never restore the same application twice.
 * - All application transactions are reversed, not only the first.
 * - Historical `credit_application` / `credit_adjustment` / `credit_allocations`
 *   rows are never deleted here — they are ledger evidence. Active-versus-
 *   reversed state is determined by the explicit `reversal_of` link.
 * - Malformed or missing provenance fails the transaction instead of silently
 *   losing customer credit.
 * - `invoices.credit_applied` is set to zero before returning: a draft,
 *   cancelled, or deleted invoice carries no applied credit.
 */

export interface RestoredCredit {
  creditId: string;
  amount: number;
}

export interface ReversedCreditApplication {
  /** The `credit_application` transaction that was reversed. */
  transactionId: string;
  /** Sum restored to the credit pool for this application. */
  restoredAmount: number;
  /** Per-credit restored amounts (mirrors the application's provenance). */
  restoredCredits: RestoredCredit[];
}

export interface CreditReversalResult {
  reversedApplications: ReversedCreditApplication[];
  totalRestored: number;
}

function parseTransactionMetadata(
  metadata: unknown,
  transactionId: string
): Record<string, unknown> | null {
  if (metadata == null) {
    return null;
  }
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      throw new Error(
        `Credit transaction ${transactionId} has unparseable metadata; refusing to reverse without provenance`
      );
    }
  }
  if (typeof metadata === 'object') {
    return metadata as Record<string, unknown>;
  }
  return null;
}

/**
 * Validate and flatten one application's `metadata.applied_credits`. Fails
 * fast on missing or malformed provenance — restoring a guessed amount (or
 * silently restoring nothing) would permanently lose or invent customer
 * credit.
 */
function extractAppliedCredits(txn: {
  transaction_id: string;
  metadata: unknown;
}): RestoredCredit[] {
  const metadata = parseTransactionMetadata(txn.metadata, txn.transaction_id);
  const appliedCredits = metadata?.applied_credits;
  if (!Array.isArray(appliedCredits)) {
    throw new Error(
      `Credit application transaction ${txn.transaction_id} has no applied_credits provenance; refusing to reverse it blind`
    );
  }

  return appliedCredits.map((entry: any, index: number): RestoredCredit => {
    const creditId = entry?.creditId;
    const amount = Number(entry?.amount);
    if (typeof creditId !== 'string' || creditId.length === 0) {
      throw new Error(
        `Credit application transaction ${txn.transaction_id} applied_credits[${index}] is missing a creditId`
      );
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(
        `Credit application transaction ${txn.transaction_id} applied_credits[${index}] has an invalid amount (${String(entry?.amount)})`
      );
    }
    return { creditId, amount };
  });
}

export async function reverseCreditApplicationsForInvoice(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
  userId: string,
  reason: string
): Promise<CreditReversalResult> {
  const now = new Date().toISOString();
  const db = tenantDb(trx, tenant);

  // Every credit_application for this invoice — not only the first.
  // Deterministic order keeps reversal audit rows reproducible.
  const creditAppTxns = await db
    .table('transactions')
    .where({ invoice_id: invoiceId, type: 'credit_application' })
    .orderBy([
      { column: 'created_at', order: 'asc' },
      { column: 'transaction_id', order: 'asc' },
    ])
    .select('*');

  // Idempotency boundary: an application already reversed by a completed
  // credit_adjustment (metadata.reversal_of) must not be restored again, or
  // repeated unfinalize/re-finalize cycles would over-credit the client.
  let alreadyReversedIds = new Set<string>();
  if (creditAppTxns.length > 0) {
    const adjustments = await db
      .table('transactions')
      .where({ invoice_id: invoiceId, type: 'credit_adjustment', status: 'completed' })
      .select('transaction_id', 'metadata');
    alreadyReversedIds = new Set(
      adjustments
        .map((adj: any) => parseTransactionMetadata(adj.metadata, adj.transaction_id)?.reversal_of)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    );
  }

  // Validate provenance for every active application up front so nothing is
  // mutated when any of them would fail.
  const activeApplications = creditAppTxns
    .filter((txn: any) => !alreadyReversedIds.has(txn.transaction_id))
    .map((txn: any) => ({ txn, appliedCredits: extractAppliedCredits(txn) }));

  // Lock the referenced credit rows in stable credit_id order (the invoice row
  // is already locked by the caller — invoice first, then credit rows). A
  // missing credit row means the provenance points at credit we can no longer
  // restore; fail rather than silently dropping it.
  const creditIds = Array.from(
    new Set(
      activeApplications.flatMap(({ appliedCredits }) =>
        appliedCredits.filter((c) => c.amount > 0).map((c) => c.creditId)
      )
    )
  ).sort();

  if (creditIds.length > 0) {
    const lockedRows = await db
      .table('credit_tracking')
      .whereIn('credit_id', creditIds)
      .orderBy('credit_id', 'asc')
      .forUpdate()
      .select('credit_id');
    if (lockedRows.length !== creditIds.length) {
      const found = new Set(lockedRows.map((row: any) => String(row.credit_id)));
      const missing = creditIds.filter((id) => !found.has(id));
      throw new Error(
        `Cannot reverse credit applications for invoice ${invoiceId}: credit_tracking rows missing for credit id(s) ${missing.join(', ')}`
      );
    }
  }

  const reversedApplications: ReversedCreditApplication[] = [];
  let totalRestored = 0;

  for (const { txn, appliedCredits } of activeApplications) {
    let restoredForApplication = 0;

    for (const applied of appliedCredits) {
      if (applied.amount === 0) {
        continue;
      }
      // Restore the credit pool. The derived client balance comes from
      // credit_tracking.remaining_amount, so this IS the balance restore.
      await db
        .table('credit_tracking')
        .where({ credit_id: applied.creditId })
        .increment('remaining_amount', applied.amount)
        .update({ updated_at: now });
      restoredForApplication += applied.amount;
    }

    if (restoredForApplication > 0) {
      // One auditable reversal record per application; reversal_of is the
      // idempotency link consulted above.
      await db.table('transactions').insert({
        transaction_id: uuidv4(),
        client_id: txn.client_id,
        invoice_id: invoiceId,
        amount: restoredForApplication,
        type: 'credit_adjustment',
        status: 'completed',
        description: `Credit application reversed (${reason})`,
        created_at: now,
        balance_after: null,
        tenant,
        metadata: {
          reversal_of: txn.transaction_id,
          reason,
          reversed_by: userId,
          restored_credits: appliedCredits,
        },
        currency_code: txn.currency_code ?? null,
      });

      reversedApplications.push({
        transactionId: txn.transaction_id,
        restoredAmount: restoredForApplication,
        restoredCredits: appliedCredits,
      });
      totalRestored += restoredForApplication;
    }
  }

  // A reversed invoice carries no applied credit — unconditionally, so drift
  // between credit_applied and the ledger heals rather than persists.
  await db
    .table('invoices')
    .where({ invoice_id: invoiceId })
    .update({ credit_applied: 0, updated_at: now });

  return { reversedApplications, totalRestored };
}
