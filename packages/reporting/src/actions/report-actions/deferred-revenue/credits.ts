/**
 * Credits rollforward — pure computation over the `transactions` ledger.
 *
 * Sign conventions verified against packages/billing/src/actions/creditActions.ts
 * and packages/jobs/src/lib/handlers/expiredCreditsHandler.ts:
 *
 *   - credit_issuance                         positive (grants balance)
 *   - credit_issuance_from_negative_invoice   positive
 *   - prepayment                              positive (legacy; the current
 *       writer records prepayments as credit_issuance)
 *   - credit_application                      negative
 *   - credit_expiration                       negative
 *   - credit_adjustment                       positive (reversal) or negative (clawback)
 *   - credit_transfer                         negative on source client, positive on target
 *
 * Movement columns are signed sums of `amount` bucketed by transaction type;
 * opening is the signed sum of all credit-affecting transactions dated before
 * the month, closing = opening + in-month movement. Credits stay on the
 * transaction ledger / calendar months — not service-period cadence.
 */

import { emptyMovement, type MovementColumns } from './types';

export type CreditMovementKey = 'issued' | 'applied' | 'expired' | 'adjustments';

const ISSUED_TYPES = new Set([
  'credit_issuance',
  'credit_issuance_from_negative_invoice',
  'prepayment',
]);
const APPLIED_TYPES = new Set(['credit_application']);
const EXPIRED_TYPES = new Set(['credit_expiration']);
const ADJUSTMENT_TYPES = new Set(['credit_adjustment', 'credit_transfer']);

export function creditMovementKey(type: string): CreditMovementKey | null {
  if (ISSUED_TYPES.has(type)) return 'issued';
  if (APPLIED_TYPES.has(type)) return 'applied';
  if (EXPIRED_TYPES.has(type)) return 'expired';
  if (ADJUSTMENT_TYPES.has(type)) return 'adjustments';
  return null;
}

export interface CreditTransactionRow {
  transactionId: string;
  clientId: string;
  currencyCode: string;
  type: string;
  amount: number;
  createdAt: string;
  /** Transaction metadata — `applied_credits` splits, `reversal_of` / `credit_id` linkage. */
  metadata?: unknown;
  /** Linked ledger transaction (expirations and transfer-outs point at the credit's issuance). */
  relatedTransactionId?: string | null;
}

export interface CreditRollforward {
  opening: number;
  movement: MovementColumns;
  closing: number;
}

export interface ClientCurrencyKey {
  clientId: string;
  currencyCode: string;
}

function keyOf(clientId: string, currencyCode: string): string {
  return `${clientId}\u0000${currencyCode}`;
}

export function parseClientCurrencyKey(key: string): ClientCurrencyKey {
  const separator = key.indexOf('\u0000');
  return {
    clientId: key.slice(0, separator),
    currencyCode: key.slice(separator + 1),
  };
}

/**
 * Build the per-client×currency credits rollforward for one calendar month.
 *
 * @param month 'YYYY-MM'
 * @param transactions every credit-affecting transaction for the tenant
 * @returns map keyed by `${clientId}\u0000${currencyCode}`
 */
export function computeCreditRollforward(
  month: string,
  transactions: CreditTransactionRow[],
): Map<string, CreditRollforward> {
  const [year, monthIndex] = month.split('-').map(Number);
  const monthStart = Date.UTC(year, monthIndex - 1, 1);
  const monthEnd = Date.UTC(year, monthIndex, 1);

  const buckets = new Map<string, CreditRollforward>();

  for (const transaction of transactions) {
    const movementKey = creditMovementKey(transaction.type);
    if (!movementKey) continue;

    const amount = Number(transaction.amount) || 0;
    if (amount === 0) continue;

    const key = keyOf(transaction.clientId, transaction.currencyCode || 'USD');
    const bucket = buckets.get(key) ?? {
      opening: 0,
      movement: emptyMovement(),
      closing: 0,
    };

    const createdMs = Date.parse(transaction.createdAt);
    if (Number.isNaN(createdMs)) continue;

    if (createdMs < monthStart) {
      bucket.opening += amount;
    } else if (createdMs < monthEnd) {
      bucket.movement[movementKey] += amount;
    }
    // Transactions dated at or after the month end are the next month's business.

    buckets.set(key, bucket);
  }

  for (const bucket of buckets.values()) {
    bucket.closing =
      bucket.opening +
      bucket.movement.issued +
      bucket.movement.applied +
      bucket.movement.expired +
      bucket.movement.adjustments;
  }

  return buckets;
}

