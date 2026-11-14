import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { activeSlaPauseCondition, registerSlaPauseCondition, resetSlaPauseConditionsForTests } from '../slaPauseConditions';

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
