import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchTicketLifecycle,
  registerTicketLifecycleHandler,
  resetTicketLifecycleHandlers,
} from '../ticketLifecycleHooks';

function countingTrx() {
  const queries: string[] = [];
  const trx: any = new Proxy(function () {}, { get(_t, p) { queries.push(String(p)); return undefined; } });
  return { trx, queries };
}

const resolved = { kind: 'resolved', tenant: 't', ticketId: 'k' } as const;

afterEach(() => {
  resetTicketLifecycleHandlers();
  vi.restoreAllMocks();
});

describe('ticketLifecycleHooks', () => {
  it('with no handlers resolves and touches nothing', async () => {
    const { trx, queries } = countingTrx();
    await expect(dispatchTicketLifecycle(trx, resolved)).resolves.toBeUndefined();
    expect(queries).toEqual([]);
  });

  it('runs handlers of the matching kind in registration order', async () => {
    const { trx } = countingTrx();
    const order: string[] = [];
    registerTicketLifecycleHandler('resolved', () => { order.push('a'); });
    registerTicketLifecycleHandler('reopened', () => { order.push('x'); });
    registerTicketLifecycleHandler('resolved', async () => { order.push('b'); });
    await dispatchTicketLifecycle(trx, resolved);
    expect(order).toEqual(['a', 'b']);
  });

  it('isolates a handler error by default, logs context and continues', async () => {
    const { trx } = countingTrx();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    registerTicketLifecycleHandler('resolved', function boom() { throw new Error('nope'); });
    registerTicketLifecycleHandler('resolved', after);
    await expect(dispatchTicketLifecycle(trx, resolved)).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: 'resolved', tenant: 't', ticketId: 'k', handler: 'boom' }));
  });

  it('propagates the error of a rollback handler and stops', async () => {
    const { trx } = countingTrx();
    const after = vi.fn();
    registerTicketLifecycleHandler('awaitingClient', () => { throw new Error('must not miss'); }, { onError: 'rollback' });
    registerTicketLifecycleHandler('awaitingClient', after);
    await expect(dispatchTicketLifecycle(trx, { kind: 'awaitingClient', tenant: 't', ticketId: 'k', previous: null, next: 'x' })).rejects.toThrow('must not miss');
    expect(after).not.toHaveBeenCalled();
  });
});