/**
 * Sum the credits rollforward for a single client×currency. Handy for the
 * tie-out assertion against availableCreditByClientQuery.
 */
export function sumCreditRollforward(
  month: string,
  transactions: CreditTransactionRow[],
  clientId: string,
  currencyCode: string,
): CreditRollforward {
  return (
    computeCreditRollforward(month, transactions).get(keyOf(clientId, currencyCode)) ?? {
      opening: 0,
      movement: emptyMovement(),
      closing: 0,
    }
  );
}

/**
 * The credit_tracking fields the per-credit reconstruction reads. Kept as a
 * structural subset so this pure module never imports the DB layer.
 */
export interface CreditBalanceSource {
  creditId: string;
  transactionId: string;
  clientId: string;
  currencyCode: string;
  amount: number;
  remainingAmount: number;
}

export interface CreditReconstruction {
  /** Outstanding balance reconstructed from the ledger as of the month's end. */
  remainingAsOfMonthEnd: number;
  /** Credit movement attributed to this credit and dated inside the month (signed). */
  inMonthMovement: number;
  /**
   * True when ledger activity for the credit's client×currency pool could not
   * be attributed to a specific credit, forcing the reconstructed value to be
   * capped at the current remaining balance instead of guessed.
   */
  limited: boolean;
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === 'object') return metadata as Record<string, unknown>;
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

interface AppliedCreditSplit {
  creditId?: unknown;
  transactionId?: unknown;
  amount?: unknown;
}

/** `metadata.applied_credits` as written by creditActions.applyCredits: [{creditId, amount, transactionId}]. */
function appliedCreditsOf(metadata: unknown): AppliedCreditSplit[] {
  const applied = normalizeMetadata(metadata).applied_credits;
  if (!Array.isArray(applied)) return [];
  return applied.filter((entry): entry is AppliedCreditSplit => typeof entry === 'object' && entry !== null);
}

function splitMatchesCredit(split: AppliedCreditSplit, credit: CreditBalanceSource): boolean {
  return (
    (typeof split.creditId === 'string' && split.creditId === credit.creditId) ||
    (typeof split.transactionId === 'string' && split.transactionId === credit.transactionId)
  );
}

function creditKeyOf(txn: { clientId: string; currencyCode?: string | null }): string {
  return `${txn.clientId}\u0000${txn.currencyCode || 'USD'}`;
}

interface AdjustmentContribution {
  amount: number;
  inMonth: boolean;
}

/**
 * Apportion an adjustment across the per-credit split recorded by a
 * `credit_application`'s `metadata.applied_credits`, prorated to the
 * adjustment's amount. Every adjustment that reverses an application restores
 * the exact pool the application drew from, so the split is canonical — it must
 * always be read from `applied_credits`, never from the application row's own
 * `related_transaction_id` (the writer loop overwrites that with only the LAST
 * applied credit).
 *
 * Returns the signed per-credit amounts, or null when the application carries
 * no usable `applied_credits` split (genuinely legacy application — the caller
 * keeps treating the adjustment as unattributable).
 */
function attributeViaAppliedCredits(
  application: CreditTransactionRow,
  adjustment: CreditTransactionRow,
  credits: CreditBalanceSource[],
): Map<string, number> | null {
  const split = appliedCreditsOf(application.metadata);
  if (split.length === 0) return null;

  const totalSplit = split.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  const adjustmentAmount = Number(adjustment.amount) || 0;
  const contributions = new Map<string, number>();
  for (const entry of split) {
    const credit = credits.find((candidate) => splitMatchesCredit(entry, candidate));
    if (!credit) continue;
    const share =
      totalSplit !== 0
        ? (Number(entry.amount) || 0) * (adjustmentAmount / totalSplit)
        : adjustmentAmount / split.length;
    contributions.set(credit.creditId, (contributions.get(credit.creditId) ?? 0) + share);
  }
  return contributions.size > 0 ? contributions : null;
}

