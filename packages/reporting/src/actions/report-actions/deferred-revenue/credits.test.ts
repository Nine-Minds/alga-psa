import { describe, expect, it } from 'vitest';

import {
  computeCreditRollforward,
  creditMovementKey,
  sumCreditRollforward,
  type CreditTransactionRow,
} from './credits';

const JAN = '2026-01-15T10:00:00.000Z';
const FEB = '2026-02-15T10:00:00.000Z';
const MAR = '2026-03-15T10:00:00.000Z';
const APR = '2026-04-15T10:00:00.000Z';

function txn(over: Partial<CreditTransactionRow>): CreditTransactionRow {
  return {
    transactionId: 'txn-1',
    clientId: 'client-1',
    currencyCode: 'USD',
    type: 'credit_issuance',
    amount: 0,
    createdAt: FEB,
    ...over,
  };
}

describe('creditMovementKey sign-convention bucket mapping', () => {
  it('maps every credit-affecting type to the correct movement column', () => {
    expect(creditMovementKey('credit_issuance')).toBe('issued');
    expect(creditMovementKey('credit_issuance_from_negative_invoice')).toBe('issued');
    expect(creditMovementKey('prepayment')).toBe('issued');
    expect(creditMovementKey('credit_application')).toBe('applied');
    expect(creditMovementKey('credit_expiration')).toBe('expired');
    expect(creditMovementKey('credit_adjustment')).toBe('adjustments');
    expect(creditMovementKey('credit_transfer')).toBe('adjustments');
    // Non-credit ledger rows must not leak into the rollforward.
    expect(creditMovementKey('payment')).toBeNull();
    expect(creditMovementKey('invoice_generated')).toBeNull();
    expect(creditMovementKey('invoice_cancelled')).toBeNull();
  });

  it('assigns the signed amounts verified against creditActions.ts', () => {
    // Sign conventions from creditActions.ts / expiredCreditsHandler.ts:
    // issuances grant (+), application/expiration consume (-), adjustments can
    // go either way, transfers move liability between clients (+/-).
    const transactions: CreditTransactionRow[] = [
      txn({ type: 'credit_issuance', amount: 1000, createdAt: FEB }),
      txn({ type: 'credit_issuance_from_negative_invoice', amount: 250, createdAt: FEB }),
      txn({ type: 'credit_application', amount: -400, createdAt: FEB }),
      txn({ type: 'credit_expiration', amount: -600, createdAt: FEB }),
      txn({ type: 'credit_adjustment', amount: 150, createdAt: FEB }),
      txn({ type: 'credit_transfer', amount: -75, createdAt: FEB }),
    ];

    const rollforward = computeCreditRollforward('2026-02', transactions).get(
      'client-1\u0000USD',
    );
    expect(rollforward?.movement).toEqual({
      opening: 0,
      issued: 1250,
      applied: -400,
      expired: -600,
      adjustments: 75,
      closing: 0,
    });
    expect(rollforward?.closing).toBe(1250 - 400 - 600 + 75);
  });
});

