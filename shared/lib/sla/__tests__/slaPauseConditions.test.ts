import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { activeSlaPauseCondition, reevaluateSlaPause, registerSlaPauseCondition, registerSlaPauseReevaluator,
  resetSlaPauseConditionsForTests } from '../slaPauseConditions';

const trx = {} as Knex.Transaction;

describe('SLA pause conditions', () => {
  beforeEach(() => resetSlaPauseConditionsForTests());

  it('resolves to none with no contributor registered, without touching the transaction', async () => {
    const touched = new Proxy({}, { get: () => { throw new Error('touched'); } }) as unknown as Knex.Transaction;
    await expect(activeSlaPauseCondition(touched, 't', 'k')).resolves.toBeNull();
  });

  it('returns the first condition that holds and stops asking', async () => {
    const none = vi.fn(async () => null);
    const holds = vi.fn(async () => 'client_it_responsibility' as const);
    const later = vi.fn(async () => 'client_it_responsibility' as const);
    registerSlaPauseCondition('a', none);
    registerSlaPauseCondition('b', holds);
    registerSlaPauseCondition('c', later);

    await expect(activeSlaPauseCondition(trx, 'tenant', 'ticket')).resolves.toBe('client_it_responsibility');
    expect(none).toHaveBeenCalledWith(trx, 'tenant', 'ticket');
    expect(later).not.toHaveBeenCalled();
  });

  it('registering an id again replaces the earlier contributor', async () => {
    registerSlaPauseCondition('a', async () => 'client_it_responsibility');
    registerSlaPauseCondition('a', async () => null);
    await expect(activeSlaPauseCondition(trx, 't', 'k')).resolves.toBeNull();
  });
});

describe('SLA pause re-evaluation port', () => {
  beforeEach(() => resetSlaPauseConditionsForTests());

  it('throws with no re-evaluator registered, so a caller committing its change with the clock rolls back', async () => {
    await expect(reevaluateSlaPause(trx, 'tenant', 'ticket', 'actor')).rejects.toThrow(/not registered/);
  });

  it('hands the transaction, ticket and actor to the registered re-evaluator', async () => {
    const reevaluator = vi.fn(async () => undefined);
    registerSlaPauseReevaluator(reevaluator);
    await reevaluateSlaPause(trx, 'tenant', 'ticket', 'actor');
    expect(reevaluator).toHaveBeenCalledWith(trx, 'tenant', 'ticket', 'actor');
  });

  it('propagates a re-evaluation failure to the caller', async () => {
    registerSlaPauseReevaluator(async () => { throw new Error('boom'); });
    await expect(reevaluateSlaPause(trx, 'tenant', 'ticket')).rejects.toThrow(/boom/);
  });
});