/**
 * Attribute one credit_adjustment / credit_transfer to the credit(s) it moves,
 * following the ledger's own linkage:
 *
 * 1. `metadata.reversal_of` referencing a credit_application → reuse that
 *    application's `metadata.applied_credits` split, prorated to the
 *    adjustment's amount (invoice-void reversals restore the applied pool).
 * 2. `metadata.credit_id` → the named credit (credit-note-void clawbacks).
 * 3. `related_transaction_id` referencing a credit_application that carries
 *    `metadata.applied_credits` → the same split apportionment as (1).
 *    FinancialService-era reversals write no metadata at all — only
 *    `related_transaction_id` pointing back at the original application — so
 *    the dereferenced application's canonical split is honored here.
 * 4. `related_transaction_id` pointing at a credit's issuance transaction →
 *    that credit (transfer-outs, issuance reversals).
 *
 * Returns the signed per-credit amounts, or null when the adjustment cannot be
 * tied to any credit (genuinely legacy / pre-metadata adjustments whose
 * referenced application carries no `applied_credits`) — the caller then treats
 * it as unattributable instead of guessing.
 */
function attributeAdjustment(
  txn: CreditTransactionRow,
  credits: CreditBalanceSource[],
  creditByTransactionId: Map<string, CreditBalanceSource>,
  transactionById: Map<string, CreditTransactionRow>,
): Map<string, number> | null {
  const meta = normalizeMetadata(txn.metadata);

  const reversalOf = meta.reversal_of;
  if (typeof reversalOf === 'string') {
    const original = transactionById.get(reversalOf);
    if (original && original.type === 'credit_application') {
      const contributions = attributeViaAppliedCredits(original, txn, credits);
      if (contributions) return contributions;
    }
  }

  const creditId = meta.credit_id;
  if (typeof creditId === 'string' && credits.some((credit) => credit.creditId === creditId)) {
    const contributions = new Map<string, number>();
    contributions.set(creditId, Number(txn.amount) || 0);
    return contributions;
  }

  if (txn.relatedTransactionId) {
    const related = transactionById.get(txn.relatedTransactionId);
    if (related && related.type === 'credit_application') {
      const contributions = attributeViaAppliedCredits(related, txn, credits);
      if (contributions) return contributions;
    }
    const credit = creditByTransactionId.get(txn.relatedTransactionId);
    if (credit) {
      const contributions = new Map<string, number>();
      contributions.set(credit.creditId, Number(txn.amount) || 0);
      return contributions;
    }
  }

  return null;
}

/**
 * Reconstruct each credit's remaining balance as of the selected month's end
 * from the `transactions` ledger — not from the *current* `credit_tracking`
 * state. A credit issued in month M-1 and fully applied in month M+1 still
 * shows its full outstanding balance for month M, because the application is
 * dated after M's end.
 *
 * Per credit: issuance amount, minus applications before month end (attributed
 * through `metadata.applied_credits`), minus expirations before month end
 * (linked via `related_transaction_id` → the credit's issuance transaction),
 * plus/minus adjustments before month end (attributed via `reversal_of` /
 * `credit_id` / `related_transaction_id` linkage).
 *
 * Movement that cannot be tied to a specific credit (FinancialService-era /
 * pre-metadata adjustments) is never guessed: the affected client×currency
 * pool's credits are capped at their current remaining balance and flagged
 * `limited` so the report can disclose the limitation.
 */
