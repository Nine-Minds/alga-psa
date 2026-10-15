import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  notifyAccountingConnectionChanged,
  registerAccountingConnectionChangeHandler,
} from './accountingConnectionChangeProvider';
import {
  notifyQboConnectionChanged,
  registerQboConnectionChangeHandler,
} from './qbo/qboConnectionChangeProvider';

const HANDLER_KEY = Symbol.for('alga.integrations.accountingConnectionChangeHandler');

beforeEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[HANDLER_KEY];
});

afterEach(() => {
  delete (globalThis as Record<PropertyKey, unknown>)[HANDLER_KEY];
});

describe('accounting connection change provider', () => {
  it('notifies the registered provider-neutral handler', async () => {
    const handler = vi.fn(async () => undefined);
    registerAccountingConnectionChangeHandler(handler);

    await notifyAccountingConnectionChanged('tenant-1');

    expect(handler).toHaveBeenCalledWith('tenant-1');
  });

  it('keeps the legacy QBO aliases on the same shared seam', async () => {
    const handler = vi.fn(async () => undefined);
    registerQboConnectionChangeHandler(handler);

    await notifyAccountingConnectionChanged('tenant-2');
    await notifyQboConnectionChanged('tenant-3');

    expect(handler).toHaveBeenNthCalledWith(1, 'tenant-2');
    expect(handler).toHaveBeenNthCalledWith(2, 'tenant-3');
  });

  it('is a no-op without a handler and never leaks convergence failures', async () => {
    await expect(notifyAccountingConnectionChanged('tenant-4')).resolves.toBeUndefined();

    registerAccountingConnectionChangeHandler(async () => {
      throw new Error('scheduler unavailable');
    });
    await expect(notifyAccountingConnectionChanged('tenant-4')).resolves.toBeUndefined();
  });
});
