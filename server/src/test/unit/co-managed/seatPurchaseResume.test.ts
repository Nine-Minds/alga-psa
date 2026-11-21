import { describe, expect, it } from 'vitest';
import { decideCoManagedSeatResume, planCoManagedSeatPurchase } from '@/components/co-managed/seatPurchaseResume';
import {
  clearSeatAllocationIntent, COMANAGED_SEAT_INTENT_TTL_MS, readSeatAllocationIntent, writeSeatAllocationIntent,
} from '@/components/co-managed/seatAllocationIntent';

const OP = '11111111-1111-4111-8111-111111111111';

describe('shortfall and new pool total (F087)', () => {
  it('is not short when available covers the request', () => {
    expect(planCoManagedSeatPurchase(3, { purchased: 10, available: 3 })).toEqual({ short: false });
    expect(planCoManagedSeatPurchase(1, { purchased: 10, available: 6 })).toEqual({ short: false });
  });
  it('buys the absolute total: purchased plus the shortfall, never the shortfall alone', () => {
    expect(planCoManagedSeatPurchase(5, { purchased: 4, available: 2 })).toEqual({ short: true, shortfall: 3, newTotal: 7 });
    expect(planCoManagedSeatPurchase(2, { purchased: 4, available: 0 })).toEqual({ short: true, shortfall: 2, newTotal: 6 });
    expect(planCoManagedSeatPurchase(3, { purchased: 0, available: 0 })).toEqual({ short: true, shortfall: 3, newTotal: 3 });
  });
  it('ignores a request that is not a whole number of seats', () => {
    expect(planCoManagedSeatPurchase(0, { purchased: 4, available: 0 })).toEqual({ short: false });
    expect(planCoManagedSeatPurchase(1.5, { purchased: 4, available: 0 })).toEqual({ short: false });
  });
});

describe('resume decision (F087): completion depends only on capacity, purchase is idempotent by operation', () => {
  const base = { requested: 5, capacity: { purchased: 4, available: 2 }, pending: null, intentPurchase: null };

  it('offers the review for the new total when no purchase exists for the intent', () => {
    expect(decideCoManagedSeatResume(base)).toEqual({ kind: 'review', quantity: 7 });
  });
  it('completes as soon as capacity covers the request, whatever the purchase says', () => {
    const covered = { ...base, capacity: { purchased: 7, available: 5 } };
    expect(decideCoManagedSeatResume(covered)).toEqual({ kind: 'complete' });
    expect(decideCoManagedSeatResume({ ...covered, intentPurchase: { operationId: OP, quantity: 7 } })).toEqual({ kind: 'complete' });
    expect(decideCoManagedSeatResume({ ...covered, pending: { operationId: OP, quantity: 7, state: 'checkout' } })).toEqual({ kind: 'complete' });
  });
  it('waits, and never starts a purchase, while one is preparing or in checkout', () => {
    for (const state of ['preparing', 'checkout']) {
      expect(decideCoManagedSeatResume({ ...base, pending: { operationId: OP, quantity: 7, state } }))
        .toEqual({ kind: 'waiting', operationId: OP, quantity: 7 });
    }
  });
  it('offers to retry the same operation after a payment failure', () => {
    expect(decideCoManagedSeatResume({ ...base, pending: { operationId: OP, quantity: 7, state: 'payment_failed' } }))
      .toEqual({ kind: 'retry', operationId: OP, quantity: 7 });
  });
  it('replays the intent\'s own operation when the server no longer reports it in flight (paid or expired)', () => {
    expect(decideCoManagedSeatResume({ ...base, intentPurchase: { operationId: OP, quantity: 7 } }))
      .toEqual({ kind: 'reconcile', operationId: OP, quantity: 7 });
  });
  it('waits for reconciliation once the operation reported complete and capacity has not caught up', () => {
    expect(decideCoManagedSeatResume({ ...base, intentPurchase: { operationId: OP, quantity: 7 }, settled: true }))
      .toEqual({ kind: 'waiting', operationId: OP, quantity: 7 });
  });
  it('after an expired operation is dropped from the intent, reviews again for the current total', () => {
    expect(decideCoManagedSeatResume({ ...base, capacity: { purchased: 4, available: 1 }, intentPurchase: null }))
      .toEqual({ kind: 'review', quantity: 8 });
  });
  it('never returns review while an operation exists for the intent', () => {
    const withOperation = [
      { ...base, pending: { operationId: OP, quantity: 7, state: 'preparing' } },
      { ...base, pending: { operationId: OP, quantity: 7, state: 'payment_failed' } },
      { ...base, intentPurchase: { operationId: OP, quantity: 7 } },
      { ...base, intentPurchase: { operationId: OP, quantity: 7 }, settled: true },
    ];
    for (const input of withOperation) expect(decideCoManagedSeatResume(input).kind).not.toBe('review');
  });
});

describe('stored allocation intent', () => {
  const store = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  };
  const intent = { clientId: 'c1', operationId: OP, seats: 5, contactId: 'ct', boards: [{ boardId: 'b1', canCreate: true }], purchase: null };

  it('round-trips and survives a second read (a reload)', () => {
    const storage = store();
    writeSeatAllocationIntent({ ...intent, purchase: { operationId: OP, quantity: 7 } }, storage, 1000);
    expect(readSeatAllocationIntent('c1', storage, 2000)).toMatchObject({ seats: 5, purchase: { operationId: OP, quantity: 7 } });
    expect(readSeatAllocationIntent('c1', storage, 2000)).not.toBeNull();
  });
  it('is per client and can be cleared', () => {
    const storage = store();
    writeSeatAllocationIntent(intent, storage, 1000);
    expect(readSeatAllocationIntent('c2', storage, 1000)).toBeNull();
    clearSeatAllocationIntent('c1', storage);
    expect(readSeatAllocationIntent('c1', storage, 1000)).toBeNull();
  });
  it('expires, and ignores corrupt values', () => {
    const storage = store();
    writeSeatAllocationIntent(intent, storage, 1000);
    expect(readSeatAllocationIntent('c1', storage, 1000 + COMANAGED_SEAT_INTENT_TTL_MS + 1)).toBeNull();
    storage.setItem('co-managed-seat-intent:c1', '{not json');
    expect(readSeatAllocationIntent('c1', storage)).toBeNull();
  });
});
