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