export function reconstructCreditBalances(
  month: string,
  credits: CreditBalanceSource[],
  transactions: CreditTransactionRow[],
): Map<string, CreditReconstruction> {
  const [year, monthIndex] = month.split('-').map(Number);
  const monthStart = Date.UTC(year, monthIndex - 1, 1);
  const monthEnd = Date.UTC(year, monthIndex, 1);

  const creditByTransactionId = new Map<string, CreditBalanceSource>();
  for (const credit of credits) {
    creditByTransactionId.set(credit.transactionId, credit);
  }

  const datedBeforeMonthEnd = (txn: CreditTransactionRow): boolean => {
    const ms = Date.parse(txn.createdAt);
    return Number.isFinite(ms) && ms < monthEnd;
  };
  const datedInMonth = (txn: CreditTransactionRow): boolean => {
    const ms = Date.parse(txn.createdAt);
    return Number.isFinite(ms) && ms >= monthStart && ms < monthEnd;
  };

  const applicationTxns = transactions.filter(
    (txn) => txn.type === 'credit_application' && datedBeforeMonthEnd(txn),
  );
  const expirationTxns = transactions.filter(
    (txn) => txn.type === 'credit_expiration' && datedBeforeMonthEnd(txn),
  );
  // Transfer-in rows are the target credit's own issuance (their amount is the
  // credit's base, not an adjustment), so the adjustment pass skips them.
  const adjustmentTxns = transactions.filter(
    (txn) =>
      (txn.type === 'credit_adjustment' || txn.type === 'credit_transfer') &&
      datedBeforeMonthEnd(txn) &&
      !creditByTransactionId.has(txn.transactionId),
  );

  const transactionById = new Map<string, CreditTransactionRow>();
  for (const txn of transactions) transactionById.set(txn.transactionId, txn);

  const adjustmentContributions = new Map<string, AdjustmentContribution[]>();
  const groupsWithUnattributable = new Set<string>();

  for (const txn of adjustmentTxns) {
    const contribution = attributeAdjustment(txn, credits, creditByTransactionId, transactionById);
    if (contribution) {
      for (const [creditId, amount] of contribution) {
        const list = adjustmentContributions.get(creditId) ?? [];
        list.push({ amount, inMonth: datedInMonth(txn) });
        adjustmentContributions.set(creditId, list);
      }
    } else {
      groupsWithUnattributable.add(creditKeyOf(txn));
    }
  }

  // An application with no `applied_credits` linkage cannot be attributed to a
  // specific credit either — same do-not-guess treatment as adjustments.
  for (const txn of applicationTxns) {
    const attributedToAnyCredit = appliedCreditsOf(txn.metadata).some((entry) =>
      credits.some((credit) => splitMatchesCredit(entry, credit)),
    );
    if (!attributedToAnyCredit) {
      groupsWithUnattributable.add(creditKeyOf(txn));
    }
  }

  const result = new Map<string, CreditReconstruction>();

  for (const credit of credits) {
    let remaining = Number(credit.amount) || 0;
    let inMonthMovement = 0;

    for (const txn of applicationTxns) {
      if (creditKeyOf(txn) !== creditKeyOf(credit)) continue;
      const split = appliedCreditsOf(txn.metadata).find((entry) => splitMatchesCredit(entry, credit));
      if (!split) continue;
      const share = Number(split.amount) || 0;
      remaining -= share;
      if (datedInMonth(txn)) inMonthMovement -= share;
    }

    for (const txn of expirationTxns) {
      if (txn.relatedTransactionId !== credit.transactionId) continue;
      const amount = Number(txn.amount) || 0;
      remaining += amount; // expiration amounts are negative
      if (datedInMonth(txn)) inMonthMovement += amount;
    }

    for (const contribution of adjustmentContributions.get(credit.creditId) ?? []) {
      remaining += contribution.amount;
      if (contribution.inMonth) inMonthMovement += contribution.amount;
    }

    if (remaining < 0) remaining = 0;

    const limited = groupsWithUnattributable.has(creditKeyOf(credit));
    if (limited) {
      remaining = Math.min(remaining, Number(credit.remainingAmount) || 0);
    }

    result.set(credit.creditId, {
      remainingAsOfMonthEnd: remaining,
      inMonthMovement,
      limited,
    });
  }

  return result;
}