describe('credits rollforward month boundaries', () => {
  it('puts pre-month transactions in opening and in-month in movement', () => {
    const transactions: CreditTransactionRow[] = [
      txn({ transactionId: 'a', type: 'credit_issuance', amount: 5000, createdAt: JAN }),
      txn({ transactionId: 'b', type: 'credit_issuance', amount: 2000, createdAt: FEB }),
      txn({ transactionId: 'c', type: 'credit_application', amount: -1500, createdAt: FEB }),
      txn({ transactionId: 'd', type: 'credit_issuance', amount: 900, createdAt: MAR }),
    ];

    const feb = computeCreditRollforward('2026-02', transactions).get('client-1\u0000USD');
    expect(feb?.opening).toBe(5000);
    expect(feb?.movement.issued).toBe(2000);
    expect(feb?.movement.applied).toBe(-1500);
    expect(feb?.closing).toBe(5000 + 2000 - 1500);

    const mar = computeCreditRollforward('2026-03', transactions).get('client-1\u0000USD');
    expect(mar?.opening).toBe(5000 + 2000 - 1500);
    expect(mar?.movement.issued).toBe(900);
    expect(mar?.closing).toBe(5000 + 2000 - 1500 + 900);
  });

  it('ignores transactions dated in the following month', () => {
    const transactions: CreditTransactionRow[] = [
      txn({ type: 'credit_issuance', amount: 1000, createdAt: FEB }),
      txn({ type: 'credit_issuance', amount: 1000, createdAt: MAR }),
      txn({ type: 'credit_issuance', amount: 1000, createdAt: APR }),
    ];
    const feb = computeCreditRollforward('2026-02', transactions).get('client-1\u0000USD');
    expect(feb?.opening).toBe(0);
    expect(feb?.movement.issued).toBe(1000);
    expect(feb?.closing).toBe(1000);
  });

  it('groups per client and currency without mixing', () => {
    const transactions: CreditTransactionRow[] = [
      txn({ clientId: 'client-1', currencyCode: 'USD', amount: 1000, createdAt: FEB }),
      txn({ clientId: 'client-1', currencyCode: 'EUR', amount: 500, createdAt: FEB }),
      txn({ clientId: 'client-2', currencyCode: 'USD', amount: 250, createdAt: FEB }),
    ];
    const rollforward = computeCreditRollforward('2026-02', transactions);
    expect(rollforward.get('client-1\u0000USD')?.closing).toBe(1000);
    expect(rollforward.get('client-1\u0000EUR')?.closing).toBe(500);
    expect(rollforward.get('client-2\u0000USD')?.closing).toBe(250);
  });
});

describe('tie-out invariant against availableCreditByClientQuery', () => {
  // availableCreditByClientQuery (packages/billing/src/lib/creditBalance.ts)
  // sums credit_tracking.remaining_amount where is_expired = false and the
  // expiration date has not passed. The ledger rollforward must reconstruct
  // the same number for the current month when every expiration has been
  // written to the ledger (the expiry job has run).
  it('closing equals the derived available credit for the current month', () => {
    const transactions: CreditTransactionRow[] = [
      // Prepayment credit, 3000 issued, 0 used.
      txn({ transactionId: 'a', type: 'credit_issuance', amount: 3000, createdAt: JAN }),
      // Negative-invoice credit, 1000 issued, 400 applied.
      txn({ transactionId: 'b', type: 'credit_issuance_from_negative_invoice', amount: 1000, createdAt: JAN }),
      txn({ transactionId: 'c', type: 'credit_application', amount: -400, createdAt: FEB }),
      // Direct grant, 800 issued, expired in full in February.
      txn({ transactionId: 'd', type: 'credit_issuance', amount: 800, createdAt: JAN }),
      txn({ transactionId: 'e', type: 'credit_expiration', amount: -800, createdAt: FEB }),
    ];

    // Derived available credit: 3000 + (1000 - 400) = 3600 (the expired grant
    // is gone). All expiry-related state agrees between ledger and tracking.
    const currentMonth = computeCreditRollforward('2026-02', transactions).get('client-1\u0000USD');
    expect(currentMonth?.closing).toBe(3600);
    expect(currentMonth?.opening).toBe(3000 + 1000 + 800);
    expect(currentMonth?.closing).toBe(
      currentMonth!.opening + currentMonth!.movement.applied + currentMonth!.movement.expired,
    );
  });

  it('opening of the next month equals closing of the current month', () => {
    const transactions: CreditTransactionRow[] = [
      txn({ transactionId: 'a', type: 'credit_issuance', amount: 2000, createdAt: JAN }),
      txn({ transactionId: 'b', type: 'credit_application', amount: -500, createdAt: FEB }),
    ];
    const feb = sumCreditRollforward('2026-02', transactions, 'client-1', 'USD');
    const mar = sumCreditRollforward('2026-03', transactions, 'client-1', 'USD');
    expect(feb.closing).toBe(1500);
    expect(mar.opening).toBe(feb.closing);
  });
});
